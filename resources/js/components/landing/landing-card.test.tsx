// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Offers } from '@/components/billing/offers';
import { LandingCard } from './landing-card';

let offers: Offers | null | 'unavailable' = null;

vi.mock('@/hooks/use-plan-prices', () => ({
    usePlanPrices: () => offers,
}));

vi.mock('@inertiajs/react', () => ({
    Link: ({
        children,
        href,
        ...props
    }: {
        children: React.ReactNode;
        href: string | { url: string };
    }) => (
        <a href={typeof href === 'string' ? href : href.url} {...props}>
            {children}
        </a>
    ),
}));

const launchOffers: Offers = {
    weekly: { price: '€2.99' },
    lifetime: { price: '€16', regularPrice: '€64', discountPercent: 75 },
    featured: null,
};

const founderOffers: Offers = {
    ...launchOffers,
    featured: { code: 'FOUNDER20', plan: 'lifetime', price: '€0', free: true },
};

function lifetimeCard() {
    return within(
        document.querySelector<HTMLElement>(
            '[data-test="landing-plan-lifetime"]',
        )!,
    );
}

afterEach(() => {
    cleanup();
    offers = null;
});

describe('LandingCard pricing', () => {
    it('shows the launch price without a featured code', () => {
        offers = launchOffers;

        render(<LandingCard />);

        expect(lifetimeCard().queryByText('€16')).not.toBeNull();
        expect(lifetimeCard().queryByText('Launch −75%')).not.toBeNull();
        expect(
            document.querySelector('[data-test="featured-code-line"]'),
        ).toBeNull();
    });

    it('also without a featured code in prices cached before it existed', () => {
        offers = {
            weekly: launchOffers.weekly,
            lifetime: launchOffers.lifetime,
        };

        render(<LandingCard />);

        expect(lifetimeCard().queryByText('€16')).not.toBeNull();
        expect(
            document.querySelector('[data-test="featured-code-line"]'),
        ).toBeNull();
    });

    it('shows lifetime free with the featured code, the regular price struck through', () => {
        offers = founderOffers;

        render(<LandingCard />);

        const card = lifetimeCard();

        expect(card.queryByText('€0')).not.toBeNull();
        expect(card.queryByText('€64')).not.toBeNull();
        expect(card.queryByText('Founder offer')).not.toBeNull();
        expect(card.queryByText('Launch −75%')).toBeNull();
        expect(
            card.queryByText('Free for our first founders, synced forever.'),
        ).not.toBeNull();
        expect(
            document.querySelector('[data-test="featured-code-line"]')
                ?.textContent,
        ).toBe('Use code FOUNDER20');
        // The weekly card is unchanged.
        expect(
            document.querySelector('[data-test="landing-plan-weekly"]')
                ?.textContent,
        ).toContain('€2.99/ week');
    });

    it('copies the code', async () => {
        const user = userEvent.setup();
        const writeText = vi
            .spyOn(navigator.clipboard, 'writeText')
            .mockResolvedValue();
        offers = founderOffers;

        render(<LandingCard />);

        await user.click(
            screen.getByRole('button', { name: 'Copy the code FOUNDER20' }),
        );

        expect(writeText).toHaveBeenCalledWith('FOUNDER20');
        expect((await screen.findByRole('status')).textContent).toBe(
            'Code copied',
        );
    });
});
