<?php

return [

    /*
    |--------------------------------------------------------------------------
    | CalDAV
    |--------------------------------------------------------------------------
    |
    | Exposes the planner to calendar clients (Apple Calendar, Thunderbird,
    | DAVx5...) over CalDAV, read-only. Off by default: an instance turns it on
    | with CALDAV_ENABLED=true, then creates app passwords on Settings >
    | Integrations. See docs/caldav.md.
    |
    */

    'enabled' => (bool) env('CALDAV_ENABLED', false),

];
