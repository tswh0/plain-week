<?php

use App\Http\Controllers\Settings\CalDavCredentialController;
use App\Http\Controllers\Settings\GoogleCalendarController;
use App\Http\Controllers\Settings\IntegrationsController;
use App\Http\Controllers\Settings\NotificationsController;
use App\Http\Controllers\Settings\ProfileController;
use App\Http\Controllers\Settings\SecurityController;
use App\Http\Middleware\EnsureCalDavEnabled;
use App\Http\Middleware\EnsureGoogleCalendarConfigured;
use App\Http\Middleware\EnsureHasAccess;
use App\Http\Middleware\EnsureWebPushConfigured;
use Illuminate\Auth\Middleware\RequirePassword;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth'])->group(function () {
    Route::get('settings', fn () => to_route('profile.edit'));

    Route::get('settings/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('settings/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('settings/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

    Route::get('settings/security', [SecurityController::class, 'edit'])
        ->middleware(RequirePassword::class)
        ->name('security.edit');

    Route::put('settings/password', [SecurityController::class, 'update'])
        ->middleware('throttle:6,1')
        ->name('user-password.update');

    Route::inertia('settings/appearance', 'settings/appearance')->name('appearance.edit');

    // Planner preferences are stored per device in the browser; the server only serves the page.
    Route::inertia('settings/preferences', 'settings/preferences')->name('preferences.edit');

    // Export and import run in the browser against IndexedDB; the server only serves the page.
    Route::inertia('settings/data', 'settings/data')->name('data.edit');

    // Push notifications: only when the instance has VAPID keys. Whether this browser is subscribed lives in the
    // browser (routes/web.php has the subscription endpoints).
    Route::middleware([EnsureWebPushConfigured::class, EnsureHasAccess::class])->group(function () {
        Route::get('settings/notifications', [NotificationsController::class, 'edit'])->name('notifications.edit');
        Route::patch('settings/notifications', [NotificationsController::class, 'update'])->name('notifications.update');
    });

    // Integrations: one page, one card per configured integration. The page is a 404 when the instance offers none.
    Route::get('settings/integrations', [IntegrationsController::class, 'edit'])->name('integrations.edit');

    // Google Calendar: only when the instance has Google OAuth credentials. Connecting is a paid feature in SaaS mode;
    // disconnecting stays reachable, so a lapsed plan can still remove the calendar.
    Route::middleware(EnsureGoogleCalendarConfigured::class)
        ->prefix('settings/integrations')
        ->name('integrations.')
        ->group(function () {
            Route::delete('google', [GoogleCalendarController::class, 'destroy'])->name('google.destroy');

            Route::middleware(EnsureHasAccess::class)->group(function () {
                Route::get('google/connect', [GoogleCalendarController::class, 'connect'])
                    ->middleware('throttle:10,1')
                    ->name('google.connect');
                Route::get('google/callback', [GoogleCalendarController::class, 'callback'])->name('google.callback');
            });
        });

    // CalDAV app passwords: only when the instance turned the integration on. Creating needs a plan in SaaS mode;
    // revoking stays reachable, so a lapsed account can still cut off a client.
    Route::middleware(EnsureCalDavEnabled::class)
        ->prefix('settings/integrations')
        ->name('integrations.')
        ->group(function () {
            Route::post('caldav', [CalDavCredentialController::class, 'store'])
                ->middleware([EnsureHasAccess::class, 'throttle:10,1'])
                ->name('caldav.store');
            Route::delete('caldav/{credential}', [CalDavCredentialController::class, 'destroy'])->name('caldav.destroy');
        });
});

Route::get('.well-known/passkey-endpoints', function () {
    return response()->json([
        'enroll' => route('security.edit'),
        'manage' => route('security.edit'),
    ]);
})->name('well-known.passkeys');
