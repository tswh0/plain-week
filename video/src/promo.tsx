import type { ComponentType } from 'react';
import {
    AbsoluteFill,
    Audio,
    Sequence,
    interpolate,
    staticFile,
    useVideoConfig,
} from 'remotion';
import { useFonts } from './fonts';
import { SceneFade } from './components/scene';
import { DarkModeScene } from './scenes/dark-mode';
import { DialogScene } from './scenes/dialog';
import { DragDropScene } from './scenes/drag-drop';
import { EndCardScene } from './scenes/end-card';
import { FastEntryScene } from './scenes/fast-entry';
import { HookScene } from './scenes/hook';
import { OfflineScene } from './scenes/offline';
import { OpenSourceScene } from './scenes/open-source';
import { RepeatScene } from './scenes/repeat';
import { WeekScene } from './scenes/week';
import { FPS, schedule } from './timeline';
import type { SceneId } from './timeline';

const SCENE_COMPONENTS: Record<SceneId, ComponentType> = {
    hook: HookScene,
    week: WeekScene,
    fastEntry: FastEntryScene,
    dialog: DialogScene,
    dragDrop: DragDropScene,
    repeat: RepeatScene,
    offline: OfflineScene,
    darkMode: DarkModeScene,
    openSource: OpenSourceScene,
    endCard: EndCardScene,
};

/** Music fade in and out, in seconds. */
const FADE_IN = 0.6;
const FADE_OUT = 2.5;

export type PromoProps = {
    order: SceneId[];
    /**
     * The README loop: silent (no soundtrack), and it fades in and out so it
     * wraps around smoothly.
     */
    loop: boolean;
};

/** The promo: its scenes in order, cross-fading, over the soundtrack. */
export function Promo({ order, loop }: PromoProps) {
    const { durationInFrames } = useVideoConfig();
    const scenes = schedule(order);
    useFonts();

    return (
        <AbsoluteFill className="bg-muted">
            {scenes.map(({ id, from, duration }, index) => {
                const Scene = SCENE_COMPONENTS[id];

                return (
                    <Sequence
                        key={id}
                        from={from}
                        durationInFrames={duration}
                        name={id}
                    >
                        <SceneFade
                            duration={duration}
                            fadeIn={loop || index > 0}
                            fadeOut={loop || index < scenes.length - 1}
                        >
                            <Scene />
                        </SceneFade>
                    </Sequence>
                );
            })}
            {!loop && (
                <Audio
                    src={staticFile('music.wav')}
                    volume={(frame) =>
                        interpolate(
                            frame,
                            [
                                0,
                                FADE_IN * FPS,
                                durationInFrames - FADE_OUT * FPS,
                                durationInFrames - 1,
                            ],
                            [0, 1, 1, 0],
                            {
                                extrapolateLeft: 'clamp',
                                extrapolateRight: 'clamp',
                            },
                        )
                    }
                />
            )}
        </AbsoluteFill>
    );
}
