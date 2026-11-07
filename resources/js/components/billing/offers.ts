import type { Plan } from '@/types';

/** Prices of the plans as the server formats them from Stripe. */
export type Offers = {
    weekly: { price: string };
    lifetime: LifetimeOffer;
    /** Missing in prices cached before it existed. */
    featured?: FeaturedCode | null;
    /** A code that has run out, shown as sold out. Missing in prices cached before it existed. */
    soldOut?: SoldOutCode | null;
};

/**
 * A promotion code shown to everyone while it can be used (e.g. FOUNDER20),
 * with the plan it applies to and that plan's price with it.
 */
export type FeaturedCode = {
    code: string;
    plan: Plan;
    price: string;
    /** The plan costs nothing with the code. */
    free: boolean;
    /** The coupon's percent off, null for an amount off. Missing in prices cached before it existed. */
    percentOff?: number | null;
};

/** A promotion code that has run out (e.g. FOUNDER20), still shown, never usable. */
export type SoldOutCode = {
    code: string;
};

export type LifetimeOffer = {
    price: string;
    /** The price before the launch discount, null without a discount. */
    regularPrice: string | null;
    discountPercent: number | null;
};

/**
 * The badge on the Lifetime plan: the featured code's offer when it is for
 * Lifetime, otherwise the launch discount, if any.
 */
export function lifetimeBadge(offers: Offers): string | undefined {
    const { featured, lifetime } = offers;

    if (featured?.plan === 'lifetime') {
        if (featured.free) {
            return 'Founder offer';
        }

        return featured.percentOff
            ? `Launch −${featured.percentOff}%`
            : 'Launch offer';
    }

    return lifetime.discountPercent
        ? `Launch −${lifetime.discountPercent}%`
        : undefined;
}
