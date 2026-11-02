/**
 * Renders single frames for a quick look, bundling once:
 *
 *   bun scripts/stills.ts PromoLandscape 60 240 480
 *
 * Writes out/stills/<composition>-<frame>.png at half size.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { webpackOverride } from '../webpack-override';

const [compositionId = 'PromoLandscape', ...frames] = process.argv.slice(2);
const outDir = path.resolve('out/stills');
mkdirSync(outDir, { recursive: true });

const serveUrl = await bundle({
    entryPoint: path.resolve('src/index.ts'),
    webpackOverride,
});
const composition = await selectComposition({ serveUrl, id: compositionId });

for (const frame of frames.map(Number)) {
    const output = path.join(outDir, `${compositionId}-${frame}.png`);
    await renderStill({ serveUrl, composition, frame, output, scale: 0.5 });
    console.log(output);
}
