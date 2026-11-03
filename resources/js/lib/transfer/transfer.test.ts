import { generateNKeysBetween } from 'fractional-indexing';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { db, wipeLocalDatabase } from '@/lib/db/database';
import { queryTask, queryWeekTasks, querySomedayTasks } from '@/lib/db/queries';
import {
    createTask,
    deleteTask,
    moveTask,
    setRecurrence,
    toggleDone,
    updateTask,
} from '@/lib/db/tasks';
import type { Task } from '@/lib/db/types';
import { occurrenceId } from '@/lib/recurrence/expand';
import { makeTask } from '@/test/fixtures';
import { buildExport } from './export';
import { EXPORT_FORMAT, EXPORT_VERSION, exportFileName } from './format';
import type { ExportFile } from './format';
import {
    ImportError,
    MAX_IMPORT_BYTES,
    applyImport,
    parseImport,
    planImport,
    summarizeImport,
} from './import';
import { backupRows } from './rows';

const MON = '2026-10-12';
const TUE = '2026-10-13';
const WED = '2026-10-14';
const FRI = '2026-10-16';
const NEXT_MON = '2026-10-19';

/** 'text[✓]@list' of the two weeks from MON and Someday, in display order. */
async function snapshot(): Promise<string[]> {
    const weeks = [await queryWeekTasks(MON), await queryWeekTasks(NEXT_MON)];
    const someday = await querySomedayTasks(MON);

    return [
        ...weeks.flatMap((week) =>
            Object.entries(week).flatMap(([day, items]) =>
                items.map(
                    (item) =>
                        `${item.text}${item.done ? '✓' : ''}@${day}:${item.color}`,
                ),
            ),
        ),
        ...someday.map((item) => `${item.text}@someday`),
    ];
}

/** Exports, wipes the database and imports the file back. */
async function roundTrip(): Promise<ExportFile> {
    const file = await buildExport();
    const json = JSON.stringify(file);

    await wipeLocalDatabase();
    await applyImport(await planImport(await parseImport(json)));

    return file;
}

function fileWith(tasks: unknown[]): string {
    return JSON.stringify({
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exported_at: '2026-10-15T08:00:00.000Z',
        app_version: '0.0.3',
        tasks,
    });
}

async function importText(text: string) {
    const plan = await planImport(await parseImport(text));
    await applyImport(plan);

    return plan;
}

beforeEach(async () => {
    await wipeLocalDatabase();
});

describe('export', () => {
    it('writes the file header and the wire shape of every live task', async () => {
        const task = await createTask({ text: 'Buy milk', date: MON });
        const file = await buildExport(db, {
            now: new Date('2026-10-15T08:00:00.000Z'),
            appVersion: '1.2.3',
        });

        expect(file).toEqual({
            format: 'plain-week',
            version: 1,
            exported_at: '2026-10-15T08:00:00.000Z',
            app_version: '1.2.3',
            tasks: [task],
        });
    });

    it('leaves out demo tasks', async () => {
        const mine = await createTask({ text: 'Mine', date: MON });
        await createTask({ text: 'Demo', date: MON }, { demo: true });

        expect((await buildExport()).tasks.map((task) => task.id)).toEqual([
            mine.id,
        ]);
    });

    it('names the file after the local date', () => {
        expect(exportFileName(new Date(2026, 9, 5, 23, 30))).toBe(
            'plain-week-export-2026-10-05.json',
        );
    });

    it('leaves out tombstones, exceptions of deleted series and losing duplicates', () => {
        const series = makeTask({
            id: 'series',
            recurrence: { type: 'weekly', weekdays: [1] },
        });
        const deletedSeries = makeTask({
            id: 'deleted-series',
            recurrence: { type: 'weekly', weekdays: [2] },
            deleted_at: '2026-10-13T00:00:00.000Z',
        });
        const exception = (id: string, updatedAt: string, deleted = false) =>
            makeTask({
                id,
                series_id: 'series',
                occurrence_date: MON,
                updated_at: updatedAt,
                deleted_at: deleted ? updatedAt : null,
            });
        const rows: Task[] = [
            series,
            deletedSeries,
            makeTask({ id: 'plain' }),
            makeTask({ id: 'gone', deleted_at: '2026-10-13T00:00:00.000Z' }),
            makeTask({
                id: 'of-deleted',
                series_id: 'deleted-series',
                occurrence_date: TUE,
            }),
            exception('old', '2026-10-12T10:00:00.000Z'),
            exception('newest', '2026-10-12T11:00:00.000Z'),
            makeTask({
                id: 'deleted-occurrence',
                series_id: 'series',
                occurrence_date: '2026-10-19',
                deleted_at: '2026-10-13T00:00:00.000Z',
            }),
            makeTask({
                id: 'orphan',
                series_id: 'not-here',
                occurrence_date: WED,
            }),
        ];

        expect(
            backupRows(rows)
                .map((row) => row.id)
                .sort(),
        ).toEqual(
            [
                'deleted-occurrence',
                'newest',
                'orphan',
                'plain',
                'series',
            ].sort(),
        );
    });
});

describe('round trip', () => {
    it('imports an export into an empty database with the same planner and new ids', async () => {
        const milk = await createTask({
            text: 'Buy milk',
            date: MON,
            color: 'cornflower',
            time: '09:30',
            notes: 'Oat',
            subtasks: [{ id: 's1', text: 'Oat milk', done: true }],
        });
        await createTask({ text: 'Read', date: MON });
        await toggleDone(milk.id);
        await createTask({ text: 'Idea', date: null });
        const gone = await createTask({ text: 'Gone', date: TUE });
        await deleteTask(gone.id);

        const gym = await createTask({ text: 'Gym', date: MON });
        await setRecurrence(gym.id, { type: 'weekly', weekdays: [1, 3, 5] });
        await toggleDone(occurrenceId(gym.id, WED));
        await updateTask(occurrenceId(gym.id, FRI), { color: 'pink' });
        await deleteTask(occurrenceId(gym.id, NEXT_MON));
        await moveTask(occurrenceId(gym.id, MON), { date: TUE });

        const before = await snapshot();
        const exported = await buildExport();
        const oldIds = new Set(exported.tasks.map((task) => task.id));

        await roundTrip();

        expect(await snapshot()).toEqual(before);
        expect(before).toContain(`Gym✓@${WED}:none`);
        expect(before).not.toContain(`Gym@${NEXT_MON}:none`);

        const rows = await db.tasks.toArray();
        expect(rows).toHaveLength(exported.tasks.length);
        expect(rows.some((row) => oldIds.has(row.id))).toBe(false);
        expect(rows.find((row) => row.text === 'Gone')).toBeUndefined();

        const series = rows.find((row) => row.recurrence !== null) as Task;
        const exceptions = rows.filter((row) => row.series_id !== null);
        expect(series.id[14]).toBe('7');
        expect(exceptions).toHaveLength(4);
        expect(exceptions.every((row) => row.series_id === series.id)).toBe(
            true,
        );

        const copy = rows.find((row) => row.text === 'Buy milk') as Task;
        const original = exported.tasks.find(
            (task) => task.id === milk.id,
        ) as Task;
        expect(copy).toMatchObject({
            done: true,
            done_at: original.done_at,
            time: '09:30',
            notes: 'Oat',
            subtasks: [{ id: 's1', text: 'Oat milk', done: true }],
        });
        expect(copy.created_at).toBe(copy.updated_at);
        expect(copy.created_at > original.updated_at).toBe(true);

        expect(await db.outbox.count()).toBe(rows.length);
        expect(
            (await db.outbox.toArray()).every((entry) => entry.revision === 1),
        ).toBe(true);
    });

    it('round-trips a series that repeats every N days', async () => {
        const water = await createTask({ text: 'Water plants', date: MON });
        await setRecurrence(water.id, { type: 'daily', every: 3 });
        await updateTask(occurrenceId(water.id, '2026-10-15'), {
            color: 'green',
        });

        const before = await snapshot();
        const exported = await buildExport();

        expect(
            exported.tasks.find((task) => task.id === water.id)?.recurrence,
        ).toEqual({ type: 'daily', every: 3 });

        await roundTrip();

        expect(await snapshot()).toEqual(before);
        expect(before).toEqual(
            expect.arrayContaining([
                `Water plants@${MON}:none`,
                'Water plants@2026-10-15:green',
                'Water plants@2026-10-18:none',
            ]),
        );
    });

    it('adds to the existing tasks and leaves them unchanged', async () => {
        const task = await createTask({ text: 'Mine', date: MON });
        const file = JSON.stringify(await buildExport());

        await importText(file);

        expect(await db.tasks.get(task.id)).toEqual(task);
        expect(await snapshot()).toEqual([
            `Mine@${MON}:none`,
            `Mine@${MON}:none`,
        ]);
    });
});

describe('planImport', () => {
    it('appends after the existing tasks of each list, keeping the file order', async () => {
        await createTask({ text: 'Existing', date: MON });
        const idea = await createTask({ text: 'Existing idea', date: null });
        // The last Someday task sits in column 2 (an older version's row).
        await db.tasks.update(idea.id, { someday_column: 2 });

        await importText(
            fileWith([
                makeTask({ id: 'b', text: 'Second', position: 'a2' }),
                makeTask({ id: 'a', text: 'First', position: 'a1' }),
                makeTask({
                    id: 'c',
                    text: 'Later idea',
                    date: null,
                    someday_column: 0,
                    position: 'Zz',
                }),
            ]),
        );

        expect(await snapshot()).toEqual([
            `Existing@${MON}:none`,
            `First@${MON}:none`,
            `Second@${MON}:none`,
            'Existing idea@someday',
            'Later idea@someday',
        ]);
        expect(
            (await db.tasks.toArray()).find((t) => t.text === 'Later idea')
                ?.someday_column,
        ).toBe(2);
    });

    it('turns an exception whose series is not in the file into a plain task', async () => {
        const plan = await importText(
            fileWith([
                makeTask({
                    id: 'moved',
                    text: 'Moved gym',
                    date: TUE,
                    series_id: 'missing',
                    occurrence_date: MON,
                }),
            ]),
        );

        expect(plan).toMatchObject({ taskCount: 1, recurringCount: 0 });
        expect(await db.tasks.toArray()).toEqual([
            expect.objectContaining({
                text: 'Moved gym',
                date: TUE,
                series_id: null,
                occurrence_date: null,
            }),
        ]);
    });

    it('drops the exceptions of a series deleted in the file', async () => {
        const plan = await importText(
            fileWith([
                makeTask({
                    id: 'series',
                    recurrence: { type: 'weekly', weekdays: [1] },
                    deleted_at: '2026-10-13T00:00:00.000Z',
                }),
                makeTask({
                    id: 'exception',
                    series_id: 'series',
                    occurrence_date: MON,
                }),
                makeTask({ id: 'plain', text: 'Plain' }),
            ]),
        );

        expect(plan).toMatchObject({ taskCount: 1, recurringCount: 0 });
        expect((await db.tasks.toArray()).map((task) => task.text)).toEqual([
            'Plain',
        ]);
    });

    it('counts series as recurring and exceptions as part of their series', async () => {
        const plan = await planImport(
            await parseImport(
                fileWith([
                    makeTask({
                        id: 'series',
                        recurrence: { type: 'monthly', day: 31 },
                    }),
                    makeTask({
                        id: 'exception',
                        series_id: 'series',
                        occurrence_date: '2026-10-31',
                        date: '2026-10-30',
                    }),
                    makeTask({ id: 'plain' }),
                ]),
            ),
        );

        expect(plan).toMatchObject({ taskCount: 2, recurringCount: 1 });
        expect(summarizeImport(await parseImport(fileWith([])))).toEqual({
            taskCount: 0,
            recurringCount: 0,
        });
        expect(plan.tasks.map((task) => task.series_id)).toEqual([
            null,
            null,
            plan.tasks[0].id,
        ]);
    });
});

describe('parseImport', () => {
    it.each([
        ['not json', 'This file is not valid JSON.'],
        ['[]', 'This is not a Plain Week export file.'],
        ['{"format":"tweek"}', 'This is not a Plain Week export file.'],
        [
            '{"format":"plain-week","version":2,"tasks":[]}',
            'This file comes from a newer version of Plain Week (format version 2). Update Plain Week to import it.',
        ],
        [
            '{"format":"plain-week","version":"1","tasks":[]}',
            'Unsupported export format version: "1".',
        ],
        ['{"format":"plain-week","version":1}', 'This file has no task list.'],
    ])('refuses %s', async (text, message) => {
        await expect(parseImport(text)).rejects.toThrow(
            new ImportError(message),
        );
    });

    it.each([
        [
            { color: 'red' },
            'Task 1: "color" must be one of none, pink, yellow, black, grey, cornflower, mango, green, lilac.',
        ],
        [{ text: undefined }, 'Task 1: "text" is missing.'],
        [{ done: 1 }, 'Task 1: "done" must be true or false.'],
        [
            { date: '2026-02-30' },
            'Task 1: "date" must be a date like 2026-10-15 or null.',
        ],
        [
            { date: null },
            'Task 1: "someday_column" is required when "date" is null.',
        ],
        [
            { time: '24:00' },
            'Task 1: "time" must be a time like 09:30 or null.',
        ],
        [
            { updated_at: '2026-10-12T10:00:00Z' },
            'Task 1: "updated_at" must be a timestamp like 2026-10-15T08:35:00.123Z.',
        ],
        [
            { subtasks: [{ id: 's', text: 'x' }] },
            'Task 1: "subtasks[0].done" must be true or false.',
        ],
        [
            { recurrence: { type: 'weekly', weekdays: [3, 1] } },
            'Task 1: "recurrence.weekdays" must be a sorted list of unique weekdays from 1 to 7.',
        ],
        [
            { recurrence: { type: 'yearly' } },
            'Task 1: "recurrence.type" must be "daily", "weekly" or "monthly".',
        ],
        [
            { recurrence: { type: 'monthly', day: 1, interval: 2 } },
            'Task 1: "recurrence" has an unknown key "interval".',
        ],
        [
            { recurrence: { type: 'daily' } },
            'Task 1: "recurrence.every" must be a number of days from 1 to 365.',
        ],
        [
            { recurrence: { type: 'daily', every: 366 } },
            'Task 1: "recurrence.every" must be a number of days from 1 to 365.',
        ],
        [
            { recurrence: { type: 'daily', every: 2.5 } },
            'Task 1: "recurrence.every" must be a number of days from 1 to 365.',
        ],
        [
            { recurrence: { type: 'daily', every: 2, day: 1 } },
            'Task 1: "recurrence.every" must be a number of days from 1 to 365.',
        ],
        [
            { recurrence: { type: 'monthly', day: 1, every: 2 } },
            'Task 1: "recurrence.day" must be a day of the month from 1 to 31.',
        ],
        [
            {
                recurrence: { type: 'monthly', day: 1 },
                date: null,
                someday_column: 0,
            },
            'Task 1: "date" is required for a recurring task.',
        ],
        [
            { recurrence: { type: 'monthly', day: 1, until: '2026-01-01' } },
            'Task 1: "recurrence.until" cannot be before the task date.',
        ],
        [
            { series_id: 'x' },
            'Task 1: "occurrence_date" is required on an exception of a series.',
        ],
        [
            { position: 'a'.repeat(256) },
            'Task 1: "position" must be at most 255 characters.',
        ],
    ])('refuses an invalid task (%j)', async (overrides, message) => {
        const task = { ...makeTask(), ...overrides };

        await expect(parseImport(fileWith([task]))).rejects.toThrow(
            new ImportError(message),
        );
    });

    it('refuses a file that is too large', async () => {
        await expect(
            parseImport(new Blob(['x'.repeat(MAX_IMPORT_BYTES + 1)])),
        ).rejects.toThrow(
            'This file is too large to import (more than 50 MB).',
        );
    });

    it('refuses duplicate ids and rows that are not objects', async () => {
        await expect(
            parseImport(
                fileWith([makeTask({ id: 'a' }), makeTask({ id: 'a' })]),
            ),
        ).rejects.toThrow('Task 2: "id" is used by another task in the file.');
        await expect(
            parseImport(fileWith([makeTask(), 'task'])),
        ).rejects.toThrow('Task 2 is not an object.');
    });

    it('reads a file and drops unknown keys', async () => {
        const task = makeTask({ date: null, someday_column: 2 });
        const file = await parseImport(
            new Blob([fileWith([{ ...task, version: 7, extra: true }])]),
        );

        expect(file.tasks).toEqual([task]);
    });
});

describe('applyImport', () => {
    it('writes 10k tasks in batches with progress', async () => {
        const positions = generateNKeysBetween(null, null, 10_000);
        const tasks = Array.from({ length: 10_000 }, (_, i) =>
            makeTask({
                text: `Task ${i}`,
                position: positions[i],
                date: `2026-10-${String(12 + (i % 7)).padStart(2, '0')}`,
            }),
        );
        const started = performance.now();
        const plan = await planImport(await parseImport(fileWith(tasks)));
        const progress = vi.fn();
        const transaction = vi.spyOn(db, 'transaction');

        await applyImport(plan, { onProgress: progress });

        expect(await db.tasks.count()).toBe(10_000);
        expect(await db.outbox.count()).toBe(10_000);
        expect(progress).toHaveBeenCalledTimes(20);
        expect(progress).toHaveBeenLastCalledWith(10_000, 10_000);
        expect(transaction).toHaveBeenCalledTimes(20);
        expect(performance.now() - started).toBeLessThan(15_000);

        const monday = await queryWeekTasks(MON);
        expect(monday[MON].slice(0, 3).map((task) => task.text)).toEqual([
            'Task 0',
            'Task 7',
            'Task 14',
        ]);
        expect(await queryTask(plan.tasks[0].id)).not.toBeNull();
    }, 30_000);
});
