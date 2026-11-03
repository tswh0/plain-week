import { useLiveQuery } from 'dexie-react-hooks';
import { toDateKey } from '@/lib/db/dates';
import {
    querySeries,
    querySomedayTasks,
    queryTask,
    queryWeekTasks,
} from '@/lib/db/queries';
import type { SomedayTasks, WeekTasks } from '@/lib/db/queries';
import { somedayArchiveWeek } from '@/lib/planner/week';
import type { PlannerTask, SeriesItem } from '@/lib/recurrence/expand';

export type { SomedayTasks, WeekTasks } from '@/lib/db/queries';

/**
 * Live tasks of the seven days starting at `weekStart`, keyed by 'YYYY-MM-DD'
 * and sorted, with the occurrences of recurring tasks. `undefined` only while the first local read is in progress.
 */
export function useWeekTasks(weekStart: Date): WeekTasks | undefined {
    const firstDay = toDateKey(weekStart);

    return useLiveQuery(() => queryWeekTasks(firstDay), [firstDay]);
}

/**
 * The live Someday list as seen from the week starting at `weekStart`, with
 * `today` as 'YYYY-MM-DD': tasks done before that week (or before the current
 * week, when a future one is shown) are archived and left out. `undefined`
 * only while the first read is in progress.
 */
export function useSomedayTasks(
    weekStart: Date,
    today: string,
): SomedayTasks | undefined {
    const firstDay = somedayArchiveWeek(weekStart, today);

    return useLiveQuery(() => querySomedayTasks(firstDay), [firstDay]);
}

/**
 * A single live task. `undefined` while loading, `null` when it does not exist
 * or was deleted. `id` may be an occurrence id; once that occurrence has an
 * exception row, the row is returned (with its own id).
 */
export function useTask(
    id: string | null | undefined,
): PlannerTask | null | undefined {
    // Right after `id` changes, useLiveQuery still returns the previous
    // query's result; tagging it with its id keeps that stale value out.
    const result = useLiveQuery(
        async () => ({ id, task: id ? await queryTask(id) : null }),
        [id],
    );

    return result !== undefined && result.id === id ? result.task : undefined;
}

/**
 * The live series of an occurrence or exception (a series: itself). `null`
 * for a plain task or a deleted series, `undefined` while loading.
 */
export function useSeries(
    item: PlannerTask | null | undefined,
): SeriesItem | null | undefined {
    const seriesId =
        item?.kind === 'series'
            ? item.id
            : item?.kind === 'occurrence' || item?.kind === 'exception'
              ? item.seriesId
              : null;
    const result = useLiveQuery(
        async () => ({
            seriesId,
            series: seriesId ? await querySeries(seriesId) : null,
        }),
        [seriesId],
    );

    return result !== undefined && result.seriesId === seriesId
        ? result.series
        : undefined;
}
