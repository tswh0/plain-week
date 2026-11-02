import { useCurrentFrame } from 'remotion';
import { Caption } from '../components/caption';
import {
    DayColumnView,
    DayHeader,
    EmptyRow,
    TaskRowView,
} from '../components/planner';
import { Card, Floor, Stage, useLayout } from '../components/stage';
import { WEEK } from '../demo-week';
import { mix, progress, useSpring } from '../motion';

const ROWS = 5;

export function WeekScene() {
    const frame = useCurrentFrame();
    const enter = useSpring();
    const { square } = useLayout();
    // Monday to Friday in landscape; around today in the square cut.
    const days = square ? WEEK.slice(2, 5) : WEEK.slice(0, 5);

    return (
        <Stage>
            <Caption text="One week. *One screen.*" at={4} />
            <Floor
                scale={square ? 1.3 : 1.36}
                top={square ? 610 : 600}
                enter={enter(frame, 2)}
            >
                <Card className="flex gap-6 p-7 pt-8">
                    {days.map((day, column) => {
                        const start = 8 + column * 5;
                        const header = enter(frame, start);

                        return (
                            <DayColumnView
                                key={day.day}
                                isToday={day.isToday}
                                width={220}
                                style={{
                                    opacity: header,
                                    transform: `translateY(${mix(header, 24, 0)}px)`,
                                }}
                                header={
                                    <DayHeader
                                        day={day.day}
                                        weekday={day.weekday}
                                        isToday={day.isToday}
                                        isWeekend={day.isWeekend}
                                        rule={progress(frame, start + 4, 16)}
                                    />
                                }
                            >
                                {Array.from({ length: ROWS }, (_, row) => {
                                    const task = day.tasks[row];
                                    const t = enter(
                                        frame,
                                        start + 14 + row * 4,
                                    );

                                    return task ? (
                                        <TaskRowView
                                            key={row}
                                            task={task}
                                            style={{
                                                opacity: t,
                                                transform: `translateX(${mix(t, -14, 0)}px)`,
                                            }}
                                        />
                                    ) : (
                                        <EmptyRow key={row} />
                                    );
                                })}
                            </DayColumnView>
                        );
                    })}
                </Card>
            </Floor>
        </Stage>
    );
}
