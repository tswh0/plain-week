<?php

namespace App\Integrations\CalDav;

/**
 * The outcome of a PUT or DELETE: what to answer, and the resource and Location when there is one.
 */
final readonly class WriteResult
{
    public function __construct(
        public int $status,
        public ?CalendarObject $object = null,
        public ?string $location = null,
        public string $message = '',
    ) {}

    public static function created(CalendarObject $object, string $location): self
    {
        return new self(201, $object, $location);
    }

    public static function updated(CalendarObject $object): self
    {
        return new self(204, $object);
    }

    public static function deleted(): self
    {
        return new self(204);
    }

    public static function failed(int $status, string $message): self
    {
        return new self($status, message: $message);
    }
}
