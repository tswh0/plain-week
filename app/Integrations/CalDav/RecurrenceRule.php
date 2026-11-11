<?php

namespace App\Integrations\CalDav;

use Carbon\CarbonImmutable;
use Sabre\VObject\Component;
use Sabre\VObject\Property;
use Sabre\VObject\Property\ICalendar\DateTime as ICalDateTime;

/**
 * The planner's small recurrence model, read from a CalDAV `RRULE`, `EXDATE` and `RECURRENCE-ID`. Only the shapes the
 * planner can represent are accepted; anything else is a `409` instead of a rule that silently means something else.
 */
final class RecurrenceRule
{
    private const array WEEKDAYS = [
        'MO' => 1,
        'TU' => 2,
        'WE' => 3,
        'TH' => 4,
        'FR' => 5,
        'SA' => 6,
        'SU' => 7,
    ];

    /**
     * @param  Component&iterable<Property>  $component
     * @return array{type: 'daily'|'weekly'|'monthly', every?: int, weekdays?: list<int>, day?: int, until?: string|null}|null
     */
    public static function from(Component $component, string $timeZone): ?array
    {
        if (! isset($component->RRULE)) {
            return null;
        }

        $rule = $component->RRULE->getParts();
        $frequency = strtoupper((string) ($rule['FREQ'] ?? ''));
        $startProperty = $component->select('DTSTART')[0] ?? $component->select('DUE')[0] ?? null;
        $start = self::date($startProperty, $timeZone);
        $until = self::until($rule['UNTIL'] ?? null);

        if ($until !== null && $until < $start) {
            throw new CalDavWriteException(409, 'The recurrence ends before it starts.');
        }

        foreach (['COUNT', 'BYSETPOS', 'BYMONTH', 'BYHOUR', 'BYMINUTE', 'BYSECOND', 'BYYEARDAY', 'BYWEEKNO'] as $name) {
            if (isset($rule[$name])) {
                throw new CalDavWriteException(409, 'Unsupported recurrence rule.');
            }
        }

        $interval = max(1, (int) ($rule['INTERVAL'] ?? 1));

        if ($frequency === 'DAILY' && (isset($rule['BYDAY']) || isset($rule['BYMONTHDAY']))) {
            throw new CalDavWriteException(409, 'Unsupported recurrence rule.');
        }

        if ($frequency === 'WEEKLY' && isset($rule['BYMONTHDAY'])) {
            throw new CalDavWriteException(409, 'Unsupported recurrence rule.');
        }

        if ($frequency === 'MONTHLY' && isset($rule['BYDAY'])) {
            throw new CalDavWriteException(409, 'Monthly rules by weekday are not supported.');
        }

        return match ($frequency) {
            'DAILY' => ['type' => 'daily', 'every' => min(365, $interval), 'until' => $until],
            'WEEKLY' => self::weekly($rule, $start, $interval, $until),
            'MONTHLY' => self::monthly($rule, $start, $interval, $until),
            default => throw new CalDavWriteException(409, 'Unsupported recurrence frequency.'),
        };
    }

    /**
     * @param  Component&iterable<Property>  $component
     * @return list<string> the dates excluded from a series, sorted and unique
     */
    public static function exdates(Component $component, string $timeZone): array
    {
        $dates = [];

        foreach ($component->select('EXDATE') as $property) {
            if (! $property instanceof ICalDateTime) {
                continue;
            }

            foreach ($property->getDateTimes() as $dateTime) {
                if (! $dateTime instanceof \DateTimeInterface) {
                    continue;
                }

                $dates[] = CarbonImmutable::instance($dateTime)->setTimezone($timeZone)->toDateString();
            }
        }

        $dates = array_values(array_unique($dates));
        sort($dates);

        return $dates;
    }

    /**
     * @param  Component&iterable<Property>  $component
     */
    public static function recurrenceId(Component $component, string $timeZone): ?string
    {
        $property = $component->{'RECURRENCE-ID'} ?? null;

        if ($property === null) {
            return null;
        }

        if (strtoupper((string) $property['RANGE']) === 'THISANDFUTURE') {
            throw new CalDavWriteException(409, 'Only single-occurrence edits are supported.');
        }

        return self::date($property, $timeZone);
    }

    /**
     * @param  array<string, mixed>  $rule
     * @return array{type: 'weekly', weekdays: list<int>, until: string|null}
     */
    private static function weekly(array $rule, string $start, int $interval, ?string $until): array
    {
        if ($interval !== 1) {
            throw new CalDavWriteException(409, 'Only weekly series every week are supported.');
        }

        $byDay = $rule['BYDAY'] ?? null;
        $days = is_array($byDay) ? $byDay : ($byDay === null ? [] : [$byDay]);

        if ($days === []) {
            $days = [self::weekday($start)];
        }

        $weekdays = [];

        foreach ($days as $day) {
            $day = strtoupper((string) $day);

            if (! isset(self::WEEKDAYS[$day])) {
                throw new CalDavWriteException(409, 'Unsupported weekday in the recurrence rule.');
            }

            $weekdays[] = self::WEEKDAYS[$day];
        }

        $weekdays = array_values(array_unique($weekdays));
        sort($weekdays);

        return ['type' => 'weekly', 'weekdays' => $weekdays, 'until' => $until];
    }

    /**
     * @param  array<string, mixed>  $rule
     * @return array{type: 'monthly', day: int, until: string|null}
     */
    private static function monthly(array $rule, string $start, int $interval, ?string $until): array
    {
        if ($interval !== 1) {
            throw new CalDavWriteException(409, 'Only monthly series every month are supported.');
        }

        $byDay = $rule['BYMONTHDAY'] ?? null;
        $days = is_array($byDay) ? $byDay : ($byDay === null ? [] : [$byDay]);

        if ($days === []) {
            $days = [(int) CarbonImmutable::parse($start, 'UTC')->day];
        }

        if (count($days) !== 1) {
            throw new CalDavWriteException(409, 'Only one day a month is supported.');
        }

        $day = (int) $days[0];

        if ($day < 1 || $day > 31) {
            throw new CalDavWriteException(409, 'Unsupported day of the month.');
        }

        return ['type' => 'monthly', 'day' => $day, 'until' => $until];
    }

    /**
     * @param  (Property&iterable<Property>)|null  $property
     */
    private static function date(?Property $property, string $timeZone): string
    {
        if ($property === null) {
            throw new CalDavWriteException(409, 'A recurrence needs a start date.');
        }

        if (! $property instanceof ICalDateTime) {
            throw new CalDavWriteException(409, 'A recurrence needs a date.');
        }

        if ($property->getValueType() === 'DATE') {
            $parsed = CarbonImmutable::createFromFormat('!Ymd', $property->getValue(), 'UTC');

            if (! $parsed instanceof CarbonImmutable) {
                throw new CalDavWriteException(409, 'Invalid recurrence date.');
            }

            return $parsed->toDateString();
        }

        return CarbonImmutable::instance($property->getDateTime())->setTimezone($timeZone)->toDateString();
    }

    private static function until(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $parsed = CarbonImmutable::createFromFormat('!Ymd', substr((string) $value, 0, 8), 'UTC');

        if (! $parsed instanceof CarbonImmutable) {
            throw new CalDavWriteException(409, 'Invalid recurrence end date.');
        }

        return $parsed->toDateString();
    }

    private static function weekday(string $date): string
    {
        return array_search(CarbonImmutable::parse($date, 'UTC')->dayOfWeekIso, self::WEEKDAYS, true) ?: 'MO';
    }
}
