<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\FakeStripe;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->stripe = enableSaas();
});

afterEach(fn () => FakeStripe::uninstall());

test('a paid lifetime checkout grants lifetime access', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test']);

    webhook('checkout.session.completed', lifetimeSession())->assertOk();

    expect($user->refresh())->hasLifetime()->toBeTrue()->lifetime_payment_id->toBe('pi_test');
});

test('an unpaid checkout waits for the delayed payment to succeed', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test']);

    webhook('checkout.session.completed', lifetimeSession(['payment_status' => 'unpaid']))->assertOk();
    expect($user->refresh()->hasLifetime())->toBeFalse();

    webhook('checkout.session.async_payment_succeeded', lifetimeSession())->assertOk();
    expect($user->refresh()->hasLifetime())->toBeTrue();
});

test('the lifetime purchase of a weekly subscriber cancels the subscription at period end', function () {
    $user = weeklySubscriber();
    $periodEnd = now()->addDays(3)->startOfSecond();
    $this->stripe
        ->on('post', '/v1/subscriptions/sub_test', stripeSubscription(['cancel_at_period_end' => true]))
        ->on('get', '/v1/subscription_items/si_test', [
            'id' => 'si_test', 'object' => 'subscription_item', 'current_period_end' => $periodEnd->timestamp,
        ]);

    webhook('checkout.session.completed', lifetimeSession())->assertOk();

    expect($this->stripe->lastRequest('post', '/v1/subscriptions/sub_test'))->toMatchArray(['cancel_at_period_end' => 'true'])
        ->and($user->refresh()->plan()?->value)->toBe('lifetime')
        ->and($user->subscription('default')?->ends_at?->timestamp)->toBe($periodEnd->timestamp);
});

test('a repeated event changes nothing', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test']);

    webhook('checkout.session.completed', lifetimeSession())->assertOk();
    $purchasedAt = $user->refresh()->lifetime_purchased_at;
    $this->travel(1)->hour();
    webhook('checkout.session.completed', lifetimeSession())->assertOk();

    expect($user->refresh()->lifetime_purchased_at?->equalTo($purchasedAt))->toBeTrue();
});

test('a full refund revokes lifetime access, a partial one does not', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test', 'lifetime_purchased_at' => now(), 'lifetime_payment_id' => 'pi_test']);
    $charge = ['id' => 'ch_test', 'object' => 'charge', 'payment_intent' => 'pi_test', 'customer' => 'cus_test'];

    webhook('charge.refunded', [...$charge, 'refunded' => false, 'amount_refunded' => 100])->assertOk();
    expect($user->refresh()->hasLifetime())->toBeTrue();

    webhook('charge.refunded', [...$charge, 'refunded' => true])->assertOk();
    expect($user->refresh()->hasAccess())->toBeFalse();
    $this->actingAs($user);
    push([wireTask()])->assertStatus(402);
});

test('a refund of another payment keeps lifetime access', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test', 'lifetime_purchased_at' => now(), 'lifetime_payment_id' => 'pi_test']);

    webhook('charge.refunded', ['id' => 'ch_other', 'object' => 'charge', 'payment_intent' => 'pi_other', 'refunded' => true])->assertOk();

    expect($user->refresh()->hasLifetime())->toBeTrue();
});

test('subscription events from Cashier keep working: created, then deleted ends access', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test']);

    webhook('customer.subscription.created', stripeSubscription())->assertOk();
    expect($user->refresh()->plan()?->value)->toBe('weekly');

    webhook('customer.subscription.deleted', stripeSubscription(['status' => 'canceled']))->assertOk();
    expect($user->refresh()->hasAccess())->toBeFalse();
});

test('the webhook rejects events with a bad signature', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test']);

    $this->postJson('/stripe/webhook', ['id' => 'evt_test', 'type' => 'checkout.session.completed', 'data' => ['object' => lifetimeSession()]])
        ->assertForbidden();

    expect($user->refresh()->hasLifetime())->toBeFalse();
});

test('the webhook refuses every event when no signing secret is set', function () {
    config(['cashier.webhook.secret' => null]);
    $user = User::factory()->create(['stripe_id' => 'cus_test']);

    $this->postJson('/stripe/webhook', ['id' => 'evt_test', 'type' => 'checkout.session.completed', 'data' => ['object' => lifetimeSession()]])
        ->assertStatus(503);

    expect($user->refresh()->hasLifetime())->toBeFalse();
});

test('a retried event cancels the weekly plan if cancelling failed the first time', function () {
    $user = weeklySubscriber();
    $user->forceFill(['lifetime_purchased_at' => now(), 'lifetime_payment_id' => 'pi_test'])->save();
    $this->stripe
        ->on('post', '/v1/subscriptions/sub_test', stripeSubscription(['cancel_at_period_end' => true]))
        ->on('get', '/v1/subscription_items/si_test', ['id' => 'si_test', 'object' => 'subscription_item', 'current_period_end' => now()->addDay()->timestamp]);

    webhook('checkout.session.completed', lifetimeSession())->assertOk();

    expect($this->stripe->lastRequest('post', '/v1/subscriptions/sub_test'))->not->toBeNull()
        ->and($user->refresh()->subscription('default')?->onGracePeriod())->toBeTrue();
});

test('a free lifetime order (a 100% promotion code) grants lifetime access', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test']);

    webhook('checkout.session.completed', lifetimeSession([
        'payment_status' => 'no_payment_required', 'payment_intent' => null,
    ]))->assertOk();

    expect($user->refresh())->hasLifetime()->toBeTrue()->lifetime_payment_id->toBeNull();

    // A refund of some other payment never revokes it.
    webhook('charge.refunded', ['id' => 'ch_other', 'object' => 'charge', 'refunded' => true, 'payment_intent' => 'pi_other'])
        ->assertOk();

    expect($user->refresh()->hasLifetime())->toBeTrue();
});
