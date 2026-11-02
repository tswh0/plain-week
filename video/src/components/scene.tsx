import type { ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { OVERLAP } from '../timeline';
import { progress } from '../motion';

/**
 * Fades a scene in over the overlap with the one before, and out (with a
 * slight push back) over the overlap with the one after.
 */
export function SceneFade({
    children,
    duration,
    fadeIn = true,
    fadeOut = true,
}: {
    children: ReactNode;
    duration: number;
    fadeIn?: boolean;
    fadeOut?: boolean;
}) {
    const frame = useCurrentFrame();
    const enter = fadeIn ? progress(frame, 0, OVERLAP) : 1;
    const leave = fadeOut ? progress(frame, duration - OVERLAP, OVERLAP) : 0;

    return (
        <AbsoluteFill
            style={{
                opacity: Math.min(enter, 1 - leave),
                transform: `scale(${1 - leave * 0.03})`,
            }}
        >
            {children}
        </AbsoluteFill>
    );
}
