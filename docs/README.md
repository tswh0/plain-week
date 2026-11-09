# Plain Week documentation

Plain Week is a minimal, offline-first weekly planner. It is free, MIT licensed and self-hostable.

| Document                             | What it covers                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| [architecture.md](./architecture.md) | The offline-first rule, the data model and sync contract (canonical), client data layer, PWA, DnD       |
| [style.md](./style.md)               | Visual style: preset, tokens, dark mode, RTL, planner layout, task colors, components, patterns         |
| [stack.md](./stack.md)               | Versions, commands, local development, testing, CI, folder layout, shadcn, Wayfinder, Inertia, hosting  |
| [self-hosting.md](./self-hosting.md) | Docker image, Coolify one-click template, docker-compose, environment variables, backups, updating      |
| [saas.md](./saas.md)                 | SaaS mode (`SAAS_ENABLED`): paid plans, Stripe and Cashier, entitlement, paywall, webhooks, legal pages |
| [caldav.md](./caldav.md)             | CalDAV (spike): exposing the planner to calendar clients, design decisions, limits, phased plan         |
| [conventions.md](./conventions.md)   | Code style, naming, tests, commits and pull requests                                                    |
| [images/](./images)                  | Screenshots of the real app used by the README (regenerate them when the UI changes)                    |

Also at the repository root: [AGENTS.md](../AGENTS.md) (non-negotiables for contributors and coding agents),
[CHANGELOG.md](../CHANGELOG.md) and the [README](../README.md).

Keep these documents current: when a change adds or alters a command, a convention, a design token, a component or
part of the sync contract, update the matching document in the same pull request.
