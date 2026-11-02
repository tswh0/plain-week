import { useCurrentFrame } from 'remotion';
import { cn } from '@/lib/utils';
import { Caption } from '../components/caption';
import {
    DayColumnView,
    DayHeader,
    EmptyRow,
    TaskRowView,
    TypingRow,
} from '../components/planner';
import { Card, Floor, Stage, useLayout } from '../components/stage';
import { mix, progress, typed, useSpring } from '../motion';
import { OFFLINE } from '../timeline';

type Status = 'idle' | 'offline' | 'syncing';

/** STATUS_LABELS and DOT_COLORS in planner/account-button.tsx. */
const STATUS: Record<Status, { label: string; dot: string }> = {
    idle: { label: 'All changes synced', dot: 'bg-sync-synced' },
    offline: {
        label: 'Offline. Changes sync when you are back.',
        dot: 'bg-sync-offline',
    },
    syncing: { label: 'Syncing…', dot: 'bg-sync-syncing' },
};

/** The account button with its sync dot, and the dot's tooltip below. */
function AccountButton({ status, frame }: { status: Status; frame: number }) {
    const enter = useSpring();
    const changedAt =
        status === 'offline'
            ? OFFLINE.goOffline
            : status === 'syncing'
              ? OFFLINE.backOnline
              : OFFLINE.backOnline + 14;
    const pop = enter(frame, changedAt, { damping: 9, stiffness: 240 });
    // The syncing pulse (animate-sync-pulse), driven by the frame.
    const pulse = ((frame - OFFLINE.backOnline) % 36) / 36;

    return (
        <div className="relative">
            <span className="relative flex size-10 items-center justify-center rounded-full bg-secondary text-sm font-medium text-secondary-foreground">
                AL
                <span
                    className={cn(
                        'absolute -end-px -top-px size-3.5 rounded-full border-[2.5px] border-background',
                        STATUS[status].dot,
                    )}
                    style={{
                        transform: `scale(${mix(pop, 1.6, 1)})`,
                        boxShadow:
                            status === 'syncing'
                                ? `0 0 0 ${pulse * 8}px color-mix(in oklab, var(--sync-syncing) ${(1 - pulse) * 45}%, transparent)`
                                : undefined,
                    }}
                />
            </span>
            <span
                className="absolute end-0 top-full mt-2 inline-flex w-max items-center rounded-xl bg-foreground px-3 py-1.5 text-xs text-background"
                style={{
                    opacity: progress(frame, OFFLINE.goOffline - 2, 6),
                }}
            >
                {STATUS[status].label}
            </span>
        </div>
    );
}

export function OfflineScene() {
    const frame = useCurrentFrame();
    const enter = useSpring();
    const { square } = useLayout();
    const status: Status =
        frame < OFFLINE.goOffline
            ? 'idle'
            : frame < OFFLINE.backOnline
              ? 'offline'
              : frame < OFFLINE.backOnline + 14
                ? 'syncing'
                : 'idle';
    const saved = frame >= OFFLINE.firstEnter;
    const savedPop = enter(frame, OFFLINE.firstEnter, {
        damping: 12,
        stiffness: 220,
    });

    return (
        <Stage>
            <Caption
                text="No signal? *Keep planning.*"
                at={4}
                out={OFFLINE.backOnline - 4}
            />
            <Caption
                text="Saved on your device, instantly."
                at={12}
                out={OFFLINE.backOnline - 4}
                size="sub"
                top={square ? 250 : 246}
            />
            <Caption text="Signed in? *It syncs.*" at={OFFLINE.backOnline} />
            <Caption
                text="The account is optional."
                at={OFFLINE.backOnline + 8}
                size="sub"
                top={square ? 250 : 246}
            />
            <Floor
                scale={square ? 1.75 : 1.9}
                top={square ? 650 : 640}
                enter={enter(frame, 2)}
            >
                <Card className="w-[400px] overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-6 pt-5">
                        <h1 className="flex items-baseline gap-2 text-2xl leading-tight font-bold tracking-tighter">
                            October 2026
                            <span className="text-muted-foreground/50">
                                W42
                            </span>
                        </h1>
                        <AccountButton status={status} frame={frame} />
                    </div>
                    <DayColumnView
                        className="px-6 pt-14 pb-6"
                        header={<DayHeader day="16 Oct" weekday="Fri" />}
                    >
                        <TaskRowView
                            task={{
                                text: 'Pizza night',
                                time: '20:00',
                                color: 'pink',
                            }}
                        />
                        <TaskRowView
                            task={{ text: 'Weekly review', repeats: true }}
                        />
                        {saved ? (
                            <TaskRowView
                                task={{ text: 'Pay rent' }}
                                style={{
                                    transform: `scale(${mix(savedPop, 1.05, 1)})`,
                                }}
                            />
                        ) : frame >= OFFLINE.first.start - 8 ? (
                            <TypingRow
                                frame={frame}
                                text={typed(
                                    frame,
                                    OFFLINE.first.text,
                                    OFFLINE.first.start,
                                    OFFLINE.first.perChar,
                                )}
                            />
                        ) : (
                            <EmptyRow />
                        )}
                        <EmptyRow />
                    </DayColumnView>
                </Card>
            </Floor>
        </Stage>
    );
}
