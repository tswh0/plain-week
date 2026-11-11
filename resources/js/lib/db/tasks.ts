import { v7 as uuidv7 } from 'uuid';
import { addDays } from '@/lib/recurrence/dates';
import {
    makeOccurrence,
    normalizeRecurrence,
    occursOn,
    parseOccurrenceId,
    startsSeries,
    toItem,
} from '@/lib/recurrence/expand';
import type {
    ExceptionItem,
    OccurrenceItem,
    PlannerTask,
    SeriesItem,
} from '@/lib/recurrence/expand';
import { compareCarryOverOrder, isCarriedOver } from './carry-over';
import { notifyLocalChange } from './changes';
import { db } from './database';
import { nextTimestamp } from './dates';
import { demoIds, trackDemoRows } from './demo';
import type { DemoMode } from './demo';
import { positionBetween, somedayKeyBetween } from './position';
import {
    placementOf,
    queryAllExceptions,
    queryException,
    queryExceptions,
    queryListTasks,
    querySeries,
    queryTask,
} from './queries';
import type { TaskPlacement } from './queries';
import type { Recurrence, Subtask, Task, TaskColor } from './types';

/**
 * The task repository. Every function only touches IndexedDB: none of them
 * waits on the network. Each mutation reads, changes and writes its records
 * and their outbox entries in one transaction, bumps `updated_at`, and wakes
 * the sync engine.
 *
 * Every function that takes an id also accepts the id of a generated
 * occurrence (`${seriesId}:${date}`). Changing an occurrence writes an
 * exception row for it; see docs/architecture.md for the recurrence rules.
 */

export type { TaskPlacement } from './queries';

export type CreateTaskInput = TaskPlacement & {
    text: string;
    /** Insert right after this task (ignored when not in the list). */
    afterId?: string | null;
    /** Insert right before this task (ignored when not in the list). */
    beforeId?: string | null;
    color?: TaskColor;
    time?: string | null;
    duration_minutes?: number | null;
    notes?: string;
    subtasks?: Subtask[];
};

const PATCHABLE_FIELDS = [
    'text',
    'done',
    'color',
    'time',
    'notes',
    'subtasks',
] as const;

/** Fields that can be changed with `updateTask`. Use `moveTask` to move. */
export type TaskPatch = Partial<Pick<Task, (typeof PATCHABLE_FIELDS)[number]>>;

export type MoveTaskInput = TaskPlacement & {
    /** Place the task right before this task. */
    beforeId?: string | null;
    /** Place the task right after this task. */
    afterId?: string | null;
};

/**
 * For an occurrence or exception: change only this one, or this one and every
 * later one of its series. Ignored for plain tasks.
 */
export type Scope = 'this' | 'future';

/**
 * Records what a mutation overwrote, so `undoChanges` can put it back. Pass
 * the same log to one or more mutations, then undo them all at once.
 */
export type UndoLog = { before: Map<string, Task | null> };

export type MutationOptions = {
    undo?: UndoLog;
    /**
     * The written rows are demo tasks: local only, never pushed (used to seed
     * the guest onboarding, see `lib/db/demo.ts`).
     */
    demo?: boolean;
};

export type ScopedMutationOptions = MutationOptions & { scope?: Scope };

/** Keeps only the stored fields (drops the view-model ones). */
function toRow(task: Task): Task {
    return {
        id: task.id,
        text: task.text,
        date: task.date,
        someday_column: task.someday_column,
        position: task.position,
        done: task.done,
        done_at: task.done_at,
        color: task.color,
        time: task.time,
        notes: task.notes,
        subtasks: task.subtasks,
        created_at: task.created_at,
        updated_at: task.updated_at,
        deleted_at: task.deleted_at,
        recurrence: task.recurrence,
        series_id: task.series_id,
        occurrence_date: task.occurrence_date,
    };
}

/** How a write affects demo tasks (see `lib/db/demo.ts`). */
type DemoEffect = {
    /** The id the user acted on, which may not be among the written rows. */
    subjectId?: string;
    /** `release` unless the mutation is a delete, restore or undo. */
    mode?: Exclude<DemoMode, 'seed'>;
};

/**
 * Runs `build` and writes the rows it returns, plus an outbox entry for each,
 * in one read-write transaction, then wakes the sync engine. Demo rows are
 * released (or kept local) in the same transaction.
 */
async function write<T>(
    build: () => Promise<{ rows: Task[]; result: T }>,
    options: MutationOptions = {},
    { subjectId, mode = 'release' }: DemoEffect = {},
): Promise<T> {
    let written = 0;
    const tables = [db.tasks, db.outbox, db.meta];
    const result = await db.transaction('rw', tables, async () => {
        const built = await build();
        const rows = [
            ...new Map(built.rows.map((row) => [row.id, toRow(row)])).values(),
        ];
        const ids = rows.map((row) => row.id);
        const [previous, entries] = await Promise.all([
            db.tasks.bulkGet(ids),
            db.outbox.bulkGet(ids),
        ]);

        rows.forEach((row, i) => {
            if (options.undo && !options.undo.before.has(row.id)) {
                options.undo.before.set(row.id, previous[i] ?? null);
            }
        });

        await db.tasks.bulkPut(rows);
        await db.outbox.bulkPut(
            rows.map((row, i) => ({
                task_id: row.id,
                revision: (entries[i]?.revision ?? 0) + 1,
            })),
        );
        await trackDemoRows(rows, subjectId, options.demo ? 'seed' : mode);

        written = rows.length;

        return built.result;
    });

    if (written > 0) {
        notifyLocalChange();
    }

    return result;
}

/** Reads a live item inside the current transaction or throws. */
async function getLive(id: string): Promise<PlannerTask> {
    const item = await queryTask(id);

    if (!item) {
        throw new Error(`Task ${id} does not exist.`);
    }

    return item;
}

/** The live series of an occurrence (it always has one). */
async function seriesOfOccurrence(item: OccurrenceItem): Promise<SeriesItem> {
    const series = await querySeries(item.seriesId);

    if (!series) {
        throw new Error(`Series ${item.seriesId} does not exist.`);
    }

    return series;
}

type Slot = Pick<Task, 'date' | 'someday_column' | 'position'>;

/**
 * The placement fields of a task that goes right after `after` and before
 * `before`, two neighbours in the list of `placement` (either may be
 * undefined for the start or end). In Someday the sort key includes the
 * column; see `somedayKeyBetween`.
 */
function slotBetween(
    placement: TaskPlacement,
    after: Task | undefined,
    before: Task | undefined,
): Slot {
    if (placement.date === null) {
        return { date: null, ...somedayKeyBetween(after, before) };
    }

    return {
        date: placement.date,
        someday_column: null,
        position: positionBetween(after?.position, before?.position),
    };
}

/**
 * The slot right before `beforeId` and/or right after `afterId` in the list
 * of `placement`, leaving out the rows in `exclude` (the task being moved).
 * A neighbour that is not in the list is ignored; with no usable neighbour
 * the slot is at the end.
 */
async function slotIn(
    placement: TaskPlacement,
    {
        afterId,
        beforeId,
    }: { afterId?: string | null; beforeId?: string | null },
    exclude: ReadonlySet<string> = new Set(),
): Promise<Slot> {
    const siblings = (await queryListTasks(placement)).filter(
        (sibling) => !exclude.has(sibling.id),
    );
    const indexOf = (siblingId: string | null | undefined) =>
        siblingId ? siblings.findIndex((s) => s.id === siblingId) : -1;

    let afterIndex = indexOf(afterId);
    let beforeIndex = indexOf(beforeId);

    if (afterIndex === -1 && beforeIndex === -1) {
        afterIndex = siblings.length - 1;
        beforeIndex = siblings.length;
    } else if (beforeIndex === -1) {
        beforeIndex = afterIndex + 1;
    } else if (afterIndex === -1) {
        afterIndex = beforeIndex - 1;
    }

    return slotBetween(placement, siblings[afterIndex], siblings[beforeIndex]);
}

/** Live items of a day (by position) or of the Someday list, in order. */
export function listTasksIn(placement: TaskPlacement): Promise<PlannerTask[]> {
    return queryListTasks(placement);
}

/** Applies `patch` to `task`, keeping `done_at` consistent with `done`. */
function patched(task: Task, patch: TaskPatch): Task {
    const next: Task = {
        ...toRow(task),
        updated_at: nextTimestamp(task.updated_at),
    };

    PATCHABLE_FIELDS.forEach((field) => {
        if (patch[field] !== undefined) {
            Object.assign(next, { [field]: patch[field] });
        }
    });

    if (next.done !== task.done) {
        next.done_at = next.done ? next.updated_at : null;
    }

    return next;
}

/** A series is never done: its occurrences are, one by one. */
function seriesPatch(patch: TaskPatch): TaskPatch {
    return { ...patch, done: undefined };
}

function tombstone(task: Task): Task {
    const now = nextTimestamp(task.updated_at);

    return { ...toRow(task), updated_at: now, deleted_at: now };
}

/** Tombstones of the live exception rows of a series. */
async function tombstonedExceptions(seriesId: string): Promise<Task[]> {
    return (await queryAllExceptions(seriesId))
        .filter((row) => row.deleted_at === null)
        .map(tombstone);
}

/** A new row: fresh id and timestamps. */
function fresh(task: Task): Task {
    const now = nextTimestamp();

    return {
        ...toRow(task),
        id: uuidv7(),
        created_at: now,
        updated_at: now,
        deleted_at: null,
    };
}

/** The exception row of an occurrence, with nothing changed yet. */
function materialize(series: SeriesItem, date: string): Task {
    return fresh(makeOccurrence(series, date));
}

/** A new plain row with the content of `task`. */
function plainCopy(task: Task): Task {
    return {
        ...fresh(task),
        recurrence: null,
        series_id: null,
        occurrence_date: null,
    };
}

/** `task` turned into a plain row (same id). */
function detached(task: Task): Task {
    return {
        ...toRow(task),
        recurrence: null,
        series_id: null,
        occurrence_date: null,
        updated_at: nextTimestamp(task.updated_at),
    };
}

/** A new series row anchored at `date` with the content of `task`. */
function newSeries(task: Task, date: string, recurrence: Recurrence): Task {
    return {
        ...plainCopy(task),
        date,
        someday_column: null,
        done: false,
        done_at: null,
        recurrence,
    };
}

/**
 * Ends `series` before `from` ("this and all future"): its exceptions dated
 * `from` or later are deleted (except `keepId`), and it gets `until` the day
 * before, or is deleted when nothing would be left (`from` is on or before its
 * first occurrence). `replacement`, a series row with a new id, takes over
 * from `from`; when the old series would be empty, the old row takes the
 * replacement's content instead (same id).
 * Returns the rows to write and the series that now covers `from`.
 */
async function splitSeries(
    series: SeriesItem,
    from: string,
    replacement: Task | null,
    keepId?: string,
): Promise<{ rows: Task[]; successor: Task | null }> {
    const later = await queryExceptions(series.id, from, '9999-12-31');
    const rows = later
        .filter((row) => row.deleted_at === null && row.id !== keepId)
        .map(tombstone);

    if (startsSeries(series, from)) {
        if (replacement === null) {
            return { rows: [...rows, tombstone(series)], successor: null };
        }

        const successor: Task = {
            ...replacement,
            id: series.id,
            created_at: series.created_at,
            updated_at: nextTimestamp(series.updated_at),
        };

        return { rows: [...rows, successor], successor };
    }

    const ended: Task = {
        ...toRow(series),
        recurrence: { ...series.recurrence, until: addDays(from, -1) },
        updated_at: nextTimestamp(series.updated_at),
    };

    return {
        rows: [...rows, ended, ...(replacement ? [replacement] : [])],
        successor: replacement,
    };
}

/**
 * What stands for the task the user acted on after a change to its series:
 * the series' occurrence on `date` when it has one, else the series itself.
 */
function representative(seriesRow: Task, date: string): PlannerTask {
    const item = toItem(seriesRow);

    return item.kind === 'series' && occursOn(item, date)
        ? makeOccurrence(item, date)
        : item;
}

/** The series of an occurrence or exception, when it is still live. */
async function liveSeriesOf(item: PlannerTask): Promise<{
    series: SeriesItem;
    item: OccurrenceItem | ExceptionItem;
} | null> {
    if (item.kind !== 'occurrence' && item.kind !== 'exception') {
        return null;
    }

    const series = await querySeries(item.seriesId);

    return series ? { series, item } : null;
}

export function createTask(
    input: CreateTaskInput,
    options: MutationOptions = {},
): Promise<Task> {
    return write(async () => {
        const slot = await slotIn(placementOf(input), input);
        const now = nextTimestamp();
        const task: Task = {
            id: uuidv7(),
            text: input.text,
            ...slot,
            done: false,
            done_at: null,
            color: input.color ?? 'none',
            time: input.time ?? null,
            ...(input.duration_minutes != null
                ? { duration_minutes: input.duration_minutes }
                : {}),
            notes: input.notes ?? '',
            subtasks: input.subtasks ?? [],
            created_at: now,
            updated_at: now,
            deleted_at: null,
            recurrence: null,
            series_id: null,
            occurrence_date: null,
        };

        return { rows: [task], result: task };
    }, options);
}

/**
 * Edits an item. On an occurrence, scope 'this' writes an exception and
 * 'future' splits the series at the occurrence's date. `done` only ever
 * applies to the one item.
 */
function edit(
    id: string,
    change: (item: PlannerTask) => TaskPatch,
    { scope = 'this', ...options }: ScopedMutationOptions,
): Promise<PlannerTask> {
    return write(
        async () => {
            const item = await getLive(id);
            const patch = change(item);
            const linked = await liveSeriesOf(item);

            if (linked && scope === 'future') {
                const { series } = linked;
                const from = linked.item.occurrenceDate;
                const content = patched(item, seriesPatch(patch));
                const { rows, successor } = await splitSeries(
                    series,
                    from,
                    newSeries(content, from, series.recurrence),
                );

                return {
                    rows,
                    result: representative(successor as Task, from),
                };
            }

            let row: Task;

            if (item.kind === 'occurrence') {
                const series = await seriesOfOccurrence(item);

                row = patched(materialize(series, item.occurrenceDate), patch);
            } else if (item.kind === 'series') {
                row = patched(item, seriesPatch(patch));
            } else {
                row = patched(item, patch);
            }

            return { rows: [row], result: toItem(row) };
        },
        options,
        { subjectId: id },
    );
}

/**
 * Changes `text`, `done`, `color`, `time`, `notes` or `subtasks`. Returns
 * the item that now shows the change: an exception row for an occurrence
 * edited with scope 'this', the new series' occurrence for 'future'.
 */
export function updateTask(
    id: string,
    patch: TaskPatch,
    options: ScopedMutationOptions = {},
): Promise<PlannerTask> {
    return edit(id, () => patch, options);
}

/** Toggles done; on an occurrence it only ever affects that one. */
export function toggleDone(
    id: string,
    options: MutationOptions = {},
): Promise<PlannerTask> {
    return edit(id, (item) => ({ done: !item.done }), options);
}

/**
 * Replaces the subtasks with `update(current)`, reading and writing in one
 * transaction so quick successive edits never overwrite each other.
 */
export function updateSubtasks(
    id: string,
    update: (subtasks: Subtask[]) => Subtask[],
    options: ScopedMutationOptions = {},
): Promise<PlannerTask> {
    return edit(id, (item) => ({ subtasks: update(item.subtasks) }), options);
}

/**
 * Soft-deletes (a tombstone that syncs like any other change). On an
 * occurrence, scope 'this' writes a deleted exception and 'future' ends the
 * series the day before (deleting it when it starts that day). Deleting a
 * series row deletes it with all its exceptions. Returns the tombstone, or the
 * ended series for 'future'.
 */
export function deleteTask(
    id: string,
    { scope = 'this', ...options }: ScopedMutationOptions = {},
): Promise<Task> {
    return write(
        async () => {
            const item = await getLive(id);
            const linked = await liveSeriesOf(item);

            if (linked && scope === 'future') {
                const { rows } = await splitSeries(
                    linked.series,
                    linked.item.occurrenceDate,
                    null,
                );

                return { rows, result: rows[rows.length - 1] };
            }

            if (item.kind === 'occurrence') {
                const series = await seriesOfOccurrence(item);
                const row = tombstone(materialize(series, item.occurrenceDate));

                return { rows: [row], result: row };
            }

            if (item.kind === 'series') {
                const row = tombstone(item);

                return {
                    rows: [...(await tombstonedExceptions(item.id)), row],
                    result: row,
                };
            }

            const row = tombstone(item);

            return { rows: [row], result: row };
        },
        options,
        { mode: 'keep' },
    );
}

/**
 * Brings back a soft-deleted task (undo of a single `deleteTask`). With an
 * occurrence id it restores that occurrence's exception. The restore is a
 * newer change, so it also wins over the tombstone on other devices. To undo
 * a change that touched several rows, use an `UndoLog`.
 */
export function restoreTask(id: string): Promise<PlannerTask> {
    return write(
        async () => {
            const occurrence = parseOccurrenceId(id);
            const task = occurrence
                ? await queryException(occurrence.seriesId, occurrence.date)
                : await db.tasks.get(id);

            if (!task) {
                throw new Error(`Task ${id} does not exist.`);
            }

            const row: Task = {
                ...task,
                updated_at: nextTimestamp(task.updated_at),
                deleted_at: null,
            };

            return { rows: [row], result: toItem(row) };
        },
        {},
        { mode: 'keep' },
    );
}

/**
 * Moves a task to a day or into the Someday list. It lands right before
 * `beforeId` and/or right after `afterId`; a neighbour that is not in the
 * target list is ignored, and with no usable neighbour the task goes to the
 * end. Moving an occurrence writes an exception for it (a series row cannot
 * be moved).
 */
export function moveTask(
    id: string,
    input: MoveTaskInput,
    options: MutationOptions = {},
): Promise<PlannerTask> {
    return write(
        async () => {
            const item = await getLive(id);

            if (item.kind === 'series') {
                throw new Error('Move an occurrence, not its series.');
            }

            const slot = await slotIn(
                placementOf(input),
                input,
                new Set([id, item.id]),
            );
            const base =
                item.kind === 'occurrence'
                    ? materialize(
                          await seriesOfOccurrence(item),
                          item.occurrenceDate,
                      )
                    : item;
            const row: Task = {
                ...toRow(base),
                ...slot,
                updated_at: nextTimestamp(base.updated_at),
            };

            return { rows: [row], result: toItem(row) };
        },
        options,
        { subjectId: id },
    );
}

/**
 * Moves every unfinished plain task dated before `today` to `today` (see
 * `isCarriedOver`), after the tasks already there and in the order they had.
 * Subtasks are part of the row, so they travel with it. Untouched demo tasks
 * stay on the day they teach. Reading and writing in one transaction makes it
 * idempotent, also across tabs; two devices doing it converge through LWW (a
 * move keeps the id, so it never duplicates). Resolves with how many moved.
 */
export function carryOverTasks(today: string): Promise<number> {
    return write(async () => {
        const [past, demo, todays] = await Promise.all([
            db.tasks.where('date').below(today).toArray(),
            demoIds(),
            queryListTasks({ date: today }),
        ]);
        let after = todays.at(-1)?.position;
        const rows = past
            .filter((task) => isCarriedOver(task, today) && !demo.has(task.id))
            .sort(compareCarryOverOrder)
            .map((task): Task => {
                const position = positionBetween(after, null);

                after = position;

                return {
                    ...toRow(task),
                    date: today,
                    position,
                    updated_at: nextTimestamp(task.updated_at),
                };
            });

        return { rows, result: rows.length };
    });
}

/**
 * Copies a task right after the original: same content and done state, new
 * ids for the task and its subtasks. The copy is always a plain task; a
 * generated occurrence used as the source gets its exception row.
 */
export function duplicateTask(
    id: string,
    options: MutationOptions = {},
): Promise<Task> {
    return write(
        async () => {
            const item = await getLive(id);
            const siblings = await queryListTasks(placementOf(item));
            const next =
                siblings[siblings.findIndex((s) => s.id === item.id) + 1];
            const source =
                item.kind === 'occurrence'
                    ? materialize(
                          await seriesOfOccurrence(item),
                          item.occurrenceDate,
                      )
                    : item;
            const copy: Task = {
                ...plainCopy(source),
                ...slotBetween(placementOf(item), item, next),
                subtasks: item.subtasks.map((subtask) => ({
                    ...subtask,
                    id: uuidv7(),
                })),
            };

            return {
                rows: item.kind === 'occurrence' ? [source, copy] : [copy],
                result: copy,
            };
        },
        options,
        { subjectId: id },
    );
}

/**
 * Sets or removes the repeat rule.
 *
 * - Plain task: `recurrence` turns it into a series anchored at its date (a
 *   Someday task cannot repeat); `null` does nothing.
 * - Series row: replaces the rule; `null` turns it into a plain task and
 *   deletes its exceptions.
 * - Occurrence or exception, scope 'future' (the default): the series ends the
 *   day before the occurrence; with a rule, a new series with this item's
 *   content starts on the occurrence's date; with `null`, this item becomes a
 *   plain task. Scope 'this': this item leaves the series, which keeps going
 *   with a deleted exception hiding its date; with a rule it starts a new,
 *   independent series on the occurrence's date, with `null` it becomes a
 *   plain task.
 *
 * Returns what now stands for the item: its occurrence on the anchor date when
 * the rule produces one, else the series row, or the plain task.
 */
export function setRecurrence(
    id: string,
    recurrence: Recurrence | null,
    { scope = 'future', ...options }: ScopedMutationOptions = {},
): Promise<PlannerTask> {
    return write(
        async () => {
            const item = await getLive(id);
            const linked = await liveSeriesOf(item);

            if (linked) {
                const { series } = linked;
                const from = linked.item.occurrenceDate;

                if (recurrence !== null) {
                    const rule = normalizeRecurrence(recurrence, from);

                    if (scope === 'this') {
                        // This item starts a series of its own; the old one
                        // keeps going without it (a deleted exception hides
                        // its date).
                        const own = newSeries(item, from, rule);
                        const hidden = tombstone(
                            item.kind === 'exception'
                                ? item
                                : materialize(series, from),
                        );

                        return {
                            rows: [hidden, own],
                            result: representative(own, from),
                        };
                    }

                    const { rows, successor } = await splitSeries(
                        series,
                        from,
                        newSeries(item, from, rule),
                    );

                    return {
                        rows,
                        result: representative(successor as Task, from),
                    };
                }

                const plain =
                    item.kind === 'exception'
                        ? detached(item)
                        : plainCopy(item);

                if (scope === 'this') {
                    // A deleted exception keeps the occurrence from coming back.
                    const hidden = tombstone(materialize(series, from));

                    return { rows: [plain, hidden], result: toItem(plain) };
                }

                const { rows } = await splitSeries(series, from, null, item.id);

                return { rows: [...rows, plain], result: toItem(plain) };
            }

            if (item.kind === 'series') {
                if (recurrence !== null) {
                    const next: Task = {
                        ...toRow(item),
                        recurrence: normalizeRecurrence(recurrence, item.date),
                        updated_at: nextTimestamp(item.updated_at),
                    };

                    return { rows: [next], result: toItem(next) };
                }

                const plain = detached(item);

                return {
                    rows: [...(await tombstonedExceptions(item.id)), plain],
                    result: toItem(plain),
                };
            }

            if (recurrence === null) {
                return { rows: [], result: item };
            }

            if (item.date === null) {
                throw new Error('A Someday task cannot repeat.');
            }

            // A plain task, or an exception whose series is gone.
            const row: Task = {
                ...detached(item),
                recurrence: normalizeRecurrence(recurrence, item.date),
                done: false,
                done_at: null,
            };

            return { rows: [row], result: representative(row, item.date) };
        },
        options,
        { subjectId: id },
    );
}

export function createUndoLog(): UndoLog {
    return { before: new Map() };
}

/**
 * Puts back every row the mutations logged in `log` overwrote, and deletes
 * the rows they created, as newer changes so the undo also syncs.
 */
export function undoChanges(log: UndoLog): Promise<void> {
    return write(
        async () => {
            const rows: Task[] = [];

            for (const [id, before] of log.before) {
                const now = await db.tasks.get(id);

                if (!now) {
                    continue;
                }

                if (before) {
                    rows.push({
                        ...before,
                        updated_at: nextTimestamp(now.updated_at),
                    });
                } else {
                    rows.push(...(await unwritten(now)));
                }
            }

            log.before.clear();

            return { rows, result: undefined };
        },
        {},
        { mode: 'keep' },
    );
}

/**
 * Undoes the creation of `row`. A new exception cannot simply be deleted: a
 * deleted exception hides its occurrence. It goes back to the series' content
 * instead, which shows the occurrence as it was.
 */
async function unwritten(row: Task): Promise<Task[]> {
    const series =
        row.series_id !== null && row.occurrence_date !== null
            ? await querySeries(row.series_id)
            : null;

    if (series && row.occurrence_date !== null) {
        return [
            {
                ...materialize(series, row.occurrence_date),
                id: row.id,
                created_at: row.created_at,
                updated_at: nextTimestamp(row.updated_at),
            },
        ];
    }

    return row.deleted_at === null ? [tombstone(row)] : [];
}
