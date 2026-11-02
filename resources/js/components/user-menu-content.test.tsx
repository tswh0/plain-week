// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
    DropdownMenu,
    DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { UserMenuContent } from './user-menu-content';

let feedbackUrl = '';

vi.mock('@inertiajs/react', () => ({
    Link: ({
        children,
        href,
        prefetch: _prefetch,
        ...rest
    }: {
        children: React.ReactNode;
        href: string | { url: string };
        prefetch?: boolean;
    }) => (
        <a href={typeof href === 'string' ? href : href.url} {...rest}>
            {children}
        </a>
    ),
    usePage: () => ({ props: { feedbackUrl } }),
}));

vi.mock('@/hooks/use-logout', () => ({ useLogout: () => () => {} }));

const user = {
    id: 7,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    email_verified_at: null,
    created_at: '',
    updated_at: '',
};

const renderMenu = () =>
    render(
        <DropdownMenu open>
            <DropdownMenuContent>
                <UserMenuContent user={user} />
            </DropdownMenuContent>
        </DropdownMenu>,
    );

const feedbackItem = () =>
    screen.getByRole('menuitem', { name: 'Send feedback' });

afterEach(cleanup);

describe('UserMenuContent', () => {
    it('opens GitHub Discussions in a new tab on a self-hosted instance', () => {
        feedbackUrl = 'https://github.com/victor-falcon/plain-week/discussions';
        renderMenu();

        expect(feedbackItem().getAttribute('href')).toBe(feedbackUrl);
        expect(feedbackItem().getAttribute('target')).toBe('_blank');
        expect(feedbackItem().getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('opens the mail app in place in SaaS mode', () => {
        feedbackUrl =
            'mailto:hello@plainweek.eu?subject=Plain%20Week%20feedback';
        renderMenu();

        expect(feedbackItem().getAttribute('href')).toBe(feedbackUrl);
        expect(feedbackItem().hasAttribute('target')).toBe(false);
        expect(feedbackItem().getAttribute('title')).toBe('hello@plainweek.eu');
    });

    it('leaves the item out when the page has no feedback URL', () => {
        feedbackUrl = '';
        renderMenu();

        expect(
            screen.queryByRole('menuitem', { name: 'Send feedback' }),
        ).toBeNull();
    });
});
