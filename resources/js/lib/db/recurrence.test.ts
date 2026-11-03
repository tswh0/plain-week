import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { occurrenceId } from '@/lib/recurrence/expand';
import type { Recurrence, Task } from './types';
import { db, wipeLocalDatabase } from './database';
import { nextTimestamp } from './dates';
import { getSeries, queryTask, queryWeekTasks } from './queries';
import {
    createTask,
    createUndoLog,
    deleteTask,
    duplicateTask,
    listTasksIn,
    moveTask,
    restoreTask,
    setRecurrence,
    toggleDone,
    undoChanges,
    updateSubtasks,
    updateTask,
} from './tasks';

const MON = '2026-10-12';
const TUE = '2026-10-13';
const WED = '2026-10-14';
const FRI = '2026-10-16';
const NEXT_MON = '2026-10-19';
const NEXT_WED = '2026-10-21';
const NEXT_FRI = '2026-10-23';
const MON_WED_FRI: Recurrence = { type: 'weekly', weekdays: [1, 3, 5] };

/** A Mon/Wed/Fri series starting on MON, with its row id. */
async function gym(recurrence: Recurrence = MON_WED_FRI): Promise<Task> {
    const task = await createTask({ text: 'Gym', date: MON, color: 'green' });

    await setRecurrence(task.id, recurrence);

    return (await db.tasks.get(task.id)) as Task;
}

/** 'text@date' of the two weeks starting on MON, in display order. */
async function twoWeeks(): Promise<string[]> {
    const weeks = [await queryWeekTasks(MON), await queryWeekTasks(NEXT_MON)];

    return weeks.flatMap((week) =>
        Object.entries(week).flatMap(([day, items]) =>
            items.map((item) => `${item.text}${item.done ? '✓' : ''}@${day}`),
        ),
    );
}

async function rows(): Promise<Task[]> {
    return db.tasks.toArray();
}

async function revision(id: string): Promise<number | undefined> {
    return (await db.outbox.get(id))?.revision;
}

beforeEach(async () => {
    await wipeLocalDatabase();
});

describe('making a task recurring', () => {
    it('turns a plain task into a series anchored at its date', async () => {
        const task = await createTask({ text: 'Gym', date: MON });
        const result = await setRecurrence(task.id, MON_WED_FRI);

        expect(result).toMatchObject({
            kind: 'occurrence',
            id: occurrenceId(task.id, MON),
        });
        expect(await db.tasks.get(task.id)).toMatchObject({
            date: MON,
            recurrence: MON_WED_FRI,
            series_id: null,
            occurrence_date: null,
        });
        expect(await revision(task.id)).toBe(2);
        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            `Gym@${WED}`,
            `Gym@${FRI}`,
            `Gym@${NEXT_MON}`,
            `Gym@${NEXT_WED}`,
            `Gym@${NEXT_FRI}`,
        ]);
    });

    it('returns the series when its own date does not repeat', async () => {
        const task = await createTask({ text: 'Gym', date: TUE });
        const result = await setRecurrence(task.id, MON_WED_FRI);

        expect(result).toMatchObject({ kind: 'series', id: task.id });
        expect((await queryWeekTasks(MON))[TUE]).toEqual([]);
    });

    it('refuses a Someday task', async () => {
        const task = await createTask({
            text: 'Read',
            date: null,
        });

        await expect(setRecurrence(task.id, MON_WED_FRI)).rejects.toThrow();
    });

    it('does nothing when removing recurrence from a plain task', async () => {
        const task = await createTask({ text: 'A', date: MON });

        await setRecurrence(task.id, null);

        expect(await revision(task.id)).toBe(1);
    });

    it('keeps Someday free of occurrences', async () => {
        await gym();

        expect(await listTasksIn({ date: null })).toEqual([]);
    });

    it('sorts occurrences with the day: timed first, then by position', async () => {
        await gym();

        await createTask({ text: 'Before', date: MON });
        await createTask({ text: 'Timed', date: MON, time: '09:00' });

        expect(
            (await queryWeekTasks(MON))[MON].map((item) => item.text),
        ).toEqual(['Timed', 'Gym', 'Before']);
    });
});

describe('reading occurrences', () => {
    it('resolves an occurrence id, and then its exception', async () => {
        const series = await gym();
        const id = occurrenceId(series.id, WED);

        expect(await queryTask(id)).toMatchObject({
            kind: 'occurrence',
            id,
            date: WED,
        });
        expect(await queryTask(occurrenceId(series.id, TUE))).toBeNull();
        expect(await queryTask(occurrenceId('missing', WED))).toBeNull();

        const exception = await toggleDone(id);

        expect(await queryTask(id)).toMatchObject({
            kind: 'exception',
            id: exception.id,
            done: true,
        });
    });

    it('finds the series of an item', async () => {
        const series = await gym();
        const occurrence = await queryTask(occurrenceId(series.id, WED));
        const plain = await queryTask(
            (await createTask({ text: 'A', date: MON })).id,
        );

        expect((await getSeries(occurrence!))?.id).toBe(series.id);
        expect(await getSeries(plain!)).toBeNull();
    });
});

describe('changing one occurrence', () => {
    it('toggles done by writing an exception', async () => {
        const series = await gym();
        const id = occurrenceId(series.id, WED);
        const exception = await toggleDone(id);

        expect(exception).toMatchObject({
            kind: 'exception',
            seriesId: series.id,
            occurrenceDate: WED,
            series_id: series.id,
            occurrence_date: WED,
            recurrence: null,
            date: WED,
            done: true,
            color: 'green',
        });
        expect(exception.id).not.toBe(id);
        expect(exception.id[14]).toBe('7');
        expect(await revision(exception.id)).toBe(1);
        expect(await twoWeeks()).toContain(`Gym✓@${WED}`);

        await toggleDone(id);

        expect(await db.tasks.get(exception.id)).toMatchObject({
            done: false,
        });
        expect(await db.tasks.count()).toBe(2);
    });

    it('edits only this one', async () => {
        const series = await gym();
        const edited = await updateTask(occurrenceId(series.id, WED), {
            text: 'Yoga',
        });

        expect(edited.kind).toBe('exception');
        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            `Yoga@${WED}`,
            `Gym@${FRI}`,
            `Gym@${NEXT_MON}`,
            `Gym@${NEXT_WED}`,
            `Gym@${NEXT_FRI}`,
        ]);
    });

    it('edits subtasks of an occurrence', async () => {
        const series = await gym();

        await updateTask(series.id, {
            subtasks: [{ id: 's1', text: 'Stretch', done: false }],
        });

        const edited = await updateSubtasks(
            occurrenceId(series.id, WED),
            (subtasks) =>
                subtasks.map((subtask) => ({ ...subtask, done: true })),
        );

        expect(edited.subtasks).toEqual([
            { id: 's1', text: 'Stretch', done: true },
        ]);
        expect((await db.tasks.get(series.id))?.subtasks[0].done).toBe(false);
    });

    it('moves an occurrence to another day or Someday', async () => {
        const series = await gym();
        const moved = await moveTask(occurrenceId(series.id, WED), {
            date: TUE,
        });

        expect(moved).toMatchObject({
            kind: 'exception',
            date: TUE,
            occurrenceDate: WED,
        });
        expect((await twoWeeks()).slice(0, 3)).toEqual([
            `Gym@${MON}`,
            `Gym@${TUE}`,
            `Gym@${FRI}`,
        ]);

        await moveTask(occurrenceId(series.id, FRI), {
            date: null,
        });

        expect(
            (await listTasksIn({ date: null })).map((item) => item.kind),
        ).toEqual(['exception']);
        // Only that date leaves the week; the series still expands.
        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            `Gym@${TUE}`,
            `Gym@${NEXT_MON}`,
            `Gym@${NEXT_WED}`,
            `Gym@${NEXT_FRI}`,
        ]);
    });

    it('reorders around occurrences of the target day', async () => {
        const series = await gym();
        const plain = await createTask({ text: 'Plain', date: MON });

        await moveTask(plain.id, {
            date: MON,
            beforeId: occurrenceId(series.id, MON),
        });

        expect(
            (await listTasksIn({ date: MON })).map((item) => item.text),
        ).toEqual(['Plain', 'Gym']);

        await moveTask(occurrenceId(series.id, MON), {
            date: MON,
            beforeId: plain.id,
        });

        expect(
            (await listTasksIn({ date: MON })).map((item) => item.text),
        ).toEqual(['Gym', 'Plain']);
    });

    it('deletes only this one, and restores it', async () => {
        const series = await gym();
        const id = occurrenceId(series.id, WED);
        const tombstone = await deleteTask(id);

        expect(tombstone).toMatchObject({
            series_id: series.id,
            occurrence_date: WED,
        });
        expect(tombstone.deleted_at).not.toBeNull();
        expect(await queryTask(id)).toBeNull();
        expect(await twoWeeks()).not.toContain(`Gym@${WED}`);

        await restoreTask(id);

        expect(await twoWeeks()).toContain(`Gym@${WED}`);
    });

    it('duplicates an occurrence as a plain task', async () => {
        const series = await gym();
        const copy = await duplicateTask(occurrenceId(series.id, WED));

        expect(copy).toMatchObject({
            text: 'Gym',
            date: WED,
            recurrence: null,
            series_id: null,
            occurrence_date: null,
        });
        expect((await queryWeekTasks(MON))[WED].map((i) => i.kind)).toEqual([
            'exception',
            'task',
        ]);
    });
});

describe('duplicate exceptions from sync', () => {
    it('lists and resolves only the winner, and edits it', async () => {
        const series = await gym();
        const id = occurrenceId(series.id, WED);
        const mine = await toggleDone(id);
        // Another device changed the same occurrence offline, later.
        const theirs: Task = {
            ...(await db.tasks.get(mine.id))!,
            id: 'ffffffff-0000-7000-8000-000000000000',
            text: 'Theirs',
            date: TUE,
            done: false,
            updated_at: nextTimestamp(),
        };

        await db.tasks.put(theirs);

        expect((await twoWeeks()).slice(0, 4)).toEqual([
            `Gym@${MON}`,
            `Theirs@${TUE}`,
            `Gym@${FRI}`,
            `Gym@${NEXT_MON}`,
        ]);
        expect((await queryTask(id))?.id).toBe(theirs.id);
        expect(await queryTask(mine.id)).toBeNull();

        await updateTask(id, { text: 'Edited' });

        expect((await db.tasks.get(theirs.id))?.text).toBe('Edited');
        expect(
            (await rows()).filter((row) => row.series_id === series.id),
        ).toHaveLength(2);
    });

    it('hides the occurrence when the winning duplicate is deleted', async () => {
        const series = await gym();
        const mine = await toggleDone(occurrenceId(series.id, WED));

        const later = nextTimestamp();

        await db.tasks.put({
            ...(await db.tasks.get(mine.id))!,
            id: 'ffffffff-0000-7000-8000-000000000000',
            updated_at: later,
            deleted_at: later,
        });

        expect(await queryTask(occurrenceId(series.id, WED))).toBeNull();
        expect((await queryWeekTasks(MON))[WED]).toEqual([]);
    });
});

describe('this and all future', () => {
    it('splits the series when editing from an occurrence', async () => {
        const series = await gym();

        await toggleDone(occurrenceId(series.id, NEXT_MON));

        const result = await updateTask(
            occurrenceId(series.id, FRI),
            { text: 'Yoga', done: true },
            { scope: 'future' },
        );

        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            `Gym@${WED}`,
            `Yoga@${FRI}`,
            `Yoga@${NEXT_MON}`,
            `Yoga@${NEXT_WED}`,
            `Yoga@${NEXT_FRI}`,
        ]);
        expect(await db.tasks.get(series.id)).toMatchObject({
            recurrence: { ...MON_WED_FRI, until: '2026-10-15' },
        });

        const all = await rows();
        const successor = all.find(
            (row) => row.recurrence !== null && row.id !== series.id,
        );

        expect(successor).toMatchObject({
            date: FRI,
            text: 'Yoga',
            done: false,
            color: 'green',
            recurrence: MON_WED_FRI,
        });
        expect(result).toMatchObject({
            kind: 'occurrence',
            id: occurrenceId(successor!.id, FRI),
        });
        // The exception after the split date was deleted with the old part.
        expect(all.filter((row) => row.series_id === series.id)).toMatchObject([
            { occurrence_date: NEXT_MON },
        ]);
        expect(
            all.find((row) => row.series_id === series.id)?.deleted_at,
        ).not.toBeNull();
        expect(await db.outbox.count()).toBe(all.length);
    });

    it('keeps the until of the series it splits', async () => {
        const series = await gym({ ...MON_WED_FRI, until: NEXT_WED });

        await updateTask(
            occurrenceId(series.id, FRI),
            { text: 'Yoga' },
            { scope: 'future' },
        );

        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            `Gym@${WED}`,
            `Yoga@${FRI}`,
            `Yoga@${NEXT_MON}`,
            `Yoga@${NEXT_WED}`,
        ]);
    });

    it('edits the series in place from its first occurrence', async () => {
        const series = await gym();
        const id = occurrenceId(series.id, MON);
        const result = await updateTask(
            id,
            { text: 'Yoga' },
            { scope: 'future' },
        );

        expect(result.id).toBe(id);
        expect(await db.tasks.count()).toBe(1);
        expect(await db.tasks.get(series.id)).toMatchObject({
            text: 'Yoga',
            recurrence: MON_WED_FRI,
        });
        expect(new Set(await twoWeeks())).toEqual(
            new Set([
                `Yoga@${MON}`,
                `Yoga@${WED}`,
                `Yoga@${FRI}`,
                `Yoga@${NEXT_MON}`,
                `Yoga@${NEXT_WED}`,
                `Yoga@${NEXT_FRI}`,
            ]),
        );
    });

    it('keeps the earlier edits of an exception in the new series', async () => {
        const series = await gym();
        const renamed = await updateTask(occurrenceId(series.id, FRI), {
            text: 'Yoga',
        });

        await updateTask(renamed.id, { color: 'pink' }, { scope: 'future' });

        const successor = (await rows()).find(
            (row) => row.recurrence !== null && row.id !== series.id,
        );

        expect(successor).toMatchObject({ text: 'Yoga', color: 'pink' });
    });

    it('refuses invalid rules before writing', async () => {
        const task = await createTask({ text: 'A', date: MON });

        await expect(
            setRecurrence(task.id, { type: 'weekly', weekdays: [] }),
        ).rejects.toThrow();
        expect(await db.tasks.get(task.id)).toMatchObject({ recurrence: null });

        await setRecurrence(task.id, { type: 'weekly', weekdays: [3, 1, 1] });
        expect((await db.tasks.get(task.id))?.recurrence).toEqual({
            type: 'weekly',
            weekdays: [1, 3],
        });
    });

    it('splits from an exception at its original date', async () => {
        const series = await gym();
        const moved = await moveTask(occurrenceId(series.id, WED), {
            date: TUE,
        });

        await updateTask(moved.id, { text: 'Yoga' }, { scope: 'future' });

        expect((await twoWeeks()).slice(0, 3)).toEqual([
            `Gym@${MON}`,
            `Yoga@${WED}`,
            `Yoga@${FRI}`,
        ]);
        expect((await db.tasks.get(moved.id))?.deleted_at).not.toBeNull();
    });

    it('deletes this and all future', async () => {
        const series = await gym();

        await toggleDone(occurrenceId(series.id, NEXT_WED));
        await deleteTask(occurrenceId(series.id, FRI), { scope: 'future' });

        expect(await twoWeeks()).toEqual([`Gym@${MON}`, `Gym@${WED}`]);
        expect((await db.tasks.get(series.id))?.recurrence?.until).toBe(
            '2026-10-15',
        );
    });

    it('deletes the whole series from its first occurrence', async () => {
        const series = await gym();

        await toggleDone(occurrenceId(series.id, WED));
        await deleteTask(occurrenceId(series.id, MON), { scope: 'future' });

        expect(await twoWeeks()).toEqual([]);
        expect((await rows()).every((row) => row.deleted_at !== null)).toBe(
            true,
        );
    });

    it('changes the rule from an occurrence on', async () => {
        const series = await gym();
        const result = await setRecurrence(occurrenceId(series.id, FRI), {
            type: 'weekly',
            weekdays: [5],
        });

        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            `Gym@${WED}`,
            `Gym@${FRI}`,
            `Gym@${NEXT_FRI}`,
        ]);
        expect(result.kind).toBe('occurrence');
        expect(result.date).toBe(FRI);
    });

    it('changes the rule in place from the first occurrence', async () => {
        const series = await gym();

        await setRecurrence(occurrenceId(series.id, MON), {
            type: 'weekly',
            weekdays: [1],
        });

        expect(await db.tasks.count()).toBe(1);
        expect(await twoWeeks()).toEqual([`Gym@${MON}`, `Gym@${NEXT_MON}`]);
    });

    it('gives only one occurrence a new rule, as a series of its own', async () => {
        const series = await gym({ type: 'weekly', weekdays: [1] });
        const result = await setRecurrence(
            occurrenceId(series.id, NEXT_MON),
            MON_WED_FRI,
            { scope: 'this' },
        );

        expect(result).toMatchObject({ kind: 'occurrence', date: NEXT_MON });
        expect(result.id).not.toContain(series.id);
        // The old series keeps its rule and only loses this date.
        expect((await db.tasks.get(series.id))?.recurrence).toEqual({
            type: 'weekly',
            weekdays: [1],
        });
        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            `Gym@${NEXT_MON}`,
            `Gym@${NEXT_WED}`,
            `Gym@${NEXT_FRI}`,
        ]);
        expect(await queryTask(occurrenceId(series.id, NEXT_MON))).toBeNull();
        expect((await queryWeekTasks('2026-10-26'))['2026-10-26']).toHaveLength(
            2,
        );
    });

    it('gives an exception a new rule with scope this, keeping its edits', async () => {
        const series = await gym();
        const renamed = await updateTask(occurrenceId(series.id, WED), {
            text: 'Swim',
        });
        const result = await setRecurrence(
            renamed.id,
            { type: 'weekly', weekdays: [3] },
            { scope: 'this' },
        );

        expect(result).toMatchObject({ kind: 'occurrence', text: 'Swim' });
        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            `Swim@${WED}`,
            `Gym@${FRI}`,
            `Gym@${NEXT_MON}`,
            `Gym@${NEXT_WED}`,
            `Swim@${NEXT_WED}`,
            `Gym@${NEXT_FRI}`,
        ]);
        expect((await db.tasks.get(renamed.id))?.deleted_at).not.toBeNull();
    });

    it('changes the rule in place from the first match of a later anchor', async () => {
        // Anchored on a Tuesday, the series first occurs on Wednesday.
        const task = await createTask({ text: 'Gym', date: TUE });

        await setRecurrence(task.id, { type: 'weekly', weekdays: [3] });
        await setRecurrence(occurrenceId(task.id, WED), MON_WED_FRI);

        expect(await db.tasks.count()).toBe(1);
        expect(await twoWeeks()).toEqual([
            `Gym@${WED}`,
            `Gym@${FRI}`,
            `Gym@${NEXT_MON}`,
            `Gym@${NEXT_WED}`,
            `Gym@${NEXT_FRI}`,
        ]);
    });

    it('stops repeating from an occurrence on, which becomes plain', async () => {
        const series = await gym();
        const result = await setRecurrence(occurrenceId(series.id, WED), null);

        expect(result).toMatchObject({
            kind: 'task',
            date: WED,
            series_id: null,
            occurrence_date: null,
            recurrence: null,
        });
        expect(await twoWeeks()).toEqual([`Gym@${MON}`, `Gym@${WED}`]);
        expect((await db.tasks.get(series.id))?.recurrence?.until).toBe(TUE);
    });

    it('turns an exception into the plain task when repeating stops', async () => {
        const series = await gym();
        const done = await toggleDone(occurrenceId(series.id, WED));
        const result = await setRecurrence(done.id, null);

        expect(result).toMatchObject({ id: done.id, kind: 'task', done: true });
        expect(await twoWeeks()).toEqual([`Gym@${MON}`, `Gym✓@${WED}`]);
    });

    it('takes one occurrence out of the series with scope this', async () => {
        const series = await gym();
        const result = await setRecurrence(occurrenceId(series.id, WED), null, {
            scope: 'this',
        });

        expect(result.kind).toBe('task');
        expect((await queryWeekTasks(MON))[WED]).toMatchObject([
            { id: result.id, kind: 'task' },
        ]);
        expect(await twoWeeks()).toHaveLength(6);
    });
});

describe('editing a series row', () => {
    it('applies to every occurrence without exceptions', async () => {
        const series = await gym();

        await updateTask(occurrenceId(series.id, WED), { text: 'Yoga' });
        await updateTask(series.id, { text: 'Run', done: true });

        expect(await twoWeeks()).toEqual([
            `Run@${MON}`,
            `Yoga@${WED}`,
            `Run@${FRI}`,
            `Run@${NEXT_MON}`,
            `Run@${NEXT_WED}`,
            `Run@${NEXT_FRI}`,
        ]);
        expect((await db.tasks.get(series.id))?.done).toBe(false);
    });

    it('replaces or removes the rule', async () => {
        const series = await gym();
        const exception = await toggleDone(occurrenceId(series.id, WED));

        await setRecurrence(series.id, { type: 'weekly', weekdays: [1] });
        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            `Gym✓@${WED}`,
            `Gym@${NEXT_MON}`,
        ]);

        await setRecurrence(series.id, null);
        expect(await twoWeeks()).toEqual([`Gym@${MON}`]);
        expect((await db.tasks.get(exception.id))?.deleted_at).not.toBeNull();
    });

    it('deletes a series with its exceptions', async () => {
        const series = await gym();

        await toggleDone(occurrenceId(series.id, WED));
        await deleteTask(series.id);

        expect(await twoWeeks()).toEqual([]);
    });

    it('cannot be moved', async () => {
        const series = await gym();

        await expect(moveTask(series.id, { date: TUE })).rejects.toThrow();
    });
});

describe('monthly series', () => {
    it('repeats on the last day of shorter months', async () => {
        const task = await createTask({ text: 'Rent', date: '2026-01-31' });

        await setRecurrence(task.id, { type: 'monthly', day: 31 });

        expect(
            (await queryWeekTasks('2026-02-23'))['2026-02-28'].map(
                (item) => item.text,
            ),
        ).toEqual(['Rent']);
        expect(
            (await queryWeekTasks('2026-04-27'))['2026-04-30'].map(
                (item) => item.text,
            ),
        ).toEqual(['Rent']);
    });
});

describe('series every N days', () => {
    const EVERY_3: Recurrence = { type: 'daily', every: 3 };

    it('repeats every N days from its date', async () => {
        await gym(EVERY_3);

        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            'Gym@2026-10-15',
            'Gym@2026-10-18',
            'Gym@2026-10-21',
            'Gym@2026-10-24',
        ]);
    });

    it('keeps the cadence when this and all future are edited', async () => {
        const series = await gym(EVERY_3);

        await updateTask(
            occurrenceId(series.id, '2026-10-18'),
            { text: 'Run' },
            { scope: 'future' },
        );

        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            'Gym@2026-10-15',
            'Run@2026-10-18',
            'Run@2026-10-21',
            'Run@2026-10-24',
        ]);
        expect((await db.tasks.get(series.id))?.recurrence).toEqual({
            ...EVERY_3,
            until: '2026-10-17',
        });
    });

    it('changes N for this and all future from an occurrence', async () => {
        const series = await gym(EVERY_3);

        await setRecurrence(
            occurrenceId(series.id, '2026-10-15'),
            { type: 'daily', every: 5 },
            { scope: 'future' },
        );

        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            'Gym@2026-10-15',
            'Gym@2026-10-20',
            'Gym@2026-10-25',
        ]);
    });

    it('changes N for the whole series from its first occurrence', async () => {
        const series = await gym(EVERY_3);

        await setRecurrence(occurrenceId(series.id, MON), {
            type: 'daily',
            every: 21,
        });

        expect(await twoWeeks()).toEqual([`Gym@${MON}`]);
        expect((await queryWeekTasks('2026-11-02'))['2026-11-02']).toEqual([
            expect.objectContaining({ kind: 'occurrence', text: 'Gym' }),
        ]);
    });

    it('moves and deletes single occurrences', async () => {
        const series = await gym(EVERY_3);

        await moveTask(occurrenceId(series.id, '2026-10-15'), { date: FRI });
        await deleteTask(occurrenceId(series.id, '2026-10-21'));

        expect(await twoWeeks()).toEqual([
            `Gym@${MON}`,
            `Gym@${FRI}`,
            'Gym@2026-10-18',
            'Gym@2026-10-24',
        ]);
    });
});

describe('undo', () => {
    it('brings back an occurrence after undoing its first change', async () => {
        const series = await gym();
        const id = occurrenceId(series.id, WED);

        for (const change of [
            (undo: ReturnType<typeof createUndoLog>) =>
                toggleDone(id, { undo }),
            (undo: ReturnType<typeof createUndoLog>) =>
                moveTask(id, { date: TUE }, { undo }),
            (undo: ReturnType<typeof createUndoLog>) =>
                duplicateTask(id, { undo }),
        ]) {
            const before = await twoWeeks();
            const undo = createUndoLog();

            await change(undo);
            await undoChanges(undo);

            expect(await twoWeeks()).toEqual(before);
        }
    });

    it('reverts a change that touched several rows', async () => {
        const series = await gym();

        await toggleDone(occurrenceId(series.id, NEXT_WED));

        const before = await twoWeeks();
        const undo = createUndoLog();

        await updateTask(
            occurrenceId(series.id, FRI),
            { text: 'Yoga' },
            { scope: 'future', undo },
        );
        await undoChanges(undo);

        expect(await twoWeeks()).toEqual(before);
        expect(
            (await db.tasks.get(series.id))?.recurrence?.until,
        ).toBeUndefined();
    });

    it('reverts a delete of this and all future', async () => {
        const series = await gym();
        const before = await twoWeeks();
        const undo = createUndoLog();

        await deleteTask(occurrenceId(series.id, WED), {
            scope: 'future',
            undo,
        });
        await undoChanges(undo);

        expect(await twoWeeks()).toEqual(before);
    });
});
