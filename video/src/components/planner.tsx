/**
 * Static twins of the planner's rows and day headers. The real components in
 * resources/js/components/planner read Dexie and dnd-kit; these take plain
 * props and carry the same classes, so they look the same. Keep them in step
 * with task-row.tsx, new-task-row.tsx and day-column.tsx.
 */
import { CircleCheck, Repeat } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { TaskColor } from '@/lib/db/types';
import { TASK_COLOR_STYLES } from '@/lib/planner/task-colors';
import { cn } from '@/lib/utils';
import { caretVisible } from '../motion';

export type DemoTask = {
    text: string;
    time?: string;
    color?: TaskColor;
    repeats?: boolean;
    done?: boolean;
};

/** The time pill, repeat icon and text pill (TaskLabelView in task-row.tsx). */
export function TaskLabel({
    task,
    timeStyle,
}: {
    task: DemoTask;
    timeStyle?: CSSProperties;
}) {
    const color = TASK_COLOR_STYLES[task.color ?? 'none'];
    const afterBadge =
        Boolean(color.pill) && (Boolean(task.time) || Boolean(task.repeats));

    return (
        <>
            {task.time && (
                <span
                    className="ms-1.5 shrink-0 rounded-full border border-current px-1.5 text-xs leading-5 tabular-nums"
                    style={timeStyle}
                >
                    {task.time}
                </span>
            )}
            {task.repeats && (
                <span className="ms-1.5 flex shrink-0 opacity-70">
                    <Repeat aria-hidden className="size-3" />
                </span>
            )}
            <span
                className={cn(
                    'truncate rounded-full px-1.5 leading-6',
                    color.pill,
                    afterBadge && 'ms-1',
                    task.done && 'line-through',
                    task.done && color.pill && 'opacity-50',
                )}
            >
                {task.text}
            </span>
        </>
    );
}

/** One ruled row with a task (TaskRow in task-row.tsx). */
export function TaskRowView({
    task,
    className,
    style,
    timeStyle,
}: {
    task: DemoTask;
    className?: string;
    style?: CSSProperties;
    timeStyle?: CSSProperties;
}) {
    return (
        <div
            className={cn(
                'relative flex h-row items-center gap-1 border-b border-border text-sm',
                task.done && 'text-muted-foreground',
                className,
            )}
            style={style}
        >
            <div className="flex h-full min-w-0 flex-1 items-center">
                <TaskLabel task={task} timeStyle={timeStyle} />
            </div>
            {task.done && (
                <span className="flex size-8 shrink-0 items-center justify-center">
                    <CircleCheck className="size-5 fill-muted-foreground text-background" />
                </span>
            )}
        </div>
    );
}

/** An empty ruled row. */
export function EmptyRow({ className }: { className?: string }) {
    return <div className={cn('h-row border-b border-border', className)} />;
}

/**
 * The new-task row while typing: the input's lifted look from
 * new-task-row.tsx (focus-visible classes), with a caret.
 */
export function TypingRow({
    text,
    frame,
    className,
}: {
    text: string;
    frame: number;
    className?: string;
}) {
    return (
        <div className={cn('relative h-row border-b border-border', className)}>
            <div className="relative z-10 -mx-2 flex h-full w-[calc(100%+1rem)] items-center rounded-sm bg-background px-3.5 text-sm shadow-md">
                <span className="whitespace-pre">{text}</span>
                <span
                    className="ms-px inline-block h-4 w-px bg-foreground"
                    style={{ opacity: caretVisible(frame) ? 1 : 0 }}
                />
            </div>
        </div>
    );
}

/** A day's header: "15 Oct … Thu" over a 2px rule (day-column.tsx). */
export function DayHeader({
    day,
    weekday,
    isToday = false,
    isWeekend = false,
    rule = 1,
}: {
    day: string;
    weekday: string;
    isToday?: boolean;
    isWeekend?: boolean;
    /** How much of the rule is drawn, 0 → 1 (start to end). */
    rule?: number;
}) {
    return (
        <h2
            className={cn(
                'relative flex items-baseline justify-between gap-2 pb-3 text-xl leading-7',
                isToday
                    ? 'text-planner-accent'
                    : isWeekend && 'text-muted-foreground/70',
            )}
        >
            <span className="font-bold tracking-tight">{day}</span>
            <span
                className={cn(
                    'text-muted-foreground/70',
                    isToday
                        ? 'text-planner-accent-muted'
                        : isWeekend && 'text-muted-foreground/50',
                )}
            >
                {weekday}
            </span>
            <span
                className={cn(
                    'absolute start-0 bottom-0 h-0.5 w-full origin-left bg-foreground',
                    isToday
                        ? 'bg-planner-accent'
                        : isWeekend && 'bg-muted-foreground/25',
                )}
                style={{ transform: `scaleX(${rule})` }}
            />
        </h2>
    );
}

/**
 * A day column: header over its rows. Today gets the soft accent tint that
 * bleeds 10px past the column, like the app.
 */
export function DayColumnView({
    header,
    isToday = false,
    width,
    children,
    className,
    style,
}: {
    header: ReactNode;
    isToday?: boolean;
    /** The column's width in CSS pixels; today's tint adds its bleed. */
    width?: number;
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <section
            className={cn(
                'flex min-w-0 flex-col',
                isToday &&
                    '-mx-2.5 -mt-2.5 rounded-t-lg bg-planner-accent/6 px-2.5 pt-2.5 dark:bg-planner-accent/10',
                className,
            )}
            style={{
                width:
                    width === undefined
                        ? undefined
                        : width + (isToday ? 20 : 0),
                ...style,
            }}
        >
            {header}
            {children}
        </section>
    );
}
