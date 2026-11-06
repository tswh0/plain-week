<?php

namespace App\Http\Controllers\Billing;

use App\Billing\FulfillCheckout;
use App\Billing\Plan;
use App\Billing\PromotionCodes;
use App\Billing\StartCheckout;
use App\Billing\StripeCatalog;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Laravel\Cashier\Cashier;
use Stripe\Exception\InvalidRequestException;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

class BillingController extends Controller
{
    /**
     * The paywall: an account without a paid plan chooses one here. A plain
     * JSON request (e.g. from a modal) gets the prices only.
     */
    public function plans(Request $request, StripeCatalog $catalog, PromotionCodes $promotionCodes): Response|RedirectResponse|JsonResponse
    {
        if ($this->wantsPlainJson($request)) {
            return $this->prices($catalog, $promotionCodes);
        }

        if ($this->user($request)->hasAccess()) {
            return to_route('home');
        }

        return Inertia::render('billing/plans', [
            'plans' => $this->offers($catalog, $promotionCodes),
            // Back from Checkout before Stripe confirmed the payment: the page polls until access starts.
            'processing' => $request->boolean('processing'),
        ]);
    }

    /**
     * The prices of the plans as JSON, for anyone (the landing card shows
     * them to guests).
     */
    public function prices(StripeCatalog $catalog, PromotionCodes $promotionCodes): JsonResponse
    {
        return response()->json(['plans' => $this->offers($catalog, $promotionCodes)]);
    }

    /**
     * Sends the user to Stripe Checkout for a plan. Also reachable with GET, so
     * a guest who picks a plan comes back here after logging in or signing up.
     * A plain JSON request gets `{ url }` (or a 409) instead of a redirect.
     */
    public function checkout(Request $request, Plan $plan, StartCheckout $startCheckout, PromotionCodes $promotionCodes): HttpResponse
    {
        $user = $this->user($request);
        $code = $this->code($request);

        // A subscription that has not ended (even unpaid) is fixed in the portal, never doubled.
        $subscription = $user->subscription('default');

        if ($user->hasLifetime() || ($plan === Plan::Weekly && $subscription !== null && ! $subscription->ended())) {
            if ($this->wantsPlainJson($request)) {
                return response()->json(['message' => __('You already have this plan.')], 409);
            }

            Inertia::flash('toast', ['type' => 'info', 'message' => __('You already have this plan.')]);

            return to_route('billing.edit');
        }

        // An invalid code is a validation error shown next to it, never a checkout without it.
        $promotionCodeId = $code === null ? null : $promotionCodes->resolve($code, $plan, $user)['id'];

        try {
            $url = (string) $startCheckout($user, $plan, $promotionCodeId)->asStripeCheckoutSession()->url;
        } catch (InvalidRequestException $e) {
            // Stripe refused the code for a reason checked only at Checkout (e.g. first-time customers only).
            if ($promotionCodeId === null) {
                throw $e;
            }

            report($e);

            throw PromotionCodes::invalid();
        }

        return $this->wantsPlainJson($request) ? response()->json(['url' => $url]) : Inertia::location($url);
    }

    /**
     * Checks a promotion code for a plan and answers with the price it gives,
     * so the plan choice can show it before Checkout. `422` when it is not
     * valid for the plan.
     */
    public function promotionCode(Request $request, Plan $plan, PromotionCodes $promotionCodes): JsonResponse
    {
        $request->validate(['code' => ['required', 'string', 'max:64']]);

        $offer = $promotionCodes->resolve((string) $this->code($request), $plan, $this->user($request));

        return response()->json([
            'code' => $offer['code'],
            'price' => $this->format($offer['amount'], $offer['currency']),
            'free' => $offer['amount'] === 0,
        ]);
    }

    /**
     * Stripe Checkout redirects here after a payment. The purchase is applied
     * right away instead of waiting for the webhook.
     */
    public function success(Request $request, FulfillCheckout $fulfill): RedirectResponse
    {
        $user = $this->user($request);
        $sessionId = $request->query('session_id');

        if (is_string($sessionId) && $fulfill->forUser($user, $sessionId)) {
            Inertia::flash('toast', ['type' => 'success', 'message' => __('Thanks! Your tasks now sync across your devices.')]);

            return to_route('home');
        }

        return to_route('billing.plans', ['processing' => 1]);
    }

    /**
     * Settings › Billing: the current plan and what can be done with it.
     */
    public function edit(Request $request, StripeCatalog $catalog): Response
    {
        $user = $this->user($request);
        $subscription = $user->subscription('default');
        $plan = $user->plan();

        return Inertia::render('settings/billing', [
            'plan' => $plan?->value,
            'lifetimeSince' => $user->lifetime_purchased_at?->toIso8601String(),
            // Also an unpaid one (past due, incomplete): the portal is where its payment gets fixed.
            'subscription' => $plan !== Plan::Lifetime && $subscription !== null && ! $subscription->ended() ? [
                'paymentFailed' => $subscription->pastDue() || $subscription->hasIncompletePayment(),
                'cancelled' => $subscription->onGracePeriod(),
                'endsAt' => $subscription->ends_at?->toIso8601String(),
                'renewsAt' => $subscription->onGracePeriod() ? null : $subscription->currentPeriodEnd()?->toIso8601String(),
            ] : null,
            'hasStripeCustomer' => $user->hasStripeId(),
            'lifetimeOffer' => $plan === Plan::Lifetime ? null : $this->lifetimeOffer($catalog),
        ]);
    }

    /**
     * Opens the Stripe customer portal (cancel, payment method, invoices).
     */
    public function portal(Request $request): HttpResponse
    {
        $user = $this->user($request);

        abort_unless($user->hasStripeId(), 404);

        return Inertia::location($user->billingPortalUrl(route('billing.edit')));
    }

    /**
     * A fetch from a script, not an Inertia visit.
     */
    private function wantsPlainJson(Request $request): bool
    {
        return $request->expectsJson() && ! $request->inertia();
    }

    /**
     * The promotion code typed on the plan choice, if any.
     */
    private function code(Request $request): ?string
    {
        $code = $request->input('code');

        return is_string($code) && trim($code) !== '' ? trim($code) : null;
    }

    private function user(Request $request): User
    {
        /** @var User */
        return $request->user();
    }

    /**
     * Prices shown to the user, formatted from the Stripe prices (Checkout
     * shows the final amount, possibly in the visitor's local currency).
     * `featured` is the promotion code shown to everyone while it can be
     * used (never how many uses are left), null otherwise.
     *
     * @return array{weekly: array{price: string}, lifetime: array<string, mixed>, featured: array<string, mixed>|null}
     */
    private function offers(StripeCatalog $catalog, PromotionCodes $promotionCodes): array
    {
        $weekly = $catalog->price(Plan::Weekly);
        $featured = $promotionCodes->featured();

        return [
            'weekly' => [
                'price' => $this->format($weekly['amount'], $weekly['currency']),
            ],
            'lifetime' => $this->lifetimeOffer($catalog),
            'featured' => $featured === null ? null : [
                'code' => $featured['code'],
                'plan' => $featured['plan']->value,
                'price' => $this->format($featured['amount'], $featured['currency']),
                'free' => $featured['amount'] === 0,
            ],
        ];
    }

    /**
     * The lifetime price, with the launch discount when there is one.
     *
     * @return array{price: string, regularPrice: string|null, discountPercent: float|null}
     */
    private function lifetimeOffer(StripeCatalog $catalog): array
    {
        $lifetime = $catalog->price(Plan::Lifetime);
        $discount = $catalog->launchDiscountPercent();
        $amount = $discount === null ? $lifetime['amount'] : (int) round($lifetime['amount'] * (100 - $discount) / 100);

        return [
            'price' => $this->format($amount, $lifetime['currency']),
            'regularPrice' => $discount === null ? null : $this->format($lifetime['amount'], $lifetime['currency']),
            'discountPercent' => $discount,
        ];
    }

    private function format(int $amount, string $currency): string
    {
        $formatted = Cashier::formatAmount($amount, $currency);

        // Whole amounts read better without cents: "€16", not "€16.00".
        return $amount % 100 === 0 ? (string) preg_replace('/[.,]00(?!\d)/', '', $formatted) : $formatted;
    }
}
