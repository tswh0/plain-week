import {
    expandSeries,
    makeOccurrence,
    occursOn,
    parseOccurrenceId,
    toItem,
    winningException,
} from '@/lib/recurrence/expand';
import type { PlannerTask, SeriesItem } from '@/lib/recurrence/expand';
import { db } from './database';
import { parseDateKey, weekDateKeys } from './dates';
import {
    compareDayOrder,
    compareSomedayOrder,
    compareTaskOrder,
} from './position';
import { SOMEDAY_COLUMNS } from './types';
import type { Task } from './types';

/**
 * Where a task lives: a day, or the Someday list. Someday is a single list;
 * the repository picks a row's `someday_column` (part of its sort key).
 */
export type TaskPlacement = { date: string } | { date: null };

/** Tasks per day of the week, keyed by 'YYYY-MM-DD' (every day is present). */
export type WeekTasks = Record<string, PlannerTask[]>;

/** The Someday list, sorted (see `compareSomedayOrder`). */
export type SomedayTasks = PlannerTask[];

export function placementOf(task: Pick<Task, 'date'>): TaskPlacement {
    return task.date === null ? { date: null } : { date: task.date };
}

/** Live Someday rows (series rows and losing duplicates left out). */
async function querySomedayItems(
    filter: (task: Task) => boolean = () => true,
): Promise<PlannerTask[]> {
    const items = await shownItems(
        await db.tasks
            .where('someday_column')
            .anyOf([...SOMEDAY_COLUMNS])
            .filter((task) => task.date === null && filter(task))
            .toArray(),
    );

    return items.sort(compareSomedayOrder);
}

function isLive(task: Task): boolean {
    return task.deleted_at === null;
}

/** Live series rows that can generate an occurrence in the range. */
async function querySeriesInRange(
    rangeStart: string,
    rangeEnd: string,
): Promise<SeriesItem[]> {
    const rows = await db.tasks
        .where('recurrence.type')
        .anyOf(['daily', 'weekly', 'monthly'])
        .toArray();

    return rows
        .filter(isLive)
        .map(toItem)
        .filter(
            (item): item is SeriesItem =>
                item.kind === 'series' &&
                item.date <= rangeEnd &&
                (item.recurrence.until ?? rangeStart) >= rangeStart,
        );
}

/** Every exception row (deleted too) of a series for the given dates. */
export function queryExceptions(
    seriesId: string,
    fromDate: string,
    toDate: string,
): Promise<Task[]> {
    return db.tasks
        .where('[series_id+occurrence_date]')
        .between([seriesId, fromDate], [seriesId, toDate], true, true)
        .toArray();
}

/** Every exception row (deleted too) of a series. */
export function queryAllExceptions(seriesId: string): Promise<Task[]> {
    return queryExceptions(seriesId, '0000-01-01', '9999-12-31');
}

/**
 * The exception row that counts for one occurrence (deleted too), or
 * undefined. Duplicates can arrive through sync; see `winningException`.
 */
export async function queryException(
    seriesId: string,
    date: string,
): Promise<Task | undefined> {
    return winningException(await queryExceptions(seriesId, date, date));
}

/** False for an exception row that lost to a duplicate of its occurrence. */
async function isShown(item: PlannerTask): Promise<boolean> {
    if (item.kind !== 'exception') {
        return true;
    }

    const winner = await queryException(item.seriesId, item.occurrenceDate);

    return winner?.id === item.id;
}

/** Live rows as items, without series rows and losing duplicates. */
async function shownItems(rows: Task[]): Promise<PlannerTask[]> {
    const items = rows
        .filter(isLive)
        .map(toItem)
        .filter((item) => item.kind !== 'series');
    const shown = await Promise.all(items.map(isShown));

    return items.filter((_, i) => shown[i]);
}

/**
 * Live items dated `rangeStart`–`rangeEnd` (inclusive), unsorted: plain
 * tasks, exceptions and the occurrences series generate there. Series rows
 * themselves are left out.
 */
export async function queryRangeItems(
    rangeStart: string,
    rangeEnd: string,
): Promise<PlannerTask[]> {
    const [rows, series] = await Promise.all([
        db.tasks
            .where('date')
            .between(rangeStart, rangeEnd, true, true)
            .toArray(),
        querySeriesInRange(rangeStart, rangeEnd),
    ]);
    const items = new Map<string, PlannerTask>();

    (await shownItems(rows)).forEach((item) => items.set(item.id, item));

    const generated = await Promise.all(
        series.map(async (item) =>
            expandSeries(
                item,
                await queryExceptions(item.id, rangeStart, rangeEnd),
                rangeStart,
                rangeEnd,
            ),
        ),
    );

    generated.flat().forEach((item) => items.set(item.id, item));

    return [...items.values()];
}

/**
 * Live items of one day by position, or of the Someday list in its order
 * (archived tasks included).
 */
export async function queryListTasks(
    placement: TaskPlacement,
): Promise<PlannerTask[]> {
    if (placement.date === null) {
        return querySomedayItems();
    }

    return (await queryRangeItems(placement.date, placement.date)).sort(
        compareTaskOrder,
    );
}

/**
 * Live items of the seven days starting at `firstDay`, occurrences of series
 * included, grouped and in display order: timed tasks first by time, then the
 * rest by position.
 */
export async function queryWeekTasks(firstDay: string): Promise<WeekTasks> {
    const days = weekDateKeys(parseDateKey(firstDay));
    const items = await queryRangeItems(days[0], days[6]);

    return Object.fromEntries(
        days.map((day) => [
            day,
            items.filter((item) => item.date === day).sort(compareDayOrder),
        ]),
    );
}

/**
 * Whether a Someday task is archived for the week starting at `firstDay`: it
 * was done before that week began. A done task without a readable `done_at`
 * (older data) counts as archived. Archiving only hides the task; undoing it brings it back.
 */
export function isArchivedSomeday(
    task: Pick<Task, 'done' | 'done_at'>,
    firstDay: string,
): boolean {
    if (!task.done) {
        return false;
    }

    // `done_at` is a UTC instant; the week starts at local midnight. A missing
    // or unreadable `done_at` gives NaN, which archives the task.
    const doneAt =
        task.done_at === null ? Number.NaN : Date.parse(task.done_at);

    return !(doneAt >= parseDateKey(firstDay).getTime());
}

/**
 * The Someday list as seen from the week starting at `firstDay`, sorted.
 * Tasks done before that week are left out (see `isArchivedSomeday`).
 */
export function querySomedayTasks(firstDay: string): Promise<SomedayTasks> {
    return querySomedayItems((task) => !isArchivedSomeday(task, firstDay));
}

/** A live series, or null. */
export async function querySeries(id: string): Promise<SeriesItem | null> {
    const row = await db.tasks.get(id);
    const item = row && isLive(row) ? toItem(row) : null;

    return item?.kind === 'series' ? item : null;
}

/**
 * A live item by id, or null when it does not exist or was deleted. The id
 * may be a row id or an occurrence id (`${seriesId}:${date}`); an occurrence
 * that has an exception row resolves to that row, so an id taken from the
 * screen keeps working after its first change.
 */
export async function queryTask(id: string): Promise<PlannerTask | null> {
    const occurrence = parseOccurrenceId(id);

    if (occurrence === null) {
        const row = await db.tasks.get(id);
        const item = row && isLive(row) ? toItem(row) : null;

        return item && (await isShown(item)) ? item : null;
    }

    const series = await querySeries(occurrence.seriesId);

    if (series === null) {
        return null;
    }

    const exception = await queryException(series.id, occurrence.date);

    if (exception) {
        return isLive(exception) ? toItem(exception) : null;
    }

    return occursOn(series, occurrence.date)
        ? makeOccurrence(series, occurrence.date)
        : null;
}

/** The series an occurrence or exception belongs to (a series: itself). */
export function getSeries(item: PlannerTask): Promise<SeriesItem | null> {
    if (item.kind === 'task') {
        return Promise.resolve(null);
    }

    return querySeries(item.kind === 'series' ? item.id : item.seriesId);
}

/**
 * Number of local changes not yet accepted by the server. For guests it is
 * the work that only lives on this device.
 */
export function queryPendingChangeCount(): Promise<number> {
    return db.outbox.count();
}
