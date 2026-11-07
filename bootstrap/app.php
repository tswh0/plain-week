<?php

use App\Http\Controllers\Billing\WebhookController;
use App\Http\Controllers\RobotsController;
use App\Http\Middleware\AddRobotsTag;
use App\Http\Middleware\EnsureSaasEnabled;
use App\Http\Middleware\HandleAppearance;
use App\Http\Middleware\HandleInertiaRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        // Outside the web group: crawlers get no session or cookies. Dynamic so APP_NOINDEX can close the instance.
        then: function () {
            Route::get('robots.txt', RobotsController::class)->name('robots');

            // Cashier's path, outside the web group (no session, no CSRF); the signature is checked instead.
            Route::post('stripe/webhook', [WebhookController::class, 'handleWebhook'])
                ->middleware(EnsureSaasEnabled::class)
                ->name('cashier.webhook');

            // CalDAV: outside the web group too. HTTP Basic with app passwords, no session, no CSRF.
            require __DIR__.'/../routes/caldav.php';
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->append(AddRobotsTag::class);

        $middleware->encryptCookies(except: ['appearance', 'sidebar_state']);

        // Sync payloads must round-trip byte for byte (empty notes, leading spaces).
        $isSync = fn (Request $request) => $request->is('sync/*');
        $middleware->trimStrings(except: [$isSync]);
        $middleware->convertEmptyStringsToNull(except: [$isSync]);

        $middleware->web(append: [
            HandleAppearance::class,
            HandleInertiaRequests::class,
            AddLinkHeadersForPreloadedAssets::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*', 'sync/*', 'stripe/*') || $request->expectsJson(),
        );
    })->create();
