<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->actingAs($this->user);
});

test('a sync request stores the time zone the browser reports', function () {
    $this->getJson(route('sync.pull'), ['X-Timezone' => 'Europe/Madrid'])->assertOk();

    expect($this->user->fresh()->timezone)->toBe('Europe/Madrid');
});

test('a push stores the time zone too', function () {
    $this->postJson(route('sync.push'), ['tasks' => [wireTask()]], ['X-Timezone' => 'America/New_York'])->assertOk();

    expect($this->user->fresh()->timezone)->toBe('America/New_York');
});

test('a later report replaces the stored time zone', function () {
    $this->user->forceFill(['timezone' => 'Europe/Madrid'])->save();

    $this->getJson(route('sync.pull'), ['X-Timezone' => 'Asia/Tokyo'])->assertOk();

    expect($this->user->fresh()->timezone)->toBe('Asia/Tokyo');
});

test('the same time zone is not written again', function () {
    $this->user->forceFill(['timezone' => 'Europe/Madrid'])->save();
    $updatedAt = $this->user->fresh()->updated_at;

    $this->travel(1)->minutes();
    $this->getJson(route('sync.pull'), ['X-Timezone' => 'Europe/Madrid'])->assertOk();

    expect($this->user->fresh()->updated_at->equalTo($updatedAt))->toBeTrue();
});

test('legacy aliases browsers still report are stored under their canonical name', function () {
    $this->getJson(route('sync.pull'), ['X-Timezone' => 'Asia/Calcutta'])->assertOk();

    expect($this->user->fresh()->timezone)->toBe('Asia/Kolkata');
});

test('an unknown or missing time zone is ignored without failing the request', function (array $headers) {
    $this->user->forceFill(['timezone' => 'Europe/Madrid'])->save();

    $this->getJson(route('sync.pull'), $headers)->assertOk();

    expect($this->user->fresh()->timezone)->toBe('Europe/Madrid');
})->with([
    'missing' => [[]],
    'empty' => [['X-Timezone' => '']],
    'unknown' => [['X-Timezone' => 'Mars/Olympus_Mons']],
    'offset' => [['X-Timezone' => '+02:00']],
    'abbreviation' => [['X-Timezone' => 'PST']],
    'wrong case' => [['X-Timezone' => 'europe/madrid']],
]);

test('guests get 401 and nothing is stored', function () {
    auth()->logout();

    $this->getJson(route('sync.pull'), ['X-Timezone' => 'Europe/Madrid'])->assertUnauthorized();
});

test('timezoneOrDefault falls back to the app time zone', function () {
    config(['app.timezone' => 'UTC']);

    expect(User::factory()->make(['timezone' => null])->timezoneOrDefault())->toBe('UTC')
        ->and(User::factory()->make(['timezone' => 'Europe/Madrid'])->timezoneOrDefault())->toBe('Europe/Madrid');
});
