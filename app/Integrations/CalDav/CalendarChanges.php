<?php

namespace App\Integrations\CalDav;

use App\Models\Task;
use App\Models\User;
use App\Tasks\Occurrence;
use App\Tasks\TaskOccurrences;
use Carbon\CarbonImmutable;

/**
 * The incremental feed behind `sync-collection`: every row with a version above the client's token, turned into the
 * resources of one collection, plus the keys that disappeared. The version counter is the same one the planner and
 * CalDAV writes use, so a web edit and a calendar edit look identical here.
 */
final class CalendarChanges
{
    public function __construct(private readonly CalendarObjects $objects) {}

    /**
     * @return array{objects: array<string, CalendarObject>, deleted: list<string>, token: int}
     */
    public function since(User $user, Collection $collection, int $version, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $token = (int) $user->tasks()->max('version');
        $rows = Task::query()
            ->where('user_id', $user->id)
            ->where('version', '>', $version)
            ->where('version', '<=', $token)
            ->orderBy('version')
            ->get();

        $objects = [];
        $deleted = [];

        foreach ($rows as $row) {
            if ($row->deleted_at !== null) {
                $this->deleted($user, $row, $from, $to, $deleted);

                continue;
            }

            if ($row->recurrence !== null) {
                $this->series($user, $collection, $row, $from, $to, $objects, $deleted);

                continue;
            }

            $key = $row->series_id !== null && $row->occurrence_date !== null
                ? Occurrence::idFor($row->series_id, $row->occurrence_date)
                : $row->id;

            $inWindow = $row->date === null
                ? $collection === Collection::Tasks
                : $row->date >= $from->toDateString() && $row->date <= $to->toDateString();

            if ($collection->accepts($row->time) && $inWindow) {
                $object = $this->objects->forKey($user, $collection, $key);

                if ($object !== null) {
                    $objects[$object->key] = $object;

                    continue;
                }
            }

            $deleted[] = $key;
        }

        return ['objects' => $objects, 'deleted' => array_values(array_unique($deleted)), 'token' => $token];
    }

    /**
     * @param  array<string, CalendarObject>  $objects
     * @param  list<string>  $deleted
     */
    private function series(
        User $user,
        Collection $collection,
        Task $series,
        CarbonImmutable $from,
        CarbonImmutable $to,
        array &$objects,
        array &$deleted,
    ): void {
        $keys = $this->seriesKeys($series, $from, $to);

        if (! $collection->accepts($series->time)) {
            array_push($deleted, ...$keys);

            return;
        }

        $exceptions = Task::query()
            ->where('user_id', $user->id)
            ->where('series_id', $series->id)
            ->get();

        foreach (TaskOccurrences::expandSeries($series, $exceptions, $from->toDateString(), $to->toDateString()) as $item) {
            $key = CalendarObjects::keyFor($item);
            $object = $this->objects->forKey($user, $collection, $key);

            if ($object !== null) {
                $objects[$object->key] = $object;
            } else {
                $deleted[] = $key;
            }
        }
    }

    /**
     * @param  list<string>  $deleted
     */
    private function deleted(User $user, Task $row, CarbonImmutable $from, CarbonImmutable $to, array &$deleted): void
    {
        if ($row->recurrence !== null) {
            array_push($deleted, ...$this->seriesKeys($row, $from, $to));

            foreach (Task::query()->where('user_id', $user->id)->where('series_id', $row->id)->get() as $exception) {
                if ($exception->occurrence_date !== null) {
                    $deleted[] = Occurrence::idFor($row->id, $exception->occurrence_date);
                }
            }

            return;
        }

        $deleted[] = $row->series_id !== null && $row->occurrence_date !== null
            ? Occurrence::idFor($row->series_id, $row->occurrence_date)
            : $row->id;
    }

    /**
     * Every occurrence key a series has in the window, whatever its exceptions do.
     *
     * @return list<string>
     */
    private function seriesKeys(Task $series, CarbonImmutable $from, CarbonImmutable $to): array
    {
        if ($series->date === null || $series->recurrence === null) {
            return [];
        }

        $start = max($series->date, $from->toDateString());
        $end = min($series->recurrence['until'] ?? $to->toDateString(), $to->toDateString());

        if ($start > $end) {
            return [];
        }

        $day = CarbonImmutable::parse($start, 'UTC');
        $last = CarbonImmutable::parse($end, 'UTC');
        $keys = [];

        for ($i = 0; $i < 800 && $day->lessThanOrEqualTo($last); $i++, $day = $day->addDay()) {
            $date = $day->toDateString();

            if (TaskOccurrences::matchesRule($series->recurrence, $series->date, $date)) {
                $keys[] = Occurrence::idFor($series->id, $date);
            }
        }

        return $keys;
    }
}
