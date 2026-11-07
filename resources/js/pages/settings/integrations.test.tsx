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
import Integrations from './integrations';

const mocks = vi.hoisted(() => ({
    post: vi.fn(),
    delete: vi.fn(),
    flash: {} as Record<string, unknown>,
}));

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    usePage: () => ({
        props: {
            integrations: { googleCalendar: false, caldav: true },
        },
        flash: mocks.flash,
    }),
    router: {
        post: mocks.post,
        delete: mocks.delete,
    },
}));

type Credential = {
    id: number;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
};

type CalDav = {
    server: string;
    username: string;
    credentials: Credential[];
};

const caldav: CalDav = {
    server: 'https://plan.example.com/dav/',
    username: 'tom@example.com',
    credentials: [],
};

function renderPage(overrides: Partial<CalDav> = {}) {
    const user = userEvent.setup();

    render(
        <Integrations
            googleCalendar={null}
            caldav={{ ...caldav, ...overrides }}
        />,
    );

    return user;
}

beforeEach(() => {
    mocks.post.mockReset();
    mocks.delete.mockReset();
    mocks.flash = {};
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Settings › Integrations › CalDAV', () => {
    it('shows the connection details and explains the one-way sync', () => {
        renderPage();

        expect(screen.getByText('CalDAV')).toBeTruthy();
        expect(screen.getByText('Read-only')).toBeTruthy();
        expect(screen.getByText('https://plan.example.com/dav/')).toBeTruthy();
        expect(screen.getByText('tom@example.com')).toBeTruthy();
        expect(screen.getByText(/No app password yet/)).toBeTruthy();
    });

    it('creates an app password with a name', async () => {
        const user = renderPage();

        await user.click(
            screen.getByRole('button', { name: 'Create app password' }),
        );
        await user.clear(screen.getByLabelText('Name'));
        await user.type(screen.getByLabelText('Name'), 'Phone');
        await user.click(screen.getByRole('button', { name: 'Create' }));

        expect(mocks.post).toHaveBeenCalledWith(
            '/settings/integrations/caldav',
            { name: 'Phone' },
            expect.objectContaining({ preserveScroll: true }),
        );
    });

    it('shows the new password once, from flash data', () => {
        mocks.flash = {
            caldavCredential: {
                name: 'Phone',
                username: 'tom@example.com',
                password: 'a-very-secret-password',
                server: 'https://plan.example.com/dav/',
            },
        };

        renderPage();

        expect(screen.getByText('App password created')).toBeTruthy();
        expect(screen.getByText('a-very-secret-password')).toBeTruthy();
        expect(screen.getByText(/shown once/)).toBeTruthy();
    });

    it('lists a credential and revokes it after confirming', async () => {
        const user = renderPage({
            credentials: [
                {
                    id: 7,
                    name: 'Phone',
                    createdAt: new Date().toISOString(),
                    lastUsedAt: null,
                },
            ],
        });

        expect(screen.getByText('Phone')).toBeTruthy();
        expect(screen.getByText(/Never used/)).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Revoke' }));
        await user.click(screen.getByRole('button', { name: 'Revoke' }));

        expect(mocks.delete).toHaveBeenCalledWith(
            { url: '/settings/integrations/caldav/7', method: 'delete' },
            expect.objectContaining({ preserveScroll: true }),
        );
    });
});
