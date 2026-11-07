<?php

namespace App\Integrations\CalDav;

use App\Models\Task;
use App\Models\User;
use App\Tasks\Occurrence;
use App\Tasks\TaskOccurrences;
use Carbon\CarbonImmutable;

/**
 * Builds the VEVENT resources of a user's planner. Series are expanded by {@see TaskOccurrences}, the same server port
 * the notifications and the Google Calendar integration use, so the calendar shows exactly what the planner shows:
 * plain tasks, exceptions (moved included) and generated occurrences, never Someday tasks or series rows.
 */
final class CalendarObjects
{
    public const int TIMED_MINUTES = 20;

    public function __construct(private readonly TaskOccurrences $occurrences) {}

    /**
     * @return array<string, CalendarObject> keyed by the stable occurrence key
     */
    public function between(User $user, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $timeZone = $user->timezoneOrDefault();
        $appUrl = (string) config('app.url');

        $items = $this->occurrences->forUser($user, $from, $to);
        $stamps = $this->stamps($user, $items->pluck('taskId')->unique()->values()->all());
        $objects = [];

        foreach ($items as $item) {
            $object = $this->make($item, $timeZone, $appUrl, $stamps[$item->taskId] ?? null);
            $objects[$object->key] = $object;
        }

        return $objects;
    }

    /**
     * One resource by its stable key: a task id, or `seriesId:YYYY-MM-DD` for an occurrence (which may be an exception
     * row that moved to another date).
     */
    public function forKey(User $user, string $key): ?CalendarObject
    {
        $timeZone = $user->timezoneOrDefault();
        $appUrl = (string) config('app.url');

        if (! str_contains($key, ':')) {
            $task = Task::query()
                ->where('user_id', $user->id)
                ->where('id', $key)
                ->whereNull('deleted_at')
                ->first();

            if ($task === null || $task->date === null || $task->recurrence !== null) {
                return null;
            }

            return $this->make(Occurrence::fromRow($task), $timeZone, $appUrl, $task->updated_at);
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
            return $winner->deleted_at === null && $winner->date !== null
                ? $this->make(Occurrence::fromRow($winner), $timeZone, $appUrl, $winner->updated_at)
                : null;
        }

        if ($date < $series->date
            || (($series->recurrence['until'] ?? null) !== null && $date > $series->recurrence['until'])
            || ! TaskOccurrences::matchesRule($series->recurrence, $series->date, $date)) {
            return null;
        }

        return $this->make(Occurrence::generated($series, $date), $timeZone, $appUrl, $series->updated_at);
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

    private function make(Occurrence $item, string $timeZone, string $appUrl, ?CarbonImmutable $stamp): CalendarObject
    {
        $stamp ??= CarbonImmutable::now('UTC');
        $ics = Ics::for($item, $timeZone, $appUrl, $stamp);
        [$start, $end] = self::range($item, $timeZone);

        return new CalendarObject(
            key: self::keyFor($item),
            ics: $ics,
            etag: '"'.sha1($ics).'"',
            start: $start,
            end: $end,
            allDay: $item->time === null,
        );
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, CarbonImmutable>
     */
    private function stamps(User $user, array $ids): array
    {
        return Task::query()
            ->where('user_id', $user->id)
            ->whereIn('id', $ids)
            ->get(['id', 'updated_at'])
            ->mapWithKeys(fn (Task $task) => [$task->id => $task->updated_at])
            ->all();
    }

    /**
     * @return array{CarbonImmutable, CarbonImmutable} the UTC instants the event covers
     */
    private static function range(Occurrence $item, string $timeZone): array
    {
        if ($item->time === null) {
            $start = CarbonImmutable::parse($item->date.' 00:00:00', $timeZone);

            return [$start->utc(), $start->addDay()->utc()];
        }

        $start = CarbonImmutable::parse($item->date.' '.$item->time, $timeZone);

        return [$start->utc(), $start->addMinutes(self::TIMED_MINUTES)->utc()];
    }
}
