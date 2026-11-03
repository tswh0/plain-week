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

/**
 * Undated tasks below the week: three ruled columns across the full width.
 * Tasks done in an earlier week are archived and not shown.
 */
export function SomedaySection({ weekStart, today, onOpenTask }: Props) {
    const columns = useSomedayTasks(weekStart, today);

    return (
        <section aria-labelledby="someday-title" className="flex flex-col">
            <h2
                id="someday-title"
                className="border-b-2 border-foreground pb-3 text-lg leading-7 font-bold tracking-tight lg:border-b-0 lg:pb-0 lg:text-xl lg:leading-[3.25rem]"
            >
                Someday
            </h2>
            <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-3">
                {SOMEDAY_COLUMNS.map((column) => (
                    <TaskList
                        key={column}
                        placement={{ date: null, someday_column: column }}
                        tasks={columns?.[column]}
                        rows={SOMEDAY_ROWS}
                        newTaskLabel={`New Someday task (column ${column + 1})`}
                        onOpenTask={onOpenTask}
                        className="lg:border-t lg:border-border"
                    />
                ))}
            </div>
        </section>
    );
}
