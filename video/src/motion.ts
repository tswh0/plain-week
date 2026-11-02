import { Easing, interpolate, spring, useVideoConfig } from 'remotion';

const CLAMP = {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
} as const;

/** 0 → 1 between two frames, eased out. */
export function progress(
    frame: number,
    start: number,
    duration: number,
    easing: (t: number) => number = Easing.bezier(0.22, 1, 0.36, 1),
): number {
    return interpolate(frame, [start, start + duration], [0, 1], {
        ...CLAMP,
        easing,
    });
}

/** Maps 0..1 onto a range. */
export function mix(t: number, from: number, to: number): number {
    return from + (to - from) * t;
}

/** A soft spring that settles without much bounce: 0 → 1 from `delay`. */
export function useSpring(): (
    frame: number,
    delay?: number,
    config?: { damping?: number; stiffness?: number; mass?: number },
) => number {
    const { fps } = useVideoConfig();

    return (frame, delay = 0, config = {}) =>
        spring({
            frame: frame - delay,
            fps,
            config: { damping: 18, stiffness: 140, mass: 0.9, ...config },
        });
}

/** The text typed so far, one character every `perChar` frames. */
export function typed(
    frame: number,
    text: string,
    start: number,
    perChar: number,
): string {
    const count = Math.floor((frame - start) / perChar) + 1;

    return text.slice(0, Math.max(0, Math.min(text.length, count)));
}

/** A text caret that blinks twice a second. */
export function caretVisible(frame: number): boolean {
    return Math.floor(frame / 15) % 2 === 0;
}

/** A point that glides through `[frame, x, y]` stops, easing in and out. */
export function glide(
    frame: number,
    stops: [number, number, number][],
): { x: number; y: number } {
    const ease = { ...CLAMP, easing: Easing.bezier(0.65, 0, 0.35, 1) };
    let index = stops.findIndex(([at]) => at > frame);

    if (index === -1) {
        index = stops.length - 1;
    }

    const from = stops[Math.max(0, index - 1)];
    const to = stops[index];
    const t =
        from === to ? 1 : interpolate(frame, [from[0], to[0]], [0, 1], ease);

    return { x: mix(t, from[1], to[1]), y: mix(t, from[2], to[2]) };
}
