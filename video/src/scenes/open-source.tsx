import { Container, Database, Globe, Scale } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Caption } from '../components/caption';
import { Floor, Stage, useLayout } from '../components/stage';
import { caretVisible, mix, typed, useSpring } from '../motion';
import { OPEN_SOURCE } from '../timeline';

/** What `docker run -d` prints: the new container's id. */
const CONTAINER_ID =
    '3f9c2a7be41d08c65e2b9f17a4d3c0e8b5a6f2d19c7e4b03a8f61d2c5e9b7a40';

const FACTS: { label: string; icon: LucideIcon }[] = [
    { label: 'MIT license', icon: Scale },
    { label: 'One container', icon: Container },
    { label: 'SQLite, no other services', icon: Database },
];

function Terminal({ frame }: { frame: number }) {
    const { command, enter } = OPEN_SOURCE;
    const text = typed(frame, command.text, command.start, command.perChar);
    const ran = frame >= enter;

    return (
        <div className="w-[640px] overflow-hidden rounded-2xl bg-[#0c0a09] font-heading text-[13px] leading-6 text-[#fafaf9] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.6)] ring-1 ring-white/10">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <span className="size-3 rounded-full bg-[#ff5f57]" />
                <span className="size-3 rounded-full bg-[#febc2e]" />
                <span className="size-3 rounded-full bg-[#28c840]" />
                <span className="ms-3 text-xs text-white/40">~ — zsh</span>
            </div>
            <pre className="min-h-[196px] px-5 py-4 whitespace-pre-wrap">
                <span className="text-[#4ade80]">$ </span>
                {text}
                {!ran && (
                    <span
                        className="inline-block h-4 w-2 translate-y-0.5 bg-white/80"
                        style={{ opacity: caretVisible(frame) ? 1 : 0 }}
                    />
                )}
                {ran && (
                    <>
                        {'\n'}
                        <span className="break-all text-white/45">
                            {CONTAINER_ID}
                        </span>
                        {'\n'}
                        <span className="text-[#4ade80]">$ </span>
                        <span
                            className="inline-block h-4 w-2 translate-y-0.5 bg-white/80"
                            style={{ opacity: caretVisible(frame) ? 1 : 0 }}
                        />
                    </>
                )}
            </pre>
        </div>
    );
}

export function OpenSourceScene() {
    const frame = useCurrentFrame();
    const enter = useSpring();
    const { square } = useLayout();
    const site = enter(frame, OPEN_SOURCE.enter + 14, {
        damping: 13,
        stiffness: 180,
    });

    return (
        <AbsoluteFill className="dark">
            <Stage>
                <Caption text="Open source. *Self-host it.*" at={4} />
                <Caption
                    text="One Docker command and it's yours."
                    at={12}
                    size="sub"
                    top={square ? 250 : 246}
                />
                <Floor
                    scale={square ? 1.35 : 1.75}
                    top={square ? 640 : 620}
                    enter={enter(frame, 2)}
                >
                    <div className="flex flex-col items-center gap-5">
                        <Terminal frame={frame} />
                        <div className="flex gap-2">
                            {FACTS.map(({ label, icon: Icon }, index) => {
                                const t = enter(frame, 30 + index * 5);

                                return (
                                    <span
                                        key={label}
                                        className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground"
                                        style={{
                                            opacity: t,
                                            transform: `translateY(${mix(t, 10, 0)}px)`,
                                        }}
                                    >
                                        <Icon className="size-3.5" />
                                        {label}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                </Floor>
                <div
                    className="absolute inset-x-0 flex justify-center"
                    style={{
                        top: square ? 960 : 990,
                        opacity: site,
                        transform: `translateY(-50%) scale(${mix(site, 0.9, 1)})`,
                    }}
                >
                    <span
                        className="flex items-center gap-3 rounded-full bg-primary px-8 py-4 font-semibold text-primary-foreground"
                        style={{ fontSize: square ? 34 : 38 }}
                    >
                        <Globe className="size-9" />
                        Or just use it at plainweek.eu
                    </span>
                </div>
            </Stage>
        </AbsoluteFill>
    );
}
