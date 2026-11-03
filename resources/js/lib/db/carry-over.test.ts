import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { db, wipeLocalDatabase } from './database';
import { seedDemoTasks } from './demo-tasks';
import {
    carryOverTasks,
    createTask,
    deleteTask,
    listTasksIn,
    setRecurrence,
    toggleDone,
    updateTask,
} from './tasks';

const TODAY = '2026-10-15';
const YESTERDAY = '2026-10-14';
const LAST_WEEK = '2026-10-08';
const TOMORROW = '2026-10-16';

async function texts(date: string): Promise<string[]> {
    return (await listTasksIn({ date })).map((task) => task.text);
}

beforeEach(async () => {
    await wipeLocalDatabase();
});

describe('carryOverTasks', () => {
    it('moves unfinished past tasks after today’s, oldest day first', async () => {
        await createTask({ text: 'Today', date: TODAY });
        await createTask({ text: 'Yesterday A', date: YESTERDAY });
        await createTask({ text: 'Yesterday B', date: YESTERDAY });
        await createTask({ text: 'Last week', date: LAST_WEEK });

        expect(await carryOverTasks(TODAY)).toBe(3);

        expect(await texts(TODAY)).toEqual([
            'Today',
            'Last week',
            'Yesterday A',
            'Yesterday B',
        ]);
        expect(await texts(YESTERDAY)).toEqual([]);
        expect(await texts(LAST_WEEK)).toEqual([]);
    });

    it('leaves today, future, done, deleted and Someday tasks alone', async () => {
        await createTask({ text: 'Today', date: TODAY });
        await createTask({ text: 'Tomorrow', date: TOMORROW });
        const done = await createTask({ text: 'Done', date: YESTERDAY });
        const deleted = await createTask({ text: 'Deleted', date: YESTERDAY });
        await createTask({ text: 'Idea', date: null });

        await toggleDone(done.id);
        await deleteTask(deleted.id);

        expect(await carryOverTasks(TODAY)).toBe(0);
        expect(await texts(TODAY)).toEqual(['Today']);
        expect(await texts(TOMORROW)).toEqual(['Tomorrow']);
        expect(await texts(YESTERDAY)).toEqual(['Done']);
        expect((await db.tasks.get(deleted.id))?.date).toBe(YESTERDAY);
        expect(await listTasksIn({ date: null })).toHaveLength(1);
    });

    it('never carries recurring tasks: series, occurrences or exceptions', async () => {
        const series = await createTask({ text: 'Gym', date: LAST_WEEK });

        // A daily series from last week, with one edited (exception) occurrence.
        await setRecurrence(series.id, { type: 'daily', every: 1 });
        await updateTask(`${series.id}:${YESTERDAY}`, { text: 'Gym (late)' });

        expect(await carryOverTasks(TODAY)).toBe(0);
        expect(await texts(YESTERDAY)).toEqual(['Gym (late)']);
        expect(await texts(TODAY)).toEqual(['Gym']);
        expect(await db.tasks.count()).toBe(2);
    });

    it('is idempotent', async () => {
        await createTask({ text: 'Late', date: YESTERDAY });

        expect(await carryOverTasks(TODAY)).toBe(1);
        const [moved] = await listTasksIn({ date: TODAY });

        expect(await carryOverTasks(TODAY)).toBe(0);
        expect(await listTasksIn({ date: TODAY })).toEqual([moved]);
    });

    it('runs concurrently without moving a task twice', async () => {
        await createTask({ text: 'Late', date: YESTERDAY });

        const counts = await Promise.all([
            carryOverTasks(TODAY),
            carryOverTasks(TODAY),
        ]);

        expect(counts.sort((a, b) => a - b)).toEqual([0, 1]);
        expect(await texts(TODAY)).toEqual(['Late']);
    });

    it('keeps the subtasks and queues the move for sync', async () => {
        const task = await createTask({
            text: 'Late',
            date: YESTERDAY,
            subtasks: [{ id: 's1', text: 'Step', done: true }],
        });
        await db.outbox.clear();

        await carryOverTasks(TODAY);

        const row = await db.tasks.get(task.id);

        expect(row?.date).toBe(TODAY);
        expect(row?.subtasks).toEqual(task.subtasks);
        expect(row && row.updated_at > task.updated_at).toBe(true);
        expect(await db.outbox.get(task.id)).toMatchObject({ revision: 1 });
    });

    it('leaves untouched demo tasks on the day they teach', async () => {
        // The demo week starts on Monday 2026-10-12, before TODAY.
        await seedDemoTasks(TODAY);

        expect(await carryOverTasks(TODAY)).toBe(0);
        expect(await db.outbox.count()).toBe(0);
    });

    it('never moves demo tasks seeded while it runs', async () => {
        await Promise.all([seedDemoTasks(TODAY), carryOverTasks(TODAY)]);

        expect(await carryOverTasks(TODAY)).toBe(0);
        expect(await db.outbox.count()).toBe(0);
    });
});
