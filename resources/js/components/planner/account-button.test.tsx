// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vite-plus/test';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { SyncStatus } from '@/lib/sync';
import { AccountButton } from './account-button';

type Props = {
    auth: { user: { id: number; name: string; email: string } | null };
    account: { hasAccess: boolean } | null;
    saas: { enabled: boolean };
    feedbackUrl: string;
};

let props: Props;
let status: SyncStatus = 'idle';
const sync = vi.fn((_options: unknown) => Promise.resolve());

vi.mock('@inertiajs/react', () => ({
    Link: ({
        children,
        href,
        ...rest
    }: {
        children: React.ReactNode;
        href: string | { url: string };
    }) => (
        <a href={typeof href === 'string' ? href : href.url} {...rest}>
            {children}
        </a>
    ),
    usePage: () => ({ props }),
}));

vi.mock('@/hooks/use-visible-sync-status', () => ({
    useVisibleSyncStatus: () => status,
}));

vi.mock('@/lib/sync', () => ({
    syncEngine: { sync: (options: unknown) => sync(options) },
}));

vi.mock('@/components/user-menu-content', () => ({
    UserMenuContent: () => null,
}));

const user = { id: 7, name: 'Ada Lovelace', email: 'ada@example.com' };

const renderButton = () =>
    render(
        <TooltipProvider>
            <AccountButton />
        </TooltipProvider>,
    );

const dot = () =>
    document
        .querySelector('[data-sync-status]')
        ?.getAttribute('data-sync-status');

beforeEach(() => {
    props = {
        auth: { user },
        account: { hasAccess: true },
        saas: { enabled: false },
        feedbackUrl: 'https://github.com/victor-falcon/plain-week/discussions',
    };
    status = 'idle';
});

afterEach(() => {
    cleanup();
    sync.mockClear();
});

describe('AccountButton', () => {
    it.each<[SyncStatus, string]>([
        ['idle', 'All changes synced'],
        ['syncing', 'Syncing…'],
        ['offline', 'Offline. Changes sync when you are back.'],
        ['error', 'Some changes could not be synced. Click to retry.'],
    ])('shows the %s dot on the avatar', (current, label) => {
        status = current;
        renderButton();

        expect(dot()).toBe(current);
        expect(
            screen.getByRole('button', { name: `Account menu. ${label}` }),
        ).not.toBeNull();
    });

    it('shows sync as paused when the plan ended (SaaS)', () => {
        props.saas.enabled = true;
        props.account = { hasAccess: false };
        renderButton();

        expect(dot()).toBe('paused');
        expect(
            screen.getByRole('button', {
                name: 'Account menu. Sync paused. Renew your plan to sync again.',
            }),
        ).not.toBeNull();
    });

    it('retries a failed sync from the menu', async () => {
        const browser = userEvent.setup();

        status = 'error';
        renderButton();

        await browser.click(
            screen.getByRole('button', { name: /Account menu/ }),
        );
        await browser.click(
            await screen.findByRole('menuitem', { name: 'Retry sync' }),
        );

        expect(sync).toHaveBeenCalledWith({ force: true });
    });

    it('invites guests to sync their week, with Log in in a menu', async () => {
        const browser = userEvent.setup();

        props.auth.user = null;
        props.account = null;
        renderButton();

        expect(
            screen
                .getByRole('link', { name: /Sync your week/ })
                .getAttribute('href'),
        ).toBe('/register');
        expect(dot()).toBe('guest');

        await browser.click(
            screen.getByRole('button', { name: 'More account options' }),
        );

        expect(
            await screen.findByRole('menuitem', { name: 'Log in' }),
        ).not.toBeNull();
        expect(
            screen
                .getByRole('menuitem', { name: 'Send feedback' })
                .getAttribute('href'),
        ).toBe('https://github.com/victor-falcon/plain-week/discussions');
        // The landing card only exists in SaaS mode.
        expect(
            screen.queryByRole('menuitem', { name: 'About Plain Week' }),
        ).toBeNull();
    });
});
