<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * CalDAV exists only on an instance that turned it on (`CALDAV_ENABLED=true`). Every route of the integration is a 404
 * otherwise, like the Google Calendar routes without credentials.
 */
class EnsureCalDavEnabled
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(config()->boolean('caldav.enabled'), 404);

        return $next($request);
    }
}
