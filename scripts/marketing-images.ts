/**
 * Renders the marketing images from resources/images/marketing/marketing.html with headless Chromium:
 * the og:image (public/og-image.png), the README header (docs/images/header-{light,dark}.png) and the GitHub
 * social preview (docs/images/social-preview.png, uploaded by hand in the repository settings).
 *
 * Usage: bun scripts/marketing-images.ts
 * Needs `bun install` (fonts and Playwright) and ImageMagick's `magick` to optimize the PNGs.
 * See docs/stack.md#marketing-images.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { optimizePng } from './lib/optimize-png';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = pathToFileURL(
    `${root}resources/images/marketing/marketing.html`,
).href;

const images = [
    // Social cards are shown small; 1× keeps the file light.
    {
        kind: 'og',
        theme: 'light',
        scale: 1,
        width: 1200,
        height: 630,
        out: 'public/og-image.png',
    },
    // GitHub shows the header at up to ~900 px wide; 2× keeps it sharp on high-density screens.
    {
        kind: 'header',
        theme: 'light',
        scale: 2,
        width: 1600,
        height: 560,
        out: 'docs/images/header-light.png',
    },
    {
        kind: 'header',
        theme: 'dark',
        scale: 2,
        width: 1600,
        height: 560,
        out: 'docs/images/header-dark.png',
    },
    // GitHub's repository social preview: 1280×640, under 1 MB. It crops the week screenshot, so run
    // scripts/screenshots.ts first when the UI changes.
    {
        kind: 'social',
        theme: 'light',
        scale: 1,
        width: 1280,
        height: 640,
        out: 'docs/images/social-preview.png',
    },
];

const browser = await chromium.launch({ headless: true });

try {
    for (const image of images) {
        const page = await browser.newPage({
            viewport: { width: image.width, height: image.height },
            deviceScaleFactor: image.scale,
        });
        await page.goto(`${source}?kind=${image.kind}&theme=${image.theme}`);
        await page.evaluate(() => document.fonts.ready);
        // The social preview embeds a screenshot; wait for it to decode.
        await page
            .evaluate(() =>
                Promise.all([...document.images].map((img) => img.decode())),
            )
            .catch(() => {
                throw new Error(
                    'docs/images/desktop-light.png did not load; run `bun scripts/screenshots.ts` first.',
                );
            });
        const fonts = await page.evaluate(
            () =>
                [...document.fonts].filter((font) => font.status === 'loaded')
                    .length,
        );
        if (fonts < 2) {
            throw new Error(
                'Inter and JetBrains Mono did not load; run `bun install` first.',
            );
        }
        const out = `${root}${image.out}`;
        await page.locator('#image').screenshot({ path: out });
        await page.close();
        optimizePng(out);
        console.log(
            `${image.out} (${image.width * image.scale}×${image.height * image.scale})`,
        );
    }
} finally {
    await browser.close();
}
