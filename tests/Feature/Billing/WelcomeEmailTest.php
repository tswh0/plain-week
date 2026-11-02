<?php

use App\Billing\LifetimeAccess;
use App\Mail\WelcomeEmail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Support\FakeStripe;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->stripe = enableSaas();
    config(['saas.seller.email' => 'victor@plainweek.eu', 'mail.from.address' => 'hello@plainweek.eu']);
    Mail::fake();
});

afterEach(fn () => FakeStripe::uninstall());

test('a lifetime grant queues the welcome email once, replying to the seller', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test', 'name' => 'Ana López']);

    webhook('checkout.session.completed', lifetimeSession())->assertOk();
    webhook('checkout.session.completed', lifetimeSession())->assertOk();

    Mail::assertQueuedCount(1);
    Mail::assertQueued(WelcomeEmail::class, fn (WelcomeEmail $mail) => $mail->hasTo($user->email)
        && $mail->hasReplyTo('victor@plainweek.eu')
        && $mail->hasSubject('Welcome to Plain Week — one question'));
    expect($user->refresh()->welcomed_at)->not->toBeNull();
});

test('a free lifetime order and a manual grant welcome too', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test']);

    webhook('checkout.session.completed', lifetimeSession(['payment_status' => 'no_payment_required', 'payment_intent' => null]))
        ->assertOk();
    $this->artisan('plainweek:grant-lifetime', ['email' => $user->email])->assertSuccessful();

    Mail::assertQueued(WelcomeEmail::class, 1);
});

test('a weekly subscription queues the welcome email once', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test']);

    webhook('customer.subscription.created', stripeSubscription())->assertOk();
    webhook('customer.subscription.updated', stripeSubscription())->assertOk();

    Mail::assertQueued(WelcomeEmail::class, fn (WelcomeEmail $mail) => $mail->hasTo($user->email));
    Mail::assertQueuedCount(1);
});

test('a subscription that is still unpaid waits until it turns active', function () {
    User::factory()->create(['stripe_id' => 'cus_test']);

    webhook('customer.subscription.created', stripeSubscription(['status' => 'incomplete']))->assertOk();
    Mail::assertNothingQueued();

    webhook('customer.subscription.updated', stripeSubscription())->assertOk();
    Mail::assertQueued(WelcomeEmail::class, 1);
});

test('the success redirect and the webhook together send it once', function (array $session, string $event, array $object) {
    $user = User::factory()->create(['stripe_id' => 'cus_test']);
    $this->actingAs($user);
    $this->stripe->on('get', '/v1/checkout/sessions/cs_test', $session);

    $this->get(route('billing.success', ['session_id' => 'cs_test']))->assertRedirect(route('home'));
    webhook($event, $object)->assertOk();

    Mail::assertQueued(WelcomeEmail::class, 1);
})->with([
    'lifetime' => fn () => [lifetimeSession(['subscription' => null]), 'checkout.session.completed', lifetimeSession()],
    'weekly' => fn () => [
        lifetimeSession(['mode' => 'subscription', 'payment_intent' => null, 'metadata' => ['plan' => 'weekly'], 'subscription' => stripeSubscription()]),
        'customer.subscription.created',
        stripeSubscription(),
    ],
]);

test('a failure to queue the email keeps the grant and lets a later event try again', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test']);
    Mail::shouldReceive('to')->once()->andThrow(new RuntimeException('Queue is down'));

    webhook('checkout.session.completed', lifetimeSession())->assertOk();

    expect($user->refresh())->hasLifetime()->toBeTrue()->welcomed_at->toBeNull();
});

test('accounts that had a plan before the migration are not welcomed retroactively', function () {
    $lifetime = User::factory()->create(['lifetime_purchased_at' => now()]);
    $weekly = weeklySubscriber();
    $neverPaid = User::factory()->create();
    $neverPaid->subscriptions()->create([
        'type' => 'default', 'stripe_id' => 'sub_unpaid', 'stripe_status' => 'incomplete', 'stripe_price' => 'price_weekly',
    ]);
    $migration = require database_path('migrations/2026_11_02_000001_add_welcomed_at_to_users_table.php');
    $migration->down();

    $migration->up();

    expect($lifetime->refresh()->welcomed_at)->not->toBeNull()
        ->and($weekly->refresh()->welcomed_at)->not->toBeNull()
        ->and($neverPaid->refresh()->welcomed_at)->toBeNull();
});

test('an account welcomed before is not welcomed again', function () {
    $user = User::factory()->create(['welcomed_at' => now()->subMonth()]);

    app(LifetimeAccess::class)->grant($user);

    Mail::assertNothingQueued();
});

test('a self-hosted instance never sends it', function () {
    config(['saas.enabled' => false]);
    $user = User::factory()->create();

    app(LifetimeAccess::class)->grant($user);

    Mail::assertNothingQueued();
    expect($user->refresh()->welcomed_at)->toBeNull();
});

test('the English email is plain text from Víctor, greeting by first name', function () {
    $mail = new WelcomeEmail(User::factory()->make(['name' => 'Ana López', 'locale' => 'en']));

    $mail->assertHasSubject('Welcome to Plain Week — one question')
        ->assertHasReplyTo('victor@plainweek.eu')
        ->assertSeeInText("Hi Ana,\n\nI'm Víctor, I build Plain Week.")
        ->assertSeeInText('what did you use to plan your week before, and what made you try Plain Week?')
        ->assertSeeInText("shape what I build next.\n\nVíctor");
    expect($mail->content()->html)->toBeNull();
});

test('the Spanish email follows the account locale', function () {
    $mail = new WelcomeEmail(User::factory()->make(['name' => 'Ana', 'locale' => 'es']));

    $mail->assertHasSubject('Bienvenido a Plain Week — una pregunta')
        ->assertHasReplyTo('victor@plainweek.eu')
        ->assertSeeInText("Hola Ana,\n\nSoy Víctor, el que hace Plain Week.")
        ->assertSeeInText('¿con qué planificabas tu semana antes y qué te hizo probar Plain Week?');
});

test('without a name the greeting has none, and an unknown locale is English', function () {
    $mail = new WelcomeEmail(User::factory()->make(['name' => ' ', 'locale' => null]));

    $mail->assertSeeInText("Hi,\n\nI'm Víctor");
});
