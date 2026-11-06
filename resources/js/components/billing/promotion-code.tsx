import { useHttp } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { promotionCode } from '@/routes/billing';
import type { Plan } from '@/types';

/** A code the server accepted for a plan, with the price it gives. */
export type AppliedCode = {
    plan: Plan;
    code: string;
    price: string;
    /** The plan costs nothing today with the code (no card needed). */
    free: boolean;
};

/**
 * A promotion code typed on the plan choice. `apply` asks the server what the
 * code gives for a plan (it answers `422` when the code does not apply);
 * Checkout gets the typed code and checks it again. `prefill` types a code
 * for the user (the featured one) until they edit the field.
 */
export function usePromotionCode() {
    const http = useHttp<{ code: string }, Omit<AppliedCode, 'plan'>>({
        code: '',
    });
    const [open, setOpen] = useState(false);
    // Whether the user typed in the field (a prefilled code is not theirs).
    const [edited, setEdited] = useState(false);
    const [applied, setApplied] = useState<AppliedCode | null>(null);
    // Set by Apply until the code is edited: a plan change then checks it again.
    const [checked, setChecked] = useState(false);
    // The plan of the latest check: an older answer (e.g. after a quick plan switch) is ignored.
    const latestPlan = useRef<Plan | null>(null);
    const typed = open ? http.data.code.trim() : '';

    // A prefilled code is checked once it is rendered (and sent) as the field's value.
    const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);

    const apply = (plan: Plan) => {
        http.cancel();
        setApplied(null);
        http.clearErrors();
        latestPlan.current = plan;

        if (typed === '') {
            return;
        }

        setChecked(true);
        http.post(promotionCode.url(plan), {
            onSuccess: (response) => {
                if (latestPlan.current === plan) {
                    setApplied({ plan, ...response });
                }
            },
            onNetworkError: () =>
                http.setError(
                    'code',
                    'Could not check the code. Check your connection.',
                ),
        }).catch(() => {
            // The error is already shown next to the field.
        });
    };

    useEffect(() => {
        if (pendingPlan !== null) {
            setPendingPlan(null);
            apply(pendingPlan);
        }
        // Only when a prefill asks for it, with the code now in the field.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingPlan]);

    const change = (code: string) => {
        http.cancel();
        http.setData('code', code);
        http.clearErrors();
        setApplied(null);
        setChecked(false);
        setEdited(true);
    };

    return {
        open,
        reveal: () => setOpen(true),
        /** Opens the field with `code` typed in and checks it for the plan. */
        prefill: (code: string, plan: Plan) => {
            http.setData('code', code);
            setOpen(true);
            setPendingPlan(plan);
        },
        /** Empties and closes the field ("Have a code?" again). */
        clear: () => {
            http.cancel();
            http.setData('code', '');
            http.clearErrors();
            setApplied(null);
            setChecked(false);
            setOpen(false);
        },
        edited,
        code: http.data.code,
        /** The code to send to Checkout, if one was typed. */
        typed: typed === '' ? undefined : typed,
        change,
        apply,
        /** The applied code, if it was checked for this plan. */
        appliedTo: (plan: Plan) => (applied?.plan === plan ? applied : null),
        /** Whether the typed code was already checked (so a plan change checks it again). */
        checked,
        error: http.errors.code,
        setError: (message: string) => http.setError('code', message),
        processing: http.processing,
    };
}

type PromotionCodeState = ReturnType<typeof usePromotionCode>;

/** "Have a code?", then the code field with Apply and its result. */
export function PromotionCodeField({
    state,
    plan,
}: {
    state: PromotionCodeState;
    plan: Plan;
}) {
    if (!state.open) {
        return (
            <Button
                type="button"
                variant="link"
                className="h-auto self-start p-0 text-sm text-muted-foreground"
                onClick={state.reveal}
                data-test="reveal-promotion-code"
            >
                Have a code?
            </Button>
        );
    }

    const applied = state.appliedTo(plan);

    return (
        <form
            className="grid gap-2"
            onSubmit={(event) => {
                event.preventDefault();
                state.apply(plan);
            }}
        >
            <div className="flex gap-2">
                <Input
                    aria-label="Promotion code"
                    placeholder="Promotion code"
                    // Not when it opens prefilled with the page.
                    autoFocus={state.edited || state.code === ''}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    value={state.code}
                    onChange={(event) => state.change(event.target.value)}
                    aria-invalid={state.error !== undefined}
                    className="h-10 px-4 uppercase placeholder:normal-case"
                    data-test="promotion-code-input"
                />
                <Button
                    type="submit"
                    variant="outline"
                    className="h-10 rounded-full px-5"
                    disabled={state.processing || state.code.trim() === ''}
                >
                    {state.processing && <Spinner />}
                    Apply
                </Button>
            </div>
            <InputError message={state.error} role="alert" />
            {/* Always rendered, so screen readers announce what appears in it. */}
            <p
                role="status"
                className="text-sm text-muted-foreground empty:hidden"
            >
                {applied && `${applied.code} applied: ${applied.price} today.`}
            </p>
        </form>
    );
}
