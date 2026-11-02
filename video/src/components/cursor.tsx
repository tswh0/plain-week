import { useCurrentFrame } from 'remotion';
import { progress } from '../motion';

/**
 * A mouse pointer at (x, y) in its parent's pixels. `pressAt` frames make it
 * dip for a click, `grabbing` keeps it pressed (dragging). Inside a scaled
 * parent, pass its `scale` so the pointer keeps its on-screen size.
 */
export function Cursor({
    x,
    y,
    pressAt = [],
    grabbing = false,
    opacity = 1,
    scale: parentScale = 1,
}: {
    x: number;
    y: number;
    pressAt?: number[];
    grabbing?: boolean;
    opacity?: number;
    scale?: number;
}) {
    const frame = useCurrentFrame();
    const press = pressAt.reduce((amount, at) => {
        const down = progress(frame, at - 3, 3);
        const up = progress(frame, at + 2, 5);

        return Math.max(amount, down - up);
    }, 0);
    const scale = (grabbing ? 0.88 : 1 - press * 0.14) / parentScale;

    return (
        <svg
            width={34}
            height={34}
            viewBox="0 0 24 24"
            className="pointer-events-none absolute z-50 drop-shadow-[0_2px_3px_rgb(0_0_0/0.35)]"
            style={{
                left: x,
                top: y,
                opacity,
                transform: `translate(-6px, -3.5px) scale(${scale})`,
                transformOrigin: '6px 3.5px',
            }}
        >
            <path
                d="M4.5 2.5v17.2l4.6-4.4 2.9 6.7 3-1.3-2.9-6.6h6.4z"
                fill="#18181B"
                stroke="#fff"
                strokeWidth={1.4}
                strokeLinejoin="round"
            />
        </svg>
    );
}
