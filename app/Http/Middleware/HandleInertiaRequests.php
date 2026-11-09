<?php

namespace App\Http\Middleware;

use App\Integrations\GoogleCalendar\GoogleOAuth;
use App\Models\User;
use App\Push\PushConfig;
use App\Support\Feedback;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        $user = $request->user();
        $pushEnabled = PushConfig::enabled();

        return [
            ...parent::share($request),
            'name' => config('app.name'),
            'auth' => [
                'user' => $request->user(),
            ],
            'saas' => [
                'enabled' => (bool) config('saas.enabled'),
            ],
            // Where "Send feedback" leads: the operator's inbox on a SaaS instance, GitHub otherwise.
            'feedbackUrl' => Feedback::url(),
            // Integrations this instance offers (each needs its own credentials or is turned on).
            'integrations' => [
                'googleCalendar' => GoogleOAuth::configured(),
                'caldav' => config()->boolean('caldav.enabled'),
            ],
            // Web Push: the settings page and the subscribe flow exist only with VAPID keys.
            'notifications' => [
                'enabled' => $pushEnabled,
                'vapidPublicKey' => $pushEnabled ? PushConfig::publicKey() : null,
            ],
            // Lazy: computed per request only for signed-in users (it may query the subscription).
            'account' => fn () => $user instanceof User ? [
                'hasAccess' => $user->hasAccess(),
                'plan' => $user->plan()?->value,
            ] : null,
            'sidebarOpen' => ! $request->hasCookie('sidebar_state') || $request->cookie('sidebar_state') === 'true',
        ];
    }
}
