<?php

use App\Integrations\CalDav\CalDavAuth;
use App\Integrations\CalDav\CalDavController;
use Illuminate\Support\Facades\Route;

/*
 * CalDAV. Outside the web group: no session, no cookies, no CSRF, HTTP Basic on every request.
 */
Route::match(['GET', 'PROPFIND'], '.well-known/caldav', fn () => redirect('/dav/', 301))->name('caldav.well-known');

Route::middleware(CalDavAuth::class)->prefix('dav')->name('caldav.')->group(function () {
    Route::match(['OPTIONS', 'GET', 'PROPFIND', 'REPORT'], '/', [CalDavController::class, 'handle'])->name('root');
    Route::match(['OPTIONS', 'GET', 'PROPFIND', 'REPORT'], '{path}', [CalDavController::class, 'handle'])
        ->where('path', '.*')
        ->name('path');
});
