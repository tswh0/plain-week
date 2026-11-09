<?php

namespace App\Integrations\CalDav;

use App\Models\User;

/**
 * The two calendars a planner exposes: timed items are events (Calendar), everything else is a task (Reminders). The
 * `planner` path stays the events collection so accounts added before the split keep working.
 */
enum Collection: string
{
    case Events = 'planner';

    case Tasks = 'tasks';

    public function component(): string
    {
        return $this === self::Events ? 'VEVENT' : 'VTODO';
    }

    public function displayName(): string
    {
        return $this === self::Events ? 'Plain Week Events' : 'Plain Week Tasks';
    }

    public function description(): string
    {
        return $this === self::Events
            ? 'Timed tasks from Plain Week, as calendar events.'
            : 'Tasks from Plain Week, as reminders. Someday tasks have no due date.';
    }

    public function accepts(?string $time): bool
    {
        return $this === self::Events ? $time !== null : $time === null;
    }

    public function href(User $user): string
    {
        return '/dav/calendars/'.$user->id.'/'.$this->value.'/';
    }

    public function objectHref(User $user, string $key): string
    {
        return $this->href($user).rawurlencode($key).'.ics';
    }
}
