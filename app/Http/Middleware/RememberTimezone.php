<?php

namespace App\Http\Middleware;

use App\Jobs\SyncGoogleCalendar;
use App\Models\User;
use Closure;
use DateTimeZone;
use Illuminate\Http\Request;
use IntlTimeZone;
use Symfony\Component\HttpFoundation\Response;

/**
 * Stores the time zone the browser reports in the `X-Timezone` header of the
 * sync requests on the signed-in user, so background work (scheduled
 * notifications, calendar events) runs in the user's local time. Only a
 * canonical IANA name that differs from the stored one is written; legacy
 * aliases are stored under their canonical name and anything else is ignored
 * without failing the request.
 */
class RememberTimezone
{
    public const string HEADER = 'X-Timezone';

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $reported = $request->header(self::HEADER);
        $timezone = is_string($reported) ? self::canonical($reported) : null;

        if ($user instanceof User && $timezone !== null && $timezone !== $user->timezone) {
            $user->forceFill(['timezone' => $timezone])->save();

            // Timed calendar events are placed in the user's time zone.
            SyncGoogleCalendar::dispatchFor($user, SyncGoogleCalendar::DEBOUNCE_SECONDS);
        }

        return $next($request);
    }

    /**
     * The canonical name PHP knows for a reported zone, or null when there is none.
     *
     * Browsers may report legacy aliases ("Asia/Calcutta") that newer tzdata
     * drops entirely, so PHP can't even build them. ICU, which ships its own
     * zone data, maps an alias to its equivalents ("Asia/Kolkata"); the first
     * one PHP lists as canonical wins. UTC offsets and abbreviations ("PST")
     * have no "/" and are never mapped.
     */
    private static function canonical(string $timezone): ?string
    {
        $canonical = DateTimeZone::listIdentifiers();

        if (in_array($timezone, $canonical, true)) {
            return $timezone;
        }

        if (! str_contains($timezone, '/')) {
            return null;
        }

        for ($index = 0, $count = IntlTimeZone::countEquivalentIDs($timezone); $index < $count; $index++) {
            $equivalent = IntlTimeZone::getEquivalentID($timezone, $index);

            if (in_array($equivalent, $canonical, true)) {
                return $equivalent;
            }
        }

        return null;
    }
}
