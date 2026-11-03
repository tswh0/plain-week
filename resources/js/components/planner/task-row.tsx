import { useSortable } from '@dnd-kit/sortable';
import { CircleCheck, GripVertical, Repeat } from 'lucide-react';
import {
    CURSOR_ROW_CLASS,
    useCursorFocus,
    useKeyboardCursor,
} from '@/components/planner/keyboard-cursor';
import { usePlannerDnd } from '@/components/planner/planner-dnd';
import { useScopedAction } from '@/components/planner/scope-prompt';
import { ShortcutHint } from '@/components/planner/shortcut-hint';
import { TaskContextMenu } from '@/components/planner/task-context-menu';
import { Button } from '@/components/ui/button';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSeries } from '@/hooks/use-tasks';
import type { TaskPlacement } from '@/lib/db/tasks';
import type { TaskDragData } from '@/lib/planner/drop';
import { summarizeRecurrence } from '@/lib/planner/repeat';
import {
    SOMEDAY_MOVE,
    deleteWithUndo,
    duplicateWithToast,
    moveWithUndo,
    nextWeekMove,
    setTaskColor,
    tomorrowMove,
} from '@/lib/planner/task-actions';
import { TASK_COLOR_STYLES } from '@/lib/planner/task-colors';
import { isRecurring } from '@/lib/recurrence/expand';
import type { PlannerTask } from '@/lib/recurrence/expand';
import { cn } from '@/lib/utils';
import { LinkedText } from './linked-text';

type Props = {
    task: PlannerTask;
    /** The list the row is in, and its tasks in display order (for drops). */
    placement: TaskPlacement;
    tasks: PlannerTask[];
    /** The keyboard cursor is on this task. */
    isCursor?: boolean;
    /** Opens the task (click, Enter or Space on its text). */
    onOpen: (taskId: string) => void;
    onToggleDone: (taskId: string) => void;
    className?: string;
};

type TaskRepeat = {
    /** Shown with the repeat icon: it belongs to a live series. */
    repeats: boolean;
    /** "Every Mon, Wed"; `null` until the series has loaded. */
    summary: string | null;
};

/**
 * Whether a row belongs to a live series, and its rule in words. An exception
 * whose series is gone is a one-off task now.
 */
function useTaskRepeat(task: PlannerTask): TaskRepeat {
    const series = useSeries(isRecurring(task) ? task : null);

    return {
        repeats:
            task.kind === 'occurrence' ||
            (task.kind === 'exception' && Boolean(series)),
        summary: series ? summarizeRecurrence(series.recurrence) : null,
    };
}

/** The repeat icon, with the rule in a tooltip ("Every Mon, Wed"). */
function RepeatIcon({ summary }: { summary: string | null }) {
    // A span carries the tooltip: buttons turn off pointer events on icons.
    const icon = (
        <span
            data-testid="repeat-icon"
            className="ms-1.5 flex shrink-0 opacity-70"
        >
            <Repeat aria-hidden className="size-3" />
        </span>
    );

    return summary ? (
        <Tooltip>
            <TooltipTrigger asChild>{icon}</TooltipTrigger>
            <TooltipContent>{summary}</TooltipContent>
        </Tooltip>
    ) : (
        icon
    );
}

function TaskLabelView({
    task,
    repeat,
}: {
    task: PlannerTask;
    repeat: TaskRepeat;
}) {
    const color = TASK_COLOR_STYLES[task.color];
    // A colored pill keeps a gap from the time pill or repeat icon before it;
    // text without a pill already sits clear of them through its padding.
    const afterBadge =
        Boolean(color.pill) && (Boolean(task.time) || repeat.repeats);

    return (
        <>
            {task.time && (
                <span className="ms-1.5 shrink-0 rounded-full border border-current px-1.5 text-xs leading-5 tabular-nums">
                    {task.time}
                </span>
            )}
            {repeat.repeats && <RepeatIcon summary={repeat.summary} />}
            <span
                className={cn(
                    'truncate rounded-full px-1.5 leading-6',
                    color.pill,
                    afterBadge && 'ms-1',
                    task.done && 'line-through',
                    task.done && color.pill && 'opacity-50',
                )}
            >
                <LinkedText text={task.text} inButton />
            </span>
        </>
    );
}

/**
 * The task's time pill, repeat icon and text pill, as shown in a row (and the
 * drag overlay).
 */
export function TaskLabel({ task }: { task: PlannerTask }) {
    return <TaskLabelView task={task} repeat={useTaskRepeat(task)} />;
}

/**
 * One ruled row showing a task: a button with the text that opens it, and a
 * check button at the end that toggles completion (on hover or focus with a
 * mouse on desktop, always on mobile and touch screens).
 *
 * The whole row is draggable (mouse: after 5px of movement, so a click still
 * opens the task; touch: press, hold and move). For keyboard users a move
 * button, visible only while focused, picks the task up with Space or Enter.
 *
 * Right click, Shift+F10 / the context menu key, or a still touch hold open
 * the task's context menu.
 */
export function TaskRow({
    task,
    placement,
    tasks,
    isCursor = false,
    onOpen,
    onToggleDone,
    className,
}: Props) {
    const openRef = useCursorFocus<HTMLButtonElement>(isCursor);
    // While the keyboard cursor is shown, keys act on its row, not on the
    // hovered one: only the cursor's row shows the hint then.
    const cursorShown = useKeyboardCursor() !== null;
    const repeat = useTaskRepeat(task);
    const label = [
        task.time,
        task.text,
        repeat.repeats ? '(repeats)' : null,
        task.done ? '(done)' : null,
    ]
        .filter(Boolean)
        .join(' ');
    const { setNodeRef, setActivatorNodeRef, listeners, attributes } =
        useSortable({
            id: task.id,
            data: {
                type: 'task',
                task,
                placement,
                tasks,
            } satisfies TaskDragData,
            attributes: { roleDescription: 'movable task' },
        });
    // Dimmed while dragged, and until the drop has been written.
    const isDragging = usePlannerDnd().activeId === task.id;
    const scoped = useScopedAction(task);

    return (
        <TaskContextMenu
            task={task}
            onColorChange={(color) => {
                if (color !== task.color) {
                    void scoped('edit', (scope) =>
                        setTaskColor(task.id, color, scope),
                    );
                }
            }}
            onMoveToTomorrow={() => moveWithUndo(task.id, tomorrowMove(task))}
            onMoveToNextWeek={() => moveWithUndo(task.id, nextWeekMove(task))}
            onMoveToSomeday={() => moveWithUndo(task.id, SOMEDAY_MOVE)}
            onDuplicate={() => duplicateWithToast(task.id)}
            onDelete={() =>
                void scoped('delete', (scope) => deleteWithUndo(task.id, scope))
            }
        >
            <div
                ref={setNodeRef}
                data-task-id={task.id}
                data-cursor={isCursor || undefined}
                {...listeners}
                onContextMenu={(event) => {
                    // No menu for the task being dragged (a touch drag may make
                    // the browser send a long-press contextmenu).
                    if (isDragging) {
                        event.preventDefault();
                    }
                }}
                className={cn(
                    'group/task relative flex h-row items-center gap-1 border-b border-border select-none [-webkit-touch-callout:none]',
                    task.done && 'text-muted-foreground',
                    isDragging && 'opacity-40',
                    // The keyboard cursor, or keyboard focus on the text
                    // button, scrolled clear of the sticky header on phones.
                    CURSOR_ROW_CLASS,
                    'max-lg:scroll-mt-20',
                    className,
                )}
            >
                <Button
                    ref={openRef}
                    type="button"
                    variant="ghost"
                    data-task-open
                    aria-label={label}
                    onClick={() => onOpen(task.id)}
                    // Focus shows on the row as the cursor's look
                    // (`CURSOR_ROW_CLASS`), not as a ring on the button.
                    className="h-full min-w-0 flex-1 justify-start gap-0 rounded-none px-0 text-base font-normal text-inherit hover:bg-transparent hover:text-inherit focus-visible:border-transparent focus-visible:ring-0 active:not-aria-[haspopup]:translate-y-0 lg:text-sm dark:hover:bg-transparent"
                >
                    <TaskLabelView task={task} repeat={repeat} />
                    {/* Grows in on hover: it takes no room until then, and
                        a long text gives way to it instead of being covered. */}
                    <ShortcutHint
                        action="task.open"
                        size="row"
                        className={cn(
                            'ms-auto max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-200 group-data-cursor/task:max-w-8 group-data-cursor/task:opacity-100',
                            !cursorShown &&
                                'group-hover/task:max-w-8 group-hover/task:opacity-100',
                        )}
                    />
                </Button>
                <Button
                    ref={setActivatorNodeRef}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    {...attributes}
                    aria-label={`Move ${task.text}`}
                    className="sr-only shrink-0 rounded-full hover:bg-transparent focus-visible:not-sr-only"
                >
                    <GripVertical className="size-5" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={task.done ? 'Mark as not done' : 'Mark as done'}
                    aria-pressed={task.done}
                    onClick={() => onToggleDone(task.id)}
                    className={cn(
                        // Hidden until hover only for mouse users on desktop; touch
                        // screens of any size always show it.
                        'shrink-0 rounded-full hover:bg-transparent lg:pointer-fine:opacity-0 lg:pointer-fine:group-hover/task:opacity-100 lg:pointer-fine:focus-visible:opacity-100',
                        task.done && 'lg:pointer-fine:opacity-100',
                    )}
                >
                    <CircleCheck
                        className={cn(
                            'size-5',
                            task.done &&
                                'fill-muted-foreground text-background',
                        )}
                    />
                </Button>
            </div>
        </TaskContextMenu>
    );
}
