<?php

namespace App\Actions\Fortify;

use App\Concerns\PasswordValidationRules;
use App\Concerns\ProfileValidationRules;
use App\Enums\ReferralSource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Laravel\Fortify\Contracts\CreatesNewUsers;

class CreateNewUser implements CreatesNewUsers
{
    use PasswordValidationRules, ProfileValidationRules;

    /** The languages an account can get emails in; the first is the fallback. */
    private const LOCALES = ['en', 'es'];

    public function __construct(private Request $request) {}

    /**
     * Validate and create a newly registered user.
     *
     * @param  array<string, string>  $input
     */
    public function create(array $input): User
    {
        $saas = (bool) config('saas.enabled');

        Validator::make($input, [
            ...$this->profileRules(),
            'password' => $this->passwordRules(confirmed: false),
            ...($saas ? ['referral_source' => ['nullable', Rule::enum(ReferralSource::class)]] : []),
        ])->validate();

        return User::create([
            'name' => $input['name'],
            'email' => $input['email'],
            'password' => $input['password'],
            'referral_source' => $saas ? ($input['referral_source'] ?? null) : null,
            'locale' => $this->request->getPreferredLanguage(self::LOCALES),
        ]);
    }
}
