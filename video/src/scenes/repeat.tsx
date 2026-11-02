import { useCurrentFrame } from 'remotion';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { Caption } from '../components/caption';
import { Cursor } from '../components/cursor';
import {
    DayColumnView,
    DayHeader,
    EmptyRow,
    TaskRowView,
} from '../components/planner';
import { Floor, Stage, useLayout } from '../components/stage';
import { glide, mix, progress, useSpring } from '../motion';
import { REPEAT } from '../timeline';

/** SELECTED_CLASS in task-dialog/task-repeat-picker.tsx. */
const SELECTED_CLASS =
    'data-[state=on]:bg-foreground data-[state=on]:text-background';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DAYS = [
    { day: '12 Oct', weekday: 'Mon' },
    { day: '13 Oct', weekday: 'Tue' },
    { day: '14 Oct', weekday: 'Wed' },
    { day: '15 Oct', weekday: 'Thu', isToday: true },
    { day: '16 Oct', weekday: 'Fri' },
];

/** Monday is the task's own day; Wednesday and Friday get picked. */
const PICKED = [
    { weekday: 'Wed', at: REPEAT.days[0] },
    { weekday: 'Fri', at: REPEAT.days[1] },
];

/** Pointer targets in the popover's own pixels. */
const WEEKLY = { x: 196, y: 32 };
const DAY_X: Record<string, number> = { Wed: 120, Fri: 204 };
const DAY_Y = 80;
const APPLY = { x: 160, y: 200 };

/** Weekdays, their note and the Ends row, in CSS pixels. */
const WEEKLY_OPTIONS_HEIGHT = 104;

/** The repeat picker's popover (task-repeat-picker.tsx), mid-edit. */
function RepeatPopover({ frame, scale }: { frame: number; scale: number }) {
    const weekly = frame >= REPEAT.weekly;
    const weekdays = [
        'Mon',
        ...PICKED.filter(({ at }) => frame >= at).map(({ weekday }) => weekday),
    ];
    const applied = frame >= REPEAT.apply;
    const open = progress(frame, REPEAT.weekly, 10);
    const pointer = glide(frame, [
        [0, 300, 150],
        [REPEAT.weekly - 12, 300, 150],
        [REPEAT.weekly - 2, WEEKLY.x, WEEKLY.y],
        [REPEAT.days[0] - 8, WEEKLY.x, WEEKLY.y],
        [REPEAT.days[0] - 1, DAY_X.Wed, DAY_Y],
        [REPEAT.days[1] - 6, DAY_X.Wed, DAY_Y],
        [REPEAT.days[1] - 1, DAY_X.Fri, DAY_Y],
        [REPEAT.apply - 8, DAY_X.Fri, DAY_Y],
        [REPEAT.apply - 1, APPLY.x, APPLY.y],
        [REPEAT.apply + 30, APPLY.x + 120, APPLY.y + 60],
    ]);

    return (
        <div className="relative flex w-80 flex-col gap-4 rounded-3xl bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/5">
            <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={weekly ? 'weekly' : 'never'}
                className="w-full"
            >
                {['Never', 'Daily', 'Weekly', 'Monthly'].map((label) => (
                    <ToggleGroupItem
                        key={label}
                        value={label.toLowerCase()}
                        className={cn('flex-1', SELECTED_CLASS)}
                    >
                        {label}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
            {/* Weekly's options open up under the kinds once it is picked. */}
            <div
                className="flex flex-col gap-4 overflow-hidden"
                style={{
                    height: mix(open, 0, WEEKLY_OPTIONS_HEIGHT),
                    marginTop: mix(open, -16, 0),
                    opacity: open,
                }}
            >
                <div className="flex flex-col gap-2">
                    <ToggleGroup
                        type="multiple"
                        size="sm"
                        spacing={1}
                        value={weekly ? weekdays : []}
                        className="w-full justify-between"
                    >
                        {WEEKDAYS.map((weekday) => (
                            <ToggleGroupItem
                                key={weekday}
                                value={weekday}
                                className={cn(
                                    'min-w-0 flex-1 px-0 text-xs',
                                    SELECTED_CLASS,
                                )}
                            >
                                {weekday}
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                    <p className="text-xs text-muted-foreground">
                        Always on Monday, the task's day.
                    </p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <span>Ends</span>
                    <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                    >
                        Never
                    </Button>
                </div>
            </div>
            <Button
                className="w-full rounded-full"
                style={{
                    filter: applied
                        ? `brightness(${mix(progress(frame, REPEAT.apply, 8), 0.85, 1)})`
                        : undefined,
                }}
            >
                Apply
            </Button>
            <Cursor
                x={pointer.x}
                y={pointer.y}
                scale={scale}
                pressAt={[REPEAT.weekly, ...REPEAT.days, REPEAT.apply]}
                opacity={progress(frame, 6, 8)}
            />
        </div>
    );
}

/** Monday to Friday, where Gym shows up on its days once applied. */
function WeekStrip({ frame }: { frame: number }) {
    const enter = useSpring();
    const { square } = useLayout();
    // Monday to Thursday fit the square cut at a readable size.
    const days = square ? DAYS.slice(0, 4) : DAYS;

    return (
        <div className="flex gap-4 rounded-3xl bg-background p-6 pt-7 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.25)] ring-1 ring-foreground/5">
            {days.map((day) => {
                const index = ['Mon', 'Wed', 'Fri'].indexOf(day.weekday);
                const t =
                    index === -1
                        ? 0
                        : enter(frame, REPEAT.apply + 6 + index * 5, {
                              damping: 12,
                              stiffness: 200,
                          });

                return (
                    <DayColumnView
                        key={day.day}
                        isToday={day.isToday}
                        width={square ? 150 : 132}
                        header={
                            <DayHeader
                                day={day.day}
                                weekday={day.weekday}
                                isToday={day.isToday}
                            />
                        }
                    >
                        {index === -1 || t <= 0.01 ? (
                            <EmptyRow />
                        ) : (
                            <TaskRowView
                                task={{
                                    text: 'Gym',
                                    time: '17:30',
                                    repeats: true,
                                }}
                                style={{
                                    opacity: Math.min(1, t * 1.3),
                                    transform: `translateY(${mix(t, -10, 0)}px) scale(${mix(t, 0.9, 1)})`,
                                }}
                            />
                        )}
                        <EmptyRow />
                    </DayColumnView>
                );
            })}
        </div>
    );
}

export function RepeatScene() {
    const frame = useCurrentFrame();
    const enter = useSpring();
    const { square } = useLayout();
    const floorScale = square ? 1.28 : 1.45;
    const popoverScale = square ? 1.1 : 1.15;

    return (
        <Stage>
            <Caption text="Make it a *habit.*" at={4} />
            <Caption
                text="Every N days, weekdays or monthly."
                at={12}
                size="sub"
                top={square ? 250 : 246}
            />
            <Floor
                scale={floorScale}
                top={square ? 660 : 640}
                enter={enter(frame, 2)}
            >
                <div
                    className={cn(
                        'flex items-center gap-16',
                        square && 'flex-col gap-14',
                    )}
                >
                    <div style={{ transform: `scale(${popoverScale})` }}>
                        <RepeatPopover
                            frame={frame}
                            scale={floorScale * popoverScale}
                        />
                    </div>
                    <WeekStrip frame={frame} />
                </div>
            </Floor>
        </Stage>
    );
}
