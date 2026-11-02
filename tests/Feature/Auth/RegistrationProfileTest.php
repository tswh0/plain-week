<?php

use App\Enums\ReferralSource;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Support\FakeStripe;

uses(RefreshDatabase::class);

afterEach(fn () => FakeStripe::uninstall());

/**
 * @param  array<string, string>  $extra
 * @param  array<string, string>  $headers
 */
function registerUser(array $extra = [], array $headers = []): TestResponse
{
    return test()->post(route('register.store'), [
        'name' => 'Test User',
        'email' => 'test@example.com',
        'password' => 'password',
        ...$extra,
    ], $headers);
}

describe('referral source', function () {
    it('stores the answer in SaaS mode', function () {
        enableSaas();

        registerUser(['referral_source' => 'hacker_news']);

        expect(User::sole()->referral_source)->toBe(ReferralSource::HackerNews);
    });

    it('is optional in SaaS mode', function (?string $answer) {
        enableSaas();

        registerUser($answer === null ? [] : ['referral_source' => $answer]);

        expect(User::sole()->referral_source)->toBeNull();
    })->with([null, '']);

    it('rejects an unknown answer in SaaS mode', function () {
        enableSaas();

        registerUser(['referral_source' => 'tiktok'])->assertSessionHasErrors('referral_source');

        expect(User::count())->toBe(0);
    });

    it('is ignored when SaaS mode is off', function () {
        registerUser(['referral_source' => 'tiktok']);

        expect(User::sole()->referral_source)->toBeNull();
    });
});

describe('locale', function () {
    it('follows the preferred language of the request', function (?string $acceptLanguage, string $locale) {
        registerUser(headers: $acceptLanguage === null ? [] : ['Accept-Language' => $acceptLanguage]);

        expect(User::sole()->locale)->toBe($locale);
    })->with([
        'Spanish' => ['es', 'es'],
        'Spanish from Spain first' => ['es-ES,es;q=0.9,en;q=0.8', 'es'],
        'English first' => ['en-US,en;q=0.9,es;q=0.8', 'en'],
        'another language' => ['fr-FR,fr;q=0.9', 'en'],
        'no header' => [null, 'en'],
    ]);

    it('is set in SaaS mode too', function () {
        enableSaas();

        registerUser(headers: ['Accept-Language' => 'es-MX']);

        expect(User::sole()->locale)->toBe('es');
    });
});
