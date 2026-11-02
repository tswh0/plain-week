# SaaS mode

Plain Week is also offered as a paid hosted service at plainweek.eu. Everything in this document is active only when
`SAAS_ENABLED=true`. The default is `false` (repository, `.env.example`, Docker image): a self-hosted instance has free
accounts that sync, no billing UI, and every route below answers `404`.

## Product rules

- No free accounts and no trials: an account exists to sync, and syncing needs a paid plan. Guests still use the
  planner locally in the browser, exactly as on a self-hosted instance.
- Two plans, both VAT-inclusive Stripe prices referenced by lookup key:
    - **Weekly**: a Cashier subscription (type `default`) on `STRIPE_PRICE_WEEKLY` (`plainweek_weekly`).
    - **Lifetime**: a one-time Checkout payment on `STRIPE_PRICE_LIFETIME` (`plainweek_lifetime`), with the coupon in
      `SAAS_LAUNCH_COUPON` applied when it is set and valid (`LAUNCH75`: 75% off).
- Flow: landing card (guests, first visit) → register (Fortify, "Step 1 of 2") → paywall (`/plans`, "Step 2 of 2") →
  Stripe Checkout → back to the planner. All are floating cards over the planner (see
  [style.md](./style.md#landing-card)). A plan picked on the landing card is preselected on the paywall.

## Sign-up answers

Registration (`App\Actions\Fortify\CreateNewUser`) stores two extra columns on `users`:

- `referral_source`: the optional "How did you hear about Plain Week?" select on the register card, shown only in SaaS
  mode. Stable slugs from `App\Enums\ReferralSource`: `x`, `substack`, `reddit`, `hacker_news`, `friend`, `other`;
  `null` when skipped. With SaaS mode off the field is not shown and anything sent is ignored.
- `locale`: set on every sign-up (SaaS mode or not) from the request's `Accept-Language`
  (`getPreferredLanguage(['en', 'es'])`): `es` when Spanish is preferred, otherwise `en`. It is meant for
  emails sent to the account (nothing reads it yet); the app UI itself stays in English.

## Entitlement

`User::hasAccess()` is the single check: always `true` with SaaS mode off; otherwise the account has lifetime access
(`users.lifetime_purchased_at` set) or a `default` subscription that Cashier considers valid (active, or cancelled but
still in its paid period). `User::plan()` returns `Plan::Lifetime`, `Plan::Weekly` or `null`; lifetime wins.

It is used by:

| Where                                        | Effect without access                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `EnsureHasAccess` on `/` and `sync/*`        | Pages redirect to `/plans`; JSON requests (sync) get `402 Payment Required`   |
| Inertia shared props                         | `saas.enabled`, `account: { hasAccess, plan } \| null` (null for guests)      |
| `SyncProvider` and the sync engine           | The engine does not start; a `402` stops it, keeps local data, shows `/plans` |
| `EnsureHasAccess` on Google Calendar connect | Redirect to `/plans` (the page and disconnecting stay reachable)              |

Settings (profile, security, data) stay reachable without a plan, so an account can always export its tasks or be
deleted; the paywall links to the export. A weekly subscription whose payment failed (`past_due`, `incomplete`) gives
no access but blocks a second weekly checkout: Settings › Billing shows it with the portal to fix the card.

## Routes

All behind `EnsureSaasEnabled` (`404` when SaaS mode is off), in `routes/billing.php` and `bootstrap/app.php`:

| Route                                 | Name                     | Notes                                                                                                                                            |
| ------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /plans`                          | `billing.plans`          | `auth`. The paywall (Inertia `billing/plans`, a card over the planner); `?processing=1` polls until a pending payment is confirmed. JSON: prices |
| `GET\|POST /billing/checkout/{plan}`  | `billing.checkout`       | `auth`, `weekly` or `lifetime`. Inertia: external redirect to Checkout; plain JSON: `{ url }` (`409` if already owned)                           |
| `POST /billing/promotion-code/{plan}` | `billing.promotion-code` | `auth`. Checks a promotion code for a plan: `{ code, price }` with the price it gives, or `422`                                                  |
| `GET /billing/success`                | `billing.success`        | `auth`. Checkout's success URL: fulfills the session right away (idempotent), then `/` or `/plans?processing=1`                                  |
| `GET /billing/portal`                 | `billing.portal`         | `auth`. Redirects to the Stripe customer portal (cancel, payment method, invoices)                                                               |
| `GET /settings/billing`               | `billing.edit`           | `auth`. Settings › Billing: plan, renewal date, portal, "Upgrade to lifetime"                                                                    |
| `GET /billing/prices`                 | `billing.prices`         | Public, `throttle:60,1`. `{ plans }`: the prices formatted from Stripe (cached an hour), for the landing card                                    |
| `GET /terms`, `GET /privacy`          | `legal.*`                | Public. Terms of Service and Privacy Policy (seller from `SAAS_SELLER_NAME` / `SAAS_CONTACT_EMAIL`)                                              |
| `POST /stripe/webhook`                | `cashier.webhook`        | Outside the web group, Stripe signature checked with `STRIPE_WEBHOOK_SECRET`                                                                     |

`GET` on the checkout route lets a guest pick a plan before having an account: `auth` stores it as the intended URL,
and Fortify sends the user back to it after logging in or registering.

## Checkout

`App\Billing\StartCheckout` builds the session: the Stripe customer (Cashier, prefilled with the account email),
`automatic_tax` (Stripe Tax, `Cashier::calculateTaxes()`), billing address and tax ID collection,
`consent_collection[terms_of_service]=required` with a custom text where the customer asks for immediate access and
waives the EU 14-day withdrawal right, and success/cancel URLs back to the app. Lifetime adds the launch coupon and an
invoice. Prices and the coupon are looked up by `App\Billing\StripeCatalog` and cached for an hour.

The terms-of-service consent needs a Terms of Service URL in the Stripe Dashboard (Settings › Public details).
Checkout passes `managed_payments[enabled]=false`: the owner is the seller and Stripe only the processor (Managed
Payments, on by default on new accounts, would make Stripe the merchant of record and rejects `custom_text`). The
billing address entered in Checkout is saved on the customer (`customer_update[address]=auto`) for Stripe Tax.

## Promotion codes

The plan choice has a "Have a code?" link that reveals a code field. "Apply" asks `POST /billing/promotion-code/{plan}`
for the price the code gives and shows it as the amount due today; changing the plan checks the code again. "Continue
to payment" sends the typed code with the checkout request (`code`), and the server checks it again.

`App\Billing\PromotionCodes` looks the code up in Stripe (`promotion_codes?code=…&active=true`, case-insensitive) and
accepts it only when the promotion code is active, not expired and not used up, not made for another customer, its
coupon is valid, applies to the plan's product (`applies_to`, if set), is in the price's currency (an amount off) and the price reaches the code's
minimum amount. Anything else is a validation error next to the field ("This code isn't valid for this plan."), and no
Checkout session is opened. Restrictions only Stripe can check (first-time customers only) surface when the session is
created and give the same error. When Stripe cannot be reached the field says "Could not check the code. Please try
again." instead. The check endpoint allows 10 requests a minute per user. A valid code goes to Checkout as `discounts[0][promotion_code]` **instead of** the launch
coupon: Stripe allows one discount per session, so they never stack. Checkout's own code box
(`allow_promotion_codes`) stays off, since it cannot be combined with an applied discount.

A 100% code on Lifetime makes a no-cost order: the button reads "Continue" instead of "Continue to payment", Checkout asks for no card and completes with `payment_status` =
`no_payment_required`, which grants lifetime like a paid session (on return and from the webhook). There is no payment
intent, so `lifetime_payment_id` stays empty and no refund can revoke it; remove such a grant with
`plainweek:grant-lifetime --revoke`.

To add a code, in the Stripe Dashboard (test and live mode separately):

1. **Product catalog › Coupons › Create coupon**: percent or amount off (amount off in EUR), duration `once` (for
   Weekly, `once` discounts only the first week; a `forever` coupon discounts every week, and the plan choice still
   shows only the first week's price), and under **Apply to specific products** pick the Lifetime and/or
   Weekly product.
2. In the coupon, **Promotion codes › Create code**: the customer-facing code (e.g. `PWFRIENDS26`), and optionally a
   maximum number of redemptions, an expiry date, first-time customers only or a minimum amount.

No deploy or configuration change is needed: codes are looked up when used. To stop a code, archive it (or its
coupon) in the Dashboard.

## Fulfillment and webhooks

`App\Billing\FulfillCheckout` applies a completed session, both from the success redirect (so the user never waits for
the webhook) and from the webhook (so it also happens when the user never comes back). Webhooks, handled by
`App\Http\Controllers\Billing\WebhookController` (Cashier's controller plus):

| Event                                                                    | Effect                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `checkout.session.completed`, `checkout.session.async_payment_succeeded` | A paid lifetime session grants lifetime (stores the payment intent)      |
| `charge.refunded`                                                        | A full refund of the lifetime payment intent revokes lifetime            |
| `customer.subscription.*`, `customer.*`, `invoice.*`                     | Cashier: stores and updates the weekly subscription; deleted ends access |

Buying lifetime while subscribed weekly cancels the subscription at the end of its paid period (retried with the
webhook if Stripe fails). Not handled automatically: refunds of weekly payments (cancel in the portal or Dashboard),
lost disputes and a second lifetime payment (refund it in the Dashboard; the last payment is the one a refund revokes).

The webhook refuses every event (`503`) while `STRIPE_WEBHOOK_SECRET` is empty, since Cashier would otherwise skip
the signature check.

## Manual grants

```sh
php artisan plainweek:grant-lifetime owner@example.com          # grant without a payment
php artisan plainweek:grant-lifetime owner@example.com --revoke # remove it
```

## Configuration

| Variable                | Default                   | Description                                                         |
| ----------------------- | ------------------------- | ------------------------------------------------------------------- |
| `SAAS_ENABLED`          | `false`                   | Turns SaaS mode on                                                  |
| `SAAS_LAUNCH_COUPON`    | (empty)                   | Stripe coupon id applied to lifetime purchases; empty = no discount |
| `SAAS_SELLER_NAME`      | `the Plain Week operator` | Seller shown in the terms and privacy pages                         |
| `SAAS_CONTACT_EMAIL`    | `MAIL_FROM_ADDRESS`       | Contact in the terms and privacy pages; "Send feedback" mails it    |
| `STRIPE_KEY`            |                           | Publishable key                                                     |
| `STRIPE_SECRET`         |                           | Secret key                                                          |
| `STRIPE_WEBHOOK_SECRET` |                           | Signing secret of the `/stripe/webhook` endpoint                    |
| `STRIPE_PRICE_WEEKLY`   | `plainweek_weekly`        | Lookup key of the weekly price                                      |
| `STRIPE_PRICE_LIFETIME` | `plainweek_lifetime`      | Lookup key of the lifetime price                                    |

The webhook endpoint must send the events in the table above.

**Send feedback.** The account menu (users and guests) and the settings sidebar link to the shared `feedbackUrl` prop
(`App\Support\Feedback`). In SaaS mode it is a `mailto:` to `SAAS_CONTACT_EMAIL` with the subject "Plain Week
feedback"; with SaaS mode off, or while the address is empty or still an `example.com` placeholder, it is the project's
GitHub Discussions. Set `SAAS_CONTACT_EMAIL` on plainweek.eu.

## Local development

Put test keys in `.env` (never commit them), set `SAAS_ENABLED=true`, and forward webhooks with the Stripe CLI:

```sh
stripe listen --api-key "$STRIPE_SECRET" --forward-to http://localhost:8000/stripe/webhook
```

Use the signing secret it prints as `STRIPE_WEBHOOK_SECRET`. Test card: `4242 4242 4242 4242`. Tests never call Stripe:
`Tests\Support\FakeStripe` replaces its HTTP client (`enableSaas()` in `tests/Pest.php`).
