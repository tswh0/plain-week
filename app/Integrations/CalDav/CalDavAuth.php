<?php

namespace App\Integrations\CalDav;

use App\Models\CalDavCredential;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * HTTP Basic auth for CalDAV clients, against the app passwords in `caldav_credentials`. The username is the account's
 * email or its id. No session and no CSRF: every DAV request carries its credentials.
 */
class CalDavAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $this->user($request);

        if ($user === null) {
            return response('Unauthorized', 401, [
                'WWW-Authenticate' => 'Basic realm="Plain Week", charset="UTF-8"',
            ]);
        }

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

        $credential->forceFill(['last_used_at' => now()])->saveQuietly();

        return $user;
    }
}
