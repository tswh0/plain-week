<?php

namespace App\Integrations\CalDav;

use App\Enums\TaskColor;
use Carbon\CarbonImmutable;

/**
 * The fields a CalDAV write carries, already in planner terms. `doneGiven` says whether the component stated a
 * completion at all: a VEVENT without the marker keeps the task's current state, while a VTODO always states it.
 */
final readonly class CalendarData
{
    public function __construct(
        public string $text,
        public string $notes,
        public ?string $date,
        public ?string $time,
        public ?int $durationMinutes,
        public bool $done,
        public bool $doneGiven,
        public ?CarbonImmutable $doneAt,
        public TaskColor $color,
        public bool $colorGiven,
        /** @var array{type: 'daily'|'weekly'|'monthly', every?: int, weekdays?: list<int>, day?: int, until?: string|null}|null */
        public ?array $recurrence = null,
        /** @var list<string> */
        public array $exdates = [],
        public ?string $recurrenceId = null,
    ) {}
}
