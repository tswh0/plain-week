import { CornerDownLeft } from 'lucide-react';
import { useCurrentFrame } from 'remotion';
import { Kbd } from '@/components/ui/kbd';
import { Caption } from '../components/caption';
import {
    DayColumnView,
    DayHeader,
    EmptyRow,
    TaskRowView,
    TypingRow,
} from '../components/planner';
import type { DemoTask } from '../components/planner';
import { Card, Floor, Stage, useLayout } from '../components/stage';
import { mix, progress, typed, useSpring } from '../motion';
import { FAST_ENTRY } from '../timeline';
import type { Typing } from '../timeline';

const { first, firstEnter, second, secondEnter } = FAST_ENTRY;

/** A row that is typed into, then turns into a task when Enter is pressed. */
function EntryRow({
    typing,
    enter,
    task,
    liftAt,
}: {
    typing: Typing;
    enter: number;
    task: DemoTask;
    liftAt: number;
}) {
    const frame = useCurrentFrame();
    const spring = useSpring();

    if (frame < liftAt) {
        return <EmptyRow />;
    }

    if (frame < enter) {
        return (
            <TypingRow
                frame={frame}
                text={typed(frame, typing.text, typing.start, typing.perChar)}
            />
        );
    }

    const pill = spring(frame, enter, { damping: 10, stiffness: 200 });
    const flash = 1 - progress(frame, enter, 18);

    return (
        <TaskRowView
            task={task}
            timeStyle={{
                display: 'inline-block',
                transform: `scale(${mix(pill, 0.5, 1)})`,
                boxShadow: `0 0 0 ${flash * 6}px color-mix(in oklab, var(--planner-accent) ${flash * 35}%, transparent)`,
            }}
        />
    );
}

export function FastEntryScene() {
    const frame = useCurrentFrame();
    const enter = useSpring();
    const { square } = useLayout();
    const keyPress = [firstEnter, secondEnter].reduce(
        (amount, at) =>
            Math.max(
                amount,
                progress(frame, at - 3, 3) - progress(frame, at + 2, 6),
            ),
        0,
    );
    const keyShown = enter(frame, first.start + 6);

    return (
        <Stage>
            <Caption text="Type. Enter. *Keep typing.*" at={4} />
            <Caption
                text="“17:30 Gym” sets the time for you."
                at={firstEnter + 2}
                size="sub"
                top={square ? 250 : 246}
            />
            <Floor
                scale={square ? 1.75 : 2.05}
                top={square ? 600 : 640}
                enter={enter(frame, 2)}
            >
                <div className="relative">
                    <Card className="w-[340px] overflow-hidden">
                        <DayColumnView
                            isToday
                            className="m-0 rounded-none px-6 pt-7 pb-6"
                            header={
                                <DayHeader day="15 Oct" weekday="Thu" isToday />
                            }
                        >
                            <TaskRowView
                                task={{ text: 'Lunch with Mia', time: '13:30' }}
                            />
                            <EntryRow
                                typing={first}
                                enter={firstEnter}
                                liftAt={first.start - 8}
                                task={{ text: 'Gym', time: '17:30' }}
                            />
                            <EntryRow
                                typing={second}
                                enter={secondEnter}
                                liftAt={firstEnter + 6}
                                task={{ text: 'Call the bank' }}
                            />
                            {/* The next row lifts, ready for the next task. */}
                            {frame >= secondEnter + 6 ? (
                                <TypingRow frame={frame} text="" />
                            ) : (
                                <EmptyRow />
                            )}
                            <EmptyRow />
                        </DayColumnView>
                    </Card>
                    {/* Beside the column, or under it in the square cut. */}
                    <div
                        className={
                            square
                                ? 'absolute start-1/2 top-full mt-5'
                                : 'absolute start-full top-1/2 ms-6'
                        }
                        style={{
                            opacity: keyShown,
                            transform: `${square ? 'translateX(-50%)' : 'translateY(-50%)'} translateY(${keyPress * 3}px) scale(${mix(keyShown, 0.8, 1) * (1 - keyPress * 0.06)})`,
                        }}
                    >
                        <Kbd
                            className="h-auto rounded-xl bg-background px-3 py-2 text-base text-foreground shadow-[0_3px_0_0_var(--border),0_10px_24px_-10px_rgb(0_0_0/0.3)] ring-1 ring-foreground/10"
                            style={{
                                boxShadow:
                                    keyPress > 0.5
                                        ? '0 1px 0 0 var(--border)'
                                        : undefined,
                            }}
                        >
                            <CornerDownLeft className="size-4" />
                            Enter
                        </Kbd>
                    </div>
                </div>
            </Floor>
        </Stage>
    );
}
