# Plain Week promo video

A short promo for Plain Week made with [Remotion](https://www.remotion.dev): small pieces of the real UI (a day
column, the new-task row, the task dialog, the repeat picker…) floating on a clean background, each one showing one
feature, with kinetic captions. All text is in English.

| Composition      | Size      | Length  | Output                    |
| ---------------- | --------- | ------- | ------------------------- |
| `PromoLandscape` | 1920×1080 | ~35.6 s | `out/promo-landscape.mp4` |
| `PromoSquare`    | 1080×1080 | ~35.6 s | `out/promo-square.mp4`    |
| `PromoLoop`      | 1280×720  | ~8.7 s  | `out/promo-loop.gif`      |

`PromoLoop` is the fast-entry and drag-and-drop scenes, silent, at 15 fps, for the README.

## Preview and render

This folder is its own bun project, apart from the app build. It reuses the app's stylesheet
(`resources/css/app.css`) and a few app components, so install both:

```sh
bun install            # at the repository root
cd video && bun install
```

Run every command from `video/` (the webpack override in `webpack-override.ts` resolves paths from there). The first
render downloads Remotion's Chrome Headless Shell; ffmpeg ships with Remotion, so nothing else is needed.

```sh
bun run dev            # Remotion Studio: scrub, preview and tweak
bun run render         # soundtrack + the three files in out/
bun run render:landscape
bun run render:square
bun run render:gif
bun scripts/stills.ts PromoLandscape 60 240   # single frames in out/stills/, half size
bun run typecheck
```

`bun run music` writes the soundtrack to `public/music.wav`; `render` runs it first. Renders and the soundtrack are
gitignored.

## How it is built

- `src/timeline.ts` is the single source of the timing: scene order and lengths, and the frames where keys are
  pressed, the pointer clicks and tasks drop. The scenes read it, and `scripts/music.ts` puts the sound effects on
  the same frames.
- `src/scenes/` has one file per scene. Each one lays itself out for landscape or square (`useLayout`).
- The reused app code is imported through `@/` (the same alias as the app): the shadcn primitives in
  `resources/js/components/ui` (`Button`, `Checkbox`, `ToggleGroup`, `Kbd`), `TaskColorSwatch` and the task colors.
  The planner rows and day headers read Dexie and dnd-kit in the app, so `src/components/planner.tsx` has static twins
  with the same classes; keep them in step with `task-row.tsx`, `new-task-row.tsx` and `day-column.tsx`.
- The app's files resolve their packages (Radix, cva…) from the root `node_modules`; `webpack-override.ts` points
  `react`, `react-dom` and `lucide-react` at this folder's copies so the bundle has one React. `package.json` pins
  Tailwind (`overrides`) to the version the root lockfile resolves; bump both together.
- CSS transitions and animations are turned off (`src/style.css`): every motion is driven by the frame.

## Music

The soundtrack is synthesized from code by `scripts/music.ts` (pad, plucked arpeggio, bass and drums at 120 BPM, plus
quiet key, click and pop sounds). No samples or third-party recordings are used, so there is nothing to license or
attribute: it is part of this repository and under its [MIT license](../LICENSE).
