import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { cn } from '@/lib/utils';

/** Landscape (1920×1080) or square (1080×1080). */
export function useLayout(): { square: boolean; width: number } {
    const { width, height } = useVideoConfig();

    return { square: width === height, width };
}

/**
 * The clean backdrop every scene floats on: the app's muted surface with a
 * soft light in the middle. Inside `.dark` it turns into the dark tokens.
 */
export function Stage({
    children,
    className,
    style,
}: {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <AbsoluteFill
            className={cn('bg-muted font-sans text-foreground', className)}
            style={style}
        >
            <AbsoluteFill
                style={{
                    background:
                        'radial-gradient(ellipse 60% 55% at 50% 58%, var(--background) 0%, transparent 100%)',
                }}
            />
            {children}
        </AbsoluteFill>
    );
}

/**
 * Where a scene's components sit: centred below the caption, scaled up from
 * the app's own CSS pixels, rising in and gently floating.
 */
export function Floor({
    children,
    scale,
    top,
    enter = 1,
    className,
}: {
    children: ReactNode;
    scale: number;
    /** Centre of the area, from the top of the frame, in pixels. */
    top: number;
    /** Entrance progress, 0 → 1. */
    enter?: number;
    className?: string;
}) {
    const frame = useCurrentFrame();
    const bob = Math.sin(frame / 22) * 3;

    return (
        <div
            className={cn('absolute inset-x-0 flex justify-center', className)}
            style={{
                top,
                transform: `translateY(-50%) translateY(${(1 - enter) * 60 + bob}px)`,
                opacity: enter,
            }}
        >
            <div style={{ transform: `scale(${scale})` }}>{children}</div>
        </div>
    );
}

/** A floating surface for a piece of UI, like the app's popovers. */
export function Card({
    children,
    className,
    style,
}: {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <div
            className={cn(
                'rounded-3xl bg-background text-foreground shadow-[0_24px_60px_-20px_rgb(0_0_0/0.25),0_8px_20px_-12px_rgb(0_0_0/0.15)] ring-1 ring-foreground/5 dark:ring-foreground/10',
                className,
            )}
            style={style}
        >
            {children}
        </div>
    );
}
