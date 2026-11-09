<?php

namespace App\Integrations\CalDav;

use App\Models\CalDavCredential;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * HTTP Basic auth for CalDAV clients, against the app passwords in `caldav_credentials`. The username is the account's
 * email or its id. No session and no CSRF: every DAV request carries its credentials.
 */
class CalDavAuth
{
    /** Failed attempts per IP and minute, so Basic auth cannot be brute-forced. */
    private const int MAX_ATTEMPTS = 10;

    private const int DECAY_SECONDS = 60;

    /** How often `last_used_at` is written: a DAV client makes many requests per sync. */
    private const int TOUCH_MINUTES = 5;

    public function handle(Request $request, Closure $next): Response
    {
        $key = 'caldav-auth:'.$request->ip();

        if (RateLimiter::tooManyAttempts($key, self::MAX_ATTEMPTS)) {
            return response('Too Many Requests', 429, [
                'Retry-After' => (string) RateLimiter::availableIn($key),
            ]);
        }

        $user = $this->user($request);

        if ($user === null) {
            RateLimiter::hit($key, self::DECAY_SECONDS);
            Log::warning('CalDAV authentication failed.', [
                'ip' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);

            return response('Unauthorized', 401, [
                'WWW-Authenticate' => 'Basic realm="Plain Week"',
            ]);
        }

        RateLimiter::clear($key);
        $request->attributes->set('caldav_user', $user);

        return $next($request);
    }

    private function user(Request $request): ?User
    {
        $header = $request->header('Authorization');

        if ($header === null || ! str_starts_with($header, 'Basic ')) {
            return null;
        }

        $decoded = base64_decode(substr($header, 6), true);

        if ($decoded === false || ! str_contains($decoded, ':')) {
            return null;
        }

        [$login, $password] = explode(':', $decoded, 2);

        $user = User::query()
            ->where('email', $login)
            ->orWhere('id', $login)
            ->first();

        if ($user === null) {
            return null;
        }

        $credential = CalDavCredential::query()
            ->where('user_id', $user->id)
            ->get()
            ->first(fn (CalDavCredential $row) => hash_equals($row->password_hash, CalDavCredential::hash($password)));

        if ($credential === null) {
            return null;
        }

        if ($credential->last_used_at === null || $credential->last_used_at->lt(now()->subMinutes(self::TOUCH_MINUTES))) {
            $credential->forceFill(['last_used_at' => now()])->saveQuietly();
        }

        return $user;
    }
}
