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
import { queryTask } from '@/lib/db/queries';
import { createTask, setRecurrence } from '@/lib/db/tasks';
import type { Recurrence, Task } from '@/lib/db/types';
import { occurrenceId } from '@/lib/recurrence/expand';
import { toastAction } from '@/test/toasts';
import { TaskDialog } from './task-dialog';

/** A Monday; the series below repeats on Monday, Wednesday and Friday. */
const MONDAY = '2026-10-12';
const WEDNESDAY = '2026-10-14';
const WEEKLY: Recurrence = { type: 'weekly', weekdays: [1, 3, 5] };

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

/** Opens a task with no series; an occurrence goes through `openOccurrence`. */
async function openDialog(taskId: string) {
    const user = userEvent.setup();

    render(<Harness taskId={taskId} />);
    const dialog = await screen.findByRole('dialog', { name: 'Edit task' });

    return { user, dialog };
}

/**
 * A weekly series from Monday and the dialog of one of its occurrences
 * (Wednesday by default), once its series has loaded: the dialog opens with
 * the occurrence, and the series (its rule, whether edits ask for a scope)
 * arrives from a live query of its own.
 */
async function openOccurrence(date = WEDNESDAY) {
    const task = await createTask({ text: 'Gym', date: MONDAY });
    await setRecurrence(task.id, WEEKLY);
    const id = occurrenceId(task.id, date);
    const opened = await openDialog(id);

    await within(opened.dialog).findByRole('button', {
        name: 'Repeat: Every Mon, Wed, Fri',
    });

    return { seriesId: task.id, id, ...opened };
}

async function rows(): Promise<Task[]> {
    return db.tasks.toArray();
}

function scopePrompt() {
    return screen.findByRole('alertdialog');
}

beforeEach(async () => {
    await wipeLocalDatabase();
});

afterEach(() => {
    cleanup();
});

describe('Repeat picker', () => {
    it('defaults to the weekday of the task and keeps it selected', async () => {
        const task = await createTask({ text: 'Gym', date: WEDNESDAY });
        const { user, dialog } = await openDialog(task.id);

        await user.click(
            within(dialog).getByRole('button', { name: 'Repeat' }),
        );
        expect(
            (await screen.findByRole('radio', { name: 'Never' })).getAttribute(
                'aria-checked',
            ),
        ).toBe('true');

        await user.click(screen.getByRole('radio', { name: 'Weekly' }));
        const wednesday = screen.getByRole('button', { name: 'Wednesday' });
        expect(wednesday.getAttribute('aria-pressed')).toBe('true');

        // The task's own weekday cannot be removed.
        await user.click(wednesday);
        expect(wednesday.getAttribute('aria-pressed')).toBe('true');

        await user.click(screen.getByRole('button', { name: 'Monday' }));
        await user.click(screen.getByRole('button', { name: 'Apply' }));

        await waitFor(async () =>
            expect((await db.tasks.get(task.id))?.recurrence).toEqual({
                type: 'weekly',
                weekdays: [1, 3],
            }),
        );
        // The dialog stays on the task, now an occurrence of the series.
        await within(dialog).findByRole('button', {
            name: 'Repeat: Every Mon, Wed',
        });
        expect(screen.getByRole('dialog', { name: 'Edit task' })).toBe(dialog);
    });

    it('defaults to the day of the month, with the shorter-month note', async () => {
        const task = await createTask({ text: 'Rent', date: '2026-10-31' });
        const { user, dialog } = await openDialog(task.id);

        await user.click(
            within(dialog).getByRole('button', { name: 'Repeat' }),
        );
        await user.click(await screen.findByRole('radio', { name: 'Monthly' }));

        expect(
            screen.getByRole('combobox', { name: 'Day of the month' })
                .textContent,
        ).toBe('31');
        screen.getByText('On the last day in shorter months.');

        await user.click(screen.getByRole('button', { name: 'Apply' }));

        await waitFor(async () =>
            expect((await db.tasks.get(task.id))?.recurrence).toEqual({
                type: 'monthly',
                day: 31,
            }),
        );
    });

    it('repeats every N days, refusing numbers out of range', async () => {
        const task = await createTask({ text: 'Water plants', date: MONDAY });
        const { user, dialog } = await openDialog(task.id);

        await user.click(
            within(dialog).getByRole('button', { name: 'Repeat' }),
        );
        await user.click(await screen.findByRole('radio', { name: 'Daily' }));

        const days = screen.getByRole('spinbutton', {
            name: 'Number of days',
        });
        expect((days as HTMLInputElement).value).toBe('2');

        const apply = screen.getByRole('button', { name: 'Apply' });

        for (const invalid of ['0', '366', '']) {
            await user.clear(days);
            if (invalid) {
                await user.type(days, invalid);
            }
            expect(apply.hasAttribute('disabled')).toBe(true);
            screen.getByText('Enter a number of days from 1 to 365.');
        }

        // Switching away and back keeps the field usable.
        await user.click(screen.getByRole('radio', { name: 'Weekly' }));
        await user.click(screen.getByRole('radio', { name: 'Daily' }));
        const again = screen.getByRole('spinbutton', {
            name: 'Number of days',
        }) as HTMLInputElement;
        expect(again.value).toBe('');
        expect(again.getAttribute('aria-describedby')).toBe(
            screen.getByText('Enter a number of days from 1 to 365.').id,
        );

        await user.type(again, '21');
        expect(apply.hasAttribute('disabled')).toBe(false);
        await user.click(apply);

        await waitFor(async () =>
            expect((await db.tasks.get(task.id))?.recurrence).toEqual({
                type: 'daily',
                every: 21,
            }),
        );
        await user.click(
            await within(dialog).findByRole('button', {
                name: 'Repeat: Every 21 days',
            }),
        );
        // Editing starts from the stored number.
        expect(
            (
                (await screen.findByRole('spinbutton', {
                    name: 'Number of days',
                })) as HTMLInputElement
            ).value,
        ).toBe('21');
    });

    it('follows the task to its first date when the day of the month skips it', async () => {
        const task = await createTask({ text: 'Rent', date: '2026-10-31' });
        const { user, dialog } = await openDialog(task.id);

        await user.click(
            within(dialog).getByRole('button', { name: 'Repeat' }),
        );
        await user.click(await screen.findByRole('radio', { name: 'Monthly' }));
        await user.click(
            screen.getByRole('combobox', { name: 'Day of the month' }),
        );
        await user.click(await screen.findByRole('option', { name: '1' }));
        screen.getByText('Starts on Sun, 1 Nov 2026.');
        await user.click(screen.getByRole('button', { name: 'Apply' }));

        await within(dialog).findByRole('button', {
            name: 'Date: Sun, 1 Nov 2026',
        });
        expect(screen.getByRole('dialog', { name: 'Edit task' })).toBe(dialog);
    });

    it('asks before changing the rule of an occurrence; "This and all future" splits the series', async () => {
        const { user, dialog, seriesId } = await openOccurrence();

        await user.click(
            within(dialog).getByRole('button', {
                name: 'Repeat: Every Mon, Wed, Fri',
            }),
        );
        expect(screen.queryByText('Applies to the whole series.')).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Friday' }));
        await user.click(screen.getByRole('button', { name: 'Apply' }));
        await user.click(
            within(await scopePrompt()).getByRole('button', {
                name: 'This and all future',
            }),
        );

        await within(dialog).findByRole('button', {
            name: 'Repeat: Every Mon, Wed',
        });
        expect((await db.tasks.get(seriesId))?.recurrence).toEqual({
            ...WEEKLY,
            until: '2026-10-13',
        });
    });

    it('gives only this occurrence the new rule, as a series of its own', async () => {
        const { user, dialog, seriesId, id } = await openOccurrence();

        await user.click(
            within(dialog).getByRole('button', {
                name: 'Repeat: Every Mon, Wed, Fri',
            }),
        );
        await user.click(screen.getByRole('button', { name: 'Friday' }));
        await user.click(screen.getByRole('button', { name: 'Apply' }));
        await user.click(
            within(await scopePrompt()).getByRole('button', {
                name: 'Only this task',
            }),
        );

        await within(dialog).findByRole('button', {
            name: 'Repeat: Every Mon, Wed',
        });
        // The old series goes on unchanged, without this date.
        expect((await db.tasks.get(seriesId))?.recurrence).toEqual(WEEKLY);
        expect(await queryTask(id)).toBeNull();
        expect(
            (await rows()).filter(
                (row) =>
                    row.date === WEDNESDAY &&
                    row.id !== seriesId &&
                    row.deleted_at === null,
            ),
        ).toMatchObject([
            {
                recurrence: { type: 'weekly', weekdays: [1, 3] },
                series_id: null,
            },
        ]);
    });

    it('writes nothing when the rule prompt is cancelled', async () => {
        const { user, dialog, seriesId } = await openOccurrence();
        const before = await rows();

        await user.click(
            within(dialog).getByRole('button', {
                name: 'Repeat: Every Mon, Wed, Fri',
            }),
        );
        await user.click(screen.getByRole('button', { name: 'Friday' }));
        await user.click(screen.getByRole('button', { name: 'Apply' }));
        await user.click(
            within(await scopePrompt()).getByRole('button', {
                name: 'Cancel',
            }),
        );

        within(dialog).getByRole('button', {
            name: 'Repeat: Every Mon, Wed, Fri',
        });
        expect(await rows()).toEqual(before);
        expect((await db.tasks.get(seriesId))?.recurrence).toEqual(WEEKLY);
    });

    it('changes the whole series from its first occurrence without asking', async () => {
        const { user, dialog, seriesId } = await openOccurrence(MONDAY);

        await user.click(
            within(dialog).getByRole('button', {
                name: 'Repeat: Every Mon, Wed, Fri',
            }),
        );
        screen.getByText('Applies to the whole series.');
        await user.click(screen.getByRole('button', { name: 'Friday' }));
        await user.click(screen.getByRole('button', { name: 'Apply' }));

        await within(dialog).findByRole('button', {
            name: 'Repeat: Every Mon, Wed',
        });
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(await rows()).toMatchObject([
            { id: seriesId, recurrence: { type: 'weekly', weekdays: [1, 3] } },
        ]);
    });

    it('stops the whole series from its first occurrence without asking', async () => {
        const { user, dialog } = await openOccurrence(MONDAY);

        await user.click(
            within(dialog).getByRole('button', {
                name: 'Repeat: Every Mon, Wed, Fri',
            }),
        );
        await user.click(await screen.findByRole('radio', { name: 'Never' }));
        screen.getByText('Stops the whole series.');
        await user.click(screen.getByRole('button', { name: 'Apply' }));

        await within(dialog).findByRole('button', { name: 'Repeat' });
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(
            (await rows())
                .filter((row) => row.deleted_at === null)
                .map((row) => [row.date, row.recurrence]),
        ).toEqual([[MONDAY, null]]);
    });

    it('stops repeating only this task after asking', async () => {
        const { user, dialog, seriesId, id } = await openOccurrence();

        await user.click(
            within(dialog).getByRole('button', {
                name: 'Repeat: Every Mon, Wed, Fri',
            }),
        );
        await user.click(await screen.findByRole('radio', { name: 'Never' }));
        await user.click(screen.getByRole('button', { name: 'Apply' }));
        await user.click(
            within(await scopePrompt()).getByRole('button', {
                name: 'Only this task',
            }),
        );

        await within(dialog).findByRole('button', { name: 'Repeat' });
        expect((await db.tasks.get(seriesId))?.recurrence).toEqual(WEEKLY);
        // The occurrence itself is hidden; a plain copy took its place.
        expect(await queryTask(id)).toBeNull();
        expect(
            (await rows()).filter(
                (row) =>
                    row.date === WEDNESDAY &&
                    row.recurrence === null &&
                    row.series_id === null &&
                    row.deleted_at === null,
            ),
        ).toHaveLength(1);
    });

    it('is disabled for a Someday task', async () => {
        const task = await createTask({
            text: 'Read',
            date: null,
        });
        const { dialog } = await openDialog(task.id);

        expect(
            within(dialog)
                .getByRole('button', { name: 'Repeat' })
                .hasAttribute('disabled'),
        ).toBe(true);
    });
});

describe('Scope prompt', () => {
    it('asks once, then edits only this occurrence', async () => {
        const { user, dialog, seriesId, id } = await openOccurrence();
        const title = within(dialog).getByLabelText('Task');

        // The prompt opens on the first keystroke and takes the focus.
        await user.type(title, '!');
        const prompt = await scopePrompt();
        await user.click(
            within(prompt).getByRole('button', { name: 'Only this task' }),
        );
        await waitFor(() =>
            expect(screen.queryByRole('alertdialog')).toBeNull(),
        );

        await user.type(title, 'AM');
        await user.click(
            within(dialog).getByRole('button', { name: 'Mark as done' }),
        );

        await waitFor(async () =>
            expect(await queryTask(id)).toMatchObject({
                kind: 'exception',
                text: 'Gym!AM',
                done: true,
            }),
        );
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect((await db.tasks.get(seriesId))?.text).toBe('Gym');
    });

    it('edits this and all future ones, following the new series', async () => {
        const { user, dialog, seriesId, id } = await openOccurrence();
        const title = within(dialog).getByLabelText('Task');

        await user.type(title, '!');
        await user.click(
            within(await scopePrompt()).getByRole('button', {
                name: 'This and all future',
            }),
        );
        await user.type(title, 'AM');
        await user.type(within(dialog).getByLabelText('Notes'), 'Legs');

        await waitFor(async () =>
            expect(
                (await rows()).find(
                    (row) => row.recurrence && row.id !== seriesId,
                ),
            ).toMatchObject({ text: 'Gym!AM', notes: 'Legs', date: WEDNESDAY }),
        );
        // The old series ends the day before; its Wednesday id is gone, but
        // the dialog followed the new series and stayed open.
        expect((await db.tasks.get(seriesId))?.recurrence?.until).toBe(
            '2026-10-13',
        );
        expect(await queryTask(id)).toBeNull();
        expect(screen.getByRole('dialog', { name: 'Edit task' })).toBe(dialog);
        expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('puts the text back and writes nothing when cancelled', async () => {
        const { user, dialog } = await openOccurrence();
        const title = within(dialog).getByLabelText(
            'Task',
        ) as HTMLTextAreaElement;
        const before = await rows();

        await user.type(title, 'X');
        await user.click(
            within(await scopePrompt()).getByRole('button', { name: 'Cancel' }),
        );

        await waitFor(() => expect(title.value).toBe('Gym'));
        expect(await rows()).toEqual(before);
    });

    it('never asks for done or a move', async () => {
        const { user, dialog, id } = await openOccurrence();

        await user.click(
            within(dialog).getByRole('button', { name: 'Mark as done' }),
        );
        await user.click(within(dialog).getByRole('button', { name: 'More' }));
        await user.click(
            await screen.findByRole('menuitem', { name: 'Tomorrow' }),
        );

        await within(dialog).findByRole('button', {
            name: 'Date: Thu, 15 Oct 2026',
        });
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(await queryTask(id)).toMatchObject({
            kind: 'exception',
            done: true,
            date: '2026-10-15',
        });
        await toastAction('Moved to Thu 15 Oct.');
    });

    it('asks before deleting; "Only this task" hides one occurrence, with undo', async () => {
        const { user, dialog, seriesId, id } = await openOccurrence();

        await user.click(
            within(dialog).getByRole('button', { name: 'Delete' }),
        );
        await user.click(
            within(await scopePrompt()).getByRole('button', {
                name: 'Only this task',
            }),
        );

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(await queryTask(id)).toBeNull();
        expect(await queryTask(occurrenceId(seriesId, '2026-10-16'))).not.toBe(
            null,
        );

        await user.click(await toastAction('Task deleted.'));
        await waitFor(async () => expect(await queryTask(id)).not.toBeNull());
    });

    it('deletes this and all future ones', async () => {
        const { user, dialog, seriesId } = await openOccurrence();

        await user.click(
            within(dialog).getByRole('button', { name: 'Delete' }),
        );
        await user.click(
            within(await scopePrompt()).getByRole('button', {
                name: 'This and all future',
            }),
        );

        await waitFor(async () =>
            expect((await db.tasks.get(seriesId))?.recurrence?.until).toBe(
                '2026-10-13',
            ),
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
});

describe('Scope prompt focus', () => {
    it('gives focus back to the task dialog when the prompt is cancelled from a closed popover', async () => {
        const { user, dialog } = await openOccurrence();

        await user.keyboard('c');
        await user.click(await screen.findByRole('radio', { name: 'Pink' }));
        await scopePrompt();
        await user.keyboard('{Escape}');

        await waitFor(() =>
            expect(screen.queryByRole('alertdialog')).toBeNull(),
        );
        expect(dialog.contains(document.activeElement)).toBe(true);
        // Its keys work again.
        await user.keyboard('t');
        await screen.findByLabelText('Time');
    });
});
