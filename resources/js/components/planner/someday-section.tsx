import { TaskList } from '@/components/planner/task-list';
import { useSomedayTasks } from '@/hooks/use-tasks';
import { SOMEDAY_COLUMNS } from '@/lib/db/types';
import { SOMEDAY_ROWS } from '@/lib/planner/week';

type Props = {
    weekStart: Date;
    /** 'YYYY-MM-DD' of today. */
    today: string;
    onOpenTask: (taskId: string) => void;
};

const SOMEDAY_PLACEMENT = { date: null } as const;

/**
 * Undated tasks below the week: one list, laid out on desktop as three ruled
 * columns across the full width (filled top to bottom, then left to right).
 * Tasks done in an earlier week are archived and not shown.
 */
export function SomedaySection({ weekStart, today, onOpenTask }: Props) {
    const tasks = useSomedayTasks(weekStart, today);

    return (
        <section aria-labelledby="someday-title" className="flex flex-col">
            <h2
                id="someday-title"
                className="border-b-2 border-foreground pb-3 text-lg leading-7 font-bold tracking-tight lg:border-b-0 lg:pb-0 lg:text-xl lg:leading-[3.25rem]"
            >
                Someday
            </h2>
            <TaskList
                placement={SOMEDAY_PLACEMENT}
                tasks={tasks}
                rows={SOMEDAY_ROWS}
                columns={SOMEDAY_COLUMNS.length}
                newTaskLabel="New Someday task"
                onOpenTask={onOpenTask}
                className="gap-x-6"
                columnTopClassName="lg:border-t lg:border-border"
            />
        </section>
    );
}
