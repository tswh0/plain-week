import { Head, usePoll } from '@inertiajs/react';
import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AuthFootnote, AuthSubmit } from '@/components/auth/auth-form';
import { LegalLinks } from '@/components/billing/legal-links';
import { lifetimeBadge } from '@/components/billing/offers';
import type { Offers } from '@/components/billing/offers';
import {
    PromotionCodeField,
    usePromotionCode,
} from '@/components/billing/promotion-code';
import { FloatingCard } from '@/components/floating-card';
import TextLink from '@/components/text-link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { useCheckout } from '@/hooks/use-checkout';
import { useLogout } from '@/hooks/use-logout';
import { chosenPlan, forgetChosenPlan } from '@/lib/landing';
import { edit as editData } from '@/routes/data';
import type { Plan } from '@/types';

type Props = {
    plans: Offers;
    processing: boolean;
};

const POLL_LIMIT_MS = 60_000;

/**
 * Polls until Stripe confirms the payment (the server then redirects to the
 * planner), for a minute at most: a delayed payment method can take days.
 */
function ProcessingNotice() {
    const { stop } = usePoll(2000);
    const [timedOut, setTimedOut] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            stop();
            setTimedOut(true);
        }, POLL_LIMIT_MS);

        return () => clearTimeout(timer);
    }, [stop]);

    return timedOut ? (
        <Alert>
            <AlertTitle>Your payment is still being confirmed</AlertTitle>
            <AlertDescription>
                Some payment methods take a while. Sync starts on its own once
                it is confirmed; reload this page later to check.
            </AlertDescription>
        </Alert>
    ) : (
        <Alert>
            <Spinner />
            <AlertTitle>Confirming your payment…</AlertTitle>
            <AlertDescription>
                This page continues on its own once Stripe confirms it.
            </AlertDescription>
        </Alert>
    );
}

/** One plan as a selectable card. */
function PlanOption({
    value,
    name,
    note,
    price,
    priceNote,
    badge,
}: {
    value: Plan;
    name: string;
    note: string;
    price: string;
    /** Under the price: the regular price (struck through) or the period. */
    priceNote: ReactNode;
    badge?: string;
}) {
    const id = `plan-${value}`;

    return (
        <label
            htmlFor={id}
            data-test={id}
            className="relative flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-border p-4 transition-colors hover:border-foreground/40 has-data-checked:border-foreground"
        >
            <RadioGroupItem id={id} value={value} className="mt-1 size-4.5" />
            <span className="flex grow flex-col gap-1">
                <span className="font-semibold">{name}</span>
                <span className="text-sm text-muted-foreground">{note}</span>
            </span>
            <span className="text-end">
                <span className="block text-2xl font-bold tracking-tight">
                    {price}
                </span>
                <span className="text-sm text-muted-foreground">
                    {priceNote}
                </span>
            </span>
            {badge && (
                <Badge className="absolute start-4 -top-2.5 bg-foreground text-background">
                    {badge}
                </Badge>
            )}
        </label>
    );
}

/**
 * The paywall (SaaS mode), step 2 of signing up: an account without a paid
 * plan picks one here before it can sync. A floating card over the planner
 * that cannot be dismissed: without a plan the account has nowhere else to
 * go but Checkout or logging out. Guests never see it.
 */
export default function Plans({ plans, processing }: Props) {
    // A plan picked on the landing card before signing up comes preselected.
    const [plan, setPlan] = useState<Plan>(() => chosenPlan() ?? 'lifetime');
    const { start, pending } = useCheckout();
    const { lifetime, weekly, featured } = plans;
    const promotion = usePromotionCode();
    const logOut = useLogout();
    const applied = promotion.appliedTo(plan);

    /**
     * The code shown on the landing card comes typed in on its plan (the
     * server still checks it) and goes away on the other one, until the user
     * edits the field: then it is their code.
     */
    const followFeaturedCode = (next: Plan): boolean => {
        if (!featured || promotion.edited) {
            return false;
        }

        if (next === featured.plan) {
            promotion.prefill(featured.code, next);
        } else {
            promotion.clear();
        }

        return true;
    };

    useEffect(() => {
        forgetChosenPlan();
        followFeaturedCode(plan);
        // Once, on opening: later changes follow the plan choice.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const choose = (next: Plan) => {
        setPlan(next);

        // A code applies to one plan: check it again for the new one.
        if (!followFeaturedCode(next) && promotion.checked) {
            promotion.apply(next);
        }
    };

    const continueToPayment = () =>
        start(plan, {
            code: promotion.typed,
            onError: (errors) => {
                if (errors.code) {
                    promotion.setError(errors.code);
                }
            },
        });

    return (
        <>
            <Head title="Choose a plan" />

            <FloatingCard
                title="Choose your plan"
                description="Sync on every device and a backup on our server."
                // Start on the chosen plan, not on "Log out".
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    document.getElementById(`plan-${plan}`)?.focus();
                }}
                toolbar={
                    <>
                        <span>Step 2 of 2</span>
                        <Button
                            variant="link"
                            size="sm"
                            className="h-auto px-0 text-muted-foreground"
                            onClick={logOut}
                            data-test="logout-button"
                        >
                            Log out
                        </Button>
                    </>
                }
            >
                {processing && <ProcessingNotice />}

                <RadioGroup
                    value={plan}
                    onValueChange={(value) => choose(value as Plan)}
                    aria-label="Plan"
                    className="gap-4 pt-1"
                >
                    <PlanOption
                        value="lifetime"
                        name="Lifetime"
                        note="Pay once, sync forever."
                        price={lifetime.price}
                        priceNote={
                            lifetime.regularPrice && (
                                <span className="line-through">
                                    <span className="sr-only">
                                        Regular price:{' '}
                                    </span>
                                    {lifetime.regularPrice}
                                </span>
                            )
                        }
                        badge={lifetimeBadge(plans)}
                    />
                    <PlanOption
                        value="weekly"
                        name="Weekly"
                        note="Cancel anytime."
                        price={weekly.price}
                        priceNote="per week"
                    />
                </RadioGroup>

                <PromotionCodeField state={promotion} plan={plan} />

                <div className="flex justify-between gap-3 px-0.5 text-sm">
                    <span className="text-muted-foreground">
                        Due today, VAT included
                    </span>
                    <span className="flex items-baseline gap-2">
                        {applied && (
                            <span className="text-muted-foreground line-through">
                                <span className="sr-only">
                                    Without the code:{' '}
                                </span>
                                {plans[plan].price}
                            </span>
                        )}
                        <span className="font-bold" data-test="due-today">
                            {applied?.price ?? plans[plan].price}
                        </span>
                    </span>
                </div>

                <div className="flex flex-col gap-3">
                    <AuthSubmit
                        type="button"
                        processing={pending !== null}
                        onClick={continueToPayment}
                        data-test="checkout-button"
                    >
                        {applied?.free ? 'Continue' : 'Continue to payment'}
                    </AuthSubmit>
                    <AuthFootnote className="flex items-center justify-center gap-1.5 text-xs">
                        <Lock className="size-3" aria-hidden />
                        {applied?.free
                            ? 'Nothing to pay and no card needed. Stripe confirms the order.'
                            : 'Secure payment with Stripe. No trial, no hidden fees.'}
                    </AuthFootnote>
                </div>

                {/* Logging out wipes this account's local data, so the way back to free local use says so. */}
                <AuthFootnote className="text-xs">
                    Not now?{' '}
                    <Button
                        variant="link"
                        className="inline h-auto p-0 text-start text-xs whitespace-normal text-muted-foreground underline"
                        onClick={logOut}
                        data-test="not-now-logout"
                    >
                        Log out and keep using Plain Week for free in this
                        browser.
                    </Button>{' '}
                    <TextLink href={editData()}>
                        Export your tasks first
                    </TextLink>
                    .
                </AuthFootnote>

                <LegalLinks />
            </FloatingCard>
        </>
    );
}
