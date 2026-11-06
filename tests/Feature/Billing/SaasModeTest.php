<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\FakeStripe;

uses(RefreshDatabase::class);

afterEach(fn () => FakeStripe::uninstall());

describe('SaaS mode off (self-hosted)', function () {
    test('billing and legal routes are 404', function (string $method, string $uri) {
        $this->actingAs(User::factory()->create());

        $this->call($method, $uri)->assertNotFound();
    })->with([
        ['GET', '/plans'],
        ['GET', '/billing/prices'],
        ['POST', '/billing/checkout/weekly'],
        ['GET', '/billing/success'],
        ['GET', '/billing/portal'],
        ['GET', '/settings/billing'],
        ['GET', '/terms'],
        ['GET', '/privacy'],
        ['POST', '/stripe/webhook'],
    ]);

    test('a free account opens the planner and syncs', function () {
        $this->actingAs(User::factory()->create());

        $this->get('/')
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->where('saas.enabled', false)
                ->where('account.hasAccess', true)
                ->where('account.plan', null));

        push([wireTask()])->assertOk();
        $this->getJson(route('sync.pull'))->assertOk();
    });
});

describe('SaaS mode on', function () {
    beforeEach(fn () => enableSaas());

    test('guests still use the planner locally', function () {
        $this->get('/')
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page->where('saas.enabled', true)->where('account', null));
    });

    test('an account without a plan is sent to the paywall and cannot sync', function () {
        $this->actingAs(User::factory()->create());

        $this->get('/')->assertRedirect(route('billing.plans'));
        push([wireTask()])->assertStatus(402);
        $this->getJson(route('sync.pull'))->assertStatus(402);
    });

    test('the paywall shows the plans with the launch discount', function () {
        $this->actingAs(User::factory()->create());

        $this->get(route('billing.plans'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('billing/plans')
                ->where('plans.weekly.price', '€2.99')
                ->where('plans.lifetime.price', '€16')
                ->where('plans.lifetime.regularPrice', '€64')
                ->where('plans.lifetime.discountPercent', 75)
                ->where('processing', false));
    });

    test('guests get the prices for the landing card', function () {
        $this->getJson(route('billing.prices'))
            ->assertOk()
            ->assertExactJson(['plans' => [
                'weekly' => ['price' => '€2.99'],
                'lifetime' => ['price' => '€16', 'regularPrice' => '€64', 'discountPercent' => 75],
                'featured' => null,
            ]]);
    });

    test('the paywall has no discount without a launch coupon', function () {
        config(['saas.launch_coupon' => null]);
        $this->actingAs(User::factory()->create());

        $this->getJson(route('billing.plans'))
            ->assertOk()
            ->assertJsonPath('plans.lifetime.price', '€64')
            ->assertJsonPath('plans.lifetime.regularPrice', null);
    });

    test('an account with a plan skips the paywall', function () {
        $this->actingAs(weeklySubscriber());

        $this->get(route('billing.plans'))->assertRedirect(route('home'));
    });

    test('a lifetime account syncs', function () {
        $user = User::factory()->create(['lifetime_purchased_at' => now()]);
        $this->actingAs($user);

        $this->get('/')
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page->where('account.hasAccess', true)->where('account.plan', 'lifetime'));
        push([wireTask()])->assertOk();
    });

    test('a weekly subscriber syncs, also during the paid period after cancelling', function (?string $endsAt) {
        $this->actingAs(weeklySubscriber(endsAt: $endsAt === null ? null : now()->modify($endsAt)));

        push([wireTask()])->assertOk();
        $this->get('/')->assertInertia(fn (Assert $page) => $page->where('account.plan', 'weekly'));
    })->with([
        'active' => [null],
        'cancelled, on grace period' => ['+3 days'],
    ]);

    test('an ended or unpaid subscription gives no access', function (string $status, ?string $endsAt) {
        $this->actingAs(weeklySubscriber($status, $endsAt === null ? null : now()->modify($endsAt)));

        push([wireTask()])->assertStatus(402);
    })->with([
        'ended' => ['canceled', '-1 day'],
        'incomplete' => ['incomplete', null],
        'past due' => ['past_due', null],
    ]);

    test('the legal pages are public', function () {
        config(['saas.seller' => ['name' => 'Jane Doe', 'email' => 'legal@example.com']]);

        $this->get(route('legal.terms'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page->component('legal/terms')->where('seller.name', 'Jane Doe'));
        $this->get(route('legal.privacy'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page->component('legal/privacy'));
    });

    test('Stripe identifiers are never shared with the client', function () {
        $this->actingAs(weeklySubscriber());

        $this->get('/')->assertInertia(fn (Assert $page) => $page
            ->missing('auth.user.stripe_id')
            ->missing('auth.user.lifetime_payment_id'));
    });
});
