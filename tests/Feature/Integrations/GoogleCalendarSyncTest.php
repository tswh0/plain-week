<?php

use App\Integrations\GoogleCalendar\SyncGoogleCalendarEvents;
use App\Jobs\SyncGoogleCalendar;
use App\Models\GoogleCalendarConnection;
use App\Models\GoogleCalendarEvent;
use App\Models\Task;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\FakeGoogleCalendar;

uses(RefreshDatabase::class);

const SYNC_CALENDAR_ID = 'cal-1@group.calendar.google.com';

beforeEach(function () {
    config([
        'services.google.client_id' => 'client-id',
        'services.google.client_secret' => 'client-secret',
    ]);
    // APP_URL in the queue worker.
    url()->forceRootUrl('https://plan.example.com');
    url()->forceScheme('https');
    $this->travelTo(CarbonImmutable::parse('2026-10-26 10:00:00', 'UTC'));

    $this->user = User::factory()->create(['timezone' => 'Europe/Madrid']);
    $this->connection = $this->user->googleCalendarConnection()->create([
        'google_email' => 'me@gmail.com',
        'access_token' => 'access-1',
        'refresh_token' => 'refresh-1',
        'token_expires_at' => now()->addYear(),
        'calendar_id' => SYNC_CALENDAR_ID,
        'connected_at' => now(),
    ]);
    $this->google = FakeGoogleCalendar::install(SYNC_CALENDAR_ID);
    Http::preventStrayRequests();
});

/**
 * Runs the sync job for the test user, the way the queue worker does.
 */
function syncCalendar(?SyncGoogleCalendar $job = null): SyncGoogleCalendar
{
    $job ??= new SyncGoogleCalendar(test()->user->id);
    $job->handle(app(SyncGoogleCalendarEvents::class));

    return $job;
}

/**
 * @param  array<string, mixed>  $attributes
 */
function calendarTask(array $attributes = []): Task
{
    return Task::factory()->for(test()->user)->create(['text' => 'Buy milk', 'date' => '2026-10-27', ...$attributes]);
}

function sentEvent(string $key): GoogleCalendarEvent
{
    return GoogleCalendarEvent::query()->where('key', $key)->sole();
}

test('an untimed task becomes an all-day event linking to it', function () {
    $task = calendarTask(['notes' => "Oat milk\nTwo bottles"]);

    syncCalendar();

    $event = $this->google->onlyEvent();
    $link = "https://plan.example.com/?task={$task->id}";

    expect($event)->toMatchArray([
        'id' => sentEvent($task->id)->google_event_id,
        'summary' => '🎯 Buy milk',
        'description' => "Oat milk\nTwo bottles\n\nOpen in Plain Week: {$link}",
        'start' => ['date' => '2026-10-27'],
        'end' => ['date' => '2026-10-28'],
        'source' => ['title' => 'Plain Week', 'url' => $link],
        'reminders' => ['useDefault' => false, 'overrides' => []],
        'status' => 'confirmed',
    ]);
    expect($this->connection->fresh())
        ->last_synced_at->not->toBeNull()
        ->last_error->toBeNull();
});

test('a task without notes only links to it', function () {
    $task = calendarTask();

    syncCalendar();

    expect($this->google->onlyEvent()['description'])->toBe("Open in Plain Week: https://plan.example.com/?task={$task->id}");
});

test('a timed task becomes an hour-long event in the user\'s time zone, across a DST change', function (string $date, string $start, string $end) {
    calendarTask(['date' => $date, 'time' => '09:30']);

    syncCalendar();

    expect($this->google->onlyEvent())->toMatchArray([
        'start' => ['dateTime' => $start, 'timeZone' => 'Europe/Madrid'],
        'end' => ['dateTime' => $end, 'timeZone' => 'Europe/Madrid'],
    ]);
})->with([
    'summer time' => ['2026-10-24', '2026-10-24T09:30:00+02:00', '2026-10-24T10:30:00+02:00'],
    'the day clocks go back' => ['2026-10-25', '2026-10-25T09:30:00+01:00', '2026-10-25T10:30:00+01:00'],
    'winter time' => ['2026-10-27', '2026-10-27T09:30:00+01:00', '2026-10-27T10:30:00+01:00'],
]);

test('without a time zone on the account the app\'s is used', function () {
    $this->user->forceFill(['timezone' => null])->save();
    calendarTask(['time' => '09:30']);

    syncCalendar();

    expect($this->google->onlyEvent()['start'])->toBe(['dateTime' => '2026-10-27T09:30:00+00:00', 'timeZone' => 'UTC']);
});

test('changes update the same event, and done tasks get a check mark', function () {
    $task = calendarTask(['time' => '09:30']);
    syncCalendar();
    $eventId = sentEvent($task->id)->google_event_id;

    $task->update(['done' => true, 'time' => null]);
    syncCalendar();

    expect($this->google->calls())->toBe(["POST {$eventId}", "PUT {$eventId}"]);
    expect($this->google->onlyEvent())->toMatchArray([
        'summary' => '✅ Buy milk',
        'start' => ['date' => '2026-10-27'],
    ]);
});

test('nothing is sent when nothing changed', function () {
    calendarTask();
    syncCalendar();

    syncCalendar();

    expect($this->google->requests)->toHaveCount(1);
});

test('a deleted task, or one moved to Someday, loses its event', function () {
    $deleted = calendarTask();
    $someday = calendarTask(['text' => 'Read']);
    syncCalendar();

    $deleted->update(['deleted_at' => now()]);
    $someday->update(['date' => null, 'someday_column' => 1]);
    syncCalendar();

    expect($this->google->events)->toBe([])
        ->and(GoogleCalendarEvent::count())->toBe(0);
});

test('tasks get events from 30 days ago on, with no limit ahead', function () {
    calendarTask(['id' => 'too-old', 'date' => '2026-09-25']);
    calendarTask(['id' => 'old', 'date' => '2026-09-26']);
    calendarTask(['id' => 'far', 'date' => '2031-01-15']);
    calendarTask(['id' => 'someday', 'date' => null, 'someday_column' => 0]);

    syncCalendar();

    expect(GoogleCalendarEvent::query()->orderBy('key')->pluck('key')->all())->toBe(['far', 'old']);
});

test('a series gets one event per occurrence from 7 days ago to 60 days ahead', function () {
    calendarTask(['id' => 'series', 'text' => 'Stretch', 'date' => '2026-09-01', 'time' => '07:00', 'recurrence' => ['type' => 'daily', 'every' => 1]]);

    syncCalendar();

    $keys = GoogleCalendarEvent::query()->orderBy('key')->pluck('key');

    expect($keys)->toHaveCount(68)
        ->and($keys->first())->toBe('series:2026-10-19')
        ->and($keys->last())->toBe('series:2026-12-25');
    expect($this->google->events[sentEvent('series:2026-10-26')->google_event_id])->toMatchArray([
        'summary' => '🎯 Stretch',
        'source' => ['title' => 'Plain Week', 'url' => 'https://plan.example.com/?task=series%3A2026-10-26'],
    ]);
});

test('the occurrence window moves with the days, and the past is left alone', function () {
    calendarTask(['id' => 'series', 'date' => '2026-10-01', 'recurrence' => ['type' => 'weekly', 'weekdays' => [1]]]);
    syncCalendar();
    expect(GoogleCalendarEvent::query()->pluck('key'))->toContain('series:2026-10-19')->not->toContain('series:2026-12-28');

    $this->travel(14)->days();
    syncCalendar();

    // 2026-10-19 is now 21 days back: no longer generated, but its event stays.
    expect(GoogleCalendarEvent::query()->pluck('key'))->toContain('series:2026-10-19', 'series:2026-12-28');
    expect(collect($this->google->requests)->where('method', 'DELETE'))->toBeEmpty();
});

test('editing or moving an occurrence keeps its event', function () {
    calendarTask(['id' => 'series', 'text' => 'Gym', 'date' => '2026-10-26', 'recurrence' => ['type' => 'weekly', 'weekdays' => [1]]]);
    syncCalendar();
    $eventId = sentEvent('series:2026-11-02')->google_event_id;
    $this->google->requests = [];

    $exception = calendarTask([
        'id' => 'exception',
        'text' => 'Gym (short)',
        'date' => '2026-11-03',
        'series_id' => 'series',
        'occurrence_date' => '2026-11-02',
        'done' => true,
    ]);
    syncCalendar();

    expect($this->google->calls())->toBe(["PUT {$eventId}"]);
    expect($this->google->events[$eventId])->toMatchArray([
        'summary' => '✅ Gym (short)',
        'start' => ['date' => '2026-11-03'],
        'source' => ['title' => 'Plain Week', 'url' => "https://plan.example.com/?task={$exception->id}"],
    ]);

    $exception->update(['deleted_at' => now()]);
    syncCalendar();

    expect($this->google->events)->not->toHaveKey($eventId);
});

test('an event the user deleted in Google is created again', function () {
    $task = calendarTask();
    syncCalendar();
    $oldId = sentEvent($task->id)->google_event_id;
    $this->google->deleteInGoogle($oldId);
    $this->google->requests = [];

    $task->update(['text' => 'Buy oat milk']);
    syncCalendar();

    $newId = sentEvent($task->id)->google_event_id;

    expect($newId)->not->toBe($oldId)
        ->and($this->google->calls())->toBe(["PUT {$oldId}", "POST {$newId}"])
        ->and($this->google->onlyEvent()['summary'])->toBe('🎯 Buy oat milk');
});

test('an event an interrupted run already created is updated, not duplicated', function () {
    $task = calendarTask();
    $this->connection->events()->create(['key' => $task->id, 'google_event_id' => 'abc123', 'date' => '2026-10-27']);
    $this->google->events['abc123'] = ['id' => 'abc123', 'summary' => 'stale'];

    syncCalendar();

    expect($this->google->calls())->toBe(['POST abc123', 'PUT abc123'])
        ->and($this->google->onlyEvent()['summary'])->toBe('🎯 Buy milk')
        ->and(sentEvent($task->id)->payload_hash)->not->toBeNull();
});

test('a rate limit puts the job back for later, keeping what got through', function (int $status, array $error) {
    calendarTask(['id' => 'a']);
    calendarTask(['id' => 'b']);
    $this->google->queued = [Http::response(['id' => 'x']), Http::response(['error' => $error], $status, ['Retry-After' => '42'])];

    $job = syncCalendar((new SyncGoogleCalendar($this->user->id))->withFakeQueueInteractions());

    $job->assertReleased(42);
    expect(GoogleCalendarEvent::query()->whereNotNull('payload_hash')->count())->toBe(1);

    $this->travel(42)->seconds();
    syncCalendar();

    expect(GoogleCalendarEvent::query()->whereNotNull('payload_hash')->count())->toBe(2);
})->with([
    '429' => [429, ['code' => 429, 'message' => 'Too many requests']],
    '403 rate limit' => [403, ['code' => 403, 'errors' => [['reason' => 'rateLimitExceeded']], 'message' => 'Rate Limit Exceeded']],
]);

test('an event Google refuses does not hold back the others', function () {
    calendarTask(['id' => 'a', 'date' => '2026-10-27']);
    calendarTask(['id' => 'b', 'date' => '2026-10-28']);
    $this->google->queued = [Http::response(['error' => ['code' => 400, 'message' => 'Invalid start time.']], 400)];

    syncCalendar();

    expect($this->google->events)->toHaveCount(1)
        ->and($this->connection->fresh()->last_error)->toBe('Invalid start time.');
});

test('long notes are cut so Google accepts the event', function () {
    calendarTask(['text' => str_repeat('a', 2000), 'notes' => str_repeat('b', 10000)]);

    syncCalendar();

    expect(mb_strlen($this->google->onlyEvent()['description']))->toBeLessThan(8000)
        ->and(mb_strlen($this->google->onlyEvent()['summary']))->toBeLessThan(1010);
});

test('a refused token marks the connection broken and stops syncing', function () {
    $this->connection->update(['token_expires_at' => now()->subMinute()]);
    Http::fake(['https://oauth2.googleapis.com/token' => Http::response(['error' => 'invalid_grant', 'error_description' => 'Token has been expired or revoked.'], 400)]);
    calendarTask();

    syncCalendar();

    expect($this->connection->fresh())->isBroken()->toBeTrue()
        ->and($this->google->requests)->toBe([]);

    syncCalendar();
    expect($this->google->requests)->toBe([]);
});

test('a calendar deleted in Google stops syncing with an error to show', function () {
    calendarTask();
    $this->google->calendarExists = false;

    syncCalendar();

    expect($this->connection->fresh())
        ->last_error->toContain('was deleted in Google')
        ->last_synced_at->toBeNull();
});

test('a failing job leaves a readable error on the connection', function () {
    (new SyncGoogleCalendar($this->user->id))->failed(new RuntimeException('cURL error 28: timed out for https://www.googleapis.com/…'));

    expect($this->connection->fresh()->last_error)->toBe('Google Calendar could not be reached. Plain Week tries again with your next change.');
});

test('a long sync stops at its time limit and goes on in the next run', function () {
    calendarTask(['id' => 'a']);
    calendarTask(['id' => 'b']);
    $sync = app(SyncGoogleCalendarEvents::class);

    $result = $sync($this->connection, CarbonImmutable::now()->subSecond());

    expect($result->complete)->toBeFalse()
        ->and($this->google->requests)->toBe([]);

    $job = syncCalendar((new SyncGoogleCalendar($this->user->id))->withFakeQueueInteractions());

    $job->assertNotReleased();
    expect($this->google->events)->toHaveCount(2);
});

test('a job queued while Google asks to wait waits too', function () {
    calendarTask();
    $this->google->queued = [Http::response(['error' => ['code' => 429]], 429, ['Retry-After' => '120'])];
    syncCalendar((new SyncGoogleCalendar($this->user->id))->withFakeQueueInteractions());

    $this->travel(30)->seconds();
    $later = syncCalendar((new SyncGoogleCalendar($this->user->id))->withFakeQueueInteractions());

    $later->assertReleased(90);
    expect($this->google->requests)->toHaveCount(1);
});

test('a new time zone queues a sync, so timed events move with it', function () {
    Queue::fake();

    $this->actingAs($this->user)
        ->getJson(route('sync.pull'), ['X-Timezone' => 'America/New_York'])
        ->assertOk();

    Queue::assertPushed(SyncGoogleCalendar::class, fn (SyncGoogleCalendar $job) => $job->userId === $this->user->id);
});

test('a failing dispatch never fails the push', function () {
    Bus::shouldReceive('dispatch')->once()->andThrow(new RuntimeException('database is locked'));
    $this->actingAs($this->user);

    push([wireTask()])->assertOk()->assertJsonPath('cursor', 1);
});

test('disconnecting forgets the events', function () {
    calendarTask();
    syncCalendar();
    Http::fake([
        'https://www.googleapis.com/calendar/v3/calendars/*' => Http::response(null, 204),
        'https://oauth2.googleapis.com/revoke' => Http::response(),
    ]);

    $this->actingAs($this->user)->delete(route('integrations.google.destroy'))->assertRedirect();

    expect(GoogleCalendarConnection::count())->toBe(0)
        ->and(GoogleCalendarEvent::count())->toBe(0);
});

test('a push queues a sync for a connected user', function () {
    Queue::fake();

    $this->actingAs($this->user);
    push([wireTask()])->assertOk();

    Queue::assertPushed(SyncGoogleCalendar::class, fn (SyncGoogleCalendar $job) => $job->userId === $this->user->id
        && $job->delay === SyncGoogleCalendar::DEBOUNCE_SECONDS);
});

test('a push queues nothing when it applied nothing, the user is not connected, the connection is broken or Google is not configured', function (Closure $setUp) {
    Queue::fake();
    $setUp->call($this);

    $this->actingAs($this->user->fresh());
    push([wireTask()])->assertOk();

    Queue::assertNotPushed(SyncGoogleCalendar::class);
})->with([
    'nothing applied' => [function () {
        $task = wireTask();
        $this->actingAs($this->user);
        push([$task]);
        Queue::fake();
        push([[...$task, 'updated_at' => '2026-10-15T08:00:00.000Z']])->assertJsonPath('applied', []);
        $this->user = User::factory()->create();
    }],
    'not connected' => [fn () => $this->connection->delete()],
    'broken' => [fn () => $this->connection->update(['disconnected_reason' => 'invalid_grant'])],
    'not configured' => [fn () => config(['services.google.client_id' => null])],
]);

test('the daily command queues a sync for every working connection', function () {
    Queue::fake();
    $broken = User::factory()->create();
    $broken->googleCalendarConnection()->create([
        ...$this->connection->only(['google_email', 'calendar_id']),
        'access_token' => 'a', 'refresh_token' => 'r', 'token_expires_at' => now(), 'connected_at' => now(),
        'disconnected_reason' => 'invalid_grant',
    ]);

    $this->artisan('google-calendar:sync')->assertSuccessful();

    Queue::assertPushed(SyncGoogleCalendar::class, 1);
    Queue::assertPushed(SyncGoogleCalendar::class, fn (SyncGoogleCalendar $job) => $job->userId === $this->user->id);
});

test('the integrations page shows when it last synced and the last error', function () {
    $this->connection->update(['last_synced_at' => now(), 'last_error' => 'Invalid start time.']);

    $this->actingAs($this->user)
        ->get(route('integrations.edit'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('googleCalendar.lastSyncedAt', '2026-10-26T10:00:00+00:00')
            ->where('googleCalendar.lastError', 'Invalid start time.'));
});
