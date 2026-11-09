<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Integrations\GoogleCalendar\GoogleOAuth;
use App\Models\CalDavCredential;
use App\Models\User;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Settings › Integrations: every optional connection the instance offers. The page exists only when at least one
 * integration is configured; each card is then shown or hidden on its own.
 */
class IntegrationsController extends Controller
{
    public function edit(Request $request): Response
    {
        abort_unless(GoogleOAuth::configured() || config()->boolean('caldav.enabled'), 404);

        $user = $this->user($request);
        $connection = $user->googleCalendarConnection;
        $caldav = config()->boolean('caldav.enabled');

        return Inertia::render('settings/integrations', [
            'googleCalendar' => $connection === null ? null : [
                'email' => $connection->google_email,
                'broken' => $connection->isBroken(),
                'lastSyncedAt' => $connection->last_synced_at?->toIso8601String(),
                'lastError' => $connection->isBroken() ? null : $connection->last_error,
            ],
            'caldav' => $caldav ? [
                'server' => url('/dav/'),
                'username' => $user->email,
                'credentials' => $user->calDavCredentials()
                    ->latest()
                    ->get()
                    ->map(fn (CalDavCredential $credential) => [
                        'id' => $credential->id,
                        'name' => $credential->name,
                        'createdAt' => $credential->created_at?->toIso8601String(),
                        'lastUsedAt' => $credential->last_used_at?->toIso8601String(),
                    ])
                    ->all(),
            ] : null,
        ]);
    }

    private function user(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
