<?php

namespace App\Models;

use App\Billing\Plan;
use App\Enums\ReferralSource;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Laravel\Cashier\Billable;
use Laravel\Fortify\Contracts\PasskeyUser;
use Laravel\Fortify\PasskeyAuthenticatable;
use Laravel\Fortify\TwoFactorAuthenticatable;

/**
 * @property int $id
 * @property string $name
 * @property string $email
 * @property Carbon|null $email_verified_at
 * @property string $password
 * @property string|null $two_factor_secret
 * @property string|null $two_factor_recovery_codes
 * @property Carbon|null $two_factor_confirmed_at
 * @property string|null $remember_token
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property string|null $stripe_id
 * @property Carbon|null $lifetime_purchased_at
 * @property string|null $lifetime_payment_id
 * @property string|null $timezone
 * @property string $notification_morning_time
 * @property ReferralSource|null $referral_source
 * @property string|null $locale
 * @property Carbon|null $welcomed_at
 */
#[Fillable(['name', 'email', 'password', 'referral_source', 'locale'])]
#[Hidden(['password', 'two_factor_secret', 'two_factor_recovery_codes', 'remember_token', 'stripe_id', 'pm_type', 'pm_last_four', 'lifetime_payment_id'])]
class User extends Authenticatable implements MustVerifyEmail, PasskeyUser
{
    /** @use HasFactory<UserFactory> */
    use Billable, HasFactory, Notifiable, PasskeyAuthenticatable, TwoFactorAuthenticatable;

    /**
     * The column defaults, so a new model has them before it is reloaded.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'notification_morning_time' => '08:00',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'two_factor_confirmed_at' => 'datetime',
            'lifetime_purchased_at' => 'datetime',
            'welcomed_at' => 'datetime',
            'referral_source' => ReferralSource::class,
        ];
    }

    /**
     * @return HasMany<Task, $this>
     */
    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    /**
     * @return HasMany<PushSubscription, $this>
     */
    public function pushSubscriptions(): HasMany
    {
        return $this->hasMany(PushSubscription::class);
    }

    /**
     * @return HasOne<GoogleCalendarConnection, $this>
     */
    public function googleCalendarConnection(): HasOne
    {
        return $this->hasOne(GoogleCalendarConnection::class);
    }

    /**
     * Whether the account may use account features (sync). Always true on a
     * self-hosted instance; in SaaS mode it needs a paid plan.
     */
    public function hasAccess(): bool
    {
        return ! config('saas.enabled') || $this->plan() !== null;
    }

    /**
     * The plan that gives access in SaaS mode (null when it is off): lifetime
     * wins over a subscription that is active or cancelled but still in its
     * paid period.
     */
    public function plan(): ?Plan
    {
        return match (true) {
            ! config('saas.enabled') => null,
            $this->hasLifetime() => Plan::Lifetime,
            $this->subscribed('default') => Plan::Weekly,
            default => null,
        };
    }

    public function hasLifetime(): bool
    {
        return $this->lifetime_purchased_at !== null;
    }

    /**
     * The user's IANA time zone, as their browser last reported it on sync,
     * or the app's when it never did. Use it for anything scheduled in the
     * user's local time.
     */
    public function timezoneOrDefault(): string
    {
        return $this->timezone ?? config()->string('app.timezone');
    }
}
