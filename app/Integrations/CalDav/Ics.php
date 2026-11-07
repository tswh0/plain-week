<?php

namespace App\Integrations\CalDav;

use App\Tasks\Occurrence;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * One planner item as an iCalendar VEVENT. All-day when the task has no time, otherwise 20 minutes from its time in the
 * user's zone, sent in UTC so no VTIMEZONE block is needed. The payload is deterministic: the same task always yields
 * the same bytes, which is what the ETag relies on.
 */
final class Ics
{
    /** How long a timed task's event lasts, like the Google Calendar integration. */
    public const int TIMED_MINUTES = 20;

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

    public static function for(Occurrence $item, string $timeZone, string $appUrl, CarbonImmutable $stamp): string
    {
        $link = rtrim($appUrl, '/').'/?task='.rawurlencode($item->id);
        $uid = self::uid($item);

        $lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Plain Week//CalDAV//EN',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            'UID:'.$uid,
            'DTSTAMP:'.$stamp->utc()->format('Ymd\THis\Z'),
            'LAST-MODIFIED:'.$stamp->utc()->format('Ymd\THis\Z'),
            'SUMMARY:'.self::escape(($item->done ? '✅ ' : '').Str::limit($item->text, self::TEXT_LIMIT)),
        ];

        if ($item->time === null) {
            $start = CarbonImmutable::parse($item->date.' 00:00:00', $timeZone);
            $lines[] = 'DTSTART;VALUE=DATE:'.$start->format('Ymd');
            $lines[] = 'DTEND;VALUE=DATE:'.$start->addDay()->format('Ymd');
        } else {
            $start = CarbonImmutable::parse($item->date.' '.$item->time, $timeZone);
            $lines[] = 'DTSTART:'.$start->utc()->format('Ymd\THis\Z');
            $lines[] = 'DTEND:'.$start->addMinutes(self::TIMED_MINUTES)->utc()->format('Ymd\THis\Z');
        }

        $notes = trim(Str::limit(trim($item->notes), self::NOTES_LIMIT));
        $lines[] = 'DESCRIPTION:'.self::escape(ltrim($notes."\n\nOpen in Plain Week: ".$link));
        $lines[] = 'URL:'.$link;

        if (isset(self::COLORS[$item->color->value])) {
            $lines[] = 'COLOR:'.self::COLORS[$item->color->value];
        }

        $lines[] = 'STATUS:CONFIRMED';
        $lines[] = 'TRANSP:TRANSPARENT';
        $lines[] = 'END:VEVENT';
        $lines[] = 'END:VCALENDAR';

        return implode('', array_map(self::fold(...), $lines));
    }

    /**
     * Stable across edits: a plain task is its id, an occurrence is `series:date`, which stays the same when the
     * occurrence becomes an exception row or moves.
     */
    public static function uid(Occurrence $item): string
    {
        return ($item->seriesId !== null && $item->occurrenceDate !== null
            ? $item->seriesId.':'.$item->occurrenceDate
            : $item->taskId).'@plainweek';
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
