<?php

namespace App\Integrations\CalDav;

/**
 * A refused CalDAV write with the HTTP status the client should see.
 */
final class CalDavWriteException extends \RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}
