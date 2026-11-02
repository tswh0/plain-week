import {
    CalendarDays,
    CircleCheck,
    Clock,
    Ellipsis,
    Plus,
    Repeat,
    Trash2,
} from 'lucide-react';
import { useCurrentFrame } from 'remotion';
import { TaskColorSwatch } from '@/components/planner/task-color-swatch';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TASK_COLORS } from '@/lib/db/types';
import { TASK_COLOR_STYLES } from '@/lib/planner/task-colors';
import { cn } from '@/lib/utils';
import { Caption } from '../components/caption';
import { Cursor } from '../components/cursor';
import { Floor, Stage, useLayout } from '../components/stage';
import { glide, mix, progress, useSpring } from '../motion';
import { DIALOG } from '../timeline';

/** TOOLBAR_BUTTON_CLASS in task-dialog/toolbar-tooltip.tsx. */
const TOOLBAR_BUTTON_CLASS =
    'rounded-full aria-expanded:bg-foreground aria-expanded:text-background';

const SUBTASKS = [
    'Update the changelog',
    'Tag v1.0.0',
    'Check the Docker image',
    'Write the announcement',
];

/** Where the pointer goes, in the dialog's own pixels. */
const COLOR_BUTTON = { x: 446, y: 42 };
const GREEN_SWATCH = { x: 342, y: 134 };
const SUBTASK_Y = [270, 302];
const CHECKBOX_X = 32;

export function DialogScene() {
    const frame = useCurrentFrame();
    const enter = useSpring();
    const { square } = useLayout();
    const scale = square ? 1.75 : 1.8;
    const pickerOpen =
        frame >= DIALOG.openPicker && frame < DIALOG.pickColor + 8;
    const picker = enter(frame, DIALOG.openPicker, {
        damping: 20,
        stiffness: 260,
    });
    const color = frame >= DIALOG.pickColor ? 'green' : 'none';
    const ticked = [
        frame >= DIALOG.tickFirst,
        frame >= DIALOG.tickSecond,
        false,
        false,
    ];
    const pointer = glide(frame, [
        [0, 560, 360],
        [DIALOG.openPicker - 14, 560, 360],
        [DIALOG.openPicker - 2, COLOR_BUTTON.x, COLOR_BUTTON.y],
        [DIALOG.pickColor - 12, COLOR_BUTTON.x, COLOR_BUTTON.y],
        [DIALOG.pickColor - 2, GREEN_SWATCH.x, GREEN_SWATCH.y],
        [DIALOG.tickFirst - 12, GREEN_SWATCH.x, GREEN_SWATCH.y],
        [DIALOG.tickFirst - 2, CHECKBOX_X, SUBTASK_Y[0]],
        [DIALOG.tickSecond - 6, CHECKBOX_X, SUBTASK_Y[0]],
        [DIALOG.tickSecond - 1, CHECKBOX_X, SUBTASK_Y[1]],
        [DIALOG.tickSecond + 30, 600, 420],
    ]);

    return (
        <Stage>
            <Caption text="Colors, notes, *checklists.*" at={4} />
            <Caption
                text="All in one task dialog."
                at={14}
                size="sub"
                top={square ? 250 : 246}
            />
            <Floor
                scale={scale}
                top={square ? 650 : 680}
                enter={enter(frame, 2)}
            >
                <div className="relative grid w-[512px] gap-4 rounded-4xl bg-secondary p-6 text-sm text-secondary-foreground shadow-xl ring-1 ring-foreground/5">
                    <div className="-mx-2 -mt-1 flex min-w-0 items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={`${TOOLBAR_BUTTON_CLASS} font-medium`}
                        >
                            <CalendarDays data-icon="inline-start" />
                            Thu, 15 Oct 2026
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            className={TOOLBAR_BUTTON_CLASS}
                        >
                            <Clock />
                        </Button>
                        <div className="ms-auto flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className={TOOLBAR_BUTTON_CLASS}
                            >
                                <Trash2 />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className={TOOLBAR_BUTTON_CLASS}
                            >
                                <Repeat className="opacity-60" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-expanded={pickerOpen}
                                className={cn(
                                    TOOLBAR_BUTTON_CLASS,
                                    'group/color',
                                )}
                            >
                                <span
                                    className={cn(
                                        'size-4 rounded-full group-aria-expanded/color:ring-2 group-aria-expanded/color:ring-background',
                                        color === 'none'
                                            ? 'border-2 border-current'
                                            : TASK_COLOR_STYLES[color].swatch,
                                    )}
                                />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className={TOOLBAR_BUTTON_CLASS}
                            >
                                <Ellipsis />
                            </Button>
                        </div>
                    </div>

                    <div className="mt-6 flex items-start gap-2 border-b border-foreground/30 pb-1">
                        <p className="flex-1 text-2xl leading-snug font-medium">
                            Ship the release
                        </p>
                        <span className="mt-0.5 flex size-8 items-center justify-center">
                            <CircleCheck className="size-5" />
                        </span>
                    </div>
                    <p className="min-h-10 leading-relaxed">
                        Changelog, tag, then the Docker image.
                        <br />
                        Announce it once the image is on GHCR.
                    </p>

                    <ul className="flex flex-col">
                        {SUBTASKS.map((text, index) => {
                            const tick = ticked[index];
                            const pop = tick
                                ? enter(
                                      frame,
                                      index === 0
                                          ? DIALOG.tickFirst
                                          : DIALOG.tickSecond,
                                      { damping: 9, stiffness: 260 },
                                  )
                                : 1;

                            return (
                                <li
                                    key={text}
                                    className="flex h-8 items-center gap-2"
                                >
                                    <Checkbox
                                        checked={tick}
                                        className="rounded-full"
                                        style={{
                                            transform: `scale(${mix(pop, 0.6, 1)})`,
                                        }}
                                    />
                                    <span
                                        className={cn(
                                            'flex-1',
                                            tick &&
                                                'text-muted-foreground line-through',
                                        )}
                                    >
                                        {text}
                                    </span>
                                </li>
                            );
                        })}
                        <li className="flex h-8 items-center gap-2 text-muted-foreground">
                            <Plus className="size-4 shrink-0" />
                            Add subtask...
                        </li>
                    </ul>

                    {pickerOpen && (
                        <div
                            className="absolute end-[40px] top-[62px] origin-top-right rounded-3xl bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-foreground/5"
                            style={{
                                opacity:
                                    Math.min(1, picker * 1.4) *
                                    (1 -
                                        progress(
                                            frame,
                                            DIALOG.pickColor + 3,
                                            5,
                                        )),
                                transform: `scale(${mix(picker, 0.9, 1)})`,
                            }}
                        >
                            <ToggleGroup
                                type="single"
                                value={color}
                                spacing={1}
                                className="grid grid-cols-5"
                            >
                                {TASK_COLORS.map((swatch) => (
                                    <ToggleGroupItem
                                        key={swatch}
                                        value={swatch}
                                        aria-label={
                                            TASK_COLOR_STYLES[swatch].label
                                        }
                                        className="size-9 rounded-full p-0 data-[state=on]:bg-transparent"
                                    >
                                        <TaskColorSwatch
                                            color={swatch}
                                            checked={swatch === color}
                                        />
                                    </ToggleGroupItem>
                                ))}
                            </ToggleGroup>
                        </div>
                    )}

                    <Cursor
                        x={pointer.x}
                        y={pointer.y}
                        scale={scale}
                        pressAt={[
                            DIALOG.openPicker,
                            DIALOG.pickColor,
                            DIALOG.tickFirst,
                            DIALOG.tickSecond,
                        ]}
                        opacity={progress(frame, 8, 8)}
                    />
                </div>
            </Floor>
        </Stage>
    );
}
