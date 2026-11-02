<?php

use App\Actions\Sync\SyncFormat;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\FakeStripe;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| The closure you provide to your test functions is always bound to a specific PHPUnit test
| case class. By default, that class is "PHPUnit\Framework\TestCase". Of course, you may
| need to change it using the "pest()" function to bind different classes or traits.
|
*/

pest()->extend(TestCase::class)
 // ->use(RefreshDatabase::class)
    ->in('Feature');

/*
|--------------------------------------------------------------------------
| Expectations
|--------------------------------------------------------------------------
|
| When you're writing tests, you often need to check that values meet certain conditions. The
| "expect()" function gives you access to a set of "expectations" methods that you can use
| to assert different things. Of course, you may extend the Expectation API at any time.
|
*/

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Functions
|--------------------------------------------------------------------------
|
| While Pest is very powerful out-of-the-box, you may have some testing code specific to your
| project that you don't want to repeat in every file. Here you can also expose helpers as
| global functions to help you to reduce the number of lines of code in your test files.
|
*/

function something()
{
    // ..
}

/**
 * Build a full wire record.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function wireTask(array $overrides = []): array
{
    return array_merge([
        'id' => (string) Str::uuid7(),
        'text' => 'Buy milk',
        'date' => '2026-10-15',
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
        'created_at' => '2026-10-15T08:35:00.123Z',
        'updated_at' => '2026-10-15T08:35:00.123Z',
        'deleted_at' => null,
    ], $overrides);
}

/**
 * Pushes like the current client; a null format sends no `X-Sync-Format` header, like v0.0.3 and older.
 *
 * @param  list<array<string, mixed>>  $tasks
 */
function push(array $tasks, ?SyncFormat $format = SyncFormat::DailyRules): TestResponse
{
    $headers = $format === null ? [] : [SyncFormat::HEADER => (string) $format->value];

    return test()->postJson(route('sync.push'), ['tasks' => $tasks], $headers);
}

/**
 * SaaS mode on, with a fake Stripe that knows the two prices and the launch coupon.
 */
function enableSaas(): FakeStripe
{
    config([
        'saas.enabled' => true,
        'saas.launch_coupon' => 'LAUNCH75',
        'cashier.secret' => 'sk_test_fake',
        'cashier.webhook.secret' => 'whsec_test',
    ]);

    $prices = [
        'plainweek_weekly' => ['id' => 'price_weekly', 'object' => 'price', 'unit_amount' => 299, 'currency' => 'eur', 'lookup_key' => 'plainweek_weekly', 'product' => 'prod_weekly'],
        'plainweek_lifetime' => ['id' => 'price_lifetime', 'object' => 'price', 'unit_amount' => 6400, 'currency' => 'eur', 'lookup_key' => 'plainweek_lifetime', 'product' => 'prod_lifetime'],
    ];

    return FakeStripe::install()
        ->on('get', '/v1/prices', fn (array $params) => [
            'object' => 'list',
            'url' => '/v1/prices',
            'has_more' => false,
            'data' => array_values(array_intersect_key($prices, array_flip($params['lookup_keys']))),
        ])
        ->on('get', '/v1/coupons/LAUNCH75', ['id' => 'LAUNCH75', 'object' => 'coupon', 'percent_off' => 75, 'valid' => true])
        ->on('post', '/v1/customers', ['id' => 'cus_test', 'object' => 'customer'])
        ->on('get', '/v1/customers/cus_test', ['id' => 'cus_test', 'object' => 'customer'])
        ->on('post', '/v1/checkout/sessions', ['id' => 'cs_test', 'object' => 'checkout.session', 'url' => 'https://checkout.stripe.com/c/pay/cs_test']);
}

/**
 * A Stripe subscription as the API returns it.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function stripeSubscription(array $overrides = []): array
{
    return array_merge([
        'id' => 'sub_test',
        'object' => 'subscription',
        'customer' => 'cus_test',
        'status' => 'active',
        'cancel_at_period_end' => false,
        'metadata' => ['type' => 'default'],
        'items' => [
            'object' => 'list',
            'data' => [[
                'id' => 'si_test',
                'object' => 'subscription_item',
                'quantity' => 1,
                'current_period_end' => now()->addWeek()->timestamp,
                'price' => ['id' => 'price_weekly', 'object' => 'price', 'product' => 'prod_weekly'],
            ]],
        ],
    ], $overrides);
}

/**
 * Posts a Stripe event to the webhook, signed with the test secret.
 *
 * @param  array<string, mixed>  $object
 */
function webhook(string $type, array $object): TestResponse
{
    $payload = json_encode(['id' => 'evt_test', 'type' => $type, 'data' => ['object' => $object]], JSON_THROW_ON_ERROR);
    $timestamp = time();
    $signature = hash_hmac('sha256', "{$timestamp}.{$payload}", 'whsec_test');

    return test()->call('POST', '/stripe/webhook', server: [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_STRIPE_SIGNATURE' => "t={$timestamp},v1={$signature}",
    ], content: $payload);
}

/**
 * A completed, paid lifetime Checkout session for `cus_test`.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function lifetimeSession(array $overrides = []): array
{
    return [
        'id' => 'cs_test', 'object' => 'checkout.session', 'customer' => 'cus_test', 'mode' => 'payment',
        'status' => 'complete', 'payment_status' => 'paid', 'payment_intent' => 'pi_test',
        'metadata' => ['plan' => 'lifetime'], ...$overrides,
    ];
}

/**
 * A user with an active weekly subscription stored locally.
 */
function weeklySubscriber(string $status = 'active', ?DateTimeInterface $endsAt = null): User
{
    $user = User::factory()->create(['stripe_id' => 'cus_test']);

    $user->subscriptions()->create([
        'type' => 'default',
        'stripe_id' => 'sub_test',
        'stripe_status' => $status,
        'stripe_price' => 'price_weekly',
        'quantity' => 1,
        'ends_at' => $endsAt,
    ])->items()->create([
        'stripe_id' => 'si_test',
        'stripe_product' => 'prod_weekly',
        'stripe_price' => 'price_weekly',
        'quantity' => 1,
    ]);

    return $user;
}
