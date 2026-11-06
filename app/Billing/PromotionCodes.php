<?php

namespace App\Billing;

use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;
use Laravel\Cashier\Cashier;
use Stripe\Coupon;
use Stripe\Exception\ApiErrorException;
use Stripe\PromotionCode;
use Throwable;

/**
 * Customer-facing promotion codes (created in the Stripe Dashboard), checked
 * against a plan before Checkout. A valid code replaces the launch coupon:
 * Stripe applies one discount per session, never both.
 */
class PromotionCodes
{
    /** How long the featured code's state is kept before asking Stripe again. */
    private const FEATURED_TTL_SECONDS = 600;

    /** After Stripe failed, the code stays hidden this long before trying again. */
    private const FEATURED_RETRY_SECONDS = 60;

    public function __construct(private readonly StripeCatalog $catalog) {}

    /**
     * Looks the code up and checks it can be used for the plan (and the
     * customer) right now.
     *
     * @return array{id: string, code: string, amount: int, currency: string} The code (as created) and the plan's price with it applied.
     *
     * @throws ValidationException When the code does not exist, does not apply, or Stripe could not be asked.
     */
    public function resolve(string $code, Plan $plan, User $user): array
    {
        $price = $this->catalog->price($plan);
        $promotionCode = $this->find(trim($code));
        $coupon = $promotionCode?->promotion?->coupon;

        if (! $promotionCode instanceof PromotionCode || ! $coupon instanceof Coupon
            || ! $this->usable($promotionCode, $coupon, $price, $user->stripe_id)) {
            throw self::invalid();
        }

        return [
            'id' => $promotionCode->id,
            'code' => $promotionCode->code,
            'amount' => $this->discounted($coupon, $price),
            'currency' => $price['currency'],
        ];
    }

    /**
     * The error shown next to the code field.
     */
    public static function invalid(): ValidationException
    {
        return ValidationException::withMessages(['code' => __("This code isn't valid for this plan.")]);
    }

    /**
     * The promotion code in `saas.featured_promotion_code`, while anyone new
     * can use it, with the first plan it applies to (Lifetime, then Weekly)
     * and that plan's price with it. Null when none is set, or it cannot be
     * used (unknown, inactive, expired, used up, made for one customer) or
     * Stripe could not be asked: the landing then shows the plain prices.
     * Kept for 10 minutes, so it is gone on its own once used up.
     *
     * @return array{code: string, plan: Plan, amount: int, currency: string}|null
     */
    public function featured(): ?array
    {
        $code = config('saas.featured_promotion_code');

        if (! is_string($code) || trim($code) === '') {
            return null;
        }

        $key = 'saas.featured-promotion-code.'.strtoupper(trim($code));

        // `false` when it cannot be featured, so that answer is cached too.
        /** @var array{code: string, plan: string, amount: int, currency: string}|false|null $offer */
        $offer = Cache::get($key);

        if ($offer === null) {
            try {
                $offer = $this->featurable(trim($code)) ?? false;
                Cache::put($key, $offer, self::FEATURED_TTL_SECONDS);
            } catch (Throwable $e) {
                report($e);
                // Fail closed (the plain prices still show), and do not ask Stripe on every visit while it fails.
                Cache::put($key, false, self::FEATURED_RETRY_SECONDS);

                return null;
            }
        }

        return $offer === false ? null : [...$offer, 'plan' => Plan::from($offer['plan'])];
    }

    /**
     * @return array{code: string, plan: string, amount: int, currency: string}|null
     *
     * @throws ApiErrorException
     */
    private function featurable(string $code): ?array
    {
        $promotionCode = $this->lookup($code);
        $coupon = $promotionCode?->promotion?->coupon;

        if (! $promotionCode instanceof PromotionCode || ! $coupon instanceof Coupon) {
            return null;
        }

        foreach ([Plan::Lifetime, Plan::Weekly] as $plan) {
            $price = $this->catalog->price($plan);

            // No customer: a code made for one customer is never shown to everyone.
            if ($this->usable($promotionCode, $coupon, $price, null)) {
                return [
                    'code' => $promotionCode->code,
                    'plan' => $plan->value,
                    'amount' => $this->discounted($coupon, $price),
                    'currency' => $price['currency'],
                ];
            }
        }

        return null;
    }

    private function find(string $code): ?PromotionCode
    {
        try {
            return $this->lookup($code);
        } catch (ApiErrorException $e) {
            report($e);

            // Not the code's fault: a good code must not be called invalid while Stripe is unreachable.
            throw ValidationException::withMessages(['code' => __('Could not check the code. Please try again.')]);
        }
    }

    /**
     * @throws ApiErrorException
     */
    private function lookup(string $code): ?PromotionCode
    {
        if ($code === '') {
            return null;
        }

        /** @var PromotionCode|null */
        return Cashier::stripe()->promotionCodes->all([
            'code' => $code,
            'active' => true,
            'limit' => 1,
            'expand' => ['data.promotion.coupon.applies_to'],
        ])->first();
    }

    /**
     * @param  array{id: string, amount: int, currency: string, product: string}  $price
     */
    private function usable(PromotionCode $promotionCode, Coupon $coupon, array $price, ?string $customerId): bool
    {
        $restrictions = $promotionCode->restrictions;
        $products = $coupon->applies_to->products ?? null;
        $customer = is_string($promotionCode->customer) ? $promotionCode->customer : $promotionCode->customer?->id;

        return $promotionCode->active
            // A code made for one customer only.
            && ($customer === null || ($customerId !== null && $customer === $customerId))
            && $coupon->valid
            && ($promotionCode->expires_at === null || $promotionCode->expires_at > now()->getTimestamp())
            && ($promotionCode->max_redemptions === null || $promotionCode->times_redeemed < $promotionCode->max_redemptions)
            && ($products === null || in_array($price['product'], $products, true))
            // An amount off in another currency would not apply to this price.
            && ($coupon->amount_off === null || $coupon->currency === $price['currency'])
            && ($restrictions->minimum_amount === null
                || ($restrictions->minimum_amount_currency === $price['currency'] && $price['amount'] >= $restrictions->minimum_amount));
    }

    /**
     * @param  array{id: string, amount: int, currency: string, product: string}  $price
     */
    private function discounted(Coupon $coupon, array $price): int
    {
        if ($coupon->percent_off !== null) {
            return (int) round($price['amount'] * (100 - $coupon->percent_off) / 100);
        }

        return max(0, $price['amount'] - (int) $coupon->amount_off);
    }
}
