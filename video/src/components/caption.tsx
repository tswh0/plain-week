import { useCurrentFrame } from 'remotion';
import { mix, progress, useSpring } from '../motion';
import { cn } from '@/lib/utils';
import { useLayout } from './stage';

/**
 * Words of a caption; words between asterisks (`*one screen.*`) are drawn
 * in the planner accent (today's blue).
 */
function parseWords(text: string): { word: string; accent: boolean }[] {
    let accent = false;

    return text
        .split(' ')
        .filter(Boolean)
        .map((raw) => {
            const opens = raw.startsWith('*');
            const closes = raw.endsWith('*');
            const word = raw.replace(/^\*|\*$/g, '');
            const isAccent = accent || opens;
            accent = isAccent && !closes;

            return { word, accent: isAccent };
        });
}

type Props = {
    text: string;
    /** Frame the first word starts to rise. */
    at: number;
    /** Frame the caption starts to leave; it stays to the scene's end if unset. */
    out?: number;
    size?: 'hero' | 'title' | 'sub';
    /** Distance from the top of the frame to the caption's centre. */
    top?: number;
    className?: string;
};

const SIZES = {
    hero: { landscape: 120, square: 96 },
    title: { landscape: 80, square: 68 },
    sub: { landscape: 50, square: 44 },
};

/**
 * A kinetic caption: each word springs up out of its own mask, one after the
 * other, and the whole line drifts up and fades when it leaves.
 */
export function Caption({
    text,
    at,
    out,
    size = 'title',
    top,
    className,
}: Props) {
    const frame = useCurrentFrame();
    const enter = useSpring();
    const { square } = useLayout();
    const fontSize = SIZES[size][square ? 'square' : 'landscape'];
    const leave = out === undefined ? 0 : progress(frame, out, 10);
    const words = parseWords(text);
    const stagger = size === 'sub' ? 2 : 3;

    if (frame < at - 1 || leave >= 1) {
        return null;
    }

    return (
        <div
            className={cn(
                'absolute inset-x-0 flex justify-center px-16 text-center',
                className,
            )}
            style={{
                top: top ?? (square ? 150 : 140),
                transform: `translateY(-50%) translateY(${-leave * 30}px)`,
                opacity: 1 - leave,
            }}
        >
            <p
                className={cn(
                    'flex flex-wrap justify-center tracking-tight',
                    size === 'sub'
                        ? 'font-medium text-foreground/70'
                        : 'font-bold',
                )}
                style={{
                    fontSize,
                    lineHeight: 1.12,
                    columnGap: fontSize * 0.26,
                    letterSpacing: size === 'sub' ? '-0.01em' : '-0.035em',
                }}
            >
                {words.map(({ word, accent }, index) => {
                    const t = enter(frame, at + index * stagger, {
                        damping: 16,
                        stiffness: 160,
                    });

                    return (
                        <span
                            key={index}
                            className="inline-block overflow-hidden"
                            style={{ paddingBottom: fontSize * 0.12 }}
                        >
                            <span
                                className={cn(
                                    'inline-block',
                                    accent && 'text-planner-accent',
                                )}
                                style={{
                                    transform: `translateY(${mix(t, 105, 0)}%)`,
                                    opacity: Math.min(1, t * 1.5),
                                }}
                            >
                                {word}
                            </span>
                        </span>
                    );
                })}
            </p>
        </div>
    );
}
