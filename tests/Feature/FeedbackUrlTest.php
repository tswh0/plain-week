<?php

use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\FakeStripe;

uses(RefreshDatabase::class);

afterEach(fn () => FakeStripe::uninstall());

test('self-hosted instances send feedback to GitHub Discussions', function () {
    config(['saas.enabled' => false, 'saas.seller.email' => 'owner@example.com']);

    $this->get('/')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('feedbackUrl', 'https://github.com/victor-falcon/plain-week/discussions'));
});

test('SaaS mode sends feedback to the contact email', function () {
    enableSaas();
    config(['saas.seller.email' => 'hello@plainweek.eu']);

    $this->get('/')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('feedbackUrl', 'mailto:hello@plainweek.eu?subject=Plain%20Week%20feedback'));
});

test('SaaS mode without a real contact email falls back to GitHub Discussions', function (string $email) {
    enableSaas();
    config(['saas.seller.email' => $email]);

    $this->get('/')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('feedbackUrl', 'https://github.com/victor-falcon/plain-week/discussions'));
})->with(['', 'hello@example.com', 'not-an-email']);
