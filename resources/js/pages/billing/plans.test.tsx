// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Offers } from '@/components/billing/offers';
import Plans from './plans';

const start = vi.fn();

type HttpOptions = {
    onSuccess?: (response: unknown) => void;
};

/** What the promotion-code endpoint answers, per test. */
let answerCode: (
    url: string,
    code: string,
    options: HttpOptions,
    setError: (message: string) => void,
) => void = () => {};

vi.mock('@inertiajs/react', async () => {
    const { useState } = await import('react');

    return {
        Head: () => null,
        // A minimal stand-in for Inertia's `useHttp` (it posts with XHR).
        useHttp: <T extends Record<string, string>>(initial: T) => {
            const [data, setData] = useState(initial);
            const [errors, setErrors] = useState<Record<string, string>>({});

            return {
                data,
                errors,
                processing: false,
                setData: (key: string, value: string) =>
                    setData((current) => ({ ...current, [key]: value })),
                clearErrors: () => setErrors({}),
                cancel: () => {},
                setError: (key: string, value: string) =>
                    setErrors((current) => ({ ...current, [key]: value })),
                post: (url: string, options: HttpOptions) => {
                    answerCode(url, data.code, options, (message) =>
                        setErrors({ code: message }),
                    );

                    return Promise.resolve();
                },
            };
        },
        Link: ({
            children,
            href,
        }: {
            children: React.ReactNode;
            href: string;
        }) => <a href={href}>{children}</a>,
        usePage: () => ({ props: { auth: { user: { id: 7 } } } }),
        usePoll: () => ({ stop: vi.fn() }),
    };
});

const logOut = vi.fn();

vi.mock('@/hooks/use-logout', () => ({
    useLogout: () => logOut,
}));

vi.mock('@/hooks/use-checkout', () => ({
    useCheckout: () => ({ start, pending: null }),
}));

const launchOffers: Offers = {
    weekly: { price: '€2.99' },
    lifetime: { price: '€16', regularPrice: '€64', discountPercent: 75 },
};

const founderOffers: Offers = {
    ...launchOffers,
    featured: { code: 'FOUNDER20', plan: 'lifetime', price: '€0', free: true },
};

afterEach(() => {
    cleanup();
    start.mockClear();
});

describe('Plans', () => {
    it('preselects lifetime with the launch discount', () => {
        render(<Plans plans={launchOffers} processing={false} />);

        expect(
            screen
                .getByRole('radio', { name: /Lifetime/ })
                .getAttribute('aria-checked'),
        ).toBe('true');
        expect(screen.queryByText('Launch −75%')).not.toBeNull();
        expect(screen.queryByText('€64')).not.toBeNull();
        expect(
            document.querySelector('[data-test="due-today"]')?.textContent,
        ).toBe('€16');
    });

    it('keeps the lifetime badge from a launch code without the launch coupon', () => {
        render(
            <Plans
                plans={{
                    weekly: launchOffers.weekly,
                    lifetime: {
                        price: '€64',
                        regularPrice: null,
                        discountPercent: null,
                    },
                    featured: {
                        code: 'EARLY75',
                        plan: 'lifetime',
                        price: '€16',
                        free: false,
                        percentOff: 75,
                    },
                }}
                processing={false}
            />,
        );

        expect(screen.queryByText('Launch −75%')).not.toBeNull();
    });

    it('preselects the plan picked on the landing card, once', () => {
        sessionStorage.setItem('plain-week.chosen-plan', 'weekly');

        render(<Plans plans={launchOffers} processing={false} />);

        expect(
            screen
                .getByRole('radio', { name: /Weekly/ })
                .getAttribute('aria-checked'),
        ).toBe('true');
        expect(sessionStorage.getItem('plain-week.chosen-plan')).toBeNull();
    });

    it('starts checkout for the chosen plan', async () => {
        const user = userEvent.setup();

        render(<Plans plans={launchOffers} processing={false} />);

        await user.click(screen.getByRole('radio', { name: /Weekly/ }));

        expect(
            document.querySelector('[data-test="due-today"]')?.textContent,
        ).toBe('€2.99');

        await user.click(
            screen.getByRole('button', { name: 'Continue to payment' }),
        );

        expect(start).toHaveBeenCalledWith('weekly', {
            code: undefined,
            onError: expect.any(Function),
        });
    });

    it('shows the full price without a badge when there is no launch offer', () => {
        render(
            <Plans
                plans={{
                    weekly: { price: '€2.99' },
                    lifetime: {
                        price: '€64',
                        regularPrice: null,
                        discountPercent: null,
                    },
                }}
                processing={false}
            />,
        );

        expect(screen.queryByText(/Launch/)).toBeNull();
        expect(
            document.querySelector('[data-test="due-today"]')?.textContent,
        ).toBe('€64');
    });

    it('applies a promotion code to the chosen plan and sends it to checkout', async () => {
        const user = userEvent.setup();

        answerCode = (url, code, options, setError) => {
            if (url.endsWith('/lifetime') && code === 'pwfriends26') {
                options.onSuccess?.({
                    code: 'PWFRIENDS26',
                    price: '€0',
                    free: true,
                });
            } else {
                setError("This code isn't valid for this plan.");
            }
        };

        render(<Plans plans={launchOffers} processing={false} />);

        await user.click(screen.getByRole('button', { name: 'Have a code?' }));
        await user.type(
            screen.getByRole('textbox', { name: 'Promotion code' }),
            'pwfriends26',
        );
        await user.click(screen.getByRole('button', { name: 'Apply' }));

        expect(
            screen.queryByText('PWFRIENDS26 applied: €0 today.'),
        ).not.toBeNull();
        expect(
            document.querySelector('[data-test="due-today"]')?.textContent,
        ).toBe('€0');

        // The code is for lifetime only: weekly checks it again and refuses it.
        await user.click(screen.getByRole('radio', { name: /Weekly/ }));

        expect(
            screen.queryByText("This code isn't valid for this plan."),
        ).not.toBeNull();
        expect(
            document.querySelector('[data-test="due-today"]')?.textContent,
        ).toBe('€2.99');

        await user.click(screen.getByRole('radio', { name: /Lifetime/ }));
        // Nothing to pay: no "payment" in the button.
        await user.click(screen.getByRole('button', { name: 'Continue' }));

        expect(start).toHaveBeenCalledWith(
            'lifetime',
            expect.objectContaining({ code: 'pwfriends26' }),
        );
    });

    it('prefills the featured code and applies it to its plan', async () => {
        const user = userEvent.setup();
        const checked: string[] = [];

        answerCode = (url, code, options, setError) => {
            checked.push(`${url.split('/').pop()}:${code}`);

            if (url.endsWith('/lifetime') && code === 'FOUNDER20') {
                options.onSuccess?.({
                    code: 'FOUNDER20',
                    price: '€0',
                    free: true,
                });
            } else {
                setError("This code isn't valid for this plan.");
            }
        };

        render(<Plans plans={founderOffers} processing={false} />);

        expect(
            (
                screen.getByRole('textbox', {
                    name: 'Promotion code',
                }) as HTMLInputElement
            ).value,
        ).toBe('FOUNDER20');
        expect(
            await screen.findByText('FOUNDER20 applied: €0 today.'),
        ).not.toBeNull();
        expect(
            document.querySelector('[data-test="due-today"]')?.textContent,
        ).toBe('€0');

        await user.click(screen.getByRole('button', { name: 'Continue' }));

        expect(start).toHaveBeenCalledWith(
            'lifetime',
            expect.objectContaining({ code: 'FOUNDER20' }),
        );
        expect(checked).toEqual(['lifetime:FOUNDER20']);
    });

    it('leaves the featured code out of another plan', async () => {
        const user = userEvent.setup();
        const checked: string[] = [];

        sessionStorage.setItem('plain-week.chosen-plan', 'weekly');
        answerCode = (url, code, options) => {
            checked.push(`${url.split('/').pop()}:${code}`);
            options.onSuccess?.({ code, price: '€0', free: true });
        };

        render(<Plans plans={founderOffers} processing={false} />);

        // Weekly: nothing typed, nothing checked.
        expect(checked).toEqual([]);
        expect(
            screen.queryByRole('textbox', { name: 'Promotion code' }),
        ).toBeNull();

        await user.click(screen.getByRole('radio', { name: /Lifetime/ }));

        expect(checked).toEqual(['lifetime:FOUNDER20']);
        expect(
            await screen.findByText('FOUNDER20 applied: €0 today.'),
        ).not.toBeNull();

        // Back to weekly: the code goes away instead of blocking the checkout.
        await user.click(screen.getByRole('radio', { name: /Weekly/ }));

        expect(
            screen.queryByRole('textbox', { name: 'Promotion code' }),
        ).toBeNull();
        expect(screen.queryByText(/isn't valid/)).toBeNull();

        await user.click(
            screen.getByRole('button', { name: 'Continue to payment' }),
        );

        expect(start).toHaveBeenCalledWith('weekly', {
            code: undefined,
            onError: expect.any(Function),
        });
    });

    it('keeps a code the user typed over the featured one', async () => {
        const user = userEvent.setup();
        const checked: string[] = [];

        answerCode = (url, code, options, setError) => {
            checked.push(`${url.split('/').pop()}:${code}`);
            setError("This code isn't valid for this plan.");
        };

        render(<Plans plans={founderOffers} processing={false} />);

        const field = screen.getByRole('textbox', { name: 'Promotion code' });

        await user.clear(field);
        await user.type(field, 'MINE');
        await user.click(screen.getByRole('button', { name: 'Apply' }));
        await user.click(screen.getByRole('radio', { name: /Weekly/ }));

        expect(checked).toEqual([
            'lifetime:FOUNDER20',
            'lifetime:MINE',
            'weekly:MINE',
        ]);
    });

    it('keeps the code field closed without a featured code', () => {
        render(
            <Plans
                plans={{ ...launchOffers, featured: null }}
                processing={false}
            />,
        );

        expect(
            screen.queryByRole('button', { name: 'Have a code?' }),
        ).not.toBeNull();
        expect(
            screen.queryByRole('textbox', { name: 'Promotion code' }),
        ).toBeNull();
    });

    it('offers logging out (with the export first) instead of free use while signed in', async () => {
        const user = userEvent.setup();

        render(<Plans plans={launchOffers} processing={false} />);

        expect(
            screen.getByRole('link', { name: 'Export your tasks first' }),
        ).not.toBeNull();

        await user.click(
            screen.getByRole('button', {
                name: 'Log out and keep using Plain Week for free in this browser.',
            }),
        );

        expect(logOut).toHaveBeenCalledOnce();
    });
});
