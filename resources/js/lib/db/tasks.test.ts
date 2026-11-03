import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { onLocalChange } from './changes';
import { db, wipeLocalDatabase } from './database';
import {
    createTask,
    deleteTask,
    duplicateTask,
    listTasksIn,
    moveTask,
    restoreTask,
    toggleDone,
    updateSubtasks,
    updateTask,
} from './tasks';

const DAY = '2026-10-12';
const OTHER_DAY = '2026-10-13';

async function texts(date: string | null) {
    const tasks = await listTasksIn(date === null ? { date: null } : { date });

    return tasks.map((task) => task.text);
}

beforeEach(async () => {
    await wipeLocalDatabase();
});

describe('task repository', () => {
    it('creates a task with defaults and an outbox entry', async () => {
        const task = await createTask({ text: 'Buy milk', date: DAY });

        expect(task).toMatchObject({
            text: 'Buy milk',
            date: DAY,
            someday_column: null,
            done: false,
            done_at: null,
            color: 'none',
            time: null,
            notes: '',
            subtasks: [],
            deleted_at: null,
        });
        expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(task.id[14]).toBe('7');
        expect(task.created_at).toBe(task.updated_at);
        expect(await db.tasks.get(task.id)).toEqual(task);
        expect(await db.outbox.get(task.id)).toEqual({
            task_id: task.id,
            revision: 1,
        });
    });

    it('creates Someday tasks without a date', async () => {
        const task = await createTask({
            text: 'Read',
            date: null,
        });

        expect(task).toMatchObject({ date: null });
    });

    it('bumps updated_at and the outbox revision on every mutation', async () => {
        const task = await createTask({ text: 'A', date: DAY });
        const updated = await updateTask(task.id, {
            text: 'B',
            color: 'mango',
        });

        expect(updated.text).toBe('B');
        expect(updated.color).toBe('mango');
        expect(updated.updated_at > task.updated_at).toBe(true);
        expect((await db.outbox.get(task.id))?.revision).toBe(2);
    });

    it('toggles done and done_at', async () => {
        const task = await createTask({ text: 'A', date: DAY });
        const done = await toggleDone(task.id);

        expect(done.done).toBe(true);
        expect(done.done_at).toBe(done.updated_at);

        const undone = await toggleDone(task.id);

        expect(undone.done).toBe(false);
        expect(undone.done_at).toBeNull();
    });

    it('deletes with a tombstone that is still queued for sync', async () => {
        const task = await createTask({ text: 'A', date: DAY });
        const deleted = await deleteTask(task.id);

        expect(deleted.deleted_at).toBe(deleted.updated_at);
        expect(await db.tasks.get(task.id)).toBeDefined();
        expect(await texts(DAY)).toEqual([]);
        expect(await db.outbox.get(task.id)).toBeDefined();
        await expect(updateTask(task.id, { text: 'B' })).rejects.toThrow();
    });

    it('restores a deleted task with a newer change', async () => {
        const task = await createTask({ text: 'A', date: DAY });
        const deleted = await deleteTask(task.id);
        const restored = await restoreTask(task.id);

        expect(restored.deleted_at).toBeNull();
        expect(restored.updated_at > deleted.updated_at).toBe(true);
        expect(await texts(DAY)).toEqual(['A']);
        expect((await db.outbox.get(task.id))?.revision).toBe(3);
    });

    it('keeps every one of several quick subtask edits', async () => {
        const task = await createTask({ text: 'A', date: DAY });

        await Promise.all(
            ['one', 'two', 'three'].map((text) =>
                updateSubtasks(task.id, (subtasks) => [
                    ...subtasks,
                    { id: text, text, done: false },
                ]),
            ),
        );

        expect(
            (await db.tasks.get(task.id))?.subtasks.map((s) => s.text),
        ).toEqual(['one', 'two', 'three']);
    });

    it('keeps both of two concurrent edits', async () => {
        const task = await createTask({ text: 'A', date: DAY });

        await Promise.all([
            updateTask(task.id, { text: 'B' }),
            updateTask(task.id, { color: 'green' }),
            toggleDone(task.id),
        ]);

        expect(await db.tasks.get(task.id)).toMatchObject({
            text: 'B',
            color: 'green',
            done: true,
        });
        expect((await db.outbox.get(task.id))?.revision).toBe(4);
    });

    it('toggles twice when clicked twice quickly', async () => {
        const task = await createTask({ text: 'A', date: DAY });

        await Promise.all([toggleDone(task.id), toggleDone(task.id)]);

        expect((await db.tasks.get(task.id))?.done).toBe(false);
    });

    it('does not resurrect a task deleted concurrently', async () => {
        const task = await createTask({ text: 'A', date: DAY });

        const results = await Promise.allSettled([
            deleteTask(task.id),
            updateTask(task.id, { text: 'B' }),
        ]);

        expect(results[1].status).toBe('rejected');
        expect((await db.tasks.get(task.id))?.deleted_at).not.toBeNull();
    });

    it('ignores undefined and unknown patch fields', async () => {
        const task = await createTask({ text: 'A', date: DAY, color: 'pink' });
        const updated = await updateTask(task.id, {
            color: undefined,
            ...({ date: '2030-01-01', id: 'x' } as object),
        });

        expect(updated).toMatchObject({
            id: task.id,
            date: DAY,
            color: 'pink',
        });
    });

    it('notifies listeners after a mutation', async () => {
        let calls = 0;
        const unsubscribe = onLocalChange(() => calls++);

        await createTask({ text: 'A', date: DAY });
        unsubscribe();

        expect(calls).toBe(1);
    });

    it('duplicates a task right after the original with new ids', async () => {
        const first = await createTask({
            text: 'A',
            date: DAY,
            subtasks: [{ id: 's1', text: 'step', done: true }],
        });
        await createTask({ text: 'B', date: DAY });

        const copy = await duplicateTask(first.id);

        expect(copy.id).not.toBe(first.id);
        expect(copy.subtasks[0].id).not.toBe('s1');
        expect(copy.subtasks[0]).toMatchObject({ text: 'step', done: true });
        expect(await texts(DAY)).toEqual(['A', 'A', 'B']);
        expect(await db.outbox.get(copy.id)).toBeDefined();
    });
});

describe('positions', () => {
    it('appends new tasks at the end of their day', async () => {
        await createTask({ text: 'A', date: DAY });
        await createTask({ text: 'B', date: DAY });
        await createTask({ text: 'C', date: DAY });
        await createTask({ text: 'X', date: OTHER_DAY });

        expect(await texts(DAY)).toEqual(['A', 'B', 'C']);
    });

    it('inserts between neighbours', async () => {
        const a = await createTask({ text: 'A', date: DAY });
        const b = await createTask({ text: 'B', date: DAY });

        await createTask({
            text: 'between',
            date: DAY,
            afterId: a.id,
            beforeId: b.id,
        });
        await createTask({ text: 'first', date: DAY, beforeId: a.id });

        expect(await texts(DAY)).toEqual(['first', 'A', 'between', 'B']);
    });

    it('moves a task within a day', async () => {
        const a = await createTask({ text: 'A', date: DAY });
        const b = await createTask({ text: 'B', date: DAY });
        const c = await createTask({ text: 'C', date: DAY });

        await moveTask(c.id, { date: DAY, beforeId: a.id });
        expect(await texts(DAY)).toEqual(['C', 'A', 'B']);

        await moveTask(c.id, { date: DAY, afterId: a.id });
        expect(await texts(DAY)).toEqual(['A', 'C', 'B']);

        await moveTask(a.id, { date: DAY, afterId: c.id, beforeId: b.id });
        expect(await texts(DAY)).toEqual(['C', 'A', 'B']);

        await moveTask(c.id, { date: DAY });
        expect(await texts(DAY)).toEqual(['A', 'B', 'C']);
    });

    it('moves a task between a day and Someday', async () => {
        const a = await createTask({ text: 'A', date: DAY });
        const s = await createTask({
            text: 'S',
            date: null,
        });

        const moved = await moveTask(a.id, {
            date: null,
            beforeId: s.id,
        });

        expect(moved).toMatchObject({ date: null });
        expect(await texts(DAY)).toEqual([]);
        expect(await texts(null)).toEqual(['A', 'S']);

        const back = await moveTask(a.id, { date: OTHER_DAY });

        expect(back).toMatchObject({ date: OTHER_DAY, someday_column: null });
        expect(await texts(null)).toEqual(['S']);
    });

    describe('the Someday list', () => {
        /** Someday tasks spread over the columns, as older versions wrote them. */
        async function legacySomeday(columns: (0 | 1 | 2)[]) {
            const tasks = [];

            for (const [i, column] of columns.entries()) {
                const task = await createTask({ text: `S${i}`, date: null });
                await db.tasks.update(task.id, { someday_column: column });
                tasks.push({ ...task, someday_column: column });
            }

            return tasks;
        }

        async function column(id: string) {
            return (await db.tasks.get(id))?.someday_column;
        }

        it('creates the first task in column 0', async () => {
            const task = await createTask({ text: 'A', date: null });

            expect(task.someday_column).toBe(0);
        });

        it('appends a new task after the last one, in its column', async () => {
            const [, , last] = await legacySomeday([0, 1, 2]);
            const task = await createTask({ text: 'new', date: null });

            expect(task.someday_column).toBe(last.someday_column);
            expect(await texts(null)).toEqual(['S0', 'S1', 'S2', 'new']);
        });

        it('moves between neighbours in different columns', async () => {
            const [s0, s1, s2] = await legacySomeday([0, 1, 1]);
            const a = await createTask({ text: 'A', date: DAY });

            await moveTask(a.id, {
                date: null,
                afterId: s0.id,
                beforeId: s1.id,
            });
            expect(await texts(null)).toEqual(['S0', 'A', 'S1', 'S2']);
            expect(await column(a.id)).toBe(0);

            await moveTask(a.id, {
                date: null,
                afterId: s1.id,
                beforeId: s2.id,
            });
            expect(await texts(null)).toEqual(['S0', 'S1', 'A', 'S2']);
            expect(await column(a.id)).toBe(1);

            await moveTask(a.id, { date: null, beforeId: s0.id });
            expect(await texts(null)).toEqual(['A', 'S0', 'S1', 'S2']);
            expect(await column(a.id)).toBe(0);
        });

        it('only writes the task that moves', async () => {
            const tasks = await legacySomeday([0, 2]);
            const before = await db.tasks.bulkGet(tasks.map((t) => t.id));

            await moveTask(tasks[1].id, { date: null, beforeId: tasks[0].id });

            expect(await texts(null)).toEqual(['S1', 'S0']);
            expect(await db.tasks.get(tasks[0].id)).toEqual(before[0]);
        });

        it('duplicates a task right after it', async () => {
            const [s0, s1] = await legacySomeday([0, 1]);
            const copy = await duplicateTask(s0.id);

            expect(copy.someday_column).toBe(0);
            expect(await texts(null)).toEqual(['S0', 'S0', 'S1']);
            expect((await listTasksIn({ date: null })).at(-1)?.id).toBe(s1.id);
        });
    });

    it('breaks position ties by id', async () => {
        await db.tasks.bulkPut([
            {
                ...(await createTask({ text: 'second', date: DAY })),
                id: 'b',
                position: 'a0',
            },
            {
                ...(await createTask({ text: 'first', date: DAY })),
                id: 'a',
                position: 'a0',
            },
        ]);

        const listed = await listTasksIn({ date: DAY });

        expect(
            listed.filter((t) => t.id.length === 1).map((t) => t.text),
        ).toEqual(['first', 'second']);
    });
});
