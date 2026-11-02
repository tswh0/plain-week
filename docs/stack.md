# Stack

## Versions

| Layer    | Package                     | Version                                                      |
| -------- | --------------------------- | ------------------------------------------------------------ |
| Runtime  | PHP                         | 8.5 (composer requires `^8.3`; CI runs 8.5)                  |
| Runtime  | bun                         | 1.3 (package manager and script runner)                      |
| Runtime  | Node.js                     | 24+ (used by some tooling; CI runs 24)                       |
| Backend  | Laravel                     | 13                                                           |
| Backend  | Laravel Fortify             | 1.x (authentication, 2FA, passkeys)                          |
| Backend  | Inertia (Laravel adapter)   | 3.x                                                          |
| Backend  | Laravel Wayfinder           | 0.1.x                                                        |
| Backend  | Laravel Cashier (Stripe)    | 16.x, billing in SaaS mode only ([saas.md](./saas.md))       |
| Database | SQLite                      | default for local dev and tests                              |
| Frontend | React                       | 19 (React Compiler enabled)                                  |
| Frontend | Inertia (React adapter)     | 3.x                                                          |
| Frontend | TypeScript                  | 5.x                                                          |
| Frontend | Tailwind CSS                | 4.x                                                          |
| Frontend | shadcn/ui                   | CLI 4.x, style `radix-luma`, Radix primitives via `radix-ui` |
| Frontend | lucide-react                | icons                                                        |
| Tooling  | Vite+ (`vp`)                | build, dev server, lint (Oxlint) and format (Oxfmt)          |
| Frontend | Dexie (+ dexie-react-hooks) | 4.x, IndexedDB: the client's source of truth                 |
| Frontend | fractional-indexing         | 4.x, `position` keys                                         |
| Frontend | uuid                        | v7 ids generated on the client                               |
| Frontend | vite-plugin-pwa (+ Workbox) | 2.x / 7.x, service worker and web manifest (offline shell)   |
| Frontend | dnd-kit (core, sortable)    | 6.x / 10.x, drag and drop of tasks (shadcn has no DnD)       |
| Tooling  | Vitest (through `vp test`)  | 4.x, JS unit tests with `fake-indexeddb`                     |
| Tooling  | Testing Library + happy-dom | React component tests (`*.test.tsx`)                         |
| Tooling  | Pest                        | 5.x                                                          |
| Tooling  | Pint                        | PHP formatter (`laravel` preset)                             |
| Tooling  | Larastan                    | PHPStan level 7                                              |
| Tooling  | Playwright                  | 1.x, headless Chromium (browser QA, screenshots, images)     |

Exact versions are pinned by `composer.lock` and `bun.lock`.

## Commands

| Task                                          | Command                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| First-time setup                              | `composer setup` (installs deps, creates `.env`, key, migrates, builds) |
| Dev server (Laravel, queue, logs, Vite)       | `composer run dev`                                                      |
| Production build                              | `bun run build`                                                         |
| Lint + format check (JS/TS)                   | `bun run check`                                                         |
| Lint + format fix (JS/TS)                     | `bun run check:fix`                                                     |
| Type check (TS)                               | `bun run types:check`                                                   |
| JS unit tests (Vitest)                        | `bun run test:js`                                                       |
| PHP format                                    | `composer lint` (fix) / `composer lint:check`                           |
| PHP static analysis                           | `composer types:check`                                                  |
| PHP tests (runs Pint check + PHPStan + Pest)  | `composer test`                                                         |
| Everything CI runs (JS checks, JS tests, PHP) | `composer ci:check`                                                     |
| og:image, README header and social preview    | `bun scripts/marketing-images.ts`                                       |
| README screenshots (after `bun run build`)    | `bun scripts/screenshots.ts`                                            |

The two image scripts need ImageMagick's `magick` and a Playwright Chromium (`bunx playwright install chromium`).

## Local development

Requirements: PHP 8.3+ (8.5 recommended), Composer 2, bun 1.3+ and Node.js 24+.

```sh
composer setup     # composer install, .env, app key, SQLite migrations, bun install, production build
composer run dev   # php artisan dev: Laravel server, queue worker, scheduler, logs and the Vite dev server
```

The scheduler (`schedule:work`) is added to `php artisan dev` in `AppServiceProvider`. Scheduled tasks live in
`routes/console.php`; `php artisan schedule:list` shows them and `php artisan schedule:test` runs one now.

The app runs at http://127.0.0.1:8000. The SQLite file is `database/database.sqlite`; `php artisan migrate:fresh`
resets it. Planner data lives in the browser (IndexedDB), so to start over as a guest clear the site data in DevTools
(Application > Storage).

The service worker is only registered by production builds (see [PWA](#pwa-offline-shell)). To try the app as it ships:
`bun run build && php artisan serve`.

Google Calendar sync is off by default: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are empty in `.env.example`, so
Settings › Integrations is hidden and its routes are `404`. To turn it on, create a test OAuth client as described in
[self-hosting.md](./self-hosting.md#google-calendar) with the redirect URI `APP_URL/settings/integrations/google/callback`
(`http://localhost:8000/settings/integrations/google/callback` with the default `.env`; open the app on that same
host so the session survives the round trip), add your Google account as a test user, put both values in `.env` (never
commit them) and run `php artisan config:clear`. Tests never call Google: they use `Http::fake()`.

Push notifications are off by default too: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are empty in
`.env.example`, so Settings › Notifications is hidden and its routes are `404`. To turn them on, generate a key pair
(`bunx web-push generate-vapid-keys`, or
`php artisan tinker --execute 'dump(Minishlink\WebPush\VAPID::createVapidKeys())'`), put both keys in `.env` with
`VAPID_SUBJECT=mailto:you@example.com` and run `php artisan config:clear`. `composer run dev` runs the scheduler and the
queue worker that send them; `php artisan notifications:send` queues the due ones right now. Browsers allow push on
`http://localhost`, and only from a production build (the service worker). Tests never call a push service: they bind
`Tests\Support\FakePushSender` in place of `App\Push\PushSender`.

## Testing

| Layer        | Tool                                        | Where                                         | Run               |
| ------------ | ------------------------------------------- | --------------------------------------------- | ----------------- |
| PHP          | Pest (feature and unit tests)               | `tests/Feature`, `tests/Unit`                 | `composer test`   |
| JS logic     | Vitest (through `vp test`), fake-indexeddb  | `resources/js/**/*.test.ts` next to the code  | `bun run test:js` |
| React        | Testing Library + happy-dom                 | `resources/js/**/*.test.tsx` next to the code | `bun run test:js` |
| Real browser | Playwright, headless (manual QA, not in CI) | your scratch directory, never committed       | see below         |

Playwright is a dev dependency; it needs a Chromium build once: `bunx playwright install chromium`.

The JS tests import Wayfinder route helpers, so generate them first (`bun run build`, `composer run dev` or
`php artisan wayfinder:generate --with-form`). How to write tests is in [conventions.md](./conventions.md#tests).

Browser QA for UI changes runs against a production build, so the service worker and offline mode are real:

1. `bun run build && php artisan migrate:fresh && php artisan serve --port=<free port>`.
2. Drive it with headless Playwright (Chromium). Useful hooks: the empty rows are inputs labelled
   `New task for Mon 12 Oct` / `New Someday task (column 1)`, task rows are `[data-task-id]` with a button named after
   the task (`17:30 Gym`, `Call mom (done)`), the task dialog is the dialog named `Edit task`, and the account button is
   `[data-test="account-button"]` with its sync dot `[data-sync-status]` (a guest's menu next to
   `[data-test="sync-your-week"]`; on phones `[data-test="guest-menu-compact"]`). In SaaS mode a guest's first visit shows the landing card (dialog named "A minimal
   weekly planner that feels like paper."): press `[data-test="landing-start"]` first, or set `localStorage`
   `plain-week.landing-dismissed`. Settings › Data
   (`/settings/data`) has `[data-test="export-data"]` / `[data-test="import-data"]`; the import reads the hidden
   `[data-test="import-file-input"]`, so `setInputFiles` on it skips the native file picker.
3. Offline: wait for `navigator.serviceWorker.ready`, then `context.setOffline(true)` and reload.
4. Sync: register in one browser context, check the `tasks` table (`sqlite3 database/database.sqlite`), log in from a
   second context and edit there; the first context picks the change up on its next sync (focus, or within 30 s).
5. Web Push (with the VAPID keys set): create the context with `permissions: ['notifications']`, turn on Settings ›
   Notifications, then deliver a push without a push service through the DevTools protocol
   (`ServiceWorker.enable`, then `ServiceWorker.deliverPushMessage` with the worker's `registrationId`, `origin` and a
   JSON `data` string). Headless Chromium shows no notification UI, so check it from the page with
   `registration.getNotifications()`.
6. Check a phone viewport (390×844), dark mode (`localStorage.appearance = 'dark'`) and RTL
   (`document.documentElement.dir = 'rtl'`).

## CI

`.github/workflows/tests.yml` runs on every pull request to `main` and on pushes to `main`: PHP 8.5, Node 24 and bun
1.3, then `composer setup` (which also builds the assets and generates Wayfinder) and `composer ci:check`.
`.github/workflows/docker.yml` builds the Docker image for amd64 and arm64 on pull requests and publishes it to GHCR on
pushes to `main` (`edge`) and on `v*` tags (`X.Y.Z`, `X.Y`, `latest`); see [self-hosting.md](./self-hosting.md). Dependabot
keeps the GitHub Actions up to date (`.github/dependabot.yml`).

## Folder layout

```
app/                      Laravel application code (controllers, models, actions, middleware)
  Integrations/           Optional server-side integrations with other services (Google Calendar)
  Push/                   Web Push notifications: what is due when, and sending it (minishlink/web-push)
bootstrap/                Framework bootstrap
config/                   Configuration
deploy/                   Coolify service template and a docker-compose.yml example (docs/self-hosting.md)
docker/                   Caddyfile, PHP ini and entrypoint of the Docker image (Dockerfile at the root)
database/                 Migrations, factories, seeders (SQLite file lives here locally)
docs/                     Project documentation (this folder)
public/                   Web root; built assets end up in public/build, the worker in public/sw.js;
                          offline.html, og-image.png and the PWA icons live here (robots.txt is a route, see routes/web.php)
resources/css/app.css     Tailwind entry point and design tokens (shadcn preset)
resources/js/
  app.tsx                 Inertia entry point: providers, layout resolution, service worker registration
  sw.ts                   Service worker source (offline app shell), built to public/sw.js
  pages/                  Inertia pages (one file per page component)
  layouts/                App, auth and settings layouts
  components/             App components (composed from shadcn components)
  components/planner/     Week view: header, week grid, day columns, task rows, Someday, drag and drop
  components/planner/task-dialog/  The task dialog and its toolbar pickers
  components/ui/          shadcn components; managed by the shadcn CLI
  hooks/                  React hooks
  lib/                    Utilities (`cn`, etc.)
  lib/db/                 Dexie database, task repository and queries (offline-first data layer)
  lib/sync/               Background sync engine and its HTTP transport
  lib/planner/            Pure planner logic: week math, date labels, smart time, task color styles, quick moves,
                          drop resolution, keyboard shortcuts and cursor
  lib/pwa/                Service worker registration, update toast and request matchers
  test/                   Shared helpers for JS unit tests (fake sync server, fixtures)
  types/                  Shared TypeScript types
  actions/, routes/,      Generated by Wayfinder at build/dev time (gitignored)
  wayfinder/
resources/images/pwa/     Source SVGs of the PWA icons (PNGs live in public/)
resources/images/marketing/  Source of the og:image and the README header (PNGs in public/ and docs/images/)
resources/views/app.blade.php  Root HTML document
routes/                   web.php, settings.php, console.php
scripts/                  Image scripts run with bun: marketing images and README screenshots (not in the app build)
tests/                    Pest tests (Feature and Unit)
video/                    Remotion promo video, its own bun project outside the app build (video/README.md)
```

## PWA (offline shell)

`vite-plugin-pwa` is configured in `vite.config.ts` with the `injectManifest` strategy: Workbox injects the list of
built files into `resources/js/sw.ts` and the result is written to `public/sw.js` (gitignored, like the web manifest
in `public/build/manifest.webmanifest`). How the worker caches requests is described in
[architecture.md](./architecture.md#offline-app-shell).

Deploying:

- `public/sw.js` only exists after `bun run build`, so deploy the build output, not just the repository.
- The app must be served from the domain root: the worker, its scope, the manifest and the cached URLs all assume `/`.
- Serve `sw.js` without long-lived caching (`Cache-Control: no-cache`) so browsers pick up new versions.

Configuration:

- The manifest (name, colors from `--background`, icons) lives in `vite.config.ts`; its `<link>` and the
  `theme-color` metas are in `resources/views/app.blade.php`.
- Icons: `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/maskable-icon-512x512.png`,
  `public/apple-touch-icon.png` and `public/favicon.ico`, rendered from `resources/images/pwa/*.svg`. The mark is one
  continuous line with round caps drawing a lowercase "pw" on a 32 grid. The app icons are white on ink (`#18181B`)
  with a faint grid behind the line (`icon.svg` for the 192, 512 and Apple touch icons, the mark at about half the
  icon; `icon-maskable.svg` keeps it inside the safe zone). The favicon is the same line on an ink rounded tile
  (`favicon-32.svg`; `favicon-16.svg` redraws it on whole pixels so the 16 px frame stays crisp). `public/favicon.svg`
  is a copy of `favicon-32.svg`; `resources/js/components/app-logo-icon.tsx` is the bare line and is edited by hand.
  `public/notification-badge.png` (Android's small notification icon, from `notification-badge.svg`) is the bare line
  in white on transparent: Android only uses its alpha.
  After editing an SVG, regenerate them (needs `rsvg-convert` from librsvg and ImageMagick's `magick`):

    ```sh
    rsvg-convert -w 192 -h 192 resources/images/pwa/icon.svg -o public/pwa-192x192.png
    rsvg-convert -w 512 -h 512 resources/images/pwa/icon.svg -o public/pwa-512x512.png
    rsvg-convert -w 512 -h 512 resources/images/pwa/icon-maskable.svg -o public/maskable-icon-512x512.png
    rsvg-convert -w 180 -h 180 resources/images/pwa/icon.svg -o public/apple-touch-icon.png
    rsvg-convert -w 96 -h 96 resources/images/pwa/notification-badge.svg -o public/notification-badge.png
    tmp=$(mktemp -d)
    rsvg-convert -w 16 -h 16 resources/images/pwa/favicon-16.svg -o "$tmp/16.png"
    rsvg-convert -w 32 -h 32 resources/images/pwa/favicon-32.svg -o "$tmp/32.png"
    magick "$tmp/16.png" "$tmp/32.png" public/favicon.ico
    cp resources/images/pwa/favicon-32.svg public/favicon.svg
    ```

- `public/offline.html` is a self-contained page (no build step); its colors mirror the tokens in
  `resources/css/app.css`. The manifest colors and the `theme-color` metas are `--background` as hex (`#ffffff`, and
  `#0c0a09` for dark); keep them in sync if the preset changes.

### Testing offline

The service worker only exists in production builds; `composer run dev` never registers it.

1. `bun run build && php artisan serve`, then open `http://127.0.0.1:8000/` once.
2. In DevTools > Application > Service workers, check that `/sw.js` is activated. Then either tick **Offline**
   (DevTools > Network) or stop `php artisan serve`.
3. Reload: the planner renders from the cache with your tasks, and creating or completing tasks still works. Opening a
   server page (for example `/settings/profile`) shows the offline page.
4. To see the update prompt, change any source file, run `bun run build` again and reload: the "Update available"
   toast appears.

Going back to `composer run dev` on the same origin unregisters the worker on the next page load.

## Marketing images and screenshots

The images are committed (like the PWA icons) and regenerated by scripts that drive headless Chromium through
Playwright. Both shrink the PNGs with ImageMagick's `magick`, and both are deterministic: running them again without
changes gives the same files.

### Marketing images

`resources/images/marketing/marketing.html` is one self-contained page that draws the og:image, the README header and
the GitHub social preview, picked by the query string (`?kind=og|header|social&theme=light|dark`); open it in a browser
to preview a variant. It uses Inter and JetBrains Mono from the `@fontsource-variable` packages in `node_modules`, so
run `bun install` first.

```sh
bun scripts/marketing-images.ts
```

It writes:

- `public/og-image.png`: light, 1200×630 at 1×, the social preview `resources/views/app.blade.php` links (see below).
- `docs/images/header-light.png` / `header-dark.png`: 1600×560 at 2×, the README's `<picture>`.
- `docs/images/social-preview.png`: light, 1280×640 at 1×, the image GitHub shows when the repository is shared. GitHub
  does not read it from the repository: upload it by hand in **Settings › General › Social preview** after regenerating
  it. Instead of a drawn week it crops the real week screenshot (`docs/images/desktop-light.png`, 1440×900 at 2×), so
  run the screenshots script first when the UI changes.

The copy, the sample week and the colors live in the page; keep the pitch in step with the README.

The Open Graph and X/Twitter card tags are in `resources/views/app.blade.php`. Their URLs are built from `APP_URL`
(`config('app.url')`), so every instance's previews point at itself; set `APP_URL` to the public URL. `APP_NOINDEX`
does not remove them.

### README screenshots

```sh
bun run build && bun scripts/screenshots.ts
```

It migrates a throwaway SQLite database in the system temp directory, serves the production build on it with PHP's
built-in server (Laravel's router) on a free port, and takes every `docs/images/*.png` except the header and the social
preview: the week (desktop 1440×900 and phone 390×844, light and dark), the task dialog (light and dark), the repeat
options, the context menu and Settings › Data (after registering a demo account on that database). The clock is fixed to Thursday 15 Oct 2026, the
device scale is 2, and the tasks are a curated week written straight into IndexedDB (`TASKS` in the script). Rebuild
first: the screenshots show whatever `public/build` holds.

### Promo video

`video/` is a [Remotion](https://www.remotion.dev) project that renders the promo video (landscape and square MP4) and
a silent loop GIF for the README from pieces of the real UI. It has its own `package.json` and type check
(`bun run typecheck` in `video/`, also a CI job), and is left out of the app's build, TypeScript check and lint; the
formatter covers it like the rest of the repository. Previewing and rendering are in
[video/README.md](../video/README.md); the renders go to `video/out/` and are not committed.

## Adding a shadcn component

Always add components through the CLI so they match the preset (`components.json`):

```sh
bunx --bun shadcn@latest add <component>
```

The files land in `resources/js/components/ui/`. Import them from `@/components/ui/<component>`. Those files are
excluded from lint/format, so keep local edits there to a minimum; prefer composing them in `resources/js/components/`.
If the CLI rewrites an import to something other than `@/lib/utils` (it has emitted `from "cn"` before), fix it, and
remove the unrelated `cn` npm package it installs along with it (`bun remove cn`). When it asks to overwrite an
existing file such as `button.tsx`, answer no.

## Inertia

Laravel controllers return `Inertia::render('<page>', $props)`; the page component lives in
`resources/js/pages/<page>.tsx`. Layouts are assigned in `resources/js/app.tsx` by page name (`planner`, `auth/*` and
`billing/plans` → the persistent planner layout, under the auth cards; `legal/*` → no layout; `settings/*` → app +
settings layouts; everything else → app layout). Shared props (for
example `auth.user`, `name`, `feedbackUrl`) come from `app/Http/Middleware/HandleInertiaRequests.php`.

## Wayfinder

Wayfinder generates typed TypeScript helpers for Laravel routes and controller actions into `resources/js/routes`,
`resources/js/actions` and `resources/js/wayfinder`. The Vite plugin regenerates them during `composer run dev` and
`bun run build`; to regenerate manually run `php artisan wayfinder:generate --with-form`. Use them instead of
hard-coded URLs:

```ts
import { login } from '@/routes';
import { update } from '@/actions/App/Http/Controllers/Settings/ProfileController';
```

Note: Wayfinder 0.1.x does not know the `QUERY` HTTP verb that Laravel 13 adds to `Route::any()`/`Route::redirect()`,
and the generated TypeScript fails to type-check for such routes. Register explicit verbs instead (for example
`Route::get('settings', fn () => to_route('profile.edit'))`).

## Self-hosting without Docker

The Docker image, the Coolify template and every environment variable are documented in
[self-hosting.md](./self-hosting.md). Without Docker, Plain Week is a plain Laravel app with SQLite: one PHP process and
one database file, no external services (the queue is a table in it). Deploy it like any Laravel app.

1. Build: `composer install --no-dev --optimize-autoloader`, `bun install`, `bun run build`. The build needs PHP
   (the Wayfinder Vite plugin calls `php artisan`) and produces `public/build/` and `public/sw.js`; deploy that output.
2. Configure `.env` (start from `.env.example`):

    | Variable                        | Value                                                                                                                             |
    | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
    | `APP_KEY`                       | `php artisan key:generate --show`; keep it stable across deploys (it encrypts sessions)                                           |
    | `APP_ENV` / `APP_DEBUG`         | `production` / `false`                                                                                                            |
    | `APP_URL`                       | The public URL, for example `https://plan.example.com`                                                                            |
    | `DB_CONNECTION`                 | `sqlite` (the default)                                                                                                            |
    | `DB_DATABASE`                   | Absolute path of the SQLite file on a persistent volume, for example `/data/database.sqlite` (default `database/database.sqlite`) |
    | `DB_BUSY_TIMEOUT`               | Optional, milliseconds a writer waits for the SQLite lock (default `5000`)                                                        |
    | `SESSION_DRIVER`, `CACHE_STORE` | `database` (the defaults; stored in SQLite)                                                                                       |
    | `MAIL_MAILER`                   | `log` (default) without a mail server; set SMTP variables to send verification and password reset emails                          |
    | `TRUSTED_PROXIES`               | The reverse proxy's IPs (or `*`) when it terminates TLS, so URLs use `https`. Sessions are secure when `APP_URL` is `https://`    |
    | `APP_NOINDEX`                   | `true` to keep search engines out (`X-Robots-Tag`, robots meta and `/robots.txt`)                                                 |

3. Migrate on every deploy: `php artisan migrate --force` (creates the SQLite file's tables; `touch` the file first if
   it does not exist). Optionally cache config and routes (`php artisan optimize`).
4. Serve `public/` from the domain root with PHP-FPM (nginx, Caddy) or `php artisan serve` behind a proxy, over HTTPS
   (service workers require it outside localhost). Keep `sw.js` uncached (see [PWA](#pwa-offline-shell)). `/up` is a
   health check.
5. Scheduler and queue worker (background work such as notifications): add the scheduler to cron,
   `* * * * * cd /path/to/plain-week && php artisan schedule:run >> /dev/null 2>&1`, and keep one
   `php artisan queue:work --max-time=3600` running under a supervisor (systemd, Supervisor) that restarts it when it
   exits. The Docker image runs both itself.
6. Backups: back up the SQLite file (for example `sqlite3 database.sqlite ".backup backup.sqlite"`). It holds accounts
   and synced tasks; guest data only lives in the browser.

Email verification never blocks the app, so an instance without mail works (see
[architecture.md](./architecture.md#routes-and-access)).
