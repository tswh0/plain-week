<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Stripe\Exception\ApiConnectionException;
use Stripe\Exception\InvalidRequestException;
use Tests\Support\FakeStripe;

uses(RefreshDatabase::class);

/**
 * A promotion code as Stripe returns it, its coupon expanded.
 *
 * @param  array<string, mixed>  $overrides
 * @param  array<string, mixed>  $coupon
 * @return array<string, mixed>
 */
function promotionCode(array $overrides = [], array $coupon = []): array
{
    return [
        'id' => 'promo_friends', 'object' => 'promotion_code', 'code' => 'PWFRIENDS26', 'active' => true, 'customer' => null,
        'expires_at' => null, 'max_redemptions' => 50, 'times_redeemed' => 0,
        'restrictions' => ['first_time_transaction' => false, 'minimum_amount' => null, 'minimum_amount_currency' => null],
        'promotion' => ['type' => 'coupon', 'coupon' => [
            'id' => 'FRIENDS100', 'object' => 'coupon', 'percent_off' => 100, 'amount_off' => null, 'currency' => null,
            'duration' => 'once', 'valid' => true, 'applies_to' => ['products' => ['prod_lifetime']], ...$coupon,
        ]],
        ...$overrides,
    ];
}

/**
 * The founders' code: 100% off Lifetime, 20 uses, 2 used.
 *
 * @param  array<string, mixed>  $overrides
 * @param  array<string, mixed>  $coupon
 * @return array<string, mixed>
 */
function founderCode(array $overrides = [], array $coupon = []): array
{
    return promotionCode(['id' => 'promo_founder', 'code' => 'FOUNDER20', 'max_redemptions' => 20, 'times_redeemed' => 2, ...$overrides], $coupon);
}

/**
 * Stripe answers the code lookup with these codes (an empty list for any other code).
 *
 * @param  array<string, mixed>  $code
 */
function stripeKnowsCode(FakeStripe $stripe, array $code): void
{
    $stripe->on('get', '/v1/promotion_codes', fn (array $params) => [
        'object' => 'list', 'url' => '/v1/promotion_codes', 'has_more' => false,
        'data' => strcasecmp($params['code'], $code['code']) === 0 ? [$code] : [],
    ]);
}

beforeEach(function () {
    $this->stripe = enableSaas();
    $this->actingAs(User::factory()->create());
});

afterEach(fn () => FakeStripe::uninstall());

test('a valid code shows the price it gives for the plan', function () {
    stripeKnowsCode($this->stripe, promotionCode());

    $this->postJson(route('billing.promotion-code', 'lifetime'), ['code' => ' pwfriends26 '])
        ->assertOk()
        ->assertExactJson(['code' => 'PWFRIENDS26', 'price' => '€0', 'free' => true]);

    expect($this->stripe->lastRequest('get', '/v1/promotion_codes'))->toMatchArray([
        'code' => 'pwfriends26',
        'active' => 'true',
        'expand' => ['data.promotion.coupon.applies_to'],
    ]);
});

test('an amount off is taken from the regular price', function () {
    stripeKnowsCode($this->stripe, promotionCode(coupon: [
        'percent_off' => null, 'amount_off' => 1000, 'currency' => 'eur', 'applies_to' => null,
    ]));

    $this->postJson(route('billing.promotion-code', 'lifetime'), ['code' => 'PWFRIENDS26'])
        ->assertOk()
        ->assertJsonPath('price', '€54');
});

test('a code that cannot be used for the plan is a validation error', function (string $plan, array $code) {
    stripeKnowsCode($this->stripe, $code);

    $this->postJson(route('billing.promotion-code', $plan), ['code' => 'PWFRIENDS26'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['code' => "This code isn't valid for this plan."]);
})->with([
    'another product' => ['weekly', promotionCode()],
    'unknown' => ['lifetime', promotionCode(['code' => 'OTHER'])],
    'used up' => ['lifetime', promotionCode(['times_redeemed' => 50])],
    'expired' => ['lifetime', promotionCode(['expires_at' => now()->subDay()->getTimestamp()])],
    'invalid coupon' => ['lifetime', promotionCode(coupon: ['valid' => false])],
    'other currency' => ['lifetime', promotionCode(coupon: ['percent_off' => null, 'amount_off' => 500, 'currency' => 'usd'])],
    'for another customer' => ['lifetime', promotionCode(['customer' => 'cus_someone'])],
    'below the minimum' => ['lifetime', promotionCode(['restrictions' => [
        'first_time_transaction' => false, 'minimum_amount' => 10000, 'minimum_amount_currency' => 'eur',
    ]])],
]);

test('a valid code replaces the launch coupon at checkout', function () {
    stripeKnowsCode($this->stripe, promotionCode());

    $this->post(route('billing.checkout', 'lifetime'), ['code' => 'PWFRIENDS26'])
        ->assertRedirect('https://checkout.stripe.com/c/pay/cs_test');

    expect($this->stripe->lastRequest('post', '/v1/checkout/sessions')['discounts'])
        ->toBe([['promotion_code' => 'promo_friends']]);
});

test('a weekly checkout takes a code for the weekly plan', function () {
    stripeKnowsCode($this->stripe, promotionCode(coupon: ['applies_to' => ['products' => ['prod_weekly']]]));

    $this->post(route('billing.checkout', 'weekly'), ['code' => 'PWFRIENDS26'])->assertRedirect();

    expect($this->stripe->lastRequest('post', '/v1/checkout/sessions')['discounts'])
        ->toBe([['promotion_code' => 'promo_friends']]);
});

test('an invalid code at checkout goes back with the error and opens no session', function () {
    stripeKnowsCode($this->stripe, promotionCode());

    $this->from(route('billing.plans'))
        ->post(route('billing.checkout', 'weekly'), ['code' => 'PWFRIENDS26'])
        ->assertRedirect(route('billing.plans'))
        ->assertSessionHasErrors(['code' => "This code isn't valid for this plan."]);

    expect($this->stripe->lastRequest('post', '/v1/checkout/sessions'))->toBeNull();
});

test('a free lifetime order grants lifetime on return, with no payment to refund', function () {
    $user = User::factory()->create(['stripe_id' => 'cus_test']);
    $this->actingAs($user);
    $this->stripe->on('get', '/v1/checkout/sessions/cs_free', [
        'id' => 'cs_free', 'object' => 'checkout.session', 'customer' => 'cus_test', 'mode' => 'payment',
        'status' => 'complete', 'payment_status' => 'no_payment_required', 'payment_intent' => null,
        'metadata' => ['plan' => 'lifetime'], 'subscription' => null,
    ]);

    $this->get(route('billing.success', ['session_id' => 'cs_free']))->assertRedirect(route('home'));

    expect($user->refresh())
        ->hasLifetime()->toBeTrue()
        ->lifetime_payment_id->toBeNull();
});

test('a code made for this customer is valid', function () {
    $this->actingAs(User::factory()->create(['stripe_id' => 'cus_test']));
    stripeKnowsCode($this->stripe, promotionCode(['customer' => 'cus_test']));

    $this->postJson(route('billing.promotion-code', 'lifetime'), ['code' => 'PWFRIENDS26'])->assertOk();
});

test('a code is not called invalid when Stripe cannot be reached', function () {
    $this->stripe->on('get', '/v1/promotion_codes', fn () => throw new ApiConnectionException('Network down'));

    $this->postJson(route('billing.promotion-code', 'lifetime'), ['code' => 'PWFRIENDS26'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['code' => 'Could not check the code. Please try again.']);
});

test('a code Stripe refuses at checkout (e.g. first-time customers only) is a code error', function () {
    stripeKnowsCode($this->stripe, promotionCode(['restrictions' => [
        'first_time_transaction' => true, 'minimum_amount' => null, 'minimum_amount_currency' => null,
    ]]));
    $this->stripe->on('post', '/v1/checkout/sessions', fn () => throw new InvalidRequestException('This promotion code cannot be redeemed because the associated customer has prior transactions.'));

    $this->from(route('billing.plans'))
        ->post(route('billing.checkout', 'lifetime'), ['code' => 'PWFRIENDS26'])
        ->assertRedirect(route('billing.plans'))
        ->assertSessionHasErrors(['code' => "This code isn't valid for this plan."]);
});

describe('the featured promotion code', function () {
    beforeEach(function () {
        config(['saas.featured_promotion_code' => 'FOUNDER20']);
        auth()->logout();
    });

    test('guests see it with the price it gives', function () {
        stripeKnowsCode($this->stripe, founderCode());

        $this->getJson(route('billing.prices'))
            ->assertOk()
            ->assertJsonPath('plans.featured', ['code' => 'FOUNDER20', 'plan' => 'lifetime', 'price' => '€0', 'free' => true]);
    });

    test('it never says how many uses are left', function () {
        stripeKnowsCode($this->stripe, founderCode());

        $json = $this->getJson(route('billing.prices'))->getContent();

        expect($json)->not->toContain('redeemed')->not->toContain('max_redemptions')->not->toContain('20,');
    });

    test('a code for the weekly plan is featured on weekly, with its discounted price', function () {
        stripeKnowsCode($this->stripe, founderCode(coupon: [
            'percent_off' => 50, 'applies_to' => ['products' => ['prod_weekly']],
        ]));

        $this->getJson(route('billing.prices'))
            ->assertJsonPath('plans.featured', ['code' => 'FOUNDER20', 'plan' => 'weekly', 'price' => '€1.50', 'free' => false]);
    });

    test('it is hidden when it cannot be used', function (array $code) {
        stripeKnowsCode($this->stripe, $code);

        $this->getJson(route('billing.prices'))->assertOk()->assertJsonPath('plans.featured', null);
    })->with([
        'unknown' => [founderCode(['code' => 'OTHER'])],
        'used up' => [founderCode(['times_redeemed' => 20])],
        'inactive' => [founderCode(['active' => false])],
        'expired' => [founderCode(['expires_at' => now()->subDay()->getTimestamp()])],
        'invalid coupon' => [founderCode(coupon: ['valid' => false])],
        'for one customer' => [founderCode(['customer' => 'cus_someone'])],
        'for another product' => [founderCode(coupon: ['applies_to' => ['products' => ['prod_other']]])],
    ]);

    test('it is hidden, and the prices still shown, when Stripe fails', function () {
        $this->stripe->on('get', '/v1/promotion_codes', fn () => throw new ApiConnectionException('Network down'));

        $this->getJson(route('billing.prices'))
            ->assertOk()
            ->assertJsonPath('plans.lifetime.price', '€16')
            ->assertJsonPath('plans.featured', null);
    });

    test('there is none without the setting, and Stripe is not asked', function () {
        config(['saas.featured_promotion_code' => null]);

        $this->getJson(route('billing.prices'))->assertOk()->assertJsonPath('plans.featured', null);

        expect($this->stripe->lastRequest('get', '/v1/promotion_codes'))->toBeNull();
    });

    test('Stripe is asked once every 10 minutes, so a used-up code goes away on its own', function () {
        $code = founderCode();
        $this->stripe->on('get', '/v1/promotion_codes', function () use (&$code) {
            return ['object' => 'list', 'url' => '/v1/promotion_codes', 'has_more' => false, 'data' => [$code]];
        });
        $lookups = fn () => count(array_filter($this->stripe->requests, fn (array $r) => $r['path'] === '/v1/promotion_codes'));

        $this->getJson(route('billing.prices'))->assertJsonPath('plans.featured.code', 'FOUNDER20');
        $code['times_redeemed'] = 20;
        $this->getJson(route('billing.prices'))->assertJsonPath('plans.featured.code', 'FOUNDER20');
        expect($lookups())->toBe(1);

        $this->travel(11)->minutes();

        $this->getJson(route('billing.prices'))->assertJsonPath('plans.featured', null);
        expect($lookups())->toBe(2);
    });

    test('a Stripe failure is retried a minute later', function () {
        $this->stripe->on('get', '/v1/promotion_codes', fn () => throw new ApiConnectionException('Network down'));
        $this->getJson(route('billing.prices'))->assertJsonPath('plans.featured', null);

        stripeKnowsCode($this->stripe, founderCode());
        $this->getJson(route('billing.prices'))->assertJsonPath('plans.featured', null);
        $this->travel(2)->minutes();

        $this->getJson(route('billing.prices'))->assertJsonPath('plans.featured.code', 'FOUNDER20');
    });

    test('Settings › Billing does not ask Stripe for it', function () {
        $this->actingAs(User::factory()->create());
        stripeKnowsCode($this->stripe, founderCode());

        $this->get(route('billing.edit'))->assertOk();

        expect($this->stripe->lastRequest('get', '/v1/promotion_codes'))->toBeNull();
    });

    test('the plan choice gets it too', function () {
        $this->actingAs(User::factory()->create());
        stripeKnowsCode($this->stripe, founderCode());

        $this->getJson(route('billing.plans'))->assertJsonPath('plans.featured.code', 'FOUNDER20');
    });
});
