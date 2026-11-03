import { useDroppable } from '@dnd-kit/core';
import {
    SortableContext,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Fragment, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { toast } from 'sonner';
import {
    useKeyboardCursor,
    useKeyboardCursorApi,
} from '@/components/planner/keyboard-cursor';
import { NewTaskRow } from '@/components/planner/new-task-row';
import {
    listDroppableId,
    usePlannerDnd,
} from '@/components/planner/planner-dnd';
import { TaskRow } from '@/components/planner/task-row';
import { createTask, toggleDone } from '@/lib/db/tasks';
import type { TaskPlacement } from '@/lib/db/tasks';
import type { PlannerTask } from '@/lib/recurrence/expand';
import { placementKey } from '@/lib/planner/drop';
import { rowKey } from '@/lib/planner/repeat';
import type { ListDropData } from '@/lib/planner/drop';
import { parseSmartTime } from '@/lib/planner/smart-time';
import { cn } from '@/lib/utils';

type Props = {
    /** The day or the Someday list this list shows. */
    placement: TaskPlacement;
    /** Sorted tasks; `undefined` while the first local read is in progress. */
    tasks: PlannerTask[] | undefined;
    /**
     * Ruled rows to fill on desktop (per column). Mobile shows a single empty
     * row.
     */
    rows: number;
    /**
     * Columns the list is laid out in on desktop, filled top to bottom and
     * then left to right; each column gets as many rows as the fullest needs.
     * On phones the columns stack into one list. Default 1.
     */
    columns?: number;
    /** Classes of the first row of each column when `columns` is more than 1. */
    columnTopClassName?: string;
    /** Accessible label of the empty rows, e.g. "New task for Mon 12 Oct". */
    newTaskLabel: string;
    onOpenTask: (taskId: string) => void;
    className?: string;
};

/** The insertion line shown while a dragged task is over this spot. */
function DropIndicator() {
    return (
        <div data-drop-indicator className="relative h-0">
            <div className="absolute inset-x-0 -top-px z-[11] h-0.5 rounded-full bg-primary" />
        </div>
    );
}

/**
 * A ruled list: the tasks, then empty rows that add new ones. Every empty row
 * appends to the end of the list, so none sits between two tasks, also when
 * the list is laid out in several columns. Empty rows are keyed by their slot
 * (row position), so adding a task only unmounts the row it replaces and an
 * input the user is in stays put. Creating with Enter moves focus to the next
 * empty slot after the new task, so typing can go on.
 */
export function TaskList({
    placement,
    tasks,
    rows,
    columns = 1,
    columnTopClassName,
    newTaskLabel,
    onOpenTask,
    className,
}: Props) {
    const emptyInputs = useRef(new Map<number, HTMLInputElement>());
    const focusAfterCreate = useRef(false);
    const taskCount = tasks?.length ?? 0;
    const listKey = placementKey(placement);
    const listTasks = tasks ?? [];
    const { setNodeRef } = useDroppable({
        id: listDroppableId(listKey),
        data: {
            type: 'list',
            placement,
            tasks: listTasks,
        } satisfies ListDropData,
    });
    const { indicator } = usePlannerDnd();
    const indicatorBefore =
        indicator?.listKey === listKey ? indicator.beforeTaskId : undefined;
    // Room for every task plus at least one empty row.
    const rowsPerColumn = Math.max(rows, Math.ceil((taskCount + 1) / columns));
    const emptyRows = rowsPerColumn * columns - taskCount;
    const cursor = useKeyboardCursor();
    const { registerList, returnToList } = useKeyboardCursorApi();
    const cursorOnNewRow =
        cursor?.listKey === listKey && cursor.taskId === null;

    // Tell the keyboard cursor what this list shows.
    useLayoutEffect(() => {
        if (tasks !== undefined) {
            return registerList(listKey, { placement, tasks });
        }
    }, [registerList, listKey, placement, tasks]);

    // When the row that had focus was replaced by its task (no empty row was
    // left below it), continue in the first empty row.
    useLayoutEffect(() => {
        if (!focusAfterCreate.current) {
            return;
        }

        focusAfterCreate.current = false;

        // The keyboard cursor may have focused the new-task row itself.
        if (!document.activeElement?.matches('[data-new-task-row] input')) {
            emptyInputs.current.get(taskCount)?.focus();
        }
    }, [taskCount]);

    const handleSubmit = (input: string, via: 'enter' | 'blur') => {
        const { text, time } = parseSmartTime(input);

        createTask({ ...placement, text, time }).catch(() =>
            toast.error(`Could not save "${input}".`),
        );

        if (via === 'enter') {
            // The new task takes the first empty slot; the next one stays.
            focusAfterCreate.current = true;
            emptyInputs.current.get(taskCount + 1)?.focus();
        }
    };

    // Esc leaves the list, even right after Enter while the task still saves,
    // and puts the keyboard cursor on this list's new-task row.
    const handleCancel = () => {
        focusAfterCreate.current = false;
        returnToList(listKey);
    };

    const handleToggleDone = (taskId: string) => {
        toggleDone(taskId).catch(() =>
            toast.error('Could not update the task.'),
        );
    };

    const multiColumn = columns > 1;

    // In columns, every slot is one grid cell that keeps its place in the DOM
    // when the layout reflows (the grid flows top to bottom, then left to
    // right), so rows never remount and focus stays put.
    const cell = (key: string, slot: number, content: ReactNode) =>
        multiColumn ? (
            <div
                key={key}
                className={cn(
                    'flex flex-col',
                    slot % rowsPerColumn === 0 && columnTopClassName,
                )}
            >
                {content}
            </div>
        ) : (
            <Fragment key={key}>{content}</Fragment>
        );

    return (
        <div
            ref={setNodeRef}
            data-list={listKey}
            className={cn(
                multiColumn
                    ? 'grid grid-cols-1 lg:grid-flow-col lg:grid-cols-[repeat(var(--list-columns),minmax(0,1fr))] lg:grid-rows-[repeat(var(--list-rows),auto)]'
                    : 'flex flex-col',
                className,
            )}
            style={
                multiColumn
                    ? ({
                          '--list-columns': columns,
                          '--list-rows': rowsPerColumn,
                      } as CSSProperties)
                    : undefined
            }
        >
            <SortableContext
                items={listTasks.map((task) => task.id)}
                strategy={verticalListSortingStrategy}
            >
                {listTasks.map((task, index) =>
                    cell(
                        rowKey(task),
                        index,
                        <>
                            {indicatorBefore === task.id && <DropIndicator />}
                            <TaskRow
                                task={task}
                                isCursor={cursor?.taskId === task.id}
                                placement={placement}
                                tasks={listTasks}
                                onOpen={onOpenTask}
                                onToggleDone={handleToggleDone}
                            />
                            {indicatorBefore === null &&
                                index === taskCount - 1 && <DropIndicator />}
                        </>,
                    ),
                )}
            </SortableContext>
            {Array.from({ length: emptyRows }, (_, index) => {
                const slot = taskCount + index;

                return cell(
                    `new-${slot}`,
                    slot,
                    <>
                        {indicatorBefore === null && slot === 0 && (
                            <DropIndicator />
                        )}
                        <NewTaskRow
                            ref={(input) => {
                                if (input) {
                                    emptyInputs.current.set(slot, input);
                                }

                                return () => {
                                    emptyInputs.current.delete(slot);
                                };
                            }}
                            label={newTaskLabel}
                            // The first empty row is the list's cursor stop
                            // (the only one shown on phones).
                            isCursor={index === 0 && cursorOnNewRow}
                            onSubmit={handleSubmit}
                            onCancel={handleCancel}
                            className={index > 0 ? 'max-lg:hidden' : undefined}
                        />
                    </>,
                );
            })}
        </div>
    );
}
