import { generateKeyBetween } from 'fractional-indexing';
import type { SomedayColumn, Task } from './types';

/** Sort order inside a day: position, then id as a tie-break. */
export function compareTaskOrder(
    a: Pick<Task, 'position' | 'id'>,
    b: Pick<Task, 'position' | 'id'>,
): number {
    if (a.position !== b.position) {
        return a.position < b.position ? -1 : 1;
    }

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Display order inside a day: tasks with a time come first, earliest first,
 * then the rest by position (`compareTaskOrder` also breaks ties). Only the
 * display of days uses it; the repository keeps placing tasks by position.
 */
export function compareDayOrder(
    a: Pick<Task, 'time' | 'position' | 'id'>,
    b: Pick<Task, 'time' | 'position' | 'id'>,
): number {
    if (a.time !== null && b.time !== null && a.time !== b.time) {
        return a.time < b.time ? -1 : 1;
    }

    if ((a.time === null) !== (b.time === null)) {
        return a.time === null ? 1 : -1;
    }

    return compareTaskOrder(a, b);
}

/**
 * A position key strictly between `after` and `before` (either may be null for
 * the start or end of the list). If the bounds are not in order (two devices
 * produced the same key, for example) it falls back to a key after `after`.
 */
export function positionBetween(
    after: string | null | undefined,
    before: string | null | undefined,
): string {
    const lower = after ?? null;
    const upper = before ?? null;

    if (lower !== null && upper !== null && lower >= upper) {
        return generateKeyBetween(lower, null);
    }

    return generateKeyBetween(lower, upper);
}

/** Where a row sorts in Someday: its column, then its position. */
export type SomedaySortKey = Pick<Task, 'someday_column' | 'position'>;

/** A row's Someday column; a missing one (never valid data) counts as 0. */
export function somedayColumnOf(
    task: Pick<Task, 'someday_column'>,
): SomedayColumn {
    return task.someday_column ?? 0;
}

/**
 * Sort order of the Someday list. Someday is one list; its sort key is
 * (`someday_column`, `position`, `id`), so tasks written in older versions
 * (three separate columns) keep the order they were shown in: column 1, then
 * 2, then 3.
 */
export function compareSomedayOrder(
    a: SomedaySortKey & Pick<Task, 'id'>,
    b: SomedaySortKey & Pick<Task, 'id'>,
): number {
    const columnA = somedayColumnOf(a);
    const columnB = somedayColumnOf(b);

    if (columnA !== columnB) {
        return columnA < columnB ? -1 : 1;
    }

    return compareTaskOrder(a, b);
}

/**
 * A Someday sort key strictly between two neighbours of the list (either may
 * be undefined for the start or end): the column of `after` with a position
 * after it (and before `before` when both share that column), else the column
 * of `before` with a position before it, else column 0. No other row has to
 * change.
 */
export function somedayKeyBetween(
    after: SomedaySortKey | undefined,
    before: SomedaySortKey | undefined,
): SomedaySortKey {
    if (after) {
        const column = somedayColumnOf(after);
        const sameColumn = before && somedayColumnOf(before) === column;

        return {
            someday_column: column,
            position: positionBetween(
                after.position,
                sameColumn ? before.position : null,
            ),
        };
    }

    if (before) {
        return {
            someday_column: somedayColumnOf(before),
            position: positionBetween(null, before.position),
        };
    }

    return { someday_column: 0, position: positionBetween(null, null) };
}
