// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Offers } from '@/components/billing/offers';
import { usePlanPrices } from './use-plan-prices';

const founderOffers: Offers = {
    weekly: { price: '€2.99' },
    lifetime: { price: '€16', regularPrice: '€64', discountPercent: 75 },
    featured: { code: 'FOUNDER20', plan: 'lifetime', price: '€0', free: true },
};

afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('usePlanPrices', () => {
    it('starts with the cached prices, without a featured code that may have run out', () => {
        localStorage.setItem(
            'plain-week.prices',
            JSON.stringify(founderOffers),
        );
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise(() => {})),
        );

        const { result } = renderHook(() => usePlanPrices());

        expect(result.current).toEqual({ ...founderOffers, featured: null });
    });

    it('keeps the sold-out code in the cached prices', () => {
        localStorage.setItem(
            'plain-week.prices',
            JSON.stringify({
                ...founderOffers,
                soldOut: { code: 'FOUNDER20' },
            }),
        );
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise(() => {})),
        );

        const { result } = renderHook(() => usePlanPrices());

        expect(result.current).toMatchObject({
            featured: null,
            soldOut: { code: 'FOUNDER20' },
        });
    });

    it('shows the featured code once the server confirms it', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() =>
                Promise.resolve(
                    new Response(JSON.stringify({ plans: founderOffers })),
                ),
            ),
        );

        const { result } = renderHook(() => usePlanPrices());

        await waitFor(() => expect(result.current).toEqual(founderOffers));
    });
});
