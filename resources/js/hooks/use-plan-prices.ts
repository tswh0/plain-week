import { useEffect, useState } from 'react';
import type { Offers } from '@/components/billing/offers';
import { readStorage, writeStorage } from '@/lib/storage';
import { prices } from '@/routes/billing';

/** The last prices seen, so the landing card shows them offline too. */
const CACHE_KEY = 'plain-week.prices';

function cachedPrices(): Offers | null {
    const cached = readStorage('local', CACHE_KEY);

    try {
        // The featured code may have run out since: shown only once the server says so.
        return cached === null
            ? null
            : { ...(JSON.parse(cached) as Offers), featured: null };
    } catch {
        return null;
    }
}

/**
 * The plan prices as the server formats them from Stripe (`GET
 * /billing/prices`), for guests. Starts with the last ones seen on this
 * device and never blocks rendering: null while loading, 'unavailable'
 * when they could not be loaded and none were cached.
 */
export function usePlanPrices(): Offers | null | 'unavailable' {
    const [offers, setOffers] = useState<Offers | null | 'unavailable'>(
        cachedPrices,
    );

    useEffect(() => {
        const controller = new AbortController();

        fetch(prices.url(), {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                return response.json() as Promise<{ plans: Offers }>;
            })
            .then(({ plans }) => {
                setOffers(plans);
                writeStorage('local', CACHE_KEY, JSON.stringify(plans));
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) {
                    console.warn('Could not load the plan prices.', error);
                    // Keep cached prices; without any, stop the placeholder.
                    setOffers((current) => current ?? 'unavailable');
                }
            });

        return () => controller.abort();
    }, []);

    return offers;
}
