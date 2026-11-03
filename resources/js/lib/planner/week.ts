import { parseDateKey, toDateKey, weekDateKeys } from '@/lib/db/dates';

/** Empty rows rendered per day on desktop (Monday to Friday). */
export const WEEKDAY_ROWS = 10;

/**
 * Saturday and Sunday share the sixth column. Sunday's header takes one row
 * slot, so Sunday gets one row less and the column ends level with the
 * weekdays (5 + 1 + 4 = 10).
 */
export const SATURDAY_ROWS = 5;
export const SUNDAY_ROWS = WEEKDAY_ROWS - SATURDAY_ROWS - 1;

/** Minimum rows per Someday column on desktop (more as the list grows). */
export const SOMEDAY_ROWS = 2;

export function addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Day of the week with Monday as 0 and Sunday as 6. */
export function weekdayIndex(date: Date): number {
    return (date.getDay() + 6) % 7;
}

/** The Monday (local midnight) of the week that contains `date`. */
export function startOfWeek(date: Date): Date {
    return addDays(date, -weekdayIndex(date));
}

/**
 * The first day ('YYYY-MM-DD') of the week whose earlier completions the
 * Someday list archives, seen from the week starting at `weekStart`: that
 * week, but never later than the current one. A Someday task ticked while
 * browsing a future week then stays on screen until its week is over.
 */
export function somedayArchiveWeek(weekStart: Date, today: string): string {
    const shown = toDateKey(weekStart);
    const current = toDateKey(startOfWeek(parseDateKey(today)));

    return shown < current ? shown : current;
}

export function addWeeks(weekStart: Date, weeks: number): Date {
    return addDays(weekStart, weeks * 7);
}

/**
 * The Thursday of the week. ISO 8601 assigns a week (number and year) by its
 * Thursday, and the header names the month that Thursday falls in.
 */
export function weekThursday(date: Date): Date {
    return addDays(startOfWeek(date), 3);
}

/** ISO 8601 week number (1 to 53) of the week that contains `date`. */
export function isoWeekNumber(date: Date): number {
    const thursday = weekThursday(date);
    const firstOfYear = new Date(thursday.getFullYear(), 0, 1);
    const dayOfYear = Math.round(
        (thursday.getTime() - firstOfYear.getTime()) / 86_400_000,
    );

    return Math.floor(dayOfYear / 7) + 1;
}

/**
 * Reads the `?week=` query value. Any valid 'YYYY-MM-DD' date is accepted and
 * normalized to the Monday of its week; anything else returns null.
 */
export function parseWeekParam(value: string | null): Date | null {
    if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }

    const date = parseDateKey(value);

    return toDateKey(date) === value ? startOfWeek(date) : null;
}

export type PlannerDay = {
    date: string;
    rows: number;
};

/**
 * The six desktop columns of a week: Monday to Friday get one day each, and
 * the sixth column stacks Saturday over Sunday.
 */
export function weekColumns(weekStart: Date): PlannerDay[][] {
    const days = weekDateKeys(weekStart);
    const weekdays = days
        .slice(0, 5)
        .map((date) => [{ date, rows: WEEKDAY_ROWS }]);
    const weekend = [
        { date: days[5], rows: SATURDAY_ROWS },
        { date: days[6], rows: SUNDAY_ROWS },
    ];

    return [...weekdays, weekend];
}

export const WEEK_PARAM = 'week';

/**
 * The week a planner URL shows: its `?week=` (normalized to the Monday), or
 * the week of `today` when the parameter is missing or invalid.
 */
export function weekFromUrl(href: string, today: Date): Date {
    const value = new URL(href).searchParams.get(WEEK_PARAM);

    return parseWeekParam(value) ?? startOfWeek(today);
}

/**
 * The canonical planner URL for a week: `?week=` holds its Monday, and is
 * dropped for the week of `today`. Other parameters and the hash are kept.
 */
export function canonicalWeekUrl(
    href: string,
    weekStart: Date,
    today: Date,
): string {
    const url = new URL(href);
    const monday = startOfWeek(weekStart);

    if (toDateKey(monday) === toDateKey(startOfWeek(today))) {
        url.searchParams.delete(WEEK_PARAM);
    } else {
        url.searchParams.set(WEEK_PARAM, toDateKey(monday));
    }

    return url.href;
}
