import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Caption } from '../components/caption';
import {
    DayColumnView,
    DayHeader,
    EmptyRow,
    TaskRowView,
} from '../components/planner';
import { Card, Floor, Stage, useLayout } from '../components/stage';
import { WEEK } from '../demo-week';
import { progress, useSpring } from '../motion';
import { DARK_MODE } from '../timeline';

const ROWS = 4;

function Content({ enter }: { enter: number }) {
    const { square } = useLayout();
    const days = square ? WEEK.slice(3, 5) : WEEK.slice(3, 6);

    return (
        <Stage>
            <Caption text="Light or *dark.*" at={4} />
            <Caption
                text="And right-to-left layouts, too."
                at={12}
                size="sub"
                top={square ? 250 : 246}
            />
            <Floor scale={square ? 1.75 : 1.8} top={640} enter={enter}>
                <Card className="flex gap-6 p-7 pt-8">
                    {days.map((day) => (
                        <DayColumnView
                            key={day.day}
                            isToday={day.isToday}
                            width={220}
                            header={
                                <DayHeader
                                    day={day.day}
                                    weekday={day.weekday}
                                    isToday={day.isToday}
                                    isWeekend={day.isWeekend}
                                />
                            }
                        >
                            {Array.from({ length: ROWS }, (_, row) =>
                                day.tasks[row] ? (
                                    <TaskRowView
                                        key={row}
                                        task={day.tasks[row]}
                                    />
                                ) : (
                                    <EmptyRow key={row} />
                                ),
                            )}
                        </DayColumnView>
                    ))}
                </Card>
            </Floor>
        </Stage>
    );
}

/**
 * The same components in light, then a circle that grows from the middle and
 * shows them under the `.dark` tokens.
 */
export function DarkModeScene() {
    const frame = useCurrentFrame();
    const enter = useSpring()(frame, 2);
    const reveal = progress(frame, DARK_MODE.flip, 22);

    return (
        <AbsoluteFill>
            <Content enter={enter} />
            <AbsoluteFill
                className="dark"
                style={{
                    clipPath: `circle(${reveal * 120}% at 50% 60%)`,
                }}
            >
                <Content enter={enter} />
            </AbsoluteFill>
        </AbsoluteFill>
    );
}
