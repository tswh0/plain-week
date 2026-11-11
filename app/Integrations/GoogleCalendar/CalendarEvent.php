<?php

namespace App\Integrations\GoogleCalendar;

use App\Tasks\Occurrence;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * The Google Calendar event for one planner item: all day on its date, or as long as the task says (one hour by
 * default) from its time in the user's time zone. Its hash tells whether the event in Google is still current.
 */
final readonly class CalendarEvent
{
    /** How long a timed event lasts when the task has no duration of its own. */
    public const int DEFAULT_MINUTES = 60;

    /** Google refuses an event whose description is too long (about 8 KB), so long notes are cut. */
    private const int NOTES_LIMIT = 6000;

    private const int TEXT_LIMIT = 1000;

    /**
     * @param  string  $key  What identifies the item across edits and moves (see {@see self::keyFor}).
     * @param  array<string, mixed>  $body  The event resource, without its id.
     */
    private function __construct(
        public string $key,
        public string $date,
        public array $body,
    ) {}

    public static function for(Occurrence $item, string $timeZone): self
    {
        $link = url('/').'/?task='.rawurlencode($item->id);

        return new self(self::keyFor($item), $item->date, [
            'summary' => ($item->done ? '✅' : '🎯').' '.Str::limit($item->text, self::TEXT_LIMIT),
            'description' => ltrim(Str::limit(trim($item->notes), self::NOTES_LIMIT)."\n\nOpen in Plain Week: {$link}"),
            ...self::when($item, $timeZone),
            'source' => ['title' => 'Plain Week', 'url' => $link],
            // Plain Week sends its own notifications.
            'reminders' => ['useDefault' => false, 'overrides' => []],
            'status' => 'confirmed',
        ]);
    }

    /**
     * A plain task is its row; an occurrence of a series is `(series, occurrence date)`, which stays the same when an
     * edit turns it into an exception row (with a new id) or moves it.
     */
    public static function keyFor(Occurrence $item): string
    {
        return $item->seriesId !== null && $item->occurrenceDate !== null
            ? Occurrence::idFor($item->seriesId, $item->occurrenceDate)
            : $item->taskId;
    }

    public function hash(): string
    {
        return hash('sha256', (string) json_encode($this->body));
    }

    /**
     * @return array<string, mixed>
     */
    public function withId(string $eventId): array
    {
        return ['id' => $eventId, ...$this->body];
    }

    /**
     * @return array{start: array<string, string>, end: array<string, string>}
     */
    private static function when(Occurrence $item, string $timeZone): array
    {
        if ($item->time === null) {
            $day = CarbonImmutable::createFromFormat('!Y-m-d', $item->date, 'UTC') ?: throw new \InvalidArgumentException("Invalid date: {$item->date}.");

            return [
                'start' => ['date' => $item->date],
                'end' => ['date' => $day->addDay()->toDateString()],
            ];
        }

        // A time that does not exist on the day clocks go forward lands on the hour after, like Google does.
        $start = CarbonImmutable::createFromFormat('!Y-m-d H:i', "{$item->date} {$item->time}", $timeZone)
            ?: throw new \InvalidArgumentException("Invalid date or time: {$item->date} {$item->time}.");

        return [
            'start' => ['dateTime' => $start->toRfc3339String(), 'timeZone' => $timeZone],
            'end' => ['dateTime' => $start->addMinutes($item->durationMinutes ?? self::DEFAULT_MINUTES)->toRfc3339String(), 'timeZone' => $timeZone],
        ];
    }
}
