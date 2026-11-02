import { Composition } from 'remotion';
import './style.css';
import { Promo } from './promo';
import { FPS, LOOP_ORDER, SCENE_ORDER, totalFrames } from './timeline';

export function RemotionRoot() {
    return (
        <>
            <Composition
                id="PromoLandscape"
                component={Promo}
                durationInFrames={totalFrames(SCENE_ORDER)}
                fps={FPS}
                width={1920}
                height={1080}
                defaultProps={{ order: SCENE_ORDER, loop: false }}
            />
            <Composition
                id="PromoSquare"
                component={Promo}
                durationInFrames={totalFrames(SCENE_ORDER)}
                fps={FPS}
                width={1080}
                height={1080}
                defaultProps={{ order: SCENE_ORDER, loop: false }}
            />
            <Composition
                id="PromoLoop"
                component={Promo}
                durationInFrames={totalFrames(LOOP_ORDER)}
                fps={FPS}
                width={1920}
                height={1080}
                defaultProps={{ order: LOOP_ORDER, loop: true }}
            />
        </>
    );
}
