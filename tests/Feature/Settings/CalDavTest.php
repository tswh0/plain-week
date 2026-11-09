<?php

use App\Models\CalDavCredential;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

beforeEach(function () {
    config([
        'caldav.enabled' => true,
        'services.google.client_id' => null,
        'services.google.client_secret' => null,
    ]);

    $this->user = User::factory()->create(['email' => 'tom@example.com']);
});

test('the page offers CalDAV with the server and the account email', function () {
    $this->actingAs($this->user)
        ->get(route('integrations.edit'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('settings/integrations')
            ->where('googleCalendar', null)
            ->where('caldav.server', url('/dav/'))
            ->where('caldav.username', 'tom@example.com')
            ->where('caldav.credentials', []));
});

test('the integration is offered to the pages when enabled', function () {
    $this->actingAs($this->user)
        ->get(route('profile.edit'))
        ->assertInertia(fn (Assert $page) => $page->where('integrations.caldav', true));
});

test('the page and the routes are 404 when disabled and Google is not configured', function () {
    config(['caldav.enabled' => false]);

    $this->actingAs($this->user)->get(route('integrations.edit'))->assertNotFound();
    $this->actingAs($this->user)->post(route('integrations.caldav.store'), ['name' => 'Phone'])->assertNotFound();
    $this->actingAs($this->user)
        ->get(route('profile.edit'))
        ->assertInertia(fn (Assert $page) => $page->where('integrations.caldav', false));
});

test('an app password is created and shown once', function () {
    $response = $this->actingAs($this->user)
        ->post(route('integrations.caldav.store'), ['name' => 'Phone']);

    $response->assertRedirect(route('integrations.edit'));
    $response->assertInertiaFlash('caldavCredential.name', 'Phone');
    $response->assertInertiaFlash('caldavCredential.username', 'tom@example.com');
    $response->assertInertiaFlash('toast.type', 'success');

    $credential = CalDavCredential::sole();
    $flash = session('inertia.flash_data');

    expect($credential->user_id)->toBe($this->user->id)
        ->and($credential->name)->toBe('Phone')
        ->and($flash['caldavCredential']['password'])->toHaveLength(40)
        ->and($credential->password_hash)->toBe(CalDavCredential::hash($flash['caldavCredential']['password']));
});

test('a name is required', function () {
    $this->actingAs($this->user)
        ->post(route('integrations.caldav.store'), ['name' => ''])
        ->assertSessionHasErrors('name');

    expect(CalDavCredential::count())->toBe(0);
});

test('a credential can be revoked', function () {
    $credential = $this->user->calDavCredentials()->create([
        'name' => 'Phone',
        'password_hash' => CalDavCredential::hash('secret'),
    ]);

    $this->actingAs($this->user)
        ->delete(route('integrations.caldav.destroy', $credential))
        ->assertRedirect(route('integrations.edit'))
        ->assertInertiaFlash('toast.type', 'success');

    expect(CalDavCredential::count())->toBe(0);
});

test('another account cannot revoke a credential', function () {
    $credential = $this->user->calDavCredentials()->create([
        'name' => 'Phone',
        'password_hash' => CalDavCredential::hash('secret'),
    ]);

    $this->actingAs(User::factory()->create())
        ->delete(route('integrations.caldav.destroy', $credential))
        ->assertNotFound();

    expect(CalDavCredential::count())->toBe(1);
});

test('creating needs a plan in SaaS mode, but revoking does not', function () {
    config(['saas.enabled' => true]);

    $this->actingAs($this->user)
        ->post(route('integrations.caldav.store'), ['name' => 'Phone'])
        ->assertRedirect(route('billing.plans'));

    expect(CalDavCredential::count())->toBe(0);

    $credential = $this->user->calDavCredentials()->create([
        'name' => 'Phone',
        'password_hash' => CalDavCredential::hash('secret'),
    ]);

    $this->actingAs($this->user)
        ->get(route('integrations.edit'))
        ->assertOk();

    $this->actingAs($this->user)
        ->delete(route('integrations.caldav.destroy', $credential))
        ->assertRedirect(route('integrations.edit'));

    expect(CalDavCredential::count())->toBe(0);
});

test('a lapsed account cannot use its calendar feed', function () {
    config(['saas.enabled' => true]);

    $this->user->calDavCredentials()->create([
        'name' => 'Phone',
        'password_hash' => CalDavCredential::hash('secret'),
    ]);

    $auth = 'Basic '.base64_encode('tom@example.com:secret');

    $this->call('PROPFIND', '/dav/', server: ['HTTP_AUTHORIZATION' => $auth])->assertStatus(402);

    $this->user->forceFill(['lifetime_purchased_at' => now()])->save();

    $this->call('PROPFIND', '/dav/', server: ['HTTP_AUTHORIZATION' => $auth])->assertStatus(207);
});
