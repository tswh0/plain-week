<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/images/header-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="./docs/images/header-light.png">
    <img src="./docs/images/header-light.png" alt="Plain Week: your week, plain and simple. A minimal weekly planner and to-do list." width="100%">
  </picture>
</p>

<p align="center">
  <strong>Your week, plain and simple.</strong><br>
  <strong>One week on one screen. Local-first and private: no account needed, your tasks stay in your browser and it
  works offline. Free and MIT licensed.</strong><br>
  Free in your browser and on your own server; optional sync across devices on plainweek.eu is a paid plan.
</p>

<p align="center">
  <img src="./docs/images/promo-loop.gif" alt="Plain Week in action: typing tasks straight into the days of the week, then dragging them between days" width="100%">
</p>

<p align="center">
  <a href="https://zdoc.app/de/victor-falcon/plain-week">Deutsch</a> |
  <a href="https://zdoc.app/es/victor-falcon/plain-week">Español</a> |
  <a href="https://zdoc.app/fr/victor-falcon/plain-week">Français</a> |
  <a href="https://zdoc.app/ja/victor-falcon/plain-week">日本語</a> |
  <a href="https://zdoc.app/ko/victor-falcon/plain-week">한국어</a> |
  <a href="https://zdoc.app/pt/victor-falcon/plain-week">Português</a> |
  <a href="https://zdoc.app/ru/victor-falcon/plain-week">Русский</a> |
  <a href="https://zdoc.app/zh/victor-falcon/plain-week">中文</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/victor-falcon/plain-week" alt="License: MIT"></a>
  <a href="https://github.com/victor-falcon/plain-week/releases/latest"><img src="https://img.shields.io/github/v/release/victor-falcon/plain-week" alt="Latest release"></a>
  <a href="https://github.com/victor-falcon/plain-week/actions/workflows/tests.yml"><img src="https://github.com/victor-falcon/plain-week/actions/workflows/tests.yml/badge.svg?branch=main" alt="Tests"></a>
  <a href="https://github.com/victor-falcon/plain-week/pkgs/container/plain-week"><img src="https://img.shields.io/badge/ghcr.io-victor--falcon%2Fplain--week-2496ED?logo=docker&amp;logoColor=white" alt="Docker image on GHCR"></a>
</p>

## Get started

- 🌐 **Use it now at [plainweek.eu](https://plainweek.eu).** Open it and start planning, no sign-up needed.
- 🐳 **Run it with Docker.** One container, SQLite on a volume, no other services. Then open http://localhost:8080.

    ```sh
    docker run -d -p 127.0.0.1:8080:8080 -v plainweek-storage:/app/storage \
      -e APP_URL=http://localhost:8080 -e APP_KEY="base64:$(openssl rand -base64 32)" \
      ghcr.io/victor-falcon/plain-week:latest
    ```

- 🚀 **Deploy on [Coolify](https://coolify.io).** Create a **Docker Compose Empty** resource, paste
  [the template](https://raw.githubusercontent.com/victor-falcon/plain-week/main/deploy/coolify/plain-week.yaml), set the
  domain of the `plainweek` service and deploy ([details](./docs/self-hosting.md#coolify)).

> ⭐ **If Plain Week is useful to you, a star helps others find it.** Ideas, questions or feedback? Say hi in
> [GitHub Discussions](https://github.com/victor-falcon/plain-week/discussions).

## Features

- ⚡ **Fast entry.** Click an empty row, type, press Enter, keep typing. "17:30 Gym" sets the time for you.
- 🔁 **Recurring tasks.** Repeat every N days, weekly on any weekdays or monthly on a day, with an optional end date.
  Change or move one occurrence, or this and all the following ones.
- 🎨 **Colors, notes and subtasks.** Eight colors, plain-text notes and a checklist, all in one task dialog.
- ↔️ **Drag and drop.** Reorder within a day, move across days and to Someday, or drop on the screen edge to send a task to
  another week. Mouse, touch and keyboard.
- 🖱️ **Right click for the rest.** A context menu to color, duplicate, delete or move a task to tomorrow, next week or
  Someday, with undo.
- ⌨️ **Keyboard shortcuts.** ← / → to change weeks, T to jump back to today.
- 📴 **Offline-first and installable.** Data lives in IndexedDB; the app loads and works without a connection and installs
  as an app (PWA).
- 🔄 **Optional account and sync.** Start as a guest, fully local. Create an account on your own server, or on
  [plainweek.eu](https://plainweek.eu) (paid), to sync between devices; your local work comes with you.
- 📅 **CalDAV.** Turn it on with `CALDAV_ENABLED=true` and add your week to Apple Calendar, Thunderbird, DAVx5 or any
  CalDAV client, with an app password from Settings › Integrations. Read-only: edit tasks here.
- 📦 **Export and import.** With an account, download all your tasks as JSON from Settings › Data and bring them back on
  any instance.
- 🌗 **Light and dark mode, right-to-left layouts.**
- 🏠 **Self-hosting in one container.** A Docker image on GHCR, a Coolify template, SQLite and no other
  services.

![Plain Week: the week view in light mode](./docs/images/desktop-light.png)

| Dark mode                                                     | Task dialog                                        |
| ------------------------------------------------------------- | -------------------------------------------------- |
| ![The week view in dark mode](./docs/images/desktop-dark.png) | ![The task dialog](./docs/images/dialog-light.png) |

| Repeat every N days                                             | Right-click menu                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| ![The repeat options of a task](./docs/images/repeat-light.png) | ![The task context menu](./docs/images/context-menu-light.png) |

| Export and import                                                            | Task dialog, dark                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| ![Settings › Data: export and import](./docs/images/settings-data-light.png) | ![The task dialog in dark mode](./docs/images/dialog-dark.png) |

| Phone, light                                                              | Phone, dark                                                             |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| <img src="./docs/images/mobile-light.png" alt="Phone, light" width="300"> | <img src="./docs/images/mobile-dark.png" alt="Phone, dark" width="300"> |

## Local development

Requirements: PHP 8.3+ (8.5 recommended), Composer, bun 1.3+, and Node.js 24+.

```sh
git clone https://github.com/victor-falcon/plain-week.git
cd plain-week
composer setup      # install dependencies, create .env, generate key, migrate SQLite, build assets
composer run dev    # serve the app, queue worker, logs and Vite
```

Then open http://127.0.0.1:8000.

Before pushing, run what CI runs:

```sh
composer ci:check   # JS lint/format, TS types, JS tests, Pint, PHPStan, Pest
bun run build       # production assets
```

## Self-hosting

One container, SQLite on a volume, no other services: the `docker run` line in [Get started](#get-started) is all it
takes. There is also a [Coolify](https://coolify.io) template, a `docker-compose.yml` for any server and a
guide for running it without Docker, plus every environment variable (email, Google Calendar, notifications): see
[docs/self-hosting.md](./docs/self-hosting.md).

## Documentation

See [docs/](./docs/README.md) for the architecture (offline-first and the sync contract), the style guide, the stack
and the conventions, and [CHANGELOG.md](./CHANGELOG.md) for what changed in each release.

## License

[MIT](./LICENSE)
