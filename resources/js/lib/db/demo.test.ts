import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { occurrenceId } from '@/lib/recurrence/expand';
import { db, wipeLocalDatabase } from './database';
import { demoIds } from './demo';
import { seedDemoTasks } from './demo-tasks';
import { queryPendingChangeCount, queryWeekTasks } from './queries';
import {
    createUndoLog,
    deleteTask,
    duplicateTask,
    moveTask,
    restoreTask,
    toggleDone,
    undoChanges,
    updateTask,
} from './tasks';
import type { Task } from './types';

// A Wednesday: the demo week runs from Monday 2026-10-12.
const TODAY = '2026-10-14';

async function liveTasks(): Promise<Task[]> {
    return (await db.tasks.toArray()).filter((t) => t.deleted_at === null);
}

async function demoTask(text: string): Promise<Task> {
    const task = (await db.tasks.toArray()).find((t) => t.text === text);

    if (!task) {
        throw new Error(`No demo task "${text}".`);
    }

    return task;
}

beforeEach(async () => {
    await wipeLocalDatabase();
});

describe('seedDemoTasks', () => {
    it('seeds the demo tasks in the current week, local only', async () => {
        expect(await seedDemoTasks(TODAY)).toBe(true);

        const tasks = await liveTasks();
        const week = await queryWeekTasks('2026-10-12');

        expect(tasks).toHaveLength(10);
        expect(week['2026-10-12'].map((t) => t.text)).toContain(
            'Drag me to another day',
        );
        expect(week['2026-10-12'].filter((t) => t.done)).toHaveLength(1);
        expect(week['2026-10-13'][0]).toMatchObject({
            text: 'Times go first',
            time: '17:30',
        });
        expect(week['2026-10-13'][1].color).toBe('yellow');
        expect(week['2026-10-13'][2].text).toBe(
            'Type a date first, like 31 Dec Party',
        );
        expect(week['2026-10-16'][0]).toMatchObject({
            text: 'Weekly review',
            kind: 'occurrence',
        });
        expect((await demoTask('Weekly review')).recurrence).toEqual({
            type: 'weekly',
            weekdays: [5],
        });
        expect((await demoTask('Ideas without a date live here')).date).toBe(
            null,
        );

        // Nothing waits to be pushed: demo tasks are not guest work.
        expect(await demoIds()).toEqual(new Set(tasks.map((t) => t.id)));
        expect(await db.outbox.count()).toBe(0);
        expect(await queryPendingChangeCount()).toBe(0);
    });

    it('seeds only once, even after every demo task is deleted', async () => {
        await seedDemoTasks(TODAY);

        for (const task of await liveTasks()) {
            await deleteTask(task.id);
        }

        expect(await seedDemoTasks(TODAY)).toBe(false);
        expect(await liveTasks()).toHaveLength(0);
        // Deleting a demo task never queues a tombstone.
        expect(await db.outbox.count()).toBe(0);
    });

    it('never leaves anything to push, even when cut short', async () => {
        await seedDemoTasks(TODAY);

        // Every row became demo in its own write, not in a final step.
        const ids = await demoIds();

        (await db.tasks.toArray()).forEach((task) =>
            expect(ids.has(task.id)).toBe(true),
        );
    });

    it('seeds once when two tabs race', async () => {
        const results = await Promise.all([
            seedDemoTasks(TODAY),
            seedDemoTasks(TODAY),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await liveTasks()).toHaveLength(10);
    });

    it('never seeds a device that already has tasks or a user', async () => {
        await db.tasks.put({
            id: 'existing',
            text: 'Mine',
            date: '2026-10-12',
            someday_column: null,
            position: 'a0',
            done: false,
            done_at: null,
            color: 'none',
            time: null,
            notes: '',
            subtasks: [],
            created_at: '2026-10-12T10:00:00.000Z',
            updated_at: '2026-10-12T10:00:00.000Z',
            deleted_at: null,
            recurrence: null,
            series_id: null,
            occurrence_date: null,
        });

        expect(await seedDemoTasks(TODAY)).toBe(false);

        await wipeLocalDatabase();
        await db.meta.put({ key: 'user_id', value: '1' });

        expect(await seedDemoTasks(TODAY)).toBe(false);
        expect(await db.tasks.count()).toBe(0);
    });
});

describe('demo status', () => {
    beforeEach(async () => {
        await seedDemoTasks(TODAY);
    });

    it('ends when the user edits a demo task', async () => {
        const task = await demoTask('Click a task to edit it');

        await updateTask(task.id, { text: 'Edited' });

        expect((await demoIds()).has(task.id)).toBe(false);
        expect(await db.outbox.get(task.id)).toBeDefined();
        expect(await queryPendingChangeCount()).toBe(1);
    });

    it('ends when the user completes, moves or duplicates one', async () => {
        const done = await demoTask('Hover to complete me');
        const moved = await demoTask('Drag me to another day');
        const source = await demoTask('Right-click for actions');

        await toggleDone(done.id);
        await moveTask(moved.id, { date: '2026-10-15' });
        const copy = await duplicateTask(source.id);

        const ids = await demoIds();

        expect(ids.has(done.id)).toBe(false);
        expect(ids.has(moved.id)).toBe(false);
        expect(ids.has(source.id)).toBe(false);
        expect(ids.has(copy.id)).toBe(false);
        expect(await db.outbox.count()).toBe(4);
    });

    it('releases a series with its exceptions when one occurrence changes', async () => {
        const series = await demoTask('Weekly review');
        const removed = occurrenceId(series.id, '2026-10-23');

        // Deleting an occurrence keeps everything demo (no tombstone pushed).
        await deleteTask(removed);
        expect(await db.outbox.count()).toBe(0);

        await toggleDone(occurrenceId(series.id, '2026-10-16'));

        const rows = (await db.tasks.toArray()).filter(
            (t) => t.id === series.id || t.series_id === series.id,
        );

        const ids = await demoIds();

        expect(rows).toHaveLength(3);
        rows.forEach((row) => expect(ids.has(row.id)).toBe(false));
        expect(
            (await db.outbox.bulkGet(rows.map((r) => r.id))).every(Boolean),
        ).toBe(true);
    });

    it('stays demo through a delete and its undo', async () => {
        const task = await demoTask('Click a task to edit it');
        const undo = createUndoLog();

        await deleteTask(task.id, { undo });
        await restoreTask(task.id);
        await deleteTask(task.id, { undo });
        await undoChanges(undo);

        expect((await demoIds()).has(task.id)).toBe(true);
        expect(await db.outbox.count()).toBe(0);
    });
});
