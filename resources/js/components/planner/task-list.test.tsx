// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
import { wipeLocalDatabase } from '@/lib/db/database';
import { createTask, listTasksIn } from '@/lib/db/tasks';

const DAY = '2026-10-12';
const LABEL = 'New task for Mon 12 Oct';

function Day({
    onOpenTask = () => {},
    rows = 10,
}: {
    onOpenTask?: (id: string) => void;
    rows?: number;
}) {
    const tasks = useLiveQuery(() => listTasksIn({ date: DAY }), []);

    return (
        <ScopePromptProvider>
            <TaskList
                placement={{ date: DAY }}
                tasks={tasks}
                rows={rows}
                newTaskLabel={LABEL}
                onOpenTask={onOpenTask}
            />
            <Toaster />
        </ScopePromptProvider>
    );
}

beforeEach(async () => {
    await wipeLocalDatabase();
});

afterEach(() => {
    cleanup();
});

describe('TaskList', () => {
    it('fills the day with empty rows', () => {
        render(<Day />);

        expect(screen.getAllByLabelText(LABEL)).toHaveLength(10);
    });

    it('creates a task with Enter, with smart time, and keeps typing below it', async () => {
        const user = userEvent.setup();
        render(<Day />);

        await user.click(screen.getAllByLabelText(LABEL)[3]);
        await user.keyboard('17:30 Gym{Enter}');

        const row = await screen.findByRole('button', { name: '17:30 Gym' });
        const [task] = await listTasksIn({ date: DAY });

        expect(task).toMatchObject({ text: 'Gym', time: '17:30' });
        expect(row.textContent).toContain('17:30');

        // Focus moved to the first empty row, now right below the new task.
        const emptyRows = screen.getAllByLabelText(LABEL);
        expect(emptyRows).toHaveLength(9);
        expect(document.activeElement).toBe(emptyRows[0]);
        expect(
            row
                .closest('[data-task-id]')
                ?.nextElementSibling?.contains(emptyRows[0]),
        ).toBe(true);

        await user.keyboard('Read{Enter}');
        await screen.findByRole('button', { name: 'Read' });

        expect((await listTasksIn({ date: DAY })).map((t) => t.text)).toEqual([
            'Gym',
            'Read',
        ]);
    });

    it('keeps focus in the row the user moved to while the previous one saves', async () => {
        const user = userEvent.setup();
        render(<Day rows={5} />);

        await user.click(screen.getAllByLabelText(LABEL)[0]);
        await user.keyboard('First');
        const lastRow = screen.getAllByLabelText(LABEL)[4];
        await user.click(lastRow);

        await screen.findByRole('button', { name: 'First' });
        expect(lastRow.isConnected).toBe(true);
        expect(document.activeElement).toBe(lastRow);

        await user.keyboard('Second{Enter}');
        await screen.findByRole('button', { name: 'Second' });
    });

    it('keeps typing after Enter when the list is full', async () => {
        const user = userEvent.setup();
        render(<Day rows={1} />);

        await user.click(screen.getByLabelText(LABEL));
        await user.keyboard('One{Enter}');
        await screen.findByRole('button', { name: 'One' });

        await waitFor(() =>
            expect(document.activeElement).toBe(screen.getByLabelText(LABEL)),
        );
        await user.keyboard('Two{Enter}');
        await screen.findByRole('button', { name: 'Two' });
    });

    it('cancels with Escape', async () => {
        const user = userEvent.setup();
        render(<Day />);

        await user.click(screen.getAllByLabelText(LABEL)[0]);
        await user.keyboard('Nope{Escape}');

        expect(document.activeElement).not.toBe(
            screen.getAllByLabelText(LABEL)[0],
        );
        expect(await listTasksIn({ date: DAY })).toEqual([]);
    });

    it('leaves the list with Escape right after Enter', async () => {
        const user = userEvent.setup();
        render(<Day />);

        await user.click(screen.getAllByLabelText(LABEL)[0]);
        await user.keyboard('One{Enter}{Escape}');
        await screen.findByRole('button', { name: 'One' });

        expect(document.activeElement).toBe(document.body);
    });

    describe('with a leading date', () => {
        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date(2026, 9, 12, 9, 0));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('creates the task on that day, says where, and keeps the row', async () => {
            const user = userEvent.setup();
            render(<Day />);

            const row = screen.getAllByLabelText(LABEL)[0];
            await user.click(row);
            await user.keyboard('14 oct 17:30 Gym{Enter}');

            expect(await screen.findByText('Added to Wed 14 Oct')).toBeTruthy();
            await waitFor(async () =>
                expect(await listTasksIn({ date: '2026-10-14' })).toEqual([
                    expect.objectContaining({ text: 'Gym', time: '17:30' }),
                ]),
            );
            expect(await listTasksIn({ date: DAY })).toEqual([]);
            expect(document.activeElement).toBe(row);
        });

        it('stays in the list when the date is this day', async () => {
            const user = userEvent.setup();
            render(<Day />);

            await user.click(screen.getAllByLabelText(LABEL)[0]);
            await user.keyboard('12 Oct Read{Enter}');

            await screen.findByRole('button', { name: 'Read' });
            expect(screen.queryByText('Added to Mon 12 Oct')).toBeNull();
        });

        it('says the year when the date is in another one', async () => {
            const user = userEvent.setup();
            render(<Day />);

            await user.click(screen.getAllByLabelText(LABEL)[0]);
            await user.keyboard('1 ene Trip{Enter}');

            expect(
                await screen.findByText('Added to Fri 1 Jan 2027'),
            ).toBeTruthy();
            expect(await listTasksIn({ date: '2027-01-01' })).toEqual([
                expect.objectContaining({ text: 'Trip' }),
            ]);
        });

        it('takes a Someday task out of Someday', async () => {
            const user = userEvent.setup();
            render(<Someday />);

            await user.click(screen.getAllByLabelText(SOMEDAY_LABEL)[0]);
            await user.keyboard('20 Oct Call{Enter}');

            expect(await screen.findByText('Added to Tue 20 Oct')).toBeTruthy();
            expect(await listTasksIn({ date: '2026-10-20' })).toEqual([
                expect.objectContaining({ text: 'Call' }),
            ]);
            expect(await listTasksIn({ date: null })).toEqual([]);
        });

        it('leaves a trailing date in the text', async () => {
            const user = userEvent.setup();
            render(<Day />);

            await user.click(screen.getAllByLabelText(LABEL)[0]);
            await user.keyboard('Gym 31 Dec{Enter}');

            await screen.findByRole('button', { name: 'Gym 31 Dec' });
        });
    });

    it('creates the task when the row loses focus with text', async () => {
        const user = userEvent.setup();
        render(<Day />);

        await user.click(screen.getAllByLabelText(LABEL)[0]);
        await user.keyboard('Blurred');
        await user.click(document.body);

        await screen.findByRole('button', { name: 'Blurred' });
    });

    it('ignores blank input', async () => {
        const user = userEvent.setup();
        render(<Day />);

        await user.click(screen.getAllByLabelText(LABEL)[0]);
        await user.keyboard('   {Enter}');
        await user.click(document.body);

        expect(await listTasksIn({ date: DAY })).toEqual([]);
    });

    it('opens a task on click, Enter or Space', async () => {
        const task = await createTask({ text: 'Open me', date: DAY });
        const onOpenTask = vi.fn();
        const user = userEvent.setup();
        render(<Day onOpenTask={onOpenTask} />);

        const row = await screen.findByRole('button', { name: 'Open me' });
        await user.click(row);
        row.focus();
        await user.keyboard('{Enter}');
        await user.keyboard(' ');

        expect(onOpenTask).toHaveBeenCalledTimes(3);
        expect(onOpenTask).toHaveBeenCalledWith(task.id);
    });

    it('opens a link in the text in a new tab instead of the task', async () => {
        await createTask({ text: 'Read https://example.com/a', date: DAY });
        const onOpenTask = vi.fn();
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const user = userEvent.setup();
        render(<Day onOpenTask={onOpenTask} />);

        await user.click(await screen.findByText('https://example.com/a'));

        expect(open).toHaveBeenCalledWith(
            'https://example.com/a',
            '_blank',
            'noopener,noreferrer',
        );
        expect(onOpenTask).not.toHaveBeenCalled();

        await user.click(screen.getByText('Read', { exact: false }));
        expect(onOpenTask).toHaveBeenCalledTimes(1);
        open.mockRestore();
    });

    it('toggles done without opening the task', async () => {
        await createTask({ text: 'Finish', date: DAY });
        const onOpenTask = vi.fn();
        const user = userEvent.setup();
        render(<Day onOpenTask={onOpenTask} />);

        await user.click(
            await screen.findByRole('button', { name: 'Mark as done' }),
        );

        await waitFor(async () => {
            expect((await listTasksIn({ date: DAY }))[0].done).toBe(true);
        });
        await screen.findByRole('button', { name: 'Mark as not done' });
        await screen.findByRole('button', { name: 'Finish (done)' });
        expect(onOpenTask).not.toHaveBeenCalled();
    });
});

const SOMEDAY_LABEL = 'New Someday task';

function Someday() {
    const tasks = useLiveQuery(() => listTasksIn({ date: null }), []);

    return (
        <ScopePromptProvider>
            <TaskList
                placement={{ date: null }}
                tasks={tasks}
                rows={2}
                columns={3}
                newTaskLabel={SOMEDAY_LABEL}
                onOpenTask={() => {}}
            />
            <Toaster />
        </ScopePromptProvider>
    );
}

describe('TaskList in columns', () => {
    const list = () =>
        document.querySelector<HTMLElement>('[data-list="someday"]')!;

    it('packs the tasks first and grows the columns as the list grows', async () => {
        render(<Someday />);

        expect(screen.getAllByLabelText(SOMEDAY_LABEL)).toHaveLength(6);
        expect(list().style.getPropertyValue('--list-rows')).toBe('2');

        for (const text of ['S0', 'S1', 'S2', 'S3', 'S4', 'S5']) {
            await createTask({ text, date: null });
        }

        // Six tasks and at least one empty row: three rows per column.
        await waitFor(() =>
            expect(list().style.getPropertyValue('--list-rows')).toBe('3'),
        );
        expect(screen.getAllByLabelText(SOMEDAY_LABEL)).toHaveLength(3);

        // In the DOM (the grid's flow order) no empty row sits between tasks.
        const order = [
            ...list().querySelectorAll('[data-task-id], [data-new-task-row]'),
        ].map((row) => (row.matches('[data-task-id]') ? 'task' : 'empty'));

        expect(order).toEqual([
            ...Array<string>(6).fill('task'),
            ...Array<string>(3).fill('empty'),
        ]);
    });

    it('keeps rows mounted when a task changes column', async () => {
        for (const text of ['S0', 'S1', 'S2', 'S3', 'S4']) {
            await createTask({ text, date: null });
        }

        render(<Someday />);

        // Two rows per column: S2 starts the second column.
        const row = (await screen.findByRole('button', { name: 'S2' })).closest(
            '[data-task-id]',
        );

        await createTask({ text: 'S5', date: null });
        await waitFor(() =>
            expect(list().style.getPropertyValue('--list-rows')).toBe('3'),
        );

        // Now S2 ends the first column, in the same element.
        expect(
            screen
                .getByRole('button', { name: 'S2' })
                .closest('[data-task-id]'),
        ).toBe(row);
    });
});
