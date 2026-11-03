// @vitest-environment happy-dom
import {
    cleanup,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { ScopePromptProvider } from '@/components/planner/scope-prompt';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { db, wipeLocalDatabase } from '@/lib/db/database';
import { createTask, listTasksIn } from '@/lib/db/tasks';
import { toastAction } from '@/test/toasts';
import type { Task } from '@/lib/db/types';
import { TaskDialog } from './task-dialog';

const DAY = '2026-10-12';

function Harness({ taskId }: { taskId: string }) {
    const [openId, setOpenId] = useState<string | null>(taskId);

    return (
        <TooltipProvider>
            <ScopePromptProvider>
                <TaskDialog taskId={openId} onClose={() => setOpenId(null)} />
                <Toaster />
            </ScopePromptProvider>
        </TooltipProvider>
    );
}

async function stored(id: string): Promise<Task | undefined> {
    return db.tasks.get(id);
}

async function open(
    fields: { notes?: string; subtasks?: Task['subtasks'] } = {},
) {
    const task = await createTask({ text: 'Plan trip', date: DAY, ...fields });
    const user = userEvent.setup();

    render(<Harness taskId={task.id} />);
    const dialog = await screen.findByRole('dialog', { name: 'Edit task' });

    return { task, user, dialog };
}

beforeEach(async () => {
    await wipeLocalDatabase();
});

afterEach(() => {
    cleanup();
});

describe('TaskDialog', () => {
    it('shows the date, the title and the notes', async () => {
        const { dialog } = await open({ notes: 'Book hotel' });

        expect(
            within(dialog).getByRole('button', {
                name: 'Date: Mon, 12 Oct 2026',
            }),
        ).toBeTruthy();
        expect(
            (within(dialog).getByLabelText('Task') as HTMLTextAreaElement)
                .value,
        ).toBe('Plan trip');
        expect(
            (within(dialog).getByLabelText('Notes') as HTMLTextAreaElement)
                .value,
        ).toBe('Book hotel');
    });

    it('shows links in the notes and title as links until they are edited', async () => {
        const task = await createTask({
            text: 'Plan www.example.org trip',
            date: DAY,
            notes: 'Hotel: https://example.com/hotel.\nPack',
        });
        const user = userEvent.setup();

        render(<Harness taskId={task.id} />);
        const dialog = await screen.findByRole('dialog', { name: 'Edit task' });

        const link = within(dialog).getByRole('link', {
            name: 'https://example.com/hotel',
        });
        expect(link.getAttribute('href')).toBe('https://example.com/hotel');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
        expect(
            within(dialog)
                .getByRole('link', { name: 'www.example.org' })
                .getAttribute('href'),
        ).toBe('https://www.example.org');

        // A click outside a link edits the text.
        await user.click(within(dialog).getByText('Pack', { exact: false }));
        const notes = within(dialog).getByLabelText('Notes');
        expect(notes.tagName).toBe('TEXTAREA');
        expect(document.activeElement).toBe(notes);
        await user.type(notes, ' bags');
        await waitFor(async () =>
            expect((await stored(task.id))?.notes).toBe(
                'Hotel: https://example.com/hotel.\nPack bags',
            ),
        );

        // Leaving the field shows the links again.
        await user.click(within(dialog).getByText('Plan', { exact: false }));
        expect(within(dialog).getByLabelText('Notes').tagName).toBe('DIV');
        expect(document.activeElement?.tagName).toBe('TEXTAREA');
        expect((document.activeElement as HTMLTextAreaElement).value).toBe(
            'Plan www.example.org trip',
        );
    });

    it('edits notes with links with n, caret at the end', async () => {
        const { user, dialog } = await open({ notes: 'See https://a.com' });

        await user.keyboard('n');

        const notes = within(dialog).getByLabelText(
            'Notes',
        ) as HTMLTextAreaElement;
        expect(document.activeElement).toBe(notes);
        expect(notes.selectionStart).toBe('See https://a.com'.length);
    });

    it('saves the title and notes as they are typed', async () => {
        const { task, user, dialog } = await open();

        const title = within(dialog).getByLabelText('Task');
        await user.clear(title);
        await user.type(title, 'Plan holidays');
        await user.type(within(dialog).getByLabelText('Notes'), 'Beach');

        await waitFor(async () =>
            expect(await stored(task.id)).toMatchObject({
                text: 'Plan holidays',
                notes: 'Beach',
            }),
        );
    });

    it('never saves an empty title', async () => {
        const { task, user, dialog } = await open();

        const title = within(dialog).getByLabelText(
            'Task',
        ) as HTMLTextAreaElement;
        await user.clear(title);
        await user.tab();

        expect(title.value).toBe('Plan trip');
        expect((await stored(task.id))?.text).toBe('Plan trip');
    });

    it('completes the task', async () => {
        const { task, user, dialog } = await open();

        await user.click(
            within(dialog).getByRole('button', { name: 'Mark as done' }),
        );

        await within(dialog).findByRole('button', { name: 'Mark as not done' });
        expect((await stored(task.id))?.done).toBe(true);
    });

    it('changes the date from the calendar', async () => {
        const { task, user, dialog } = await open();

        await user.click(
            within(dialog).getByRole('button', { name: /^Date:/ }),
        );
        await user.click(
            await screen.findByRole('button', { name: /October 15th, 2026/ }),
        );

        await within(dialog).findByRole('button', {
            name: 'Date: Thu, 15 Oct 2026',
        });
        expect((await stored(task.id))?.date).toBe('2026-10-15');
    });

    it('sets and clears the time', async () => {
        const { task, user, dialog } = await open();

        await user.click(
            within(dialog).getByRole('button', { name: 'Set time' }),
        );
        const input = await screen.findByLabelText('Time');
        await user.type(input, '09:30');

        await within(dialog).findByRole('button', { name: 'Time: 09:30' });
        expect((await stored(task.id))?.time).toBe('09:30');

        await user.click(screen.getByRole('button', { name: 'Clear' }));
        await within(dialog).findByRole('button', { name: 'Set time' });
        expect((await stored(task.id))?.time).toBeNull();

        // Emptying the native field clears it too.
        await user.click(
            within(dialog).getByRole('button', { name: 'Set time' }),
        );
        await user.type(await screen.findByLabelText('Time'), '10:15');
        await within(dialog).findByRole('button', { name: 'Time: 10:15' });
        await user.clear(screen.getByLabelText('Time'));
        await within(dialog).findByRole('button', { name: 'Set time' });
        expect((await stored(task.id))?.time).toBeNull();
    });

    it('changes the color', async () => {
        const { task, user, dialog } = await open();

        await user.click(
            within(dialog).getByRole('button', { name: 'Color: No color' }),
        );
        await user.click(await screen.findByRole('radio', { name: 'Pink' }));

        await within(dialog).findByRole('button', { name: 'Color: Pink' });
        expect((await stored(task.id))?.color).toBe('pink');
        expect(
            screen
                .getByRole('radio', { name: 'Pink' })
                .getAttribute('aria-checked'),
        ).toBe('true');
    });

    it('adds, edits, toggles and deletes subtasks', async () => {
        const { task, user, dialog } = await open();

        const add = within(dialog).getByLabelText('Add subtask');
        await user.type(add, 'Flights{Enter}');
        await user.type(add, 'Hotel{Enter}');

        expect(document.activeElement).toBe(add);
        expect((add as HTMLInputElement).value).toBe('');
        await waitFor(async () =>
            expect(
                (await stored(task.id))?.subtasks.map((s) => s.text),
            ).toEqual(['Flights', 'Hotel']),
        );

        await user.click(
            await within(dialog).findByRole('checkbox', {
                name: 'Complete "Flights"',
            }),
        );
        await waitFor(async () =>
            expect((await stored(task.id))?.subtasks[0].done).toBe(true),
        );

        await user.type(
            within(dialog).getAllByLabelText('Subtask')[1],
            ' room',
        );
        await user.click(
            within(dialog).getByRole('button', { name: 'Delete "Flights"' }),
        );

        await waitFor(async () =>
            expect((await stored(task.id))?.subtasks).toMatchObject([
                { text: 'Hotel room', done: false },
            ]),
        );
    });

    it('keeps a subtask typed without Enter when focus leaves or the dialog closes', async () => {
        const { task, user, dialog } = await open();

        await user.type(
            within(dialog).getByLabelText('Add subtask'),
            'Blurred',
        );
        await user.click(within(dialog).getByLabelText('Notes'));
        await user.type(within(dialog).getByLabelText('Add subtask'), 'Closed');
        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await waitFor(async () =>
            expect(
                (await stored(task.id))?.subtasks.map((s) => s.text),
            ).toEqual(['Blurred', 'Closed']),
        );
    });

    it('moves from a subtask to "Add subtask" with Enter', async () => {
        const { user, dialog } = await open({
            subtasks: [{ id: 's1', text: 'Flights', done: false }],
        });

        await user.click(within(dialog).getByLabelText('Subtask'));
        await user.keyboard('{Enter}');

        expect(document.activeElement).toBe(
            within(dialog).getByLabelText('Add subtask'),
        );
    });

    it('turns pasted line breaks in the title into spaces', async () => {
        const { task, user, dialog } = await open();

        const title = within(dialog).getByLabelText('Task');
        await user.clear(title);
        await user.click(title);
        await user.paste('Plan\ntrip');

        expect((title as HTMLTextAreaElement).value).toBe('Plan trip');
        await waitFor(async () =>
            expect((await stored(task.id))?.text).toBe('Plan trip'),
        );
    });

    it('moves the task with the More menu', async () => {
        const { task, user, dialog } = await open();
        const more = within(dialog).getByRole('button', { name: 'More' });

        await user.click(more);
        await user.click(
            await screen.findByRole('menuitem', { name: 'Tomorrow' }),
        );
        await within(dialog).findByRole('button', {
            name: 'Date: Tue, 13 Oct 2026',
        });

        await user.click(more);
        await user.click(
            await screen.findByRole('menuitem', { name: 'Next week' }),
        );
        await within(dialog).findByRole('button', {
            name: 'Date: Tue, 20 Oct 2026',
        });

        await user.click(more);
        await user.click(
            await screen.findByRole('menuitem', { name: 'Someday' }),
        );
        await within(dialog).findByRole('button', { name: 'Date: Someday' });
        expect(await stored(task.id)).toMatchObject({
            date: null,
            someday_column: 0,
        });
    });

    it('duplicates the task from the More menu', async () => {
        const { user, dialog } = await open();

        await user.click(within(dialog).getByRole('button', { name: 'More' }));
        await user.click(
            await screen.findByRole('menuitem', { name: 'Duplicate' }),
        );

        await waitFor(async () =>
            expect(
                (await listTasksIn({ date: DAY })).map((t) => t.text),
            ).toEqual(['Plan trip', 'Plan trip']),
        );
    });

    it('deletes the task, closes, and restores it with Undo', async () => {
        const { task, user, dialog } = await open();

        await user.click(
            within(dialog).getByRole('button', { name: 'Delete' }),
        );

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect((await stored(task.id))?.deleted_at).not.toBeNull();

        await user.click(await toastAction('Task deleted.'));

        await waitFor(async () =>
            expect((await stored(task.id))?.deleted_at).toBeNull(),
        );
        expect((await listTasksIn({ date: DAY })).map((t) => t.id)).toEqual([
            task.id,
        ]);
    });

    it('closes with Escape right after a popover closes', async () => {
        const { user, dialog } = await open();

        await user.click(
            within(dialog).getByRole('button', { name: 'Color: No color' }),
        );
        await screen.findByRole('radio', { name: 'Pink' });
        await user.keyboard('{Escape}');
        await waitFor(() =>
            expect(screen.queryByRole('radio', { name: 'Pink' })).toBeNull(),
        );
        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('closes with Escape', async () => {
        const { user } = await open();

        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
});

describe('TaskDialog keys', () => {
    it('opens the date picker with d, on the task day, and picks a day with the arrows', async () => {
        const { task, user, dialog } = await open();

        await user.keyboard('d');
        const grid = await screen.findByRole('grid');
        await waitFor(() =>
            expect(grid.contains(document.activeElement)).toBe(true),
        );
        expect(document.activeElement?.closest('td')?.dataset.day).toBe(DAY);

        await user.keyboard('{ArrowRight}{Enter}');
        await within(dialog).findByRole('button', {
            name: 'Date: Tue, 13 Oct 2026',
        });
        expect((await stored(task.id))?.date).toBe('2026-10-13');
    });

    it('opens the time, repeat and color pickers with t, r and c', async () => {
        const { user } = await open();

        await user.keyboard('t');
        await screen.findByLabelText('Time');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByLabelText('Time')).toBeNull());

        await user.keyboard('r');
        await screen.findByRole('button', { name: 'Apply' });
        await user.keyboard('{Escape}');
        await waitFor(() =>
            expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull(),
        );

        await user.keyboard('c');
        await screen.findByRole('radio', { name: 'Pink' });
        // Still in the dialog: Esc closes the popover only.
        await user.keyboard('{Escape}');
        await waitFor(() =>
            expect(screen.queryByRole('radio', { name: 'Pink' })).toBeNull(),
        );
        expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeTruthy();
    });

    it('marks the task as done with x', async () => {
        const { task, user } = await open();

        await user.keyboard('x');

        await waitFor(async () =>
            expect((await stored(task.id))?.done).toBe(true),
        );
    });

    it('moves the task with its keys, and from the More menu with m', async () => {
        const { task, user, dialog } = await open();

        await user.keyboard('>');
        await within(dialog).findByRole('button', {
            name: 'Date: Tue, 13 Oct 2026',
        });

        await user.keyboard('m');
        await screen.findByRole('menu');
        await user.keyboard('w');
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
        await within(dialog).findByRole('button', {
            name: 'Date: Tue, 20 Oct 2026',
        });

        await user.keyboard('s');
        await within(dialog).findByRole('button', { name: 'Date: Someday' });
        expect((await stored(task.id))?.date).toBeNull();
    });

    it('duplicates the task with y', async () => {
        const { user } = await open();

        await user.keyboard('y');

        await waitFor(async () =>
            expect(
                (await listTasksIn({ date: DAY })).map((t) => t.text),
            ).toEqual(['Plan trip', 'Plan trip']),
        );
    });

    it('focuses the title, the notes and "Add subtask" with e, n and a', async () => {
        const { user, dialog } = await open();

        await user.keyboard('e');
        expect(document.activeElement).toBe(
            within(dialog).getByLabelText('Task'),
        );

        await user.tab();
        await user.tab();
        await user.keyboard('n');
        expect(document.activeElement).toBe(
            within(dialog).getByLabelText('Notes'),
        );

        await user.tab();
        await user.keyboard('a');
        expect(document.activeElement).toBe(
            within(dialog).getByLabelText('Add subtask'),
        );
    });

    it('types its keys as text in a field', async () => {
        const { task, user, dialog } = await open();
        const notes = within(dialog).getByLabelText('Notes');

        await user.click(notes);
        await user.keyboard('dtrcmx');

        expect(screen.queryByRole('grid')).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
        await waitFor(async () =>
            expect((await stored(task.id))?.notes).toBe('dtrcmx'),
        );
        expect((await stored(task.id))?.done).toBe(false);
    });

    it('leaves the subtasks their own keys: Delete or x there never acts on the task', async () => {
        const { task, user, dialog } = await open({
            subtasks: [{ id: 's1', text: 'Book hotel', done: false }],
        });

        within(dialog)
            .getByRole('button', { name: 'Delete "Book hotel"' })
            .focus();
        await user.keyboard('{Delete}x');
        within(dialog)
            .getByRole('checkbox', { name: 'Complete "Book hotel"' })
            .focus();
        await user.keyboard('{Delete}{Backspace}');

        expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeTruthy();
        expect(await stored(task.id)).toMatchObject({
            deleted_at: null,
            done: false,
        });
    });

    it('does not delete the task with Backspace', async () => {
        const { task, user } = await open();

        await user.keyboard('{Backspace}');

        expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeTruthy();
        expect((await stored(task.id))?.deleted_at).toBeNull();
    });

    // Last: Sonner keeps the "Task deleted." toast across tests.
    it('deletes the task and closes with Delete', async () => {
        const { task, user } = await open();

        await user.keyboard('{Delete}');

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect((await stored(task.id))?.deleted_at).not.toBeNull();
    });
});
