<?php

namespace App\Integrations\CalDav;

use Carbon\CarbonImmutable;

/**
 * One resource of the CalDAV collection: the ICS body, its ETag, and the UTC instant range it covers (used to answer
 * `calendar-query` time ranges without parsing the ICS again).
 */
final readonly class CalendarObject
{
    public function __construct(
        public string $key,
        public string $ics,
        public string $etag,
        public CarbonImmutable $start,
        public CarbonImmutable $end,
        public bool $allDay,
        public bool $undated = false,
    ) {}

    public function overlaps(CarbonImmutable $from, CarbonImmutable $to): bool
    {
        return $this->undated || ($this->start->lessThan($to) && $this->end->greaterThan($from));
    }
}
