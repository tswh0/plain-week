import { useCurrentFrame } from 'remotion';
import { Caption } from '../components/caption';
import { Cursor } from '../components/cursor';
import {
    DayColumnView,
    DayHeader,
    EmptyRow,
    TaskLabel,
    TaskRowView,
} from '../components/planner';
import type { DemoTask } from '../components/planner';
import { Card, Floor, Stage, useLayout } from '../components/stage';
import { glide, mix, progress, useSpring } from '../motion';
import { DRAG } from '../timeline';

const FLIGHTS: DemoTask = { text: 'Book flights to Lisbon', color: 'yellow' };
const BANK: DemoTask = { text: 'Call the bank' };

/** Card-local geometry (CSS pixels), matching the layout below. */
const PAD_X = 28;
const PAD_TOP = 32;
const COLUMN = 220;
const GAP = 24;
const HEADER = 40;
const ROW = 42;
const DAY_ROWS = 4;
const SOMEDAY_TOP = PAD_TOP + HEADER + DAY_ROWS * ROW + 32 + 52;

const columnX = (column: number) => PAD_X + column * (COLUMN + GAP);
const dayRowY = (row: number) => PAD_TOP + HEADER + row * ROW;
const somedayRowY = (row: number) => SOMEDAY_TOP + row * ROW;

/** Where each task is grabbed, from the row's top-start corner. */
const GRAB = { x: 70, y: ROW / 2 };

const FLIGHTS_FROM = { x: columnX(0), y: dayRowY(1) };
const FLIGHTS_TO = { x: columnX(1), y: dayRowY(2) };
const BANK_FROM = { x: columnX(0), y: dayRowY(1) };
const BANK_TO = { x: columnX(2), y: somedayRowY(1) };

function Rows({
    tasks,
    rows,
    dimmed,
    arrived,
}: {
    tasks: DemoTask[];
    rows: number;
    /** The task being dragged out of this list. */
    dimmed?: DemoTask;
    /** The task just dropped here, and how far its landing has got (0 → 1). */
    arrived?: { task: DemoTask; t: number };
}) {
    return (
        <>
            {Array.from({ length: rows }, (_, row) => {
                const task = tasks[row];

                if (!task) {
                    return <EmptyRow key={row} />;
                }

                const landing = arrived?.task === task ? arrived.t : 1;

                return (
                    <TaskRowView
                        key={task.text}
                        task={task}
                        className={task === dimmed ? 'opacity-40' : undefined}
                        style={{
                            transform: `scale(${mix(landing, 1.06, 1)})`,
                        }}
                    />
                );
            })}
        </>
    );
}

export function DragDropScene() {
    const frame = useCurrentFrame();
    const enter = useSpring();
    const { square } = useLayout();
    const scale = square ? 1.28 : 1.55;

    const firstDone = frame >= DRAG.firstDrop;
    const secondDone = frame >= DRAG.secondDrop;
    const draggingFirst = frame >= DRAG.firstGrab && !firstDone;
    const draggingSecond = frame >= DRAG.secondGrab && !secondDone;

    const tuesday: DemoTask[] = [
        { text: 'Gym', time: '17:30', repeats: true },
        ...(firstDone ? [] : [FLIGHTS]),
        ...(secondDone ? [] : [BANK]),
    ];
    const wednesday: DemoTask[] = [
        { text: 'Dentist', time: '09:00', color: 'cornflower' },
        { text: 'Read 20 pages', repeats: true },
        ...(firstDone ? [FLIGHTS] : []),
    ];
    const someday: DemoTask[][] = [
        [{ text: 'Learn Portuguese basics' }],
        [{ text: 'Gift ideas for Leo', color: 'grey' }],
        [{ text: 'Try the ramen place' }, ...(secondDone ? [BANK] : [])],
    ];

    const pointer = glide(frame, [
        [0, 640, 470],
        [DRAG.firstGrab - 12, 640, 470],
        [DRAG.firstGrab - 2, FLIGHTS_FROM.x + GRAB.x, FLIGHTS_FROM.y + GRAB.y],
        [DRAG.firstGrab + 2, FLIGHTS_FROM.x + GRAB.x, FLIGHTS_FROM.y + GRAB.y],
        [DRAG.firstDrop, FLIGHTS_TO.x + GRAB.x, FLIGHTS_TO.y + GRAB.y],
        [DRAG.secondGrab - 12, FLIGHTS_TO.x + GRAB.x, FLIGHTS_TO.y + GRAB.y],
        [DRAG.secondGrab - 2, BANK_FROM.x + GRAB.x, BANK_FROM.y + GRAB.y],
        [DRAG.secondGrab + 2, BANK_FROM.x + GRAB.x, BANK_FROM.y + GRAB.y],
        [DRAG.secondDrop, BANK_TO.x + GRAB.x, BANK_TO.y + GRAB.y],
        [DRAG.secondDrop + 24, BANK_TO.x + 160, BANK_TO.y + 70],
    ]);
    const dragged = draggingFirst ? FLIGHTS : draggingSecond ? BANK : null;
    const lift = draggingFirst
        ? progress(frame, DRAG.firstGrab, 6)
        : progress(frame, DRAG.secondGrab, 6);
    const tilt = dragged
        ? Math.sin(
              (frame - (draggingFirst ? DRAG.firstGrab : DRAG.secondGrab)) / 6,
          ) * 1.5
        : 0;
    const landing = (at: number) =>
        enter(frame, at, { damping: 12, stiffness: 220 });

    return (
        <Stage>
            <Caption
                text="Drag it to *another day.*"
                at={4}
                out={DRAG.secondGrab - 6}
            />
            <Caption
                text="Or park it for *Someday.*"
                at={DRAG.secondGrab - 2}
            />
            <Floor
                scale={scale}
                top={square ? 650 : 640}
                enter={enter(frame, 2)}
            >
                <Card className="relative p-7 pt-8">
                    <div className="grid grid-cols-3 gap-x-6">
                        <DayColumnView
                            width={220}
                            header={<DayHeader day="13 Oct" weekday="Tue" />}
                        >
                            <Rows
                                tasks={tuesday}
                                rows={DAY_ROWS}
                                dimmed={dragged ?? undefined}
                            />
                        </DayColumnView>
                        <DayColumnView
                            width={220}
                            header={<DayHeader day="14 Oct" weekday="Wed" />}
                        >
                            <Rows
                                tasks={wednesday}
                                rows={DAY_ROWS}
                                arrived={{
                                    task: FLIGHTS,
                                    t: landing(DRAG.firstDrop),
                                }}
                            />
                        </DayColumnView>
                        <DayColumnView
                            isToday
                            width={220}
                            header={
                                <DayHeader day="15 Oct" weekday="Thu" isToday />
                            }
                        >
                            <Rows
                                tasks={[
                                    { text: 'Lunch with Mia', time: '13:30' },
                                    {
                                        text: 'Ship the release',
                                        color: 'green',
                                    },
                                ]}
                                rows={DAY_ROWS}
                            />
                        </DayColumnView>
                    </div>
                    <h2 className="mt-8 text-xl leading-[3.25rem] font-bold tracking-tight">
                        Someday
                    </h2>
                    <div className="grid grid-cols-3 gap-x-6">
                        {someday.map((tasks, column) => (
                            <div
                                key={column}
                                className="flex w-[220px] flex-col border-t border-border"
                            >
                                <Rows
                                    tasks={tasks}
                                    rows={2}
                                    arrived={{
                                        task: BANK,
                                        t: landing(DRAG.secondDrop),
                                    }}
                                />
                            </div>
                        ))}
                    </div>

                    {dragged && (
                        <div
                            className="absolute flex h-row w-[220px] items-center rounded-md bg-background text-sm shadow-lg ring-1 ring-border"
                            style={{
                                left: pointer.x - GRAB.x,
                                top: pointer.y - GRAB.y,
                                transform: `rotate(${tilt}deg) scale(${mix(lift, 1, 1.04)})`,
                                boxShadow: `0 ${mix(lift, 2, 18)}px ${mix(lift, 6, 36)}px -8px rgb(0 0 0 / 0.3)`,
                            }}
                        >
                            <TaskLabel task={dragged} />
                        </div>
                    )}

                    <Cursor
                        x={pointer.x}
                        y={pointer.y}
                        scale={scale}
                        grabbing={dragged !== null}
                        pressAt={[DRAG.firstGrab, DRAG.secondGrab]}
                        opacity={progress(frame, 6, 8)}
                    />
                </Card>
            </Floor>
        </Stage>
    );
}
