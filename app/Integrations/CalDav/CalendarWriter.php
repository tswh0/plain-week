<?php

namespace App\Integrations\CalDav;

use App\Actions\Sync\VersionCounter;
use App\Enums\TaskColor;
use App\Models\Task;
use App\Models\User;
use App\Tasks\Position;
use App\Tasks\TaskOccurrences;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\VObject\ParseException;
use Sabre\VObject\Reader;

/**
 * Applies CalDAV writes to the planner: a VEVENT becomes a timed task, a VTODO an untimed one (Someday when it has no
 * due date). Occurrence hrefs (`series:date`) edit the occurrence as an exception row, so the series itself is never
 * rewritten by a client. Every write reserves a sync version, so the phone and the web app pull the change.
 */
final class CalendarWriter
{
    /** RFC 7986 colour names back to the planner's palette. */
    private const array COLORS = [
        'PINK' => 'pink',
        'YELLOW' => 'yellow',
        'BLACK' => 'black',
        'GREY' => 'grey',
        'GRAY' => 'grey',
        'CORNFLOWERBLUE' => 'cornflower',
        'ORANGE' => 'mango',
        'GREEN' => 'green',
        'MEDIUMPURPLE' => 'lilac',
    ];

    private const array UNSUPPORTED = ['RDATE'];

    public function __construct(
        private readonly CalendarObjects $objects,
        private readonly VersionCounter $versions,
    ) {}

    public function put(
        User $user,
        Collection $collection,
        string $key,
        string $body,
        ?string $ifMatch,
        bool $ifNoneMatch,
    ): WriteResult {
        try {
            $data = $this->read($body, $collection, $user->timezoneOrDefault());
        } catch (CalDavWriteException $exception) {
            return WriteResult::failed($exception->status, $exception->getMessage());
        }

        try {
            return str_contains($key, ':')
                ? $this->putOccurrence($user, $collection, $key, $data, $ifMatch, $ifNoneMatch)
                : $this->putTask($user, $collection, $key, $data, $ifMatch, $ifNoneMatch);
        } catch (CalDavWriteException $exception) {
            return WriteResult::failed($exception->status, $exception->getMessage());
        }
    }

    public function delete(User $user, Collection $collection, string $key, ?string $ifMatch): WriteResult
    {
        try {
            return str_contains($key, ':')
                ? $this->deleteOccurrence($user, $collection, $key, $ifMatch)
                : $this->deleteTask($user, $collection, $key, $ifMatch);
        } catch (CalDavWriteException $exception) {
            return WriteResult::failed($exception->status, $exception->getMessage());
        }
    }

    private function putTask(
        User $user,
        Collection $collection,
        string $key,
        CalendarData $data,
        ?string $ifMatch,
        bool $ifNoneMatch,
    ): WriteResult {
        $existing = Task::query()->where('user_id', $user->id)->where('id', $key)->first();

        if ($existing !== null && ($existing->recurrence !== null || $existing->series_id !== null)) {
            throw new CalDavWriteException(404, 'Not Found');
        }

        $current = $existing !== null && $existing->deleted_at === null
            ? $this->objects->forKey($user, $collection, $key)
            : null;

        if ($existing !== null && $existing->deleted_at === null && $current === null) {
            throw new CalDavWriteException(404, 'Not Found');
        }

        $this->checkPreconditions($current, $ifMatch, $ifNoneMatch);

        if ($data->recurrenceId !== null) {
            throw new CalDavWriteException(409, 'RECURRENCE-ID belongs on an occurrence href.');
        }

        if ($data->recurrence !== null && $existing !== null && $existing->deleted_at === null) {
            throw new CalDavWriteException(409, 'Create a new event to start a series.');
        }

        $isSeries = $data->recurrence !== null;

        if ($isSeries && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $key) !== 1) {
            throw new CalDavWriteException(409, 'A new series needs a UUID resource name.');
        }

        if ($isSeries && $data->date === null) {
            throw new CalDavWriteException(409, 'A recurring item needs a date.');
        }

        $exdates = $isSeries ? $this->matchingExdates($data->date, $data->recurrence, $data->exdates) : [];
        $firstDate = $isSeries ? $this->firstOccurrence((string) $data->date, $data->recurrence, $exdates) : null;

        if ($isSeries && $firstDate === null) {
            throw new CalDavWriteException(409, 'The series has no occurrence.');
        }

        $id = $existing === null ? $this->idFor($key) : $existing->id;

        if ($existing === null && Task::query()->where('id', $id)->where('user_id', '!=', $user->id)->exists()) {
            throw new CalDavWriteException(409, 'That id is already taken.');
        }

        $now = CarbonImmutable::now('UTC');
        $isNew = $current === null;
        [$position, $column] = $isNew ? $this->placement($user, $data->date) : [$existing->position, $existing->someday_column];
        $color = $data->colorGiven ? $data->color : ($existing === null ? TaskColor::None : $existing->color);

        DB::transaction(function () use ($user, $existing, $id, $data, $position, $column, $now, $isNew, $isSeries, $exdates, $color): void {
            $versions = $this->versions->reserve(1 + count($exdates));
            $task = $existing ?? new Task;
            $done = $data->doneGiven ? $data->done : ($existing !== null && $existing->done);

            $task->fill([
                'id' => $id,
                'text' => $data->text,
                'date' => $data->date,
                'someday_column' => $data->date === null ? ($existing === null ? ($column ?? 0) : $existing->someday_column) : null,
                'position' => $isNew ? $position : $existing->position,
                'done' => $done,
                'done_at' => $done ? ($data->doneAt ?? ($existing === null ? null : $existing->done_at) ?? $now) : null,
                'color' => $color,
                'time' => $data->time,
                'duration_minutes' => $data->time === null ? null : ($data->durationMinutes ?? Ics::DEFAULT_MINUTES),
                'notes' => $data->notes,
                'subtasks' => $existing === null ? [] : $existing->subtasks,
                'recurrence' => $data->recurrence,
                'series_id' => null,
                'occurrence_date' => null,
                'created_at' => $existing === null ? $now : $existing->created_at,
                'updated_at' => $now,
                'deleted_at' => null,
            ]);
            $task->user_id = $user->id;
            $task->version = $versions;
            $task->save();

            if ($isSeries) {
                foreach ($exdates as $index => $exdate) {
                    $tombstone = new Task;
                    $tombstone->fill([
                        'id' => (string) Str::uuid7(),
                        'text' => $data->text,
                        'date' => $exdate,
                        'someday_column' => null,
                        'position' => $position,
                        'done' => false,
                        'done_at' => null,
                        'color' => $color,
                        'time' => $data->time,
                        'duration_minutes' => $data->time === null ? null : ($data->durationMinutes ?? Ics::DEFAULT_MINUTES),
                        'notes' => $data->notes,
                        'subtasks' => [],
                        'recurrence' => null,
                        'series_id' => $id,
                        'occurrence_date' => $exdate,
                        'created_at' => $now,
                        'updated_at' => $now,
                        'deleted_at' => $now,
                    ]);
                    $tombstone->user_id = $user->id;
                    $tombstone->version = $versions + 1 + $index;
                    $tombstone->save();
                }
            }
        });

        if ($isSeries) {
            $firstKey = $id.':'.$firstDate;
            $object = $this->objects->forKey($user, $collection, $firstKey);

            if ($object === null) {
                throw new CalDavWriteException(500, 'The series was saved but cannot be read back.');
            }

            return WriteResult::created($object, $collection->objectHref($user, $firstKey));
        }

        $object = $this->objects->forKey($user, $collection, $id);

        if ($object === null) {
            throw new CalDavWriteException(500, 'The task was saved but cannot be read back.');
        }

        return $isNew
            ? WriteResult::created($object, $collection->objectHref($user, $id))
            : WriteResult::updated($object);
    }

    private function putOccurrence(
        User $user,
        Collection $collection,
        string $key,
        CalendarData $data,
        ?string $ifMatch,
        bool $ifNoneMatch,
    ): WriteResult {
        [$series, $date] = $this->series($user, $key);
        $winner = $this->winner($user, $series, $date);
        $current = $winner !== null && $winner->deleted_at !== null
            ? null
            : $this->objects->forKey($user, $collection, $key);

        if ($winner === null && $current === null) {
            throw new CalDavWriteException(404, 'Not Found');
        }

        $this->checkPreconditions($current, $ifMatch, $ifNoneMatch);

        if ($data->recurrence !== null) {
            throw new CalDavWriteException(409, 'An RRULE belongs on the series, not on one occurrence.');
        }

        if ($data->exdates !== []) {
            throw new CalDavWriteException(409, 'EXDATE belongs on the series, not on one occurrence.');
        }

        if ($data->recurrenceId !== null && $data->recurrenceId !== $date) {
            throw new CalDavWriteException(409, 'RECURRENCE-ID does not match this occurrence.');
        }

        if ($data->date === null) {
            throw new CalDavWriteException(409, 'An occurrence needs a date.');
        }

        $now = CarbonImmutable::now('UTC');
        $existed = $winner === null || $winner->deleted_at === null;

        DB::transaction(function () use ($user, $series, $date, $winner, $data, $now): void {
            $version = $this->versions->reserve();
            $task = $winner ?? new Task;

            $task->fill([
                'id' => $winner === null ? (string) Str::uuid7() : $winner->id,
                'text' => $data->text,
                'date' => $data->date,
                'someday_column' => null,
                'position' => $series->position,
                'done' => $data->done,
                'done_at' => $data->done ? ($data->doneAt ?? $now) : null,
                'color' => $data->colorGiven ? $data->color : ($winner === null ? $series->color : $winner->color),
                'time' => $data->time,
                'duration_minutes' => $data->time === null ? null : ($data->durationMinutes ?? Ics::DEFAULT_MINUTES),
                'notes' => $data->notes,
                'subtasks' => $winner === null ? [] : $winner->subtasks,
                'recurrence' => null,
                'series_id' => $series->id,
                'occurrence_date' => $date,
                'created_at' => $winner === null ? $now : $winner->created_at,
                'updated_at' => $now,
                'deleted_at' => null,
            ]);
            $task->user_id = $user->id;
            $task->version = $version;
            $task->save();
        });

        $object = $this->objects->forKey($user, $collection, $key);

        if ($object === null) {
            throw new CalDavWriteException(500, 'The occurrence was saved but cannot be read back.');
        }

        return $existed
            ? WriteResult::updated($object)
            : WriteResult::created($object, $collection->objectHref($user, $key));
    }

    private function deleteTask(User $user, Collection $collection, string $key, ?string $ifMatch): WriteResult
    {
        $task = Task::query()->where('user_id', $user->id)->where('id', $key)->first();

        if ($task === null || $task->deleted_at !== null || $task->series_id !== null) {
            throw new CalDavWriteException(404, 'Not Found');
        }

        if ($task->recurrence !== null) {
            return $this->deleteSeries($user, $task, $ifMatch);
        }

        $current = $this->objects->forKey($user, $collection, $key);

        if ($current === null) {
            throw new CalDavWriteException(404, 'Not Found');
        }

        $this->checkPreconditions($current, $ifMatch, false);

        $now = CarbonImmutable::now('UTC');

        DB::transaction(function () use ($task, $now): void {
            $task->deleted_at = $now;
            $task->updated_at = $now;
            $task->version = $this->versions->reserve();
            $task->save();
        });

        return WriteResult::deleted();
    }

    private function deleteSeries(User $user, Task $series, ?string $ifMatch): WriteResult
    {
        if ($ifMatch !== null) {
            throw new CalDavWriteException(412, 'Precondition Failed');
        }

        $now = CarbonImmutable::now('UTC');

        DB::transaction(function () use ($user, $series, $now): void {
            $exceptions = Task::query()
                ->where('user_id', $user->id)
                ->where('series_id', $series->id)
                ->whereNull('deleted_at')
                ->get();

            $versions = $this->versions->reserve(1 + $exceptions->count());

            $series->deleted_at = $now;
            $series->updated_at = $now;
            $series->version = $versions;
            $series->save();

            foreach ($exceptions as $index => $exception) {
                $exception->deleted_at = $now;
                $exception->updated_at = $now;
                $exception->version = $versions + 1 + $index;
                $exception->save();
            }
        });

        return WriteResult::deleted();
    }

    private function deleteOccurrence(User $user, Collection $collection, string $key, ?string $ifMatch): WriteResult
    {
        [$series, $date] = $this->series($user, $key);
        $winner = $this->winner($user, $series, $date);
        $current = $winner !== null && $winner->deleted_at !== null
            ? null
            : $this->objects->forKey($user, $collection, $key);

        if ($winner !== null && $winner->deleted_at !== null) {
            throw new CalDavWriteException(404, 'Not Found');
        }

        if ($current === null) {
            throw new CalDavWriteException(404, 'Not Found');
        }

        $this->checkPreconditions($current, $ifMatch, false);

        $now = CarbonImmutable::now('UTC');

        DB::transaction(function () use ($user, $series, $date, $winner, $now): void {
            $version = $this->versions->reserve();
            $task = $winner ?? new Task;

            $task->fill([
                'id' => $winner === null ? (string) Str::uuid7() : $winner->id,
                'text' => $winner === null ? $series->text : $winner->text,
                'date' => $winner === null ? $date : $winner->date,
                'someday_column' => null,
                'position' => $winner === null ? $series->position : $winner->position,
                'done' => $winner !== null && $winner->done,
                'done_at' => $winner === null ? null : $winner->done_at,
                'color' => $winner === null ? $series->color : $winner->color,
                'time' => $winner === null ? $series->time : $winner->time,
                'duration_minutes' => $winner === null ? $series->duration_minutes : $winner->duration_minutes,
                'notes' => $winner === null ? $series->notes : $winner->notes,
                'subtasks' => $winner === null ? [] : $winner->subtasks,
                'recurrence' => null,
                'series_id' => $series->id,
                'occurrence_date' => $date,
                'created_at' => $winner === null ? $now : $winner->created_at,
                'updated_at' => $now,
                'deleted_at' => $now,
            ]);
            $task->user_id = $user->id;
            $task->version = $version;
            $task->save();
        });

        return WriteResult::deleted();
    }

    private function read(string $body, Collection $collection, string $timeZone): CalendarData
    {
        if (trim($body) === '') {
            throw new CalDavWriteException(400, 'Empty calendar object.');
        }

        try {
            $document = Reader::read($body);
        } catch (ParseException) {
            throw new CalDavWriteException(400, 'Invalid iCalendar.');
        }

        $events = $document->select('VEVENT');
        $todos = $document->select('VTODO');

        if (count($events) + count($todos) !== 1) {
            throw new CalDavWriteException(409, 'Send exactly one event or task.');
        }

        $component = $events[0] ?? $todos[0];

        if (($events !== []) !== ($collection === Collection::Events)) {
            throw new CalDavWriteException(409, 'This collection holds '.$collection->component().' objects.');
        }

        foreach (self::UNSUPPORTED as $name) {
            if (isset($component->{$name})) {
                throw new CalDavWriteException(409, 'Only simple recurrence rules are editable over CalDAV.');
            }
        }

        $recurrence = RecurrenceRule::from($component, $timeZone);
        $exdates = RecurrenceRule::exdates($component, $timeZone);
        $recurrenceId = RecurrenceRule::recurrenceId($component, $timeZone);

        if ($exdates !== [] && $recurrence === null) {
            throw new CalDavWriteException(409, 'EXDATE needs an RRULE.');
        }

        $text = trim((string) $component->SUMMARY);
        $doneFromText = str_starts_with($text, '✅ ');
        $text = Str::limit(trim($doneFromText ? substr($text, 3) : $text) ?: 'Untitled', 1000, '');
        $notes = (string) $component->DESCRIPTION;
        $notes = preg_replace('/\n\nOpen in Plain Week: \S+\s*$/u', '', $notes) ?? $notes;
        $notes = Str::limit(trim($notes), 6000, '');
        $colorGiven = isset($component->COLOR);
        $color = $colorGiven
            ? TaskColor::tryFrom(self::COLORS[strtoupper(trim((string) $component->COLOR))] ?? '') ?? TaskColor::None
            : TaskColor::None;

        if ($collection === Collection::Events) {
            $start = $component->DTSTART;

            if ($start === null) {
                throw new CalDavWriteException(409, 'An event needs a start.');
            }

            if ($start->getValueType() === 'DATE') {
                throw new CalDavWriteException(409, 'Events need a time; create all-day items as reminders.');
            }

            $local = CarbonImmutable::instance($start->getDateTime())->setTimezone($timeZone);
            $duration = Ics::DEFAULT_MINUTES;

            if (isset($component->DTEND)) {
                $minutes = (int) round($local->diffInMinutes(CarbonImmutable::instance($component->DTEND->getDateTime()), false));

                if ($minutes >= 1 && $minutes <= 1440) {
                    $duration = $minutes;
                }
            } elseif (isset($component->DURATION)) {
                $interval = $component->DURATION->getDateInterval();
                $minutes = ((int) $interval->days * 1440) + ($interval->h * 60) + $interval->i;

                if (! $interval->invert && $minutes >= 1 && $minutes <= 1440) {
                    $duration = $minutes;
                }
            }

            $doneGiven = $doneFromText || isset($component->{'X-PLAIN-WEEK-DONE'});
            $done = $doneFromText || strtoupper(trim((string) $component->{'X-PLAIN-WEEK-DONE'})) === 'TRUE';

            return new CalendarData(
                text: $text,
                notes: $notes,
                date: $local->toDateString(),
                time: $local->format('H:i'),
                durationMinutes: $duration,
                done: $done,
                doneGiven: $doneGiven,
                doneAt: null,
                color: $color,
                colorGiven: $colorGiven,
                recurrence: $recurrence,
                exdates: $exdates,
                recurrenceId: $recurrenceId,
            );
        }

        $due = $component->DUE ?? $component->DTSTART;
        $date = null;

        if ($due !== null) {
            if ($due->getValueType() === 'DATE') {
                $parsed = CarbonImmutable::createFromFormat('!Ymd', $due->getValue(), 'UTC');
                $date = $parsed instanceof CarbonImmutable ? $parsed->toDateString() : null;
            } else {
                throw new CalDavWriteException(409, 'Reminders are all-day; create timed items in the Events calendar.');
            }
        }

        $done = strtoupper(trim((string) $component->STATUS)) === 'COMPLETED'
            || trim((string) $component->{'PERCENT-COMPLETE'}) === '100';
        $doneAt = isset($component->COMPLETED)
            ? CarbonImmutable::instance($component->COMPLETED->getDateTime())->utc()
            : null;

        if ($recurrence !== null && $date === null) {
            throw new CalDavWriteException(409, 'A recurring task needs a due date.');
        }

        return new CalendarData(
            text: $text,
            notes: $notes,
            date: $date,
            time: null,
            durationMinutes: null,
            done: $done,
            doneGiven: true,
            doneAt: $done ? ($doneAt ?? CarbonImmutable::now('UTC')) : null,
            color: $color,
            colorGiven: $colorGiven,
            recurrence: $recurrence,
            exdates: $exdates,
            recurrenceId: $recurrenceId,
        );
    }

    /**
     * @return array{Task, string}
     */
    private function series(User $user, string $key): array
    {
        [$seriesId, $date] = explode(':', $key, 2);

        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw new CalDavWriteException(404, 'Not Found');
        }

        $series = Task::query()
            ->where('user_id', $user->id)
            ->where('id', $seriesId)
            ->whereNotNull('recurrence')
            ->whereNull('deleted_at')
            ->first();

        if ($series === null || $series->date === null) {
            throw new CalDavWriteException(404, 'Not Found');
        }

        return [$series, $date];
    }

    private function winner(User $user, Task $series, string $date): ?Task
    {
        return TaskOccurrences::winningException(
            Task::query()
                ->where('user_id', $user->id)
                ->where('series_id', $series->id)
                ->where('occurrence_date', $date)
                ->get(),
        );
    }

    private function checkPreconditions(?CalendarObject $current, ?string $ifMatch, bool $ifNoneMatch): void
    {
        if ($ifMatch !== null && ($current === null || ! $this->etagMatches($ifMatch, $current->etag))) {
            throw new CalDavWriteException(412, 'Precondition Failed');
        }

        if ($ifNoneMatch && $current !== null) {
            throw new CalDavWriteException(412, 'Precondition Failed');
        }
    }

    private function etagMatches(string $header, string $etag): bool
    {
        foreach (explode(',', $header) as $candidate) {
            $candidate = trim($candidate);

            if ($candidate === '*' || $candidate === $etag || (str_starts_with($candidate, 'W/') && substr($candidate, 2) === $etag)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The EXDATEs that fall inside the series and match its rule; the rest are ignored.
     *
     * @param  array{type: 'daily'|'weekly'|'monthly', every?: int, weekdays?: list<int>, day?: int, until?: string|null}  $recurrence
     * @param  list<string>  $exdates
     * @return list<string>
     */
    private function matchingExdates(?string $date, array $recurrence, array $exdates): array
    {
        if ($date === null) {
            return [];
        }

        $until = $recurrence['until'] ?? null;
        $matches = array_filter(array_unique($exdates), function (string $exdate) use ($date, $recurrence, $until): bool {
            if ($exdate < $date || ($until !== null && $exdate > $until)) {
                return false;
            }

            return TaskOccurrences::matchesRule($recurrence, $date, $exdate);
        });

        sort($matches);

        return $matches;
    }

    /**
     * The first date a new series shows on, skipping its EXDATEs. Bounded to two years so a pathological rule cannot
     * spin here.
     *
     * @param  array{type: 'daily'|'weekly'|'monthly', every?: int, weekdays?: list<int>, day?: int, until?: string|null}  $recurrence
     * @param  list<string>  $exdates
     */
    private function firstOccurrence(string $date, array $recurrence, array $exdates): ?string
    {
        $day = CarbonImmutable::parse($date, 'UTC');
        $last = CarbonImmutable::parse($recurrence['until'] ?? $day->addYears(2)->toDateString(), 'UTC');
        $excluded = array_flip($exdates);

        for ($i = 0; $i < 800 && $day->lessThanOrEqualTo($last); $i++, $day = $day->addDay()) {
            $candidate = $day->toDateString();

            if (! isset($excluded[$candidate]) && TaskOccurrences::matchesRule($recurrence, $date, $candidate)) {
                return $candidate;
            }
        }

        return null;
    }

    private function idFor(string $key): string
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $key) === 1
            ? $key
            : (string) Str::uuid7();
    }

    /**
     * @return array{string, int|null}
     */
    private function placement(User $user, ?string $date): array
    {
        if ($date !== null) {
            $last = Task::query()
                ->where('user_id', $user->id)
                ->where('date', $date)
                ->whereNull('deleted_at')
                ->orderByDesc('position')
                ->value('position');

            return [Position::after(is_string($last) ? $last : null), null];
        }

        $last = Task::query()
            ->where('user_id', $user->id)
            ->whereNull('date')
            ->whereNull('series_id')
            ->whereNull('deleted_at')
            ->orderByDesc('someday_column')
            ->orderByDesc('position')
            ->first(['position', 'someday_column']);

        return $last === null
            ? ['a0', 0]
            : [Position::after($last->position), $last->someday_column ?? 0];
    }
}
