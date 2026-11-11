<?php

namespace App\Integrations\CalDav;

use App\Enums\TaskColor;
use App\Tasks\Occurrence;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * One planner item as an iCalendar component. Events are timed tasks (VEVENT); tasks are reminders (VTODO), with or
 * without a due date. Timed events last as long as the task says, or one hour, and are sent in UTC so no VTIMEZONE
 * block is needed. The payload is deterministic: the same item always yields the same bytes, which is what the ETag
 * relies on.
 */
final class Ics
{
    /** How long a timed event lasts when the task has no duration of its own. */
    public const int DEFAULT_MINUTES = 60;

    private const int NOTES_LIMIT = 6000;

    private const int TEXT_LIMIT = 1000;

    /** RFC 7986 colour names most calendar clients know. */
    private const array COLORS = [
        'pink' => 'PINK',
        'yellow' => 'YELLOW',
        'black' => 'BLACK',
        'grey' => 'GREY',
        'cornflower' => 'CORNFLOWERBLUE',
        'mango' => 'ORANGE',
        'green' => 'GREEN',
        'lilac' => 'MEDIUMPURPLE',
    ];

    public static function event(Occurrence $item, string $timeZone, string $appUrl, CarbonImmutable $stamp): string
    {
        if ($item->time === null) {
            throw new \InvalidArgumentException('An event needs a time.');
        }

        $link = self::link($appUrl, $item->id);
        $start = CarbonImmutable::parse($item->date.' '.$item->time, $timeZone);

        $lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Plain Week//CalDAV//EN',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            'UID:'.self::uid($item).'@plainweek',
            'DTSTAMP:'.$stamp->utc()->format('Ymd\THis\Z'),
            'LAST-MODIFIED:'.$stamp->utc()->format('Ymd\THis\Z'),
            'SUMMARY:'.self::escape(($item->done ? '✅ ' : '').Str::limit($item->text, self::TEXT_LIMIT)),
            'DTSTART:'.$start->utc()->format('Ymd\THis\Z'),
            'DTEND:'.$start->addMinutes($item->durationMinutes ?? self::DEFAULT_MINUTES)->utc()->format('Ymd\THis\Z'),
            self::description($item->notes, $link),
            'URL:'.$link,
        ];

        if (isset(self::COLORS[$item->color->value])) {
            $lines[] = 'COLOR:'.self::COLORS[$item->color->value];
        }

        $lines[] = 'X-PLAIN-WEEK-DONE:'.($item->done ? 'TRUE' : 'FALSE');
        $lines[] = 'STATUS:CONFIRMED';
        $lines[] = 'TRANSP:TRANSPARENT';
        $lines[] = 'END:VEVENT';
        $lines[] = 'END:VCALENDAR';

        return self::render($lines);
    }

    public static function todo(
        string $key,
        string $text,
        string $notes,
        bool $done,
        ?CarbonImmutable $doneAt,
        TaskColor $color,
        ?string $date,
        string $appUrl,
        CarbonImmutable $stamp,
    ): string {
        $link = self::link($appUrl, $key);
        $lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Plain Week//CalDAV//EN',
            'CALSCALE:GREGORIAN',
            'BEGIN:VTODO',
            'UID:'.$key.'@plainweek',
            'DTSTAMP:'.$stamp->utc()->format('Ymd\THis\Z'),
            'LAST-MODIFIED:'.$stamp->utc()->format('Ymd\THis\Z'),
            'SUMMARY:'.self::escape(Str::limit($text, self::TEXT_LIMIT)),
            self::description($notes, $link),
            'URL:'.$link,
        ];

        if ($date !== null) {
            $lines[] = 'DUE;VALUE=DATE:'.CarbonImmutable::parse($date, 'UTC')->format('Ymd');
        }

        if (isset(self::COLORS[$color->value])) {
            $lines[] = 'COLOR:'.self::COLORS[$color->value];
        }

        if ($done) {
            $lines[] = 'STATUS:COMPLETED';
            $lines[] = 'COMPLETED:'.($doneAt ?? $stamp)->utc()->format('Ymd\THis\Z');
            $lines[] = 'PERCENT-COMPLETE:100';
        } else {
            $lines[] = 'STATUS:NEEDS-ACTION';
            $lines[] = 'PERCENT-COMPLETE:0';
        }

        $lines[] = 'END:VTODO';
        $lines[] = 'END:VCALENDAR';

        return self::render($lines);
    }

    /**
     * Stable across edits: a plain task is its id, an occurrence is `series:date`, which stays the same when the
     * occurrence becomes an exception row or moves.
     */
    public static function uid(Occurrence $item): string
    {
        return $item->seriesId !== null && $item->occurrenceDate !== null
            ? $item->seriesId.':'.$item->occurrenceDate
            : $item->taskId;
    }

    /**
     * @param  list<string>  $lines
     */
    private static function render(array $lines): string
    {
        return implode('', array_map(self::fold(...), $lines));
    }

    private static function description(string $notes, string $link): string
    {
        $notes = trim(Str::limit(trim($notes), self::NOTES_LIMIT));

        return 'DESCRIPTION:'.self::escape(ltrim($notes."\n\nOpen in Plain Week: ".$link));
    }

    private static function link(string $appUrl, string $key): string
    {
        return rtrim($appUrl, '/').'/?task='.rawurlencode($key);
    }

    /**
     * RFC 5545 §3.1: a line is at most 75 octets, continuation lines start with one space.
     */
    private static function fold(string $line): string
    {
        $folded = '';
        $offset = 0;
        $length = strlen($line);
        $limit = 75;

        while ($offset < $length) {
            $chunk = mb_strcut($line, $offset, $limit, 'UTF-8');
            $folded .= ($offset === 0 ? '' : ' ').$chunk."\r\n";
            $offset += strlen($chunk);
            $limit = 74;
        }

        return $folded;
    }

    /**
     * RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped in text values.
     */
    private static function escape(string $value): string
    {
        return str_replace(
            ['\\', ';', ',', "\r\n", "\n", "\r"],
            ['\\\\', '\\;', '\\,', '\\n', '\\n', '\\n'],
            $value,
        );
    }
}
