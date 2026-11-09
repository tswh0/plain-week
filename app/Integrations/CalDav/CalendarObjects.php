<?php

namespace App\Integrations\CalDav;

use App\Models\Task;
use App\Models\User;
use App\Tasks\Occurrence;
use App\Tasks\TaskOccurrences;
use Carbon\CarbonImmutable;

/**
 * Builds the resources of the two collections. Events are the timed items of {@see TaskOccurrences}; tasks are the
 * untimed ones plus the Someday rows, which have no date and are always included. Series are expanded by the same
 * server port the notifications and the Google Calendar integration use, so both calendars show exactly what the
 * planner shows.
 */
final class CalendarObjects
{
    public function __construct(private readonly TaskOccurrences $occurrences) {}

    /**
     * @return array<string, CalendarObject> keyed by the stable occurrence key
     */
    public function eventsBetween(User $user, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $timeZone = $user->timezoneOrDefault();
        $appUrl = (string) config('app.url');
        $items = $this->occurrences->forUser($user, $from, $to)->filter(fn (Occurrence $item) => $item->time !== null);
        $stamps = $this->stamps($user, array_values($items->map(fn (Occurrence $item) => $item->taskId)->unique()->all()));
        $objects = [];

        foreach ($items as $item) {
            $object = $this->makeEvent($item, $timeZone, $appUrl, $stamps[$item->taskId] ?? null);
            $objects[$object->key] = $object;
        }

        return $objects;
    }

    /**
     * @return array<string, CalendarObject> keyed by the stable occurrence key
     */
    public function todosBetween(User $user, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $timeZone = $user->timezoneOrDefault();
        $appUrl = (string) config('app.url');
        $items = $this->occurrences->forUser($user, $from, $to)->filter(fn (Occurrence $item) => $item->time === null);
        $rows = $this->stamps($user, array_values($items->map(fn (Occurrence $item) => $item->taskId)->unique()->all()));
        $objects = [];

        foreach ($items as $item) {
            $object = $this->makeTodo($item, $timeZone, $appUrl, $rows[$item->taskId] ?? null);
            $objects[$object->key] = $object;
        }

        foreach ($this->somedayTasks($user) as $task) {
            $object = $this->makeSomedayTodo($task, $appUrl);
            $objects[$object->key] = $object;
        }

        return $objects;
    }

    /**
     * One resource by its stable key: a task id, or `seriesId:YYYY-MM-DD` for an occurrence (which may be an exception
     * row that moved to another date). Null when the key is not in this collection.
     */
    public function forKey(User $user, Collection $collection, string $key): ?CalendarObject
    {
        $timeZone = $user->timezoneOrDefault();
        $appUrl = (string) config('app.url');

        if (! str_contains($key, ':')) {
            $task = Task::query()
                ->where('user_id', $user->id)
                ->where('id', $key)
                ->whereNull('deleted_at')
                ->first();

            if ($task === null || $task->recurrence !== null || $task->series_id !== null) {
                return null;
            }

            if ($task->date === null) {
                return $collection === Collection::Tasks ? $this->makeSomedayTodo($task, $appUrl) : null;
            }

            $item = Occurrence::fromRow($task);

            return $collection->accepts($item->time)
                ? $this->make($collection, $item, $timeZone, $appUrl, $task)
                : null;
        }

        [$seriesId, $date] = explode(':', $key, 2);

        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return null;
        }

        $series = Task::query()
            ->where('user_id', $user->id)
            ->where('id', $seriesId)
            ->whereNotNull('recurrence')
            ->whereNull('deleted_at')
            ->first();

        if ($series === null || $series->date === null) {
            return null;
        }

        $winner = TaskOccurrences::winningException(
            Task::query()
                ->where('user_id', $user->id)
                ->where('series_id', $seriesId)
                ->where('occurrence_date', $date)
                ->get(),
        );

        if ($winner !== null) {
            if ($winner->deleted_at !== null || $winner->date === null) {
                return null;
            }

            $item = Occurrence::fromRow($winner);

            return $collection->accepts($item->time)
                ? $this->make($collection, $item, $timeZone, $appUrl, $winner)
                : null;
        }

        if ($date < $series->date
            || (($series->recurrence['until'] ?? null) !== null && $date > $series->recurrence['until'])
            || ! TaskOccurrences::matchesRule($series->recurrence, $series->date, $date)) {
            return null;
        }

        $item = Occurrence::generated($series, $date);

        return $collection->accepts($item->time)
            ? $this->make($collection, $item, $timeZone, $appUrl, $series)
            : null;
    }

    /**
     * A plain task is its row; an occurrence of a series is `(series, occurrence date)`, which stays the same when an
     * edit turns it into an exception row or moves it. Same key as the Google Calendar integration.
     */
    public static function keyFor(Occurrence $item): string
    {
        return $item->seriesId !== null && $item->occurrenceDate !== null
            ? Occurrence::idFor($item->seriesId, $item->occurrenceDate)
            : $item->taskId;
    }

    private function make(Collection $collection, Occurrence $item, string $timeZone, string $appUrl, Task $row): CalendarObject
    {
        return $collection === Collection::Events
            ? $this->makeEvent($item, $timeZone, $appUrl, $row)
            : $this->makeTodo($item, $timeZone, $appUrl, $row);
    }

    private function makeEvent(Occurrence $item, string $timeZone, string $appUrl, ?Task $row): CalendarObject
    {
        $stamp = $row === null ? CarbonImmutable::now('UTC') : $row->updated_at;
        $time = $item->time ?? throw new \InvalidArgumentException('An event needs a time.');
        $ics = Ics::event($item, $timeZone, $appUrl, $stamp);
        $start = CarbonImmutable::parse($item->date.' '.$time, $timeZone);

        return new CalendarObject(
            key: self::keyFor($item),
            ics: $ics,
            etag: '"'.sha1($ics).'"',
            start: $start->utc(),
            end: $start->addMinutes(Ics::TIMED_MINUTES)->utc(),
            allDay: false,
        );
    }

    private function makeTodo(Occurrence $item, string $timeZone, string $appUrl, ?Task $row): CalendarObject
    {
        $stamp = $row === null ? CarbonImmutable::now('UTC') : $row->updated_at;
        $ics = Ics::todo(
            key: self::keyFor($item),
            text: $item->text,
            notes: $item->notes,
            done: $item->done,
            doneAt: $row === null ? null : $row->done_at,
            color: $item->color,
            date: $item->date,
            appUrl: $appUrl,
            stamp: $stamp,
        );
        $start = CarbonImmutable::parse($item->date.' 00:00:00', $timeZone);

        return new CalendarObject(
            key: self::keyFor($item),
            ics: $ics,
            etag: '"'.sha1($ics).'"',
            start: $start->utc(),
            end: $start->addDay()->utc(),
            allDay: true,
        );
    }

    private function makeSomedayTodo(Task $task, string $appUrl): CalendarObject
    {
        $ics = Ics::todo(
            key: $task->id,
            text: $task->text,
            notes: $task->notes,
            done: $task->done,
            doneAt: $task->done_at,
            color: $task->color,
            date: null,
            appUrl: $appUrl,
            stamp: $task->updated_at,
        );

        return new CalendarObject(
            key: $task->id,
            ics: $ics,
            etag: '"'.sha1($ics).'"',
            start: $task->updated_at,
            end: $task->updated_at,
            allDay: true,
            undated: true,
        );
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, Task>
     */
    private function stamps(User $user, array $ids): array
    {
        return Task::query()
            ->where('user_id', $user->id)
            ->whereIn('id', $ids)
            ->get(['id', 'updated_at', 'done_at'])
            ->keyBy('id')
            ->all();
    }

    /**
     * Live Someday rows: no date, no series, no exception.
     *
     * @return \Illuminate\Support\Collection<int, Task>
     */
    private function somedayTasks(User $user): \Illuminate\Support\Collection
    {
        return Task::query()
            ->where('user_id', $user->id)
            ->whereNull('date')
            ->whereNull('recurrence')
            ->whereNull('series_id')
            ->whereNull('deleted_at')
            ->orderBy('someday_column')
            ->orderBy('position')
            ->orderBy('id')
            ->get();
    }
}
