import { Dexie } from 'dexie';
import { generateNKeysBetween } from 'fractional-indexing';
import { v7 as uuidv7 } from 'uuid';
import { notifyLocalChange } from '@/lib/db/changes';
import { db } from '@/lib/db/database';
import type { PlainWeekDatabase } from '@/lib/db/database';
import { nextTimestamp } from '@/lib/db/dates';
import {
    compareSomedayOrder,
    compareTaskOrder,
    somedayColumnOf,
} from '@/lib/db/position';
import type { SomedaySortKey } from '@/lib/db/position';
import { SOMEDAY_COLUMNS } from '@/lib/db/types';
import type { Task } from '@/lib/db/types';
import { EXPORT_FORMAT, EXPORT_VERSION } from './format';
import type { ExportFile } from './format';
import { backupRows } from './rows';
import { ImportError, validateTask } from './validate';

export { ImportError } from './validate';

/**
 * Importing a backup ADDS its tasks next to the existing ones, with new ids;
 * nothing that is already in the local database changes. See "Export format"
 * in docs/architecture.md.
 */

export type ImportSummary = {
    /** Tasks the user will see added: plain tasks plus series. */
    taskCount: number;
    /** How many of `taskCount` repeat. */
    recurringCount: number;
};

export type ImportPlan = ImportSummary & {
    /** The rows to write: series first, then plain tasks, then exceptions. */
    tasks: Task[];
};

/** Far above any real planner (10 000 tasks are about 5 MB). */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export type ApplyImportOptions = {
    database?: PlainWeekDatabase;
    /** Rows per transaction. */
    batchSize?: number;
    /** Called after each committed batch with the rows written so far. */
    onProgress?: (written: number, total: number) => void;
};

/**
 * Reads and validates an export file. Throws an `ImportError` with a message
 * for the user when it is not a Plain Week export, has an unsupported
 * version or holds an invalid task.
 */
export async function parseImport(input: Blob | string): Promise<ExportFile> {
    const size = typeof input === 'string' ? input.length : input.size;

    if (size > MAX_IMPORT_BYTES) {
        throw new ImportError(
            `This file is too large to import (more than ${MAX_IMPORT_BYTES / 1024 / 1024} MB).`,
        );
    }

    const text = typeof input === 'string' ? input : await input.text();
    let data: unknown;

    try {
        data = JSON.parse(text);
    } catch {
        throw new ImportError('This file is not valid JSON.');
    }

    if (
        typeof data !== 'object' ||
        data === null ||
        (data as { format?: unknown }).format !== EXPORT_FORMAT
    ) {
        throw new ImportError('This is not a Plain Week export file.');
    }

    const file = data as Record<string, unknown>;

    if (file.version !== EXPORT_VERSION) {
        throw new ImportError(
            typeof file.version === 'number' && file.version > EXPORT_VERSION
                ? `This file comes from a newer version of Plain Week (format version ${file.version}). Update Plain Week to import it.`
                : `Unsupported export format version: ${JSON.stringify(file.version)}.`,
        );
    }

    if (!Array.isArray(file.tasks)) {
        throw new ImportError('This file has no task list.');
    }

    const tasks = file.tasks.map((task, index) => validateTask(task, index));
    const ids = new Set<string>();

    tasks.forEach((task, index) => {
        if (ids.has(task.id)) {
            throw new ImportError(
                `Task ${index + 1}: "id" is used by another task in the file.`,
            );
        }

        ids.add(task.id);
    });

    return {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exported_at:
            typeof file.exported_at === 'string' ? file.exported_at : '',
        app_version:
            typeof file.app_version === 'string' ? file.app_version : '',
        tasks,
    };
}

const SOMEDAY_LIST = 'someday';

function listKey(task: Pick<Task, 'date'>): string {
    return task.date ?? SOMEDAY_LIST;
}

type ListEnd = (SomedaySortKey & Pick<Task, 'id'>) | null;

/**
 * The sort key of the last task of each day / the Someday list in the
 * database (`null`: the list is empty).
 */
async function listEnds(
    database: PlainWeekDatabase,
    keys: Set<string>,
): Promise<Map<string, ListEnd>> {
    const ends = new Map<string, ListEnd>();

    await database.transaction('r', database.tasks, async () => {
        for (const key of keys) {
            if (key !== SOMEDAY_LIST) {
                const row = await database.tasks
                    .where('[date+position]')
                    .between([key, Dexie.minKey], [key, Dexie.maxKey])
                    .last();
                ends.set(key, row ?? null);
                continue;
            }

            const rows = await database.tasks
                .where('someday_column')
                .anyOf([...SOMEDAY_COLUMNS])
                .filter((row) => row.date === null)
                .toArray();
            ends.set(
                key,
                rows.reduce<ListEnd>(
                    (last, row) =>
                        last === null || compareSomedayOrder(row, last) > 0
                            ? row
                            : last,
                    null,
                ),
            );
        }
    });

    return ends;
}

/** What an import adds, for the preview (no database access). */
export function summarizeImport(file: ExportFile): ImportSummary {
    const rows = backupRows(file.tasks);
    const series = new Set(
        rows.filter((task) => task.recurrence !== null).map((task) => task.id),
    );
    // Exceptions of a series in the file are part of it; the others become
    // plain tasks. Only exceptions of a series can be deleted here.
    const visible = rows.filter(
        (task) =>
            task.deleted_at === null &&
            (task.series_id === null || !series.has(task.series_id)),
    );

    return {
        taskCount: visible.length,
        recurringCount: series.size,
    };
}

/**
 * Turns a parsed file into the rows to add: new UUID v7 ids, `series_id`
 * remapped to the new series (an exception whose series is not in the file
 * becomes a plain task), positions appended after the existing tasks of each
 * day / the Someday list keeping the file's order, and fresh `created_at` /
 * `updated_at`. `done` and `done_at` are kept. Reads the database, never
 * writes it; call it right before `applyImport` so positions are current.
 */
export async function planImport(
    file: ExportFile,
    database: PlainWeekDatabase = db,
): Promise<ImportPlan> {
    const kept = backupRows(file.tasks);
    const series = new Set(
        kept.filter((task) => task.recurrence !== null).map((task) => task.id),
    );
    const kindOrder = (task: Task) =>
        task.recurrence !== null ? 0 : task.series_id === null ? 1 : 2;
    // Series first, so their (time-ordered) ids are smaller and both a
    // partial import and the sync push write a series before its exceptions.
    const rows = kept
        .map((task) =>
            task.series_id === null || series.has(task.series_id)
                ? task
                : { ...task, series_id: null, occurrence_date: null },
        )
        .sort((a, b) => kindOrder(a) - kindOrder(b));

    const now = nextTimestamp();
    const newIds = new Map(rows.map((task) => [task.id, uuidv7()]));
    const byList = new Map<string, Task[]>();

    rows.forEach((task) => {
        const key = listKey(task);
        const list = byList.get(key) ?? [];
        list.push(task);
        byList.set(key, list);
    });

    const ends = await listEnds(database, new Set(byList.keys()));
    const sortKeys = new Map<string, SomedaySortKey>();

    // Appended after the last task of each list, in the file's order. Someday
    // tasks all take the column of the last Someday task (0 when empty), so
    // they land at the end of the single list.
    byList.forEach((tasks, key) => {
        const end = ends.get(key) ?? null;
        const isSomeday = key === SOMEDAY_LIST;
        const sorted = [...tasks].sort(
            isSomeday ? compareSomedayOrder : compareTaskOrder,
        );
        const keys = generateNKeysBetween(
            end?.position ?? null,
            null,
            sorted.length,
        );
        sorted.forEach((task, i) =>
            sortKeys.set(task.id, {
                someday_column: isSomeday
                    ? end === null
                        ? 0
                        : somedayColumnOf(end)
                    : task.someday_column,
                position: keys[i],
            }),
        );
    });

    return {
        ...summarizeImport(file),
        tasks: rows.map((task) => ({
            ...task,
            id: newIds.get(task.id) as string,
            ...sortKeys.get(task.id),
            series_id:
                task.series_id === null
                    ? null
                    : (newIds.get(task.series_id) as string),
            subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
            created_at: now,
            updated_at: now,
            deleted_at: task.deleted_at === null ? null : now,
        })),
    };
}

function nextTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Writes a plan to the local database in batches, each in one transaction
 * with its outbox entries (so a signed-in user syncs them), yielding to the
 * event loop between batches so a large import does not freeze the UI.
 * Batches already written stay if a later one fails.
 */
export async function applyImport(
    plan: ImportPlan,
    { database = db, batchSize = 500, onProgress }: ApplyImportOptions = {},
): Promise<void> {
    const total = plan.tasks.length;

    try {
        for (let start = 0; start < total; start += batchSize) {
            const batch = plan.tasks.slice(start, start + batchSize);

            await database.transaction(
                'rw',
                database.tasks,
                database.outbox,
                async () => {
                    await database.tasks.bulkAdd(batch);
                    await database.outbox.bulkPut(
                        batch.map((task) => ({
                            task_id: task.id,
                            revision: 1,
                        })),
                    );
                },
            );

            onProgress?.(start + batch.length, total);
            await nextTick();
        }
    } finally {
        // Wake the sync engine once for the batches that were written.
        if (total > 0) {
            notifyLocalChange();
        }
    }
}
