// @vitest-environment happy-dom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLiveQuery } from 'dexie-react-hooks';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vite-plus/test';
import { ScopePromptProvider } from '@/components/planner/scope-prompt';
import { TaskList } from '@/components/planner/task-list';
import { Toaster } from '@/components/ui/sonner';
import { db, wipeLocalDatabase } from '@/lib/db/database';
import { createTask, listTasksIn } from '@/lib/db/tasks';
import { toastAction } from '@/test/toasts';
import type { TaskPlacement } from '@/lib/db/tasks';
import type { Task } from '@/lib/db/types';

const DAY = '2026-10-12';

function List({
    placement,
    onOpenTask = () => {},
}: {
    placement: TaskPlacement;
    onOpenTask?: (id: string) => void;
}) {
    const tasks = useLiveQuery(() => listTasksIn(placement), [placement]);

    return (
        <ScopePromptProvider>
            <TaskList
                placement={placement}
                tasks={tasks}
                rows={3}
                newTaskLabel="New task"
                onOpenTask={onOpenTask}
            />
            <Toaster />
        </ScopePromptProvider>
    );
}

async function stored(id: string): Promise<Task | undefined> {
    return db.tasks.get(id);
}

async function setup(
    placement: TaskPlacement = { date: DAY },
    onOpenTask = vi.fn(),
) {
    const task = await createTask({ text: 'Plan trip', ...placement });
    const user = userEvent.setup();

    render(<List placement={placement} onOpenTask={onOpenTask} />);
    const button = await screen.findByRole('button', { name: 'Plan trip' });

    return { task, user, button, onOpenTask };
}

/** Right click on the task's row; resolves with the open menu. */
async function openMenu(button: HTMLElement) {
    fireEvent.contextMenu(button, { clientX: 10, clientY: 10 });

    return screen.findByRole('menu', { name: 'Task: Plan trip' });
}

async function select(name: string) {
    fireEvent.click(await screen.findByRole('menuitem', { name }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

beforeEach(async () => {
    await wipeLocalDatabase();
});

afterEach(() => {
    cleanup();
});

describe('TaskContextMenu', () => {
    it('opens on right click with the colors and actions, without opening the task', async () => {
        const { button, onOpenTask } = await setup();

        await openMenu(button);

        expect(
            screen
                .getAllByRole('menuitemradio')
                .map((item) => item.getAttribute('aria-label')),
        ).toEqual([
            'No color',
            'Pink',
            'Yellow',
            'Black',
            'Grey',
            'Cornflower',
            'Mango',
            'Green',
            'Lilac',
        ]);
        expect(
            screen
                .getByRole('menuitemradio', { name: 'No color' })
                .getAttribute('aria-checked'),
        ).toBe('true');
        expect(
            screen.getAllByRole('menuitem').map((item) => item.textContent),
        ).toEqual([
            // Each with its planner key.
            'Tomorrow>',
            'Next weekw',
            'Somedays',
            'Duplicatey',
            'Deletedd',
        ]);
        expect(onOpenTask).not.toHaveBeenCalled();
    });

    it('picks an item with its key while open', async () => {
        const { task, user, button } = await setup();

        await openMenu(button);
        await user.keyboard('w');
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
        await waitFor(async () =>
            expect((await stored(task.id))?.date).toBe('2026-10-19'),
        );
    });

    it('opens from the keyboard with Shift+F10 and the context menu key', async () => {
        const { user, button } = await setup();

        button.focus();
        await user.keyboard('{Shift>}{F10}{/Shift}');
        await screen.findByRole('menu', { name: 'Task: Plan trip' });
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

        button.focus();
        await user.keyboard('{ContextMenu}');
        await screen.findByRole('menu', { name: 'Task: Plan trip' });
    });

    it('returns focus to the row when it closes', async () => {
        const { user, button } = await setup();

        button.focus();
        await user.keyboard('{Shift>}{F10}{/Shift}');
        await screen.findByRole('menu');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
        expect(document.activeElement).toBe(button);

        await user.keyboard('{Shift>}{F10}{/Shift}');
        fireEvent.click(
            await screen.findByRole('menuitemradio', { name: 'Green' }),
        );
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Plan trip' }),
        );
    });

    it('changes the color', async () => {
        const { task, button } = await setup();

        await openMenu(button);
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Pink' }));

        await waitFor(async () =>
            expect((await stored(task.id))?.color).toBe('pink'),
        );

        await openMenu(button);
        expect(
            screen
                .getByRole('menuitemradio', { name: 'Pink' })
                .getAttribute('aria-checked'),
        ).toBe('true');
    });

    it('moves the task to tomorrow, next week and Someday', async () => {
        const { task, button } = await setup();

        await openMenu(button);
        await select('Tomorrow');
        await waitFor(async () =>
            expect((await stored(task.id))?.date).toBe('2026-10-13'),
        );

        cleanup();
        render(<List placement={{ date: '2026-10-13' }} />);
        await openMenu(
            await screen.findByRole('button', { name: 'Plan trip' }),
        );
        await select('Next week');
        await waitFor(async () =>
            expect((await stored(task.id))?.date).toBe('2026-10-20'),
        );

        cleanup();
        render(<List placement={{ date: '2026-10-20' }} />);
        await openMenu(
            await screen.findByRole('button', { name: 'Plan trip' }),
        );
        await select('Someday');
        await waitFor(async () =>
            expect(await stored(task.id)).toMatchObject({
                date: null,
            }),
        );
    });

    it('does not offer Someday for a Someday task', async () => {
        const { button } = await setup({ date: null });

        await openMenu(button);

        expect(screen.queryByRole('menuitem', { name: 'Someday' })).toBeNull();
        expect(screen.getByRole('menuitem', { name: 'Tomorrow' })).toBeTruthy();
    });

    it('duplicates the task', async () => {
        const { button } = await setup();

        await openMenu(button);
        await select('Duplicate');

        await waitFor(async () =>
            expect(
                (await listTasksIn({ date: DAY })).map((t) => t.text),
            ).toEqual(['Plan trip', 'Plan trip']),
        );
        await screen.findByText('Task duplicated.');
    });

    it('deletes the task and restores it with Undo', async () => {
        const { task, user, button } = await setup();

        await openMenu(button);
        await select('Delete');

        await waitFor(() =>
            expect(
                screen.queryByRole('button', { name: 'Plan trip' }),
            ).toBeNull(),
        );
        expect((await stored(task.id))?.deleted_at).not.toBeNull();

        await user.click(await toastAction('Task deleted.'));

        await screen.findByRole('button', { name: 'Plan trip' });
        expect((await stored(task.id))?.deleted_at).toBeNull();
    });

    it('deletes with d d while open, not with one d', async () => {
        const { task, user, button } = await setup();

        await openMenu(button);
        await user.keyboard('d');
        // "d" alone neither deletes nor jumps to "Duplicate" (typeahead).
        expect(screen.getByRole('menu')).toBeTruthy();
        expect((await stored(task.id))?.deleted_at).toBeNull();
        await user.keyboard('d');
        await waitFor(async () =>
            expect((await stored(task.id))?.deleted_at).not.toBeNull(),
        );
    });
});
