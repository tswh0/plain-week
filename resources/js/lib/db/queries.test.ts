import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { db, wipeLocalDatabase } from './database';
import {
    isArchivedSomeday,
    queryListTasks,
    queryPendingChangeCount,
    querySomedayTasks,
    queryTask,
    queryWeekTasks,
} from './queries';
import { createTask, deleteTask, toggleDone } from './tasks';

beforeEach(async () => {
    await wipeLocalDatabase();
});

describe('queries', () => {
    it('groups a week by day, sorted, without tombstones', async () => {
        await createTask({ text: 'Mon 1', date: '2026-10-12' });
        const removed = await createTask({ text: 'gone', date: '2026-10-12' });
        await createTask({ text: 'Mon 2', date: '2026-10-12' });
        await createTask({ text: 'Sun', date: '2026-10-18' });
        await createTask({ text: 'next week', date: '2026-10-19' });
        await createTask({ text: 'someday', date: null });
        await deleteTask(removed.id);

        const week = await queryWeekTasks('2026-10-12');

        expect(Object.keys(week)).toEqual([
            '2026-10-12',
            '2026-10-13',
            '2026-10-14',
            '2026-10-15',
            '2026-10-16',
            '2026-10-17',
            '2026-10-18',
        ]);
        expect(week['2026-10-12'].map((t) => t.text)).toEqual([
            'Mon 1',
            'Mon 2',
        ]);
        expect(week['2026-10-18'].map((t) => t.text)).toEqual(['Sun']);
        expect(week['2026-10-13']).toEqual([]);
    });

    it('handles weeks that cross a month boundary', async () => {
        await createTask({ text: 'Nov', date: '2026-11-02' });

        const week = await queryWeekTasks('2026-10-27');

        expect(week['2026-11-02'].map((t) => t.text)).toEqual(['Nov']);
    });

    it('lists Someday as one list, by column and then position', async () => {
        const a = await createTask({ text: 'a', date: null });
        const b = await createTask({ text: 'b', date: null });
        const c = await createTask({ text: 'c', date: null });
        await createTask({ text: 'dated', date: '2026-10-12' });
        // Rows written by older versions sit in any of the three columns.
        await db.tasks.update(a.id, { someday_column: 2 });
        await db.tasks.update(b.id, { someday_column: 1 });
        await db.tasks.update(c.id, { someday_column: 1 });

        const tasks = await querySomedayTasks('2026-10-12');

        expect(tasks.map((t) => t.text)).toEqual(['b', 'c', 'a']);
        expect(
            (await queryListTasks({ date: null })).map((t) => t.text),
        ).toEqual(['b', 'c', 'a']);
    });

    describe('archiving done Someday tasks', () => {
        // Weeks start on Monday: W2 = 12 Oct 2026, W3 = 19 Oct 2026.
        const W1 = '2026-10-05';
        const W2 = '2026-10-12';
        const W3 = '2026-10-19';

        /** A Someday task done at `doneAt` (local time). */
        async function doneSomeday(text: string, doneAt: Date | null) {
            const task = await createTask({
                text,
                date: null,
            });

            await toggleDone(task.id);
            await db.tasks.update(task.id, {
                done_at: doneAt?.toISOString() ?? null,
            });
        }

        async function shownIn(firstDay: string): Promise<string[]> {
            return (await querySomedayTasks(firstDay)).map((t) => t.text);
        }

        it('shows an unfinished task in every week', async () => {
            await createTask({ text: 'open', date: null });

            for (const week of [W1, W2, W3, '2027-03-01']) {
                expect(await shownIn(week)).toEqual(['open']);
            }
        });

        it('shows a task done in a week there and earlier, not later', async () => {
            await doneSomeday('done', new Date(2026, 9, 14, 18, 30));

            expect(await shownIn(W1)).toEqual(['done']);
            expect(await shownIn(W2)).toEqual(['done']);
            expect(await shownIn(W3)).toEqual([]);
        });

        it('uses local week bounds', async () => {
            await doneSomeday('first moment', new Date(2026, 9, 12, 0, 0));
            await doneSomeday('last moment', new Date(2026, 9, 18, 23, 59));

            expect(await shownIn(W2)).toEqual(['first moment', 'last moment']);
            expect(await shownIn(W3)).toEqual([]);
        });

        it('hides a done task without done_at', async () => {
            await doneSomeday('legacy', null);

            expect(await shownIn(W1)).toEqual([]);
        });

        it('brings a task back when it is undone', async () => {
            const task = await createTask({
                text: 'again',
                date: null,
            });

            await toggleDone(task.id);
            await db.tasks.update(task.id, {
                done_at: new Date(2026, 9, 14).toISOString(),
            });
            expect(await shownIn(W3)).toEqual([]);

            await toggleDone(task.id);
            expect(await shownIn(W3)).toEqual(['again']);
        });

        it('archives a done task with an unreadable done_at', () => {
            expect(isArchivedSomeday({ done: true, done_at: 'nope' }, W1)).toBe(
                true,
            );
        });

        it('only archives done tasks', () => {
            expect(isArchivedSomeday({ done: false, done_at: null }, W3)).toBe(
                false,
            );
            expect(
                isArchivedSomeday(
                    {
                        done: true,
                        done_at: new Date(2026, 9, 14).toISOString(),
                    },
                    W3,
                ),
            ).toBe(true);
        });
    });

    it('returns null for deleted or unknown tasks', async () => {
        const task = await createTask({ text: 'a', date: '2026-10-12' });

        expect((await queryTask(task.id))?.text).toBe('a');
        await deleteTask(task.id);
        expect(await queryTask(task.id)).toBeNull();
        expect(await queryTask('missing')).toBeNull();
    });

    it('counts the pending local changes', async () => {
        expect(await queryPendingChangeCount()).toBe(0);

        const task = await createTask({ text: 'a', date: '2026-10-12' });
        await createTask({ text: 'b', date: null });
        await deleteTask(task.id);

        expect(await queryPendingChangeCount()).toBe(2);
    });

    it('shows timed tasks first in a day, by time, then the rest by position', async () => {
        await createTask({ text: 'first untimed', date: '2026-10-12' });
        await createTask({ text: 'late', date: '2026-10-12', time: '18:00' });
        await createTask({ text: 'second untimed', date: '2026-10-12' });
        await createTask({ text: 'early', date: '2026-10-12', time: '07:30' });
        await createTask({
            text: 'early too',
            date: '2026-10-12',
            time: '07:30',
        });

        const week = await queryWeekTasks('2026-10-12');

        expect(week['2026-10-12'].map((task) => task.text)).toEqual([
            'early',
            'early too',
            'late',
            'first untimed',
            'second untimed',
        ]);
        // The repository order (used to place tasks) stays by position.
        expect(
            (await queryListTasks({ date: '2026-10-12' })).map((t) => t.text),
        ).toEqual([
            'first untimed',
            'late',
            'second untimed',
            'early',
            'early too',
        ]);
    });
});
