# Plain Week: agent guide

Plain Week is an open-source (MIT), free, self-hostable, offline-first weekly planner built with Laravel 13, Inertia v3,
React 19, TypeScript, Tailwind v4 and shadcn/ui, using bun and SQLite.

## Non-negotiables

1. **Offline-first.** IndexedDB (Dexie) is the client's source of truth. The UI only reads and writes the local
   database and never waits on the network to render or apply a user action. The backend is auth plus sync.
2. **shadcn components only.** Add them with `bunx --bun shadcn@latest add <component>`, compose them, and style
   through tokens and Tailwind classes. Don't hand-roll primitives shadcn already has. Use logical (RTL-safe) classes:
   `ms-/me-/ps-/pe-/start-/end-`.
3. **English everywhere.** Code, identifiers, comments, docs, commits and pull requests.

## Read first

- [docs/README.md](./docs/README.md): documentation index
- [docs/architecture.md](./docs/architecture.md): offline-first rule, data model, sync contract (canonical), client data
  layer, offline shell, drag and drop
- [docs/style.md](./docs/style.md): preset, tokens, dark mode, RTL, planner layout, task colors, component inventory,
  patterns and the checklist for building a new component
- [docs/stack.md](./docs/stack.md): versions, commands, local dev, testing (incl. browser QA), CI, folder layout,
  self-hosting
- [docs/self-hosting.md](./docs/self-hosting.md): Docker image, GHCR, Coolify template, environment variables
- [docs/conventions.md](./docs/conventions.md): code style, naming, tests, commits and PRs

## Before you push

```sh
composer ci:check   # JS lint/format, TS types, JS tests, Pint, PHPStan, Pest
bun run build
```

UI changes also get a headless browser check ([stack.md](./docs/stack.md#testing)). Keep `docs/` and `CHANGELOG.md`
current with what you change. Never commit anything under `docs/research/`.

## Releases

Cut a **patch** release (`x.y.Z`) by default: bump `package.json`, move the `Unreleased` CHANGELOG entries under the
new version and update the compare links. Once that is merged, tag the merge commit `vX.Y.Z` and push the tag: CI
publishes the Docker image and the GitHub release (notes taken from the CHANGELOG). Only bump the minor or major
version when the owner explicitly asks for it.
