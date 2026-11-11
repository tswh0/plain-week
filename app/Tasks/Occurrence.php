<?php

namespace App\Tasks;

use App\Enums\TaskColor;
use App\Models\Task;

/**
 * One task as the planner shows it on a date: a plain task, an exception row, or an occurrence generated from a series.
 * It carries what background features need; subtasks, `done_at` and Someday placement are left out.
 */
final readonly class Occurrence
{
    /**
     * @param  string  $id  The id the client uses: the row id, or `${seriesId}:${date}` for a generated occurrence.
     * @param  string  $taskId  The row behind it: the task itself, the exception row, or the series.
     * @param  string|null  $seriesId  The series it belongs to; null for a plain task.
     * @param  string|null  $occurrenceDate  The generated date it stands for ('YYYY-MM-DD'); null for a plain task.
     *                                       With `$seriesId` it identifies an occurrence across edits and moves.
     * @param  string  $date  Where it is now ('YYYY-MM-DD').
     * @param  string|null  $time  'HH:mm'.
     * @param  int|null  $durationMinutes  How long a timed item lasts; null uses the default.
     */
    public function __construct(
        public string $id,
        public string $taskId,
        public ?string $seriesId,
        public ?string $occurrenceDate,
        public string $date,
        public ?string $time,
        public string $text,
        public string $notes,
        public bool $done,
        public TaskColor $color,
        public string $position,
        public ?int $durationMinutes = null,
    ) {}

    /**
     * The deterministic id of a generated occurrence, the same as on the client.
     */
    public static function idFor(string $seriesId, string $date): string
    {
        return "{$seriesId}:{$date}";
    }

    /**
     * A plain task or an exception row, at its own `date`.
     */
    public static function fromRow(Task $task): self
    {
        return new self(
            id: $task->id,
            taskId: $task->id,
            seriesId: $task->series_id,
            occurrenceDate: $task->occurrence_date,
            date: (string) $task->date,
            time: $task->time,
            text: $task->text,
            notes: $task->notes,
            done: $task->done,
            color: $task->color,
            position: $task->position,
            durationMinutes: $task->duration_minutes,
        );
    }

    /**
     * The occurrence a series generates on `$date`: the series' content, not done.
     */
    public static function generated(Task $series, string $date): self
    {
        return new self(
            id: self::idFor($series->id, $date),
            taskId: $series->id,
            seriesId: $series->id,
            occurrenceDate: $date,
            date: $date,
            time: $series->time,
            text: $series->text,
            notes: $series->notes,
            done: false,
            color: $series->color,
            position: $series->position,
            durationMinutes: $series->duration_minutes,
        );
    }

    /**
     * Whether it was generated from a series (it has no row of its own).
     */
    public function isGenerated(): bool
    {
        return $this->seriesId !== null && $this->taskId === $this->seriesId;
    }
}
