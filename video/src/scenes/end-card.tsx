import { Github, Star } from 'lucide-react';
import { useCurrentFrame } from 'remotion';
import { Stage, useLayout } from '../components/stage';
import { mix, progress, useSpring } from '../motion';

/** The logo's path (app-logo-icon.tsx), drawn as one stroke. */
const LOGO_PATH =
    'M5 25.5V9.75a2.75 2.75 0 0 1 5.5 0v8.5a2.75 2.75 0 0 0 5.5 0v-5.5a2.75 2.75 0 0 1 5.5 0v5.5a2.75 2.75 0 0 0 5.5 0V7.5';
/** Long enough for the whole path, so dashoffset can draw it. */
const LOGO_LENGTH = 90;

export function EndCardScene() {
    const frame = useCurrentFrame();
    const enter = useSpring();
    const { square } = useLayout();
    const draw = progress(frame, 4, 26);
    const name = enter(frame, 16);
    const tagline = enter(frame, 24);
    const site = enter(frame, 34, { damping: 13, stiffness: 170 });
    const star = enter(frame, 42, { damping: 13, stiffness: 170 });
    const repo = enter(frame, 50);
    // A gentle nudge on the star button once everything has settled.
    const nudge = Math.sin(progress(frame, 78, 14) * Math.PI) * 0.06;

    return (
        <Stage>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="flex items-center gap-6">
                    <svg
                        viewBox="0 0 32 32"
                        className="text-[#18181B]"
                        style={{
                            width: square ? 132 : 150,
                            height: square ? 132 : 150,
                        }}
                    >
                        <path
                            d={LOGO_PATH}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={3.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray={LOGO_LENGTH}
                            strokeDashoffset={LOGO_LENGTH * (1 - draw)}
                        />
                    </svg>
                    <span
                        className="font-bold tracking-tighter"
                        style={{
                            fontSize: square ? 104 : 124,
                            opacity: name,
                            transform: `translateX(${mix(name, -20, 0)}px)`,
                        }}
                    >
                        Plain Week
                    </span>
                </div>
                <p
                    className="mt-4 font-medium tracking-tight text-muted-foreground"
                    style={{
                        fontSize: square ? 38 : 42,
                        opacity: tagline,
                        transform: `translateY(${mix(tagline, 14, 0)}px)`,
                    }}
                >
                    Your week. Plain and simple.
                </p>

                <div
                    className="mt-16 flex items-center gap-5"
                    style={{ flexDirection: square ? 'column' : 'row' }}
                >
                    <span
                        className="flex items-center rounded-full bg-primary px-10 py-5 font-semibold text-primary-foreground shadow-lg"
                        style={{
                            fontSize: 40,
                            opacity: site,
                            transform: `scale(${mix(site, 0.85, 1)})`,
                        }}
                    >
                        plainweek.eu
                    </span>
                    <span
                        className="flex items-center gap-3 rounded-full bg-foreground px-10 py-5 font-semibold text-background shadow-lg"
                        style={{
                            fontSize: 40,
                            opacity: star,
                            transform: `scale(${mix(star, 0.85, 1) + nudge})`,
                        }}
                    >
                        <Star className="size-10 fill-[#facc15] text-[#facc15]" />
                        Star it on GitHub
                    </span>
                </div>
                <p
                    className="mt-8 flex items-center gap-3 font-medium text-foreground/80"
                    style={{
                        fontSize: square ? 34 : 40,
                        opacity: repo,
                    }}
                >
                    <Github className="size-9" />
                    github.com/victor-falcon/plain-week
                </p>
            </div>
        </Stage>
    );
}
