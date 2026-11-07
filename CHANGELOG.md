# Changelog

All notable changes to Plain Week are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Launch code and sold-out founder code.** A featured promotion code that is not free (e.g. `EARLY75`, 75% off) now
  gives Lifetime its "Launch −75%" badge on the landing card and the plan choice by itself, so the automatic launch
  coupon can be removed. The new `SAAS_SOLD_OUT_PROMOTION_CODE` (e.g. `FOUNDER20`) keeps a used-up code on the landing
  card's Lifetime plan, struck through with a "Sold out" badge and "Free for our first founders.", never copyable.

## [0.3.13] - 2026-11-06

### Added

- **Install the mobile app.** On desktop, "Install mobile app" in the header shows a QR code of your Plain Week and the
  steps to add it to your phone's home screen on iPhone (Safari) and Android (Chrome), where it opens like an app and
  works offline. It also shows up once by itself on your first visit from a computer.
- **Founder code on the landing.** While the promotion code in `SAAS_FEATURED_PROMOTION_CODE` (e.g. `FOUNDER20`) can
  still be used, the landing card shows Lifetime at its price with the code (free for the first founders, "Use code
  FOUNDER20"), the code copyable, and the plan choice after sign-up comes with the code already typed in and applied. Stripe is asked at most
  every 10 minutes, so once the code is used up, expired or deactivated the landing goes back to the usual prices on
  its own. How many uses are left is never shown.

## [0.3.12] - 2026-11-03

### Fixed

- **No more gaps in Someday.** Someday is now a single list, shown on desktop as three columns filled top to bottom and
  then left to right; empty rows always come after the last task, on phones too. Dragging anywhere in Someday
  reorders that one list, and `j` / `k` walk it across the columns. Existing tasks keep their order (column 1, then 2,
  then 3) with nothing to migrate, but they are re-flowed over the three columns: a column is no longer a group of
  its own.

## [0.3.11] - 2026-11-03

### Added

- **Clickable links in tasks.** Web links (`https://…`, `http://…`, `www.…`) in a task's title or notes open in a new
  tab. In the task dialog they show as links until you click elsewhere in the text to edit it; in the week, a click
  on a link in a task opens the link instead of the task.
- **GitHub releases from tags.** Pushing a `vX.Y.Z` tag now also publishes its GitHub release, with that version's
  CHANGELOG section as the notes.

## [0.3.10] - 2026-11-03

### Added

- **A promo video.** `video/` is a Remotion project that tells Plain Week's story in about 35 seconds with pieces of
  the real UI (fast entry, the task dialog, drag and drop, repeats, offline, dark mode, self-hosting), over a
  soundtrack synthesized from code. It renders a landscape and a square MP4 and a short loop GIF; see
  `video/README.md`.

### Changed

- **Done Someday tasks are archived when their week is over.** A Someday task you complete stays there, ticked, for
  the rest of that week, and is gone from the following weeks; browse back to that week and it is still there, done.
  Nothing is deleted: undoing the task brings it back.
- **A README for first-time visitors.** It opens with a short pitch, the promo loop and three ways to get started
  (plainweek.eu with no sign-up, one `docker run` line, the Coolify template), links to machine translations in eight
  languages through zdoc.app, and points to GitHub Discussions for ideas and feedback. Development and self-hosting
  details moved further down.
- **A GitHub social preview.** `bun scripts/marketing-images.ts` also renders `docs/images/social-preview.png`
  (1280×640), with a crop of the real week view, for the repository's social preview.

### Fixed

- **Legacy time zone aliases.** A time zone a browser reports as a legacy alias, such as `Asia/Calcutta`, is stored
  again under its canonical name (`Asia/Kolkata`), even on servers whose tzdata no longer ships the alias, so its
  notifications and calendar events use the right local time. UTC offsets and abbreviations are still ignored. The
  PHP `intl` extension is now a declared requirement (the Docker image already has it).

## [0.3.9] - 2026-11-02

### Added

- **A welcome note on plainweek.eu.** The first time an account gets a plan (weekly or lifetime), it gets one short,
  plain email from Víctor, in Spanish or English, asking what you used to plan your week before and what made you try
  Plain Week. Replying reaches him directly. Self-hosted instances never send it.

### Fixed

- **Email from Coolify and Docker Compose.** The Coolify template and `deploy/docker-compose.yml` now pass the SMTP
  settings (`MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_SCHEME`, `MAIL_FROM_ADDRESS`,
  `MAIL_FROM_NAME`), so an instance can actually send verification and password reset emails. The self-hosting guide
  has an example with Resend.

## [0.3.8] - 2026-11-02

### Added

- **Send feedback.** The account menu (also for guests in the planner) and the settings sidebar have a "Send feedback"
  link. On plainweek.eu it opens an email to the contact address (`SAAS_CONTACT_EMAIL`); on a self-hosted instance it
  opens the project's GitHub Discussions.
- **"How did you hear about Plain Week?"** The sign-up card on plainweek.eu asks, optionally, where you found Plain
  Week (X, Substack, Reddit, Hacker News, a friend or other). Self-hosted instances don't ask.
- **Account language.** New accounts remember whether their browser prefers Spanish or English, for emails in that
  language later on.

### Changed

- **README.** It now says plainly that Plain Week is free and open source with every feature, and points to
  [plainweek.eu](https://plainweek.eu) for anyone who'd rather not run a server. Sync there is a paid plan.

## [0.3.7] - 2026-10-31

### Changed

- **One morning notification for the whole day.** At your morning time you now get a single notification listing the
  day's tasks that have no time and aren't done yet ("3 tasks today: Buy bread · Call mom · Gym"), instead of one per
  task. With a single task it still shows that task and opens it. Phones that are asleep at that time now have four
  hours to receive it instead of one, so it no longer gets lost; reminders before timed tasks are unchanged.

## [0.3.6] - 2026-10-30

### Changed

- **Morning notifications are for tasks without a time.** At your morning time (08:00 by default, in your time zone)
  you get one notification for each task of the day that has no time and isn't done yet. A task with a time no longer
  gets one in the morning: its reminder 5 minutes before it starts is enough.
- **Longer Google Calendar events for timed tasks.** A task with a time now becomes a 20-minute event in Google
  Calendar instead of a 15-minute one. Events already in the calendar get the new length on the next sync (at the
  latest the daily one), except those dated more than 30 days ago.

## [0.3.5] - 2026-10-29

### Fixed

- **Room between the time and a colored task.** A colored task with a time (or a repeat icon) no longer sits flush
  against it: a small gap now separates them.

## [0.3.4] - 2026-10-28

### Changed

- **A quieter weekend.** Saturday and Sunday headers use softer grey text and a lighter rule, so the weekend stands
  apart from the work week at a glance. When today falls on the weekend it keeps its usual highlight.

## [0.3.3] - 2026-10-27

### Fixed

- **Push notifications on Android.** They are sent with high urgency, so they arrive on time while the phone is idle
  instead of only when it wakes up or the app is opened.

## [0.3.2] - 2026-10-26

### Added

- **Google Calendar sync.** Settings › Integrations connects a Google account and creates a "Plain Week" calendar in
  it, where every dated task shows up as an event: all day, or 15 minutes at its time in your time zone, with 🎯 in the
  title (✅ once done), your notes and a link that opens the task. Recurring tasks get one event per occurrence for the
  next 60 days. Edits, moves and deletes follow within seconds of syncing, in the background; changes go one way (Plain
  Week → Google). The page shows when it last synced and the last problem, if any, and asks you to reconnect if Google
  stops accepting the access. Disconnecting deletes that calendar and revokes the access. Self-hosted instances turn it
  on with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (see docs/self-hosting.md); without them it stays hidden. It
  needs the queue worker and scheduler, which the Docker image already runs.
- **Push notifications.** Settings › Notifications turns them on per device: every morning (08:00 by default, at the
  time you choose there, in your time zone) one notification for each task planned that day that isn't done, and one 5
  minutes before a task with a time, recurring ones included. Opening one opens its task. Nothing is sent twice, and
  browsers that unsubscribed are forgotten. On iPhone and iPad they work in the app added to the Home Screen
  (iOS 16.4+). Self-hosted instances turn them on with `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (see
  docs/self-hosting.md); without them they stay off and hidden.
- **Task links.** `/?task=<id>` opens the planner on that task's week with its dialog open, also for a task that only
  arrives with the first sync after the page loads (an unknown task is ignored). Closing the dialog drops `?task=` from
  the address. Calendar events and notifications link here.
- **Your time zone on the server.** Sync requests send the browser's time zone, and the server keeps it on the account
  so scheduled work can happen at your local time. Nothing to set.
- **Background work in the Docker image.** The container now runs the Laravel scheduler and a database queue worker
  next to the server, supervised and stopped together with it (`tini` is PID 1). No configuration needed; `composer dev`
  runs the scheduler too. Without Docker, add the scheduler to cron and run a queue worker (see docs/stack.md).
- **Google and push settings in the Coolify template.** `deploy/coolify/plain-week.yaml` lists `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`, empty by default, so they can be
  set from Coolify's Environment Variables. Left empty, both features stay off.

## [0.3.1] - 2026-10-21

### Security

- **PHP 8.5.12.** The Docker image pins FrankenPHP to the exact `php8.5.12` release, which fixes two critical
  remote code execution bugs (GHSA-w8hw-w9fx-j79w and GHSA-6wmf-4rv5-p3rp), so a cached base image can't keep
  shipping the vulnerable build.

## [0.3.0] - 2026-10-17

### Added

- **Unfinished tasks move to today.** When the planner opens and when the day changes, tasks from earlier days that
  are not done move to the end of today, in the order they had, subtasks included. Recurring and Someday tasks stay
  where they are. On by default; turn it off in the new Settings › Preferences page (stored per device; guests always
  get it).

### Changed

- **Enter opens a task; `o` is gone.** Enter opens the task under the cursor (or the mouse) and starts typing on an
  empty row, under the mouse too. Both rows hint `⏎`; `a` and `i` still start a new task.
- **A quieter keyboard cursor.** The cursor's row gets a faint full-row tint and a 2px bar on its start edge (mirrored
  in RTL) instead of a rounded box with a ring; a focused task shows the same bar. Mouse hover shows only the hint.

### Removed

- **The "? Keyboard shortcuts" button at the end of the planner.** The account menu item and the `?` key open the
  shortcuts dialog.

### Fixed

- **The planner moves on to the new day without a reload.** It used to stay on yesterday after midnight when the laptop
  had slept or the tab never became hidden. It now also checks the date on focus, on wake, when coming back online and
  every 30 seconds, and if the current week was on screen it follows into the new week.
- **Sync heals by itself.** A failed sync is retried on its own, with exponential backoff and jitter (2 s up to 5 min,
  honouring `Retry-After`), and at once when the device comes back online, the window gets focus or the tab is shown
  again. Server hiccups read as "Syncing…" and only turn red once they have lasted 2 minutes; "Retry sync" still runs at
  once and resets the backoff. A `402` still pauses sync until the plan changes.
- **A bad connection never makes anything hang.** Every sync request gives up after 20 s (it used to be 30 s, and a
  stuck request could hold the cross-tab sync lock), logout waits at most 10 s for pending changes before asking about
  them, and Settings › Data waits at most 3 s for a fresh sync. A retry while offline no longer flashes the dot green.
  The periodic pull only runs while the tab is visible.

## [0.2.0] - 2026-10-16

### Added

- **Keyboard shortcuts for the whole planner, vim style.** A keyboard cursor over the tasks (`h` / `j` / `k` / `l`,
  arrows, `g g` / `G`, Esc), task actions on it (`o` / Enter open, `x` / Space done, `J` / `K` reorder, `<` / `>`
  previous / next day, `w` next week, `s` Someday, `y` duplicate, `d d` / Delete delete, `m` menu, `a` / `i` new task),
  weeks (`H` / `L`, ← / →, `t`), `u` undo, `,` settings and a `?` dialog listing them all (also in the account menu).
  Mirrored in RTL, never while typing, with a dialog open or while dragging, and hidden from mouse users.
- **Key hints for mouse and trackpad users.** Hovering a task shows `o`, an empty row `a`; the header tooltips show
  `t`, `H` / `←` and `L` / `→`; the task menu and the task dialog's More menu show each item's key (which also picks
  the item while the menu is open); a quiet "? Keyboard shortcuts" button sits at the end of the planner. All read
  from the shortcut list, and never shown on touch screens. With no keyboard cursor, `o` and `a` act on the row under
  the mouse.
- **Task dialog keys.** With focus in the dialog but not in a text field: `d` date, `t` time, `r` repeat, `c` color,
  `m` More, `e` title, `n` notes, `a` add a subtask, `x` done, `>` next day, `w` next week, `s` Someday, `y`
  duplicate, Delete delete, Esc close. They show in the toolbar tooltips and in a "Task dialog" group of the `?`
  dialog. The date pickers open on the task's day, so the arrow keys pick a day at once.
- **`h` / `l` remember the row in each day.** Going back to a day puts the cursor on the row it left there.

### Changed

- **The "current week" shortcut is lowercase `t`.** Shortcuts are case-sensitive now; Shift+T no longer goes to the
  current week.

## [0.1.1] - 2026-10-16

### Changed

- **Landing self-hosting block.** "Prefer your own server?" drops the `docker run` command and the GitHub link and
  keeps a single "Self-hosting guide →" link to the self-hosting docs, opening in a new tab.

## [0.1.0] - 2026-10-16

### Added

- **SaaS mode (`SAAS_ENABLED`, off by default).** For the hosted service: accounts need a paid plan to sync, a Weekly
  subscription or a one-time Lifetime purchase (with an optional launch coupon), paid through Stripe Checkout with
  Stripe Tax (Laravel Cashier). An account without a plan sees a paywall and the sync API answers `402`; the client
  then stops syncing, keeps its local data and shows the paywall. Adds Settings › Billing (plan, renewal, Stripe
  portal, upgrade to lifetime), Terms of Service and Privacy Policy pages, Stripe webhooks (refunds revoke lifetime)
  and `php artisan plainweek:grant-lifetime`. Self-hosted instances are unchanged: free accounts, no billing, and the
  new routes are `404`. See [docs/saas.md](docs/saas.md).
- **Promotion codes (SaaS mode).** The plan choice has a "Have a code?" field: a code created in the Stripe Dashboard
  is checked for the chosen plan, shows the price it gives and replaces the launch coupon at Checkout. A 100% code on
  Lifetime makes a no-cost order (no card) that grants lifetime like a paid one.

- **Landing card (SaaS mode).** A guest's first visit shows a floating card over the planner (a bottom sheet on
  phones): what Plain Week is, product shots, the Weekly and Lifetime prices from Stripe (with the launch discount),
  self-hosting and a FAQ. "Start now" (or Esc) closes it for good on that device, "Log in" opens the log in card, and a
  plan picked there is preselected on the plan choice after signing up. Self-hosted instances never show it. The
  prices come from the new public `GET /billing/prices`.

### Changed

- **Sync status dot and "Sync your week".** The account avatar always shows a sync status dot at its corner: green
  synced, pulsing indigo syncing (no pulse with reduced motion), amber offline, red error (with "Retry sync" in the
  menu) and grey when a SaaS plan ended. Guests get a "Sync your week" pill to sign-up, with Log in in a small menu.

- **Log in, sign up and the plan choice float over the planner.** `/login`, `/register`, the password reset pages,
  email verification, two-factor and password confirmation are now floating cards over the dimmed planner (a bottom
  sheet on phones) instead of separate pages; closing one (close button or Esc) goes back to the planner. Sign-up asks
  for the password once (it can be shown). In SaaS mode sign-up is step 1 of 2 and `/plans` is step 2: Lifetime or
  Weekly as radio cards, the amount due today and "Continue to payment".

### Fixed

- **Logging out leaves nothing behind and shows the demo again.** Logout wipes every local table and flag, so the
  planner starts over like a first-time guest with the demo tasks. When sync finds the session gone (`401`, or a `419`
  confirmed by a `401`) or a guest page finds a signed-out user's data, the device is wiped the same way instead of
  keeping it visible, asking first if some changes never synced. Other open tabs reload into the guest state. A guest's own tasks are never wiped.

## [0.0.6] - 2026-10-16

### Added

- **Link previews.** Every page carries Open Graph and X/Twitter card tags (title, description, a 1200×630 image), so a
  shared link shows a card. URLs come from `APP_URL`, so self-hosted instances point at themselves; `APP_NOINDEX` only
  affects robots, not the previews.

### Changed

- **README.** A header image (light and dark), badges, a shorter pitch and a feature list that matches the current
  app, with fresh screenshots of the new logo, today's tint, the repeat options, the context menu and Settings › Data.
  The marketing images and the screenshots are generated by scripts (`bun scripts/marketing-images.ts`,
  `bun scripts/screenshots.ts`).
- **New logo: a single line drawing "pw".** One thick continuous line with round ends writes a lowercase "pw", the p's
  stem dropping below the baseline. It replaces the seven bars in the sidebar and on the auth pages. The browser tab
  shows it in white on a black rounded tile, and the installed app icons in white on black over a faint grid.

## [0.0.5] - 2026-10-16

### Changed

- **Today stands out.** Today's day, header and rows, now sits on a soft accent tint with rounded top corners, so it is
  easy to spot at a glance. Its weekday label is a touch darker to keep its contrast on the tint.

### Fixed

- In dark mode, hovering a task no longer draws a gray box behind it.

## [0.0.4] - 2026-10-15

### Added

- **Repeat every N days.** The repeat picker has a "Daily" option with a number of days from 1 to 365 ("Every day",
  "Every 21 days"), counted from the task's date. Like the other rules it can end on a date, and single occurrences can
  be changed, moved or deleted, or the rule changed for this and all future occurrences. Export and import carry it.

### Changed

- **New logo, favicon and app icons.** The Laravel starter-kit mark is replaced by Plain Week's own: seven bars for the
  days of the week, Monday to Friday in ink and the weekend in indigo. It shows in the sidebar, the auth pages, the
  browser tab (with a dark variant) and the installed app icons.
- **Narrower task context menu.** Its nine color swatches sit in two rows of five and four, like the task dialog's color
  picker, so the menu is as wide as that grid instead of one long row.
- Sync requests send `X-Sync-Format: 2`. Clients without it (v0.0.3 and older) receive "every N days" series as
  deleted, since they cannot show them, and cannot overwrite them; after updating, a client pulls everything once to
  get them back.

## [0.0.3] - 2026-10-15

### Added

- **Guest onboarding.** A first-time guest finds a few demo tasks in the current week that show how the planner works.
  They stay on the device: the untouched ones are dropped when the guest creates an account or logs in, the ones the
  guest changed are kept and synced. They never come back once seeded.
- **Export and import** in Settings › Data (registered users). "Export data" downloads all your tasks, recurring ones
  included, as a JSON backup (`plain-week-export-YYYY-MM-DD.json`). "Import data…" previews a backup and adds its tasks
  next to the ones you have, leaving those unchanged. Both run in the browser on your local data; imported tasks sync
  like any other change.
- **Docker image.** `ghcr.io/victor-falcon/plain-week` (amd64 and arm64): one FrankenPHP container on port 8080 running
  as a non-root user, with SQLite on the `/app/storage` volume. It migrates on start, refuses to start without a valid
  `APP_KEY` and trusts the reverse proxy's forwarded headers. CI publishes `X.Y.Z`, `X.Y` and `latest` on release tags
  and `edge` on `main`.
- **Coolify one-click template** (`deploy/coolify/plain-week.yaml`), a `docker-compose.yml` example and a self-hosting
  guide (`docs/self-hosting.md`).
- **`APP_NOINDEX`.** When `true`, every response carries `X-Robots-Tag: noindex, nofollow`, the page has a robots meta
  tag and `/robots.txt` disallows all crawlers.

### Changed

- `/robots.txt` is served by the app instead of a static file (same content unless `APP_NOINDEX` is on).
- The guest "save your tasks" button uses a cloud upload icon instead of a download icon.

## [0.0.2] - 2026-10-15

### Added

- **Recurring tasks.** Repeat a task weekly on any weekdays or monthly on a day (the last day in shorter months), with
  an optional end date, from the new Repeat button in the task dialog. Recurring tasks show a repeat icon with the rule
  in a tooltip. Changing one asks "Only this task" or "This and all future" (once per dialog for typing), and so does
  changing its repeat from any but the first occurrence ("Only this task" starts a series of its own); completing or
  moving one only ever affects that one.
- **Undo for quick moves.** Tomorrow, Next week and Someday, from the context menu or the task dialog, say where the
  task went ("Moved to Tue 13 Oct.") with an Undo.
- **Recurring tasks: sync.** Tasks carry `recurrence`, `series_id` and `occurrence_date`, validated and synced by the
  server so recurring tasks and their per-day changes reach every device.
- **Task context menu.** Right click a task (or press Shift+F10 / the context menu key on it) to change its color, move
  it to tomorrow, next week or Someday, duplicate it or delete it with undo. On touch screens, press and hold still to
  open it; press, hold and move still drags the task.

## [0.0.1] - 2026-10-15

The first release: a minimal, offline-first weekly planner you can use as a guest or with an account that syncs
between devices.

### Added

- **Week view.** Monday to Friday side by side, Saturday stacked over Sunday, and three Someday columns below for
  everything without a date. ISO week number in the header, today highlighted, a single-column layout on phones.
- **Fast task entry.** Type in any empty row and press Enter to keep going. A leading time becomes the task's time
  ("17:30 Gym"); timed tasks are listed first in their day.
- **Complete and reopen tasks** from the row's check button.
- **Task dialog.** Edit the title, date (calendar), time, color (nine colors), plain-text notes and subtasks. Move a
  task to tomorrow, next week or Someday, duplicate it, or delete it with undo. Everything saves as you type.
- **Drag and drop.** Reorder tasks within a day, move them across days and Someday columns, or drop them on the screen
  edges to move them to the previous or next week. Works with mouse, touch (long press) and keyboard.
- **Keyboard shortcuts.** ← / → for the previous and next week (mirrored in RTL), T for the current week; clicking the
  title also returns to today.
- **Offline-first.** Tasks live in the browser (IndexedDB). The app renders and every action applies instantly without
  waiting for the network.
- **Installable PWA.** A service worker keeps the app shell available offline after the first visit, with an "Update
  available" prompt on new deploys.
- **Accounts and sync.** Use it as a guest with no account. Register to sync between devices: guest work is uploaded,
  changes sync in the background (last write wins), and logging out wipes the local copy. Login, registration, password
  reset, optional email verification, two-factor authentication and passkeys via Laravel Fortify.
- **Look and feel.** shadcn/ui (radix-luma, stone, Inter), light and dark mode, RTL support.
- **Self-hostable.** A plain Laravel 13 app with SQLite and no external services; email verification never blocks the
  app, so an instance without mail works.
- **Documentation** for contributors and coding agents in `docs/` and `AGENTS.md`.

[Unreleased]: https://github.com/victor-falcon/plain-week/compare/v0.3.13...HEAD
[0.3.13]: https://github.com/victor-falcon/plain-week/compare/v0.3.12...v0.3.13
[0.3.12]: https://github.com/victor-falcon/plain-week/compare/v0.3.11...v0.3.12
[0.3.11]: https://github.com/victor-falcon/plain-week/compare/v0.3.10...v0.3.11
[0.3.10]: https://github.com/victor-falcon/plain-week/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/victor-falcon/plain-week/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/victor-falcon/plain-week/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/victor-falcon/plain-week/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/victor-falcon/plain-week/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/victor-falcon/plain-week/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/victor-falcon/plain-week/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/victor-falcon/plain-week/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/victor-falcon/plain-week/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/victor-falcon/plain-week/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/victor-falcon/plain-week/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/victor-falcon/plain-week/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/victor-falcon/plain-week/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/victor-falcon/plain-week/compare/v0.0.6...v0.1.0
[0.0.6]: https://github.com/victor-falcon/plain-week/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/victor-falcon/plain-week/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/victor-falcon/plain-week/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/victor-falcon/plain-week/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/victor-falcon/plain-week/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/victor-falcon/plain-week/releases/tag/v0.0.1
