// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import Register from './register';

let saasEnabled = false;

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    Link: ({
        children,
        href,
    }: {
        children: React.ReactNode;
        href: string | { url: string };
    }) => <a href={typeof href === 'string' ? href : href.url}>{children}</a>,
    router: { visit: vi.fn() },
    usePage: () => ({ props: { saas: { enabled: saasEnabled } } }),
    Form: ({
        children,
    }: {
        children: (state: {
            processing: boolean;
            errors: Record<string, string>;
        }) => React.ReactNode;
    }) => (
        <form aria-label="Register">
            {children({ processing: false, errors: {} })}
        </form>
    ),
}));

const QUESTION = 'How did you hear about Plain Week?';

function renderPage(saas: boolean) {
    saasEnabled = saas;
    render(<Register passwordRules="minlength: 8;" />);
}

describe('Register', () => {
    afterEach(cleanup);

    it('asks how the user heard about Plain Week in SaaS mode', () => {
        renderPage(true);

        expect(screen.getByRole('combobox', { name: QUESTION })).toBeTruthy();
        expect(screen.getByText('Optional')).toBeTruthy();
    });

    it('does not ask when SaaS mode is off', () => {
        renderPage(false);

        expect(screen.queryByText(QUESTION)).toBeNull();
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('sends the chosen answer with the form as a stable slug', async () => {
        const user = userEvent.setup();
        renderPage(true);

        await user.click(screen.getByRole('combobox', { name: QUESTION }));
        await user.click(
            await screen.findByRole('option', { name: 'Hacker News' }),
        );

        const form = screen.getByRole('form', { name: 'Register' });
        expect(
            new FormData(form as HTMLFormElement).get('referral_source'),
        ).toBe('hacker_news');
    });
});
