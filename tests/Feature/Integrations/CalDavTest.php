<?php

use App\Models\CalDavCredential;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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

    DB::table('sync_versions')->where('id', 1)->update(['value' => 100]);
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

function icsEvent(string $uid, string $start, string $summary, string $extra = ''): string
{
    return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nDTSTAMP:20261101T100000Z\r\n"
        ."DTSTART:{$start}\r\nSUMMARY:{$summary}\r\n{$extra}END:VEVENT\r\nEND:VCALENDAR\r\n";
}

function icsTodo(string $uid, string $summary, string $extra = ''): string
{
    return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:{$uid}\r\nDTSTAMP:20261101T100000Z\r\n"
        ."SUMMARY:{$summary}\r\n{$extra}END:VTODO\r\nEND:VCALENDAR\r\n";
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

it('redirects the well-known path with a trailing slash', function () {
    $response = dav('PROPFIND', '/.well-known/caldav', $this->auth);

    $response->assertStatus(301);
    expect(parse_url((string) $response->headers->get('Location'), PHP_URL_PATH))->toBe('/dav/');
});

it('answers a PROPFIND on the web root like the DAV root', function () {
    $response = dav('PROPFIND', '/', $this->auth, '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>');

    $response->assertStatus(207);
    expect($response->getContent())->toContain('/dav/principals/'.$this->user->id.'/');
});

it('answers OPTIONS without credentials', function () {
    test()->call('OPTIONS', '/dav/')
        ->assertStatus(200)
        ->assertHeader('DAV', '1, 2, 3, calendar-access');
});

it('publishes the account email on the principal', function () {
    $response = dav('PROPFIND', '/dav/principals/'.$this->user->id.'/', $this->auth, '<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-user-address-set/></D:prop></D:propfind>');

    $response->assertStatus(207);
    expect($response->getContent())->toContain('mailto:tom@example.com');
});

it('lists the principal from the principal collection', function () {
    $response = dav('PROPFIND', '/dav/principals/', $this->auth, '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:displayname/></D:prop></D:propfind>', ['HTTP_DEPTH' => '1']);

    $response->assertStatus(207);
    expect($response->getContent())
        ->toContain('/dav/principals/'.$this->user->id.'/')
        ->toContain('Principals');
});

it('publishes the principal, the home and both collections', function () {
    $root = dav('PROPFIND', '/dav/', $this->auth, '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>');
    $root->assertStatus(207);
    expect($root->getContent())->toContain('<D:href>/dav/principals/'.$this->user->id.'/</D:href>');

    $principal = dav('PROPFIND', '/dav/principals/'.$this->user->id.'/', $this->auth, '<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>');
    $principal->assertStatus(207);
    expect($principal->getContent())->toContain('<D:href>/dav/calendars/'.$this->user->id.'/</D:href>');

    $home = dav('PROPFIND', '/dav/calendars/'.$this->user->id.'/', $this->auth, '<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><C:supported-calendar-component-set/></D:prop></D:propfind>', ['HTTP_DEPTH' => '1']);
    $home->assertStatus(207);
    expect($home->getContent())
        ->toContain('/dav/calendars/'.$this->user->id.'/planner/')
        ->toContain('/dav/calendars/'.$this->user->id.'/tasks/')
        ->toContain('Plain Week Events')
        ->toContain('Plain Week Tasks')
        ->toContain('name="VEVENT"')
        ->toContain('name="VTODO"');
});

it('reports only timed items as events', function () {
    $milk = caldavTask($this->user, ['text' => 'Buy milk', 'date' => '2026-11-09']);
    caldavTask($this->user, ['text' => 'Gym', 'date' => '2026-11-10', 'time' => '17:30', 'color' => 'cornflower']);
    caldavTask($this->user, ['text' => 'Elsewhere', 'date' => '2027-06-01', 'time' => '09:00']);

    $body = '<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        .'<D:prop><D:getetag/><C:calendar-data/></D:prop>'
        .'<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">'
        .'<C:time-range start="20261101T000000Z" end="20261201T000000Z"/>'
        .'</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>';

    $xml = dav('REPORT', '/dav/calendars/'.$this->user->id.'/planner/', $this->auth, $body, ['HTTP_DEPTH' => '1'])->getContent();

    expect($xml)
        ->toContain('BEGIN:VEVENT')
        ->toContain('SUMMARY:Gym')
        ->toContain('DTSTART:20261110T163000Z')
        ->toContain('DTEND:20261110T165000Z')
        ->not->toContain('Buy milk')
        ->not->toContain('Elsewhere');

    dav('GET', '/dav/calendars/'.$this->user->id.'/planner/'.$milk->id.'.ics', $this->auth)->assertStatus(404);
});

it('reports untimed and Someday items as tasks', function () {
    caldavTask($this->user, ['text' => 'Buy milk', 'date' => '2026-11-09', 'notes' => "Oat milk\nand bread"]);
    caldavTask($this->user, ['text' => 'Someday thing', 'date' => null, 'someday_column' => 0, 'position' => 'a1']);
    caldavTask($this->user, ['text' => 'Done thing', 'date' => '2026-11-10', 'done' => true, 'done_at' => '2026-11-10T12:00:00.000Z']);
    caldavTask($this->user, ['text' => 'Gym', 'date' => '2026-11-10', 'time' => '17:30']);

    $body = '<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        .'<D:prop><D:getetag/><C:calendar-data/></D:prop>'
        .'<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VTODO">'
        .'<C:time-range start="20261101T000000Z" end="20261201T000000Z"/>'
        .'</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>';

    $xml = dav('REPORT', '/dav/calendars/'.$this->user->id.'/tasks/', $this->auth, $body, ['HTTP_DEPTH' => '1'])->getContent();

    expect($xml)
        ->toContain('BEGIN:VTODO')
        ->toContain('SUMMARY:Buy milk')
        ->toContain('DUE;VALUE=DATE:20261109')
        ->toContain('SUMMARY:Someday thing')
        ->toContain('STATUS:COMPLETED')
        ->toContain('COMPLETED:20261110T120000Z')
        ->not->toContain('SUMMARY:Gym');
});

it('serves a timed event with a stable etag', function () {
    $task = caldavTask($this->user, ['text' => 'Gym', 'time' => '17:30']);

    $first = dav('GET', '/dav/calendars/'.$this->user->id.'/planner/'.$task->id.'.ics', $this->auth);
    $second = dav('GET', '/dav/calendars/'.$this->user->id.'/planner/'.$task->id.'.ics', $this->auth);

    $first->assertStatus(200)->assertHeader('Content-Type', 'text/calendar; charset=utf-8');
    expect($first->getContent())->toContain('BEGIN:VEVENT')->toContain('UID:'.$task->id.'@plainweek');
    expect($first->headers->get('ETag'))->toBe($second->headers->get('ETag'));
});

it('serves a task as a VTODO with a stable etag', function () {
    $task = caldavTask($this->user);

    $first = dav('GET', '/dav/calendars/'.$this->user->id.'/tasks/'.$task->id.'.ics', $this->auth);
    $second = dav('GET', '/dav/calendars/'.$this->user->id.'/tasks/'.$task->id.'.ics', $this->auth);

    $first->assertStatus(200)->assertHeader('Content-Type', 'text/calendar; charset=utf-8');
    expect($first->getContent())
        ->toContain('BEGIN:VTODO')
        ->toContain('UID:'.$task->id.'@plainweek')
        ->toContain('DUE;VALUE=DATE:20261109');
    expect($first->headers->get('ETag'))->toBe($second->headers->get('ETag'));
});

it('hides a tombstoned task', function () {
    $task = caldavTask($this->user, ['deleted_at' => '2026-11-02T10:00:00.000Z', 'version' => 2]);

    dav('GET', '/dav/calendars/'.$this->user->id.'/tasks/'.$task->id.'.ics', $this->auth)->assertStatus(404);
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

    expect(substr_count($xml, 'UID:'.$series->id.':2026-11-04@plainweek'))->toBe(1);
});

it('creates a timed task from a VEVENT', function () {
    $id = (string) Str::uuid7();
    $ics = icsEvent($id.'@example', '20261110T163000Z', 'Gym', "DESCRIPTION:Leg day\r\n");

    $response = dav('PUT', '/dav/calendars/'.$this->user->id.'/planner/'.$id.'.ics', $this->auth, $ics, [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
        'HTTP_IF_NONE_MATCH' => '*',
    ]);

    $response->assertStatus(201);
    expect($response->headers->get('Location'))->toBe('/dav/calendars/'.$this->user->id.'/planner/'.$id.'.ics');
    expect($response->headers->get('ETag'))->not->toBeNull();

    $task = Task::find($id);
    expect($task)->not->toBeNull()
        ->and($task->date)->toBe('2026-11-10')
        ->and($task->time)->toBe('17:30')
        ->and($task->text)->toBe('Gym')
        ->and($task->notes)->toBe('Leg day')
        ->and($task->done)->toBeFalse()
        ->and($task->version)->toBeGreaterThan(0);
});

it('updates a task with If-Match and rejects a stale one', function () {
    $task = caldavTask($this->user, ['text' => 'Gym', 'time' => '17:30']);
    $uri = '/dav/calendars/'.$this->user->id.'/planner/'.$task->id.'.ics';
    $etag = dav('GET', $uri, $this->auth)->headers->get('ETag');
    $ics = icsEvent($task->id.'@example', '20261110T180000Z', 'Gym (late)');

    dav('PUT', $uri, $this->auth, $ics, [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
        'HTTP_IF_MATCH' => (string) $etag,
    ])->assertStatus(204);

    $task->refresh();
    expect($task->text)->toBe('Gym (late)')
        ->and($task->time)->toBe('19:00')
        ->and($task->version)->toBeGreaterThan(1);

    dav('PUT', $uri, $this->auth, icsEvent($task->id.'@example', '20261110T190000Z', 'Too late'), [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
        'HTTP_IF_MATCH' => (string) $etag,
    ])->assertStatus(412);
});

it('creates a task from a VTODO', function () {
    $id = (string) Str::uuid7();
    $ics = icsTodo($id.'@example', 'Buy milk', "DUE;VALUE=DATE:20261110\r\nSTATUS:NEEDS-ACTION\r\n");

    dav('PUT', '/dav/calendars/'.$this->user->id.'/tasks/'.$id.'.ics', $this->auth, $ics, [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
        'HTTP_IF_NONE_MATCH' => '*',
    ])->assertStatus(201);

    $task = Task::find($id);
    expect($task->date)->toBe('2026-11-10')
        ->and($task->time)->toBeNull()
        ->and($task->done)->toBeFalse();

    $xml = dav('GET', '/dav/calendars/'.$this->user->id.'/tasks/'.$id.'.ics', $this->auth)->getContent();
    expect($xml)->toContain('BEGIN:VTODO')->toContain('DUE;VALUE=DATE:20261110');
});

it('completes a task from a VTODO', function () {
    $task = caldavTask($this->user);
    $uri = '/dav/calendars/'.$this->user->id.'/tasks/'.$task->id.'.ics';
    $etag = dav('GET', $uri, $this->auth)->headers->get('ETag');
    $ics = icsTodo($task->id.'@example', 'Buy milk', "DUE;VALUE=DATE:20261109\r\nSTATUS:COMPLETED\r\nCOMPLETED:20261110T120000Z\r\nPERCENT-COMPLETE:100\r\n");

    dav('PUT', $uri, $this->auth, $ics, [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
        'HTTP_IF_MATCH' => (string) $etag,
    ])->assertStatus(204);

    $task->refresh();
    expect($task->done)->toBeTrue()
        ->and($task->done_at?->utc()->format('Ymd\THis\Z'))->toBe('20261110T120000Z');

    expect(dav('GET', $uri, $this->auth)->getContent())
        ->toContain('STATUS:COMPLETED')
        ->toContain('PERCENT-COMPLETE:100');
});

it('creates a Someday task from a VTODO without a due date', function () {
    $id = (string) Str::uuid7();

    dav('PUT', '/dav/calendars/'.$this->user->id.'/tasks/'.$id.'.ics', $this->auth, icsTodo($id.'@example', 'Someday thing'), [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
        'HTTP_IF_NONE_MATCH' => '*',
    ])->assertStatus(201);

    $task = Task::find($id);
    expect($task->date)->toBeNull()
        ->and($task->time)->toBeNull()
        ->and($task->someday_column)->toBe(0);

    expect(dav('GET', '/dav/calendars/'.$this->user->id.'/tasks/'.$id.'.ics', $this->auth)->getContent())
        ->not->toContain('DUE');
});

it('deletes a task with If-Match', function () {
    $task = caldavTask($this->user);
    $uri = '/dav/calendars/'.$this->user->id.'/tasks/'.$task->id.'.ics';
    $etag = dav('GET', $uri, $this->auth)->headers->get('ETag');

    dav('DELETE', $uri, $this->auth, null, ['HTTP_IF_MATCH' => (string) $etag])->assertStatus(204);
    expect($task->refresh()->deleted_at)->not->toBeNull();
    dav('GET', $uri, $this->auth)->assertStatus(404);
    dav('DELETE', $uri, $this->auth)->assertStatus(404);
});

it('edits one occurrence as an exception', function () {
    $series = caldavTask($this->user, [
        'text' => 'Standup',
        'date' => '2026-11-02',
        'time' => '09:00',
        'recurrence' => ['type' => 'weekly', 'weekdays' => [1, 3, 5]],
        'version' => 10,
    ]);
    $key = rawurlencode($series->id.':2026-11-04');

    dav('PUT', '/dav/calendars/'.$this->user->id.'/planner/'.$key.'.ics', $this->auth, icsEvent('moved@example', '20261106T090000Z', 'Standup (moved)'), [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
    ])->assertStatus(204);

    $exception = Task::query()->where('series_id', $series->id)->where('occurrence_date', '2026-11-04')->first();
    expect($exception)->not->toBeNull()
        ->and($exception->date)->toBe('2026-11-06')
        ->and($exception->time)->toBe('10:00')
        ->and($exception->text)->toBe('Standup (moved)')
        ->and($exception->recurrence)->toBeNull();

    $xml = dav('GET', '/dav/calendars/'.$this->user->id.'/planner/'.$key.'.ics', $this->auth)->getContent();
    expect($xml)->toContain('DTSTART:20261106T090000Z')->toContain('SUMMARY:Standup (moved)');
});

it('deletes one occurrence as a tombstone', function () {
    $series = caldavTask($this->user, [
        'text' => 'Standup',
        'date' => '2026-11-02',
        'time' => '09:00',
        'recurrence' => ['type' => 'weekly', 'weekdays' => [1, 3, 5]],
        'version' => 10,
    ]);
    $key = rawurlencode($series->id.':2026-11-04');

    dav('DELETE', '/dav/calendars/'.$this->user->id.'/planner/'.$key.'.ics', $this->auth)->assertStatus(204);

    $tombstone = Task::query()->where('series_id', $series->id)->where('occurrence_date', '2026-11-04')->first();
    expect($tombstone)->not->toBeNull()->and($tombstone->deleted_at)->not->toBeNull();

    $body = '<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        .'<D:prop><C:calendar-data/></D:prop>'
        .'<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">'
        .'<C:time-range start="20261102T000000Z" end="20261108T000000Z"/>'
        .'</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>';
    $xml = dav('REPORT', '/dav/calendars/'.$this->user->id.'/planner/', $this->auth, $body)->getContent();

    expect($xml)->not->toContain($series->id.'%3A2026-11-04.ics');
    expect($xml)->toContain($series->id.'%3A2026-11-02.ics');
});

it('refuses an all-day event', function () {
    $id = (string) Str::uuid7();
    $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$id}@example\r\nDTSTAMP:20261101T100000Z\r\n"
        ."DTSTART;VALUE=DATE:20261110\r\nSUMMARY:All day\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    dav('PUT', '/dav/calendars/'.$this->user->id.'/planner/'.$id.'.ics', $this->auth, $ics, [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
    ])->assertStatus(409);
});

it('refuses a recurring event', function () {
    $id = (string) Str::uuid7();

    dav('PUT', '/dav/calendars/'.$this->user->id.'/planner/'.$id.'.ics', $this->auth, icsEvent($id.'@example', '20261110T163000Z', 'Daily', "RRULE:FREQ=DAILY\r\n"), [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
    ])->assertStatus(409);
});

it('refuses a task in the events collection and an event in the tasks collection', function () {
    $id = (string) Str::uuid7();

    dav('PUT', '/dav/calendars/'.$this->user->id.'/planner/'.$id.'.ics', $this->auth, icsTodo($id.'@example', 'Wrong'), [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
    ])->assertStatus(409);

    dav('PUT', '/dav/calendars/'.$this->user->id.'/tasks/'.$id.'.ics', $this->auth, icsEvent($id.'@example', '20261110T163000Z', 'Wrong'), [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
    ])->assertStatus(409);
});

it('refuses If-None-Match on an existing resource', function () {
    $task = caldavTask($this->user, ['time' => '17:30']);

    dav('PUT', '/dav/calendars/'.$this->user->id.'/planner/'.$task->id.'.ics', $this->auth, icsEvent($task->id.'@example', '20261110T163000Z', 'Again'), [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
        'HTTP_IF_NONE_MATCH' => '*',
    ])->assertStatus(412);
});

it('refuses an oversized REPORT body', function () {
    dav('REPORT', '/dav/calendars/'.$this->user->id.'/planner/', $this->auth, str_repeat(' ', 1024 * 1024 + 1))
        ->assertStatus(413);
});

it('refuses an oversized PUT body', function () {
    $id = (string) Str::uuid7();

    dav('PUT', '/dav/calendars/'.$this->user->id.'/planner/'.$id.'.ics', $this->auth, str_repeat('A', 256 * 1024 + 1), [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
    ])->assertStatus(413);
});

it('creates a task at a generated location when the filename is not a UUID', function () {
    $response = dav('PUT', '/dav/calendars/'.$this->user->id.'/planner/not-a-uuid.ics', $this->auth, icsEvent('x@example', '20261110T163000Z', 'Gym'), [
        'CONTENT_TYPE' => 'text/calendar; charset=utf-8',
    ]);

    $response->assertStatus(201);
    expect($response->headers->get('Location'))->toMatch('#/planner/[0-9a-f-]{36}\.ics$#');
});
