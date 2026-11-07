<?php

use App\Models\CalDavCredential;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['caldav.enabled' => true]);

    $this->user = User::factory()->create(['email' => 'tom@example.com']);
    $this->user->timezone = 'Europe/Berlin';
    $this->user->save();

    $this->password = Str::random(40);

    CalDavCredential::create([
        'user_id' => $this->user->id,
        'name' => 'test',
        'password_hash' => CalDavCredential::hash($this->password),
    ]);

    $this->auth = 'Basic '.base64_encode('tom@example.com:'.$this->password);
});

/**
 * @param  array<string, mixed>  $overrides
 */
function caldavTask(User $user, array $overrides = []): Task
{
    $version = $overrides['version'] ?? 1;
    unset($overrides['version']);

    $task = new Task;
    $task->fill(array_merge([
        'id' => (string) Str::uuid7(),
        'text' => 'Buy milk',
        'date' => '2026-11-09',
        'someday_column' => null,
        'position' => 'a0',
        'done' => false,
        'done_at' => null,
        'color' => 'none',
        'time' => null,
        'notes' => '',
        'subtasks' => [],
        'recurrence' => null,
        'series_id' => null,
        'occurrence_date' => null,
        'created_at' => '2026-11-01T10:00:00.000Z',
        'updated_at' => '2026-11-01T10:00:00.000Z',
        'deleted_at' => null,
    ], $overrides));
    $task->user_id = $user->id;
    $task->version = $version;
    $task->save();

    return $task;
}

/**
 * @param  array<string, string>  $headers
 */
function dav(string $method, string $uri, string $auth, ?string $body = null, array $headers = []): TestResponse
{
    return test()->call($method, $uri, server: [
        'HTTP_AUTHORIZATION' => $auth,
        'CONTENT_TYPE' => 'application/xml; charset=utf-8',
        ...$headers,
    ], content: $body);
}

it('refuses a request without credentials', function () {
    $response = test()->call('PROPFIND', '/dav/');

    $response->assertStatus(401);
    expect($response->headers->get('WWW-Authenticate'))->toContain('Basic');
});

it('is a 404 when the instance has not turned it on', function () {
    config(['caldav.enabled' => false]);

    test()->call('PROPFIND', '/dav/')->assertNotFound();
    test()->call('PROPFIND', '/.well-known/caldav')->assertNotFound();
});

it('refuses a wrong password', function () {
    dav('PROPFIND', '/dav/', 'Basic '.base64_encode('tom@example.com:wrong'))->assertStatus(401);
});

it('rate limits failed credentials per IP', function () {
    for ($attempt = 0; $attempt < 10; $attempt++) {
        dav('PROPFIND', '/dav/', 'Basic '.base64_encode('tom@example.com:wrong'))->assertStatus(401);
    }

    dav('PROPFIND', '/dav/', 'Basic '.base64_encode('tom@example.com:wrong'))->assertStatus(429);
});

it('redirects the well-known path', function () {
    dav('PROPFIND', '/.well-known/caldav', $this->auth)->assertStatus(301)->assertRedirect('/dav/');
});

it('publishes the principal and the calendar home', function () {
    $root = dav('PROPFIND', '/dav/', $this->auth, '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>');
    $root->assertStatus(207);
    expect($root->getContent())->toContain('<D:href>/dav/principals/'.$this->user->id.'/</D:href>');

    $principal = dav('PROPFIND', '/dav/principals/'.$this->user->id.'/', $this->auth, '<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>');
    $principal->assertStatus(207);
    expect($principal->getContent())->toContain('<D:href>/dav/calendars/'.$this->user->id.'/</D:href>');

    $home = dav('PROPFIND', '/dav/calendars/'.$this->user->id.'/', $this->auth, '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>', ['HTTP_DEPTH' => '1']);
    $home->assertStatus(207);
    expect($home->getContent())
        ->toContain('/dav/calendars/'.$this->user->id.'/planner/')
        ->toContain('Plain Week');
});

it('reports the planner as events in the requested range', function () {
    $allDay = caldavTask($this->user, ['text' => 'Buy milk', 'date' => '2026-11-09', 'notes' => "Oat milk\nand bread"]);
    caldavTask($this->user, ['text' => 'Gym', 'date' => '2026-11-10', 'time' => '17:30', 'color' => 'cornflower']);
    caldavTask($this->user, ['text' => 'Elsewhere', 'date' => '2027-06-01']);

    $body = '<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        .'<D:prop><D:getetag/><C:calendar-data/></D:prop>'
        .'<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">'
        .'<C:time-range start="20261101T000000Z" end="20261201T000000Z"/>'
        .'</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>';

    $response = dav('REPORT', '/dav/calendars/'.$this->user->id.'/planner/', $this->auth, $body, ['HTTP_DEPTH' => '1']);
    $response->assertStatus(207);

    $xml = $response->getContent();

    expect($xml)
        ->toContain($allDay->id.'.ics')
        ->toContain('SUMMARY:Buy milk')
        ->toContain('DESCRIPTION:Oat milk\\nand bread')
        ->toContain('DTSTART;VALUE=DATE:20261109')
        ->toContain('DTEND;VALUE=DATE:20261110')
        // 17:30 in Europe/Berlin is 16:30 UTC.
        ->toContain('DTSTART:20261110T163000Z')
        ->toContain('DTEND:20261110T165000Z')
        ->not->toContain('Elsewhere');
});

it('serves one resource with a stable etag', function () {
    $task = caldavTask($this->user, ['text' => 'Buy milk']);

    $first = dav('GET', '/dav/calendars/'.$this->user->id.'/planner/'.$task->id.'.ics', $this->auth);
    $second = dav('GET', '/dav/calendars/'.$this->user->id.'/planner/'.$task->id.'.ics', $this->auth);

    $first->assertStatus(200)->assertHeader('Content-Type', 'text/calendar; charset=utf-8');
    expect($first->getContent())->toContain('UID:'.$task->id.'@plainweek');
    expect($first->headers->get('ETag'))->toBe($second->headers->get('ETag'));
});

it('hides a tombstoned task', function () {
    $task = caldavTask($this->user, ['deleted_at' => '2026-11-02T10:00:00.000Z', 'version' => 2]);

    dav('GET', '/dav/calendars/'.$this->user->id.'/planner/'.$task->id.'.ics', $this->auth)->assertStatus(404);
});

it('expands a series and keeps a moved occurrence under its own key', function () {
    $series = caldavTask($this->user, [
        'text' => 'Standup',
        'date' => '2026-11-02',
        'time' => '09:00',
        'recurrence' => ['type' => 'weekly', 'weekdays' => [1, 3, 5]],
        'version' => 10,
    ]);

    caldavTask($this->user, [
        'text' => 'Standup (moved)',
        'date' => '2026-11-06',
        'time' => '10:00',
        'series_id' => $series->id,
        'occurrence_date' => '2026-11-04',
        'version' => 11,
    ]);

    $body = '<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        .'<D:prop><C:calendar-data/></D:prop>'
        .'<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">'
        .'<C:time-range start="20261102T000000Z" end="20261108T000000Z"/>'
        .'</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>';

    $xml = dav('REPORT', '/dav/calendars/'.$this->user->id.'/planner/', $this->auth, $body)->getContent();

    expect($xml)
        ->toContain($series->id.'%3A2026-11-02.ics')
        ->toContain($series->id.'%3A2026-11-04.ics')
        ->toContain($series->id.'%3A2026-11-06.ics')
        ->toContain('SUMMARY:Standup (moved)');

    // The Wednesday occurrence is replaced by its exception, so it is generated once, not twice.
    expect(substr_count($xml, 'UID:'.$series->id.':2026-11-04@plainweek'))->toBe(1);
});
