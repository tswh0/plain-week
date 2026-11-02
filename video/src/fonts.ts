import { useState } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';

/** The faces the video uses: the app's Inter and JetBrains Mono. */
const FACES = [
    '400 16px "Inter Variable"',
    '500 16px "Inter Variable"',
    '700 16px "Inter Variable"',
    '400 16px "JetBrains Mono Variable"',
];

/**
 * Holds the render until the fonts are loaded, so no frame is drawn with a
 * fallback font.
 */
export function useFonts(): void {
    useState(() => {
        const handle = delayRender('Loading fonts');

        Promise.all(FACES.map((face) => document.fonts.load(face)))
            .then(() => continueRender(handle))
            .catch((error: unknown) => {
                // Fail the render rather than draw it in a fallback font.
                cancelRender(error);
            });

        return handle;
    });
}
