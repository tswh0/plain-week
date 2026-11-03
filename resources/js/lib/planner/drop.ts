import { parseDateKey, toDateKey } from '@/lib/db/dates';
import { compareDayOrder } from '@/lib/db/position';
import { placementOf } from '@/lib/db/queries';
import type { MoveTaskInput, TaskPlacement } from '@/lib/db/tasks';
import type { Task } from '@/lib/db/types';
import type { PlannerTask } from '@/lib/recurrence/expand';
import { formatDay, formatWeekday } from '@/lib/planner/format';
import { addDays, addWeeks, weekdayIndex } from '@/lib/planner/week';

/**
 * Drag and drop of tasks, as pure functions: where a dragged task lands, given
 * what it is dropped on. The planner's DnD layer (`planner-dnd.tsx`) turns
 * pointer and keyboard positions into a `DropTarget` and writes the result
 * with `moveTask`.
 */

/** -1 for the previous week, 1 for the next one. */
export type WeekDirection = -1 | 1;

/** A day or the Someday list and its tasks in display order. */
export type TaskListRef = { placement: TaskPlacement; tasks: Task[] };

/** dnd-kit `data` of a draggable task row (`useSortable`). */
export type TaskDragData = TaskListRef & { type: 'task'; task: PlannerTask };

/** dnd-kit `data` of a list droppable (a day or the Someday list). */
export type ListDropData = TaskListRef & { type: 'list' };

/** dnd-kit `data` of an edge-zone droppable. */
export type EdgeDropData = { type: 'edge'; direction: WeekDirection };

export type DropData = TaskDragData | ListDropData | EdgeDropData;

/** What the dragged task is over. `tasks` is the list in display order. */
export type DropTarget =
    | {
          type: 'task';
          placement: TaskPlacement;
          tasks: Task[];
          taskId: string;
          /** The probe is in the lower half of the row: drop below it. */
          below: boolean;
      }
    | { type: 'list'; placement: TaskPlacement; tasks: Task[] }
    | { type: 'edge'; direction: WeekDirection };

export type DropResult = {
    move: MoveTaskInput;
    /**
     * Where the insertion line goes: the list, and the task it is drawn above
     * (`null`: after the last task). `null` for an edge-zone drop, whose list
     * is not on screen.
     */
    indicator: { listKey: string; beforeTaskId: string | null } | null;
};

/** The `placementKey` of the Someday list. */
export const SOMEDAY_KEY = 'someday';

/** A stable key for a day ("2026-10-12") or the Someday list ("someday"). */
export function placementKey(placement: TaskPlacement): string {
    return placement.date ?? SOMEDAY_KEY;
}

/** Whether a `placementKey` is the Someday list's. */
export function isSomedayKey(key: string): boolean {
    return key === SOMEDAY_KEY;
}

/** "Mon 12 Oct" or "Someday", for screen reader announcements. */
export function placementLabel(placement: TaskPlacement): string {
    return placement.date !== null
        ? `${formatWeekday(placement.date)} ${formatDay(placement.date)}`
        : 'Someday';
}

/**
 * Lands `active` in a list at `slot`, an insertion index into `tasks` (the
 * list in display order, which may contain `active` itself): 0 is above the
 * first task, `tasks.length` after the last one.
 *
 * Days show timed tasks first by time, so only untimed tasks are positional
 * there: the neighbours handed to `moveTask` are the closest untimed tasks
 * around the slot, and a timed task keeps its place by time (moving it within
 * its own day changes nothing). Someday is positional throughout.
 *
 * Returns `null` when the drop would leave the task where it is.
 */
export function resolveListDrop(
    active: Task,
    placement: TaskPlacement,
    tasks: Task[],
    slot: number,
): DropResult | null {
    const isDay = placement.date !== null;
    const listKey = placementKey(placement);
    const sameList = placementKey(placementOf(active)) === listKey;
    const activeIndex = tasks.findIndex((task) => task.id === active.id);
    const others = tasks.filter((task) => task.id !== active.id);
    const otherSlot =
        activeIndex !== -1 && activeIndex < slot ? slot - 1 : slot;
    const positional = (task: Task) => !isDay || task.time === null;

    const afterId = others.slice(0, otherSlot).findLast(positional)?.id ?? null;
    const beforeId = others.slice(otherSlot).find(positional)?.id ?? null;

    if (sameList) {
        if (isDay && active.time !== null) {
            return null;
        }

        const current = activeIndex === -1 ? others.length : activeIndex;
        const currentAfter =
            others.slice(0, current).findLast(positional)?.id ?? null;
        const currentBefore =
            others.slice(current).find(positional)?.id ?? null;

        if (currentAfter === afterId && currentBefore === beforeId) {
            return null;
        }
    }

    const beforeTaskId =
        isDay && active.time !== null
            ? (others.find((task) => compareDayOrder(active, task) < 0)?.id ??
              null)
            : beforeId;

    return {
        move: { ...placement, afterId, beforeId },
        indicator: { listKey, beforeTaskId },
    };
}

/**
 * The day an edge-zone drop sends a task to: the same weekday in the week
 * before or after the shown one (Monday for a Someday task, which has no
 * weekday). Dropping always targets the week beyond the visible one, also
 * after hovering the zone has already changed the shown week.
 */
export function edgeDropDate(
    active: Task,
    shownWeekStart: Date,
    direction: WeekDirection,
): string {
    const weekday =
        active.date === null ? 0 : weekdayIndex(parseDateKey(active.date));

    return toDateKey(addDays(addWeeks(shownWeekStart, direction), weekday));
}

/**
 * The `moveTask` input that puts a task back where it was picked up (for
 * undo): its list, between the positional tasks that surrounded it.
 */
export function originalSpot(
    active: Task,
    { placement, tasks }: TaskListRef,
): MoveTaskInput {
    const isDay = placement.date !== null;
    const positional = (task: Task) =>
        task.id !== active.id && (!isDay || task.time === null);
    const index = tasks.findIndex((task) => task.id === active.id);

    return {
        ...placement,
        afterId: tasks.slice(0, Math.max(index, 0)).findLast(positional)?.id,
        beforeId: tasks.slice(index + 1).find(positional)?.id,
    };
}

/** Where `active` lands when dropped on `target` (`null`: nowhere new). */
export function resolveDrop(
    active: Task,
    target: DropTarget,
    shownWeekStart: Date,
): DropResult | null {
    switch (target.type) {
        case 'edge': {
            const date = edgeDropDate(active, shownWeekStart, target.direction);

            return date === active.date
                ? null
                : { move: { date }, indicator: null };
        }
        case 'list':
            return resolveListDrop(
                active,
                target.placement,
                target.tasks,
                target.tasks.length,
            );
        case 'task': {
            const index = target.tasks.findIndex(
                (task) => task.id === target.taskId,
            );

            if (index === -1) {
                return resolveListDrop(
                    active,
                    target.placement,
                    target.tasks,
                    target.tasks.length,
                );
            }

            return resolveListDrop(
                active,
                target.placement,
                target.tasks,
                target.below ? index + 1 : index,
            );
        }
    }
}
