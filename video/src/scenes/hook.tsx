import {
    Bell,
    Bot,
    Flag,
    Folder,
    Inbox,
    KanbanSquare,
    Layers,
    ListFilter,
    Sparkles,
    Tag,
    Timer,
    Trophy,
    Users,
    Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { random, useCurrentFrame } from 'remotion';
import { Caption } from '../components/caption';
import { Stage, useLayout } from '../components/stage';
import { mix, progress, useSpring } from '../motion';

/** The kind of clutter the hook sweeps away. */
const BLOAT: { label: string; icon: LucideIcon }[] = [
    { label: 'Projects', icon: Folder },
    { label: 'Labels', icon: Tag },
    { label: 'Priorities', icon: Flag },
    { label: 'Boards', icon: KanbanSquare },
    { label: 'Filters', icon: ListFilter },
    { label: 'Inbox zero', icon: Inbox },
    { label: 'AI assistant', icon: Bot },
    { label: 'Workspaces', icon: Layers },
    { label: 'Reminders', icon: Bell },
    { label: 'Productivity score', icon: Trophy },
    { label: 'Time tracking', icon: Timer },
    { label: 'Automations', icon: Zap },
    { label: 'Team seats', icon: Users },
    { label: 'Upgrade to Pro', icon: Sparkles },
];

/** Frame the clutter falls away and the title takes over. */
const SWEEP = 52;

export function HookScene() {
    const frame = useCurrentFrame();
    const enter = useSpring();
    const { square } = useLayout();
    const width = square ? 1080 : 1920;
    const fall = progress(frame, SWEEP, 22, (t) => t * t);
    const rule = progress(frame, SWEEP + 16, 18);

    return (
        <Stage>
            <Caption text="To-do apps got bloated." at={4} out={SWEEP - 4} />

            {BLOAT.map(({ label, icon: Icon }, index) => {
                const seed = `bloat-${index}`;
                // A jittered grid, so the clutter fills the frame evenly.
                const columns = square ? 3 : 5;
                const cell = index % columns;
                const line = Math.floor(index / columns);
                const lines = Math.ceil(BLOAT.length / columns);
                const x =
                    width *
                    mix(
                        (cell + 0.5 + mix(random(`${seed}-x`), -0.25, 0.25)) /
                            columns,
                        0.14,
                        0.86,
                    );
                const y = mix(
                    (line + 0.5 + mix(random(`${seed}-y`), -0.25, 0.25)) /
                        lines,
                    300,
                    square ? 1000 : 980,
                );
                const rotate = mix(random(`${seed}-r`), -14, 14);
                const pop = enter(frame, 6 + index * 2.6, {
                    damping: 11,
                    stiffness: 180,
                });
                const drop = fall * (900 + random(`${seed}-d`) * 500);
                const spin = fall * mix(random(`${seed}-s`), -60, 60);

                return (
                    <div
                        key={label}
                        className="absolute flex items-center gap-2.5 rounded-full bg-background px-5 py-3 text-[26px] font-medium whitespace-nowrap text-muted-foreground shadow-lg ring-1 ring-foreground/5"
                        style={{
                            left: x,
                            top: y,
                            transform: `translate(-50%, -50%) translateY(${drop}px) rotate(${rotate + spin}deg) scale(${pop})`,
                            opacity: Math.min(1, pop) * (1 - fall * 0.6),
                        }}
                    >
                        <Icon className="size-7" />
                        {label}
                    </div>
                );
            })}

            <Caption
                text="Your week."
                at={SWEEP + 6}
                size="hero"
                top={square ? 470 : 470}
            />
            <Caption
                text="Plain and *simple.*"
                at={SWEEP + 14}
                size="hero"
                top={square ? 610 : 610}
            />
            <div
                className="absolute h-1.5 origin-left rounded-full bg-foreground"
                style={{
                    left: '50%',
                    width: square ? 560 : 760,
                    top: 712,
                    transform: `translateX(-50%) scaleX(${rule})`,
                }}
            />
        </Stage>
    );
}
