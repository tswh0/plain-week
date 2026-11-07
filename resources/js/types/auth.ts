export type User = {
    id: number;
    name: string;
    email: string;
    avatar?: string;
    email_verified_at: string | null;
    two_factor_enabled?: boolean;
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
};

export type Auth = {
    user: User;
};

/** SaaS mode (`SAAS_ENABLED`): accounts need a paid plan to sync. */
export type Saas = {
    enabled: boolean;
};

/** Integrations this instance offers; each needs its own credentials or is turned on. */
export type Integrations = {
    googleCalendar: boolean;
    caldav: boolean;
};

/** Web Push on this instance (`VAPID_*` keys); the key is base64url. */
export type Notifications = {
    enabled: boolean;
    vapidPublicKey: string | null;
};

export type Plan = 'weekly' | 'lifetime';

/** The signed-in account's entitlement. `hasAccess` is always true when SaaS mode is off. */
export type Account = {
    hasAccess: boolean;
    plan: Plan | null;
};

export type Passkey = {
    id: number;
    name: string;
    authenticator: string | null;
    created_at_diff: string;
    last_used_at_diff: string | null;
};

export type TwoFactorSetupData = {
    svg: string;
    url: string;
};

export type TwoFactorSecretKey = {
    secretKey: string;
};
