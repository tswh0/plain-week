import type { Plan } from '@/types';

/** Prices of the plans as the server formats them from Stripe. */
export type Offers = {
    weekly: { price: string };
    lifetime: LifetimeOffer;
    /** Missing in prices cached before it existed. */
    featured?: FeaturedCode | null;
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
};

export type LifetimeOffer = {
    price: string;
    /** The price before the launch discount, null without a discount. */
    regularPrice: string | null;
    discountPercent: number | null;
};
