# CalDAV

Status: **phase 2**, two-way. Timed tasks are calendar events, everything else is a reminder. The server, the Settings ›
Integrations card, app passwords, `PUT`/`DELETE` and the two collections are built and tested.

## Using it

Set `CALDAV_ENABLED=true` and redeploy. Then open **Settings › Integrations**, create an app password and add
`APP_URL/dav/` to the client with the account email and that password.

- **Apple Calendar** shows the `Plain Week Events` collection: timed tasks.
- **iOS Reminders** shows the `Plain Week Tasks` collection: untimed tasks and Someday tasks.

The endpoint is HTTP Basic, so **serve it over HTTPS**. iOS in particular will not send the password over plain HTTP
during account setup: it loops on `401` and says "account verification failed", while Thunderbird works over the same
URL. A Cloudflare Tunnel, Caddy with a Let's Encrypt certificate or `tailscale serve` is enough.

On iOS 26, add the account through **Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add
CalDAV Account**. The Mail → Accounts path leaves the account inactive after discovery.

## What "CalDAV" means here

CalDAV is WebDAV plus iCalendar. A client discovers a calendar home, lists collections, and reads and writes resources
with `PROPFIND`, `REPORT`, `GET`, `PUT` and `DELETE`.

Two different features hide under the same word:

| Feature                           | Direction                      | What it gives                                                |
| --------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| **CalDAV server** (this document) | Plain Week ↔ clients           | The planner shows up in Calendar and Reminders, editable.    |
| CalDAV client                     | external calendar → Plain Week | Events from Fastmail/Nextcloud/Google appear in the planner. |

The request was "this calendar can sync with third party clients", so this is the server. A client integration is a
separate feature and would fight the offline-first rule unless it syncs through the same outbox.

## Two collections

The planner has one distinction that matters to a client: a timed item is an event, an untimed item is a task.

| Collection | Path                             | Component | Client    | Contents                                   |
| ---------- | -------------------------------- | --------- | --------- | ------------------------------------------ |
| Events     | `/dav/calendars/{user}/planner/` | `VEVENT`  | Calendar  | Timed tasks, 20 minutes from their time    |
| Tasks      | `/dav/calendars/{user}/tasks/`   | `VTODO`   | Reminders | Untimed tasks with a due date, and Someday |

`planner` keeps its old path so accounts added before the split keep working. The display names are `Plain Week
Events` and `Plain Week Tasks`.

### Reading

| Planner                                       | VEVENT / VTODO                                                    |
| --------------------------------------------- | ----------------------------------------------------------------- |
| plain task / exception / generated occurrence | one resource each, no `RRULE`                                     |
| `text`                                        | `SUMMARY`; a `✅ ` prefix on VEVENTs when done                    |
| `notes`                                       | `DESCRIPTION`, plus `Open in Plain Week: APP_URL/?task=<id>`      |
| `date` + `time` (Events)                      | `DTSTART`/`DTEND` in UTC, 20 minutes                              |
| `date`, no `time` (Tasks)                     | `DUE;VALUE=DATE`                                                  |
| no `date` (Someday, Tasks)                    | no `DUE`; always included, whatever the time range                |
| `done`                                        | `STATUS:COMPLETED`, `COMPLETED`, `PERCENT-COMPLETE:100` on VTODOs |
| `color`                                       | `COLOR` (RFC 7986), when not `none`                               |
| `updated_at`                                  | `DTSTAMP` and `LAST-MODIFIED`                                     |
| —                                             | `UID` = the stable key; `TRANSP:TRANSPARENT` on VEVENTs           |

The **key** is the same one the Google Calendar integration uses (`CalendarObjects::keyFor`): the task id for a plain
task or exception row, `seriesId:YYYY-MM-DD` for an occurrence. It survives the changes that matter:

- an occurrence edited for one date turns into an exception row with a new id, but keeps its key, so the client updates
  instead of delete + create;
- moving an occurrence keeps its key and changes `DTSTART`;
- deleting an occurrence is a tombstone row, so the resource disappears.

Two exceptions to the stable key, both acceptable and worth documenting for users:

- "this and all future" splits a series: the new series has a new id, so every occurrence from the split date gets a
  new `UID` and the client sees a delete + create for each;
- changing a series rule changes the set of occurrences the same way.

### Writing

`PUT` creates or updates a resource; `DELETE` tombstones it. A `series:date` href edits that occurrence as an exception
row, so a client never rewrites a series.

| ICS                                         | Planner                                                  |
| ------------------------------------------- | -------------------------------------------------------- |
| `VEVENT` with `DTSTART` date-time           | timed task: `date` + `time` in the user's zone           |
| `VTODO` with `DUE;VALUE=DATE`               | untimed task with `date`                                 |
| `VTODO` without `DUE`                       | Someday task                                             |
| `SUMMARY`                                   | `text` (a leading `✅ ` marks it done and is stripped)   |
| `DESCRIPTION`                               | `notes` (the `Open in Plain Week` line is stripped)      |
| `COLOR`                                     | `color`                                                  |
| `STATUS:COMPLETED` / `PERCENT-COMPLETE:100` | `done` + `done_at`                                       |
| `X-PLAIN-WEEK-DONE` on a VEVENT             | `done`; without it a VEVENT edit keeps the current state |

- **New tasks** get a UUID (the request filename when it is a UUID, otherwise a generated one and a `Location`
  header), a position after the last task of the day (`App\Tasks\Position`, the server port of the client's
  `fractional-indexing`), and a fresh `tasks.version` from `VersionCounter`, the same counter `PushTasks` uses. The
  planner pulls the change on its next sync.
- **Preconditions.** `If-Match` must match the current `ETag`; `If-None-Match: *` creates only. Stale writes get
  `412`. A deleted resource can be recreated with the same href.
- **Status codes.** `201` created (with `Location` and `ETag`), `204` updated/deleted, `400` invalid iCalendar, `404`
  unknown resource or wrong collection, `409` unsupported component/recurrence/all-day event/timed VTODO, `412`
  precondition failed, `413` body over 256 KB.

### What is refused, on purpose

- `RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`: a client cannot create or rewrite a recurring series yet. Existing
  series are read as expanded occurrences and can be edited or deleted one occurrence at a time.
- A `VEVENT` with `DTSTART;VALUE=DATE`: an all-day item is a task, not an event. Create it in Reminders.
- A `VTODO` whose `DUE` has a time: a timed item is an event. Create it in Calendar.
- A series row (the id without `:date`): series rows are not exposed; only their occurrences are.

## Protocol surface

| Method               | Path                       | Purpose                                            |
| -------------------- | -------------------------- | -------------------------------------------------- |
| `GET`, `PROPFIND`    | `/.well-known/caldav`      | `301` to `/dav/`                                   |
| `PROPFIND`           | `/dav/`                    | `current-user-principal`                           |
| `PROPFIND`           | `/dav/principals/{id}/`    | `principal-URL`, `calendar-home-set`               |
| `PROPFIND` Depth 0/1 | `/dav/calendars/{id}/`     | the home and both collections                      |
| `PROPFIND` Depth 0/1 | `…/planner/`, `…/tasks/`   | calendar props; Depth 1 lists resources            |
| `REPORT`             | `…/planner/`, `…/tasks/`   | `calendar-query` (time range), `calendar-multiget` |
| `GET`                | `…/{collection}/{key}.ics` | one resource, with `ETag`                          |
| `PUT`, `DELETE`      | `…/{collection}/{key}.ics` | create/update/delete, with preconditions           |
| `OPTIONS`            | anywhere under `/dav/`     | `DAV: 1, 2, 3, calendar-access`                    |

Calendar properties: `resourcetype` (collection + calendar), `displayname`, `supported-calendar-component-set`
(`VEVENT` or `VTODO`), `supported-report-set`, `current-user-privilege-set` (read, write, write-content, bind,
unbind), `calendar-description` and `CS:getctag`. `getctag` is the highest `tasks.version` of the user plus a
projection version (`-v2`), so it changes on every accepted push or CalDAV write, and a projection change (like the
events/tasks split) forces one full sync.

**No `sync-token`.** `sync-collection` is optional in CalDAV. Clients fall back to a full `calendar-query` over their
window and reconcile by `ETag`/`href`. That is fine for a personal planner (hundreds of resources) and removes a
change-log table and a whole class of bugs. `getctag` still lets a client skip a sync when nothing changed.

## Design decisions

### Two collections, split by time

The planner has no separate event entity: a task with a time is an appointment, a task without one is a to-do. Mapping
that to one VEVENT collection put every to-do in Calendar and nothing in Reminders; mapping it to one VTODO collection
did the reverse. Two collections use the distinction the data already has, and each client shows the half it is good
at. A task that gains or loses its time moves between the collections; the old href `404`s and the new one appears, so
the client sees a delete + create. That is rare and honest.

### Expanded occurrences, not `RRULE`

A series could be one VEVENT with `RRULE` plus `RECURRENCE-ID` exceptions and `EXDATE`. It is prettier in the client
and much harder on the server: Plain Week's exceptions can move, split and duplicate, and the client would then own a
recurrence model that must round-trip. The Google integration already expands every occurrence into its own event, and
`TaskOccurrences` makes that free. Keep it.

The cost is a bounded window: the collection cannot contain an infinite series. The server expands only what a
`REPORT` asks for, clamped to **1 year back / 2 years ahead** and at most **5000 resources** per response.

### Writes reuse the sync contract

A CalDAV write is a normal planner write: a row, a position, a `tasks.version`. Reusing `VersionCounter` (extracted
from `PushTasks`) and `TaskOccurrences` means the phone sees a CalDAV edit on its next pull, and the offline-first rule
does not change. Occurrence edits create the same exception rows the app creates, so a moved event is one row and the
series is untouched. `If-Match` maps to the resource `ETag` (SHA-1 of the ICS), which is the only stable version a
CalDAV client understands.

### App passwords, HTTP Basic

CalDAV clients speak HTTP Basic; they cannot use the Fortify session or a passkey. The account password must not be
used: clients store it in plaintext and some sync it to their vendor.

- a `caldav_credentials` table: `user_id`, `name`, `password_hash` (SHA-256 of a 40-character random secret),
  `last_used_at`;
- the username is the account email (or id);
- the password is shown once, on creation, and can be revoked;
- the DAV endpoint is a global middleware (`HandleCalDav`), before routing: no session, no cookies, no CSRF;
- failed attempts are rate-limited per IP (10 per minute, then `429`);
- **HTTPS is mandatory** in the docs; Basic over plain HTTP is a plaintext password, and iOS will not even send it.

This also gives a clean future: a read-only vs read-write scope per credential.

### One container, no sidecar

The alternative is running Radicale or Baïkal next to Plain Week and syncing into it. That adds a service, a second
database, a second auth system and a consistency problem — exactly what the project avoids. The Laravel app already
owns the data and the time zone; the DAV front end belongs there.

### Why not `sabre/dav`

`sabre/dav` is the reference implementation and would get the protocol right. But it brings its own HTTP kernel and a
"stored ICS blob" model that does not match generated occurrences, and it is a large dependency for a minimal,
single-container app. The server implements the subset clients actually use (discovery, `PROPFIND`, `calendar-query`,
`calendar-multiget`, `GET`, `PUT`, `DELETE`). `sabre/vobject` is used only to parse a `PUT` body, where hand-rolled
parsing would be a liability; it is not a second server.

## What is built

Files:

- `app/Http/Middleware/HandleCalDav.php` — answers `/dav/*` and `/.well-known/caldav` before routing (PROPFIND,
  REPORT, PUT and DELETE are not router verbs);
- `app/Integrations/CalDav/CalDavAuth.php` — Basic auth against app passwords;
- `app/Integrations/CalDav/CalDavController.php` — discovery, `PROPFIND`, `REPORT`, `GET`, `PUT`, `DELETE`, `OPTIONS`;
- `app/Integrations/CalDav/Collection.php` — the two collections and their component/props;
- `app/Integrations/CalDav/CalendarObjects.php` — the planner → resources projection, including Someday;
- `app/Integrations/CalDav/CalendarObject.php`, `Ics.php` — the resource and the iCalendar serializer (VEVENT and
  VTODO);
- `app/Integrations/CalDav/CalendarWriter.php`, `CalendarData.php`, `CalDavWriteException.php`, `WriteResult.php` —
  the write path and its parser;
- `app/Tasks/Position.php` — the server port of the client's `fractional-indexing` append;
- `app/Actions/Sync/VersionCounter.php` — the shared `tasks.version` counter, now used by `PushTasks` and the writer;
- `app/Models/CalDavCredential.php` + migration;
- `app/Http/Controllers/Settings/CalDavCredentialController.php` — create and revoke app passwords;
- `app/Http/Controllers/Settings/IntegrationsController.php` — the Settings › Integrations page (Google + CalDAV);
- `resources/js/pages/settings/integrations.tsx` — the CalDAV card: server, username, credentials, one-time password;
- `app/Console/Commands/CalDavCredentialCommand.php` — `php artisan caldav:credential <email> <name>`, for scripts;
- `tests/Feature/Integrations/CalDavTest.php` and `tests/Feature/Settings/CalDavTest.php` — the endpoint and the card.

## Verification

Local account (Europe/Berlin, plain tasks, timed tasks, a done task, a weekly Mon/Wed/Fri series with one moved
occurrence), plus a Docker deployment and a real iPhone:

| Check                                  | Result                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `PROPFIND` discovery chain             | `207`, correct principal, home and both collections                            |
| `REPORT calendar-query` November       | timed items in `planner`, untimed + Someday in `tasks`                         |
| `GET` an event / a task                | `200`, `VEVENT` / `VTODO`, stable `ETag`                                       |
| `PUT` a VEVENT                         | `201`, timed task in the DB, `Location` and `ETag`                             |
| `PUT` a VTODO                          | `201`, untimed task with `DUE`, or Someday without                             |
| `PUT` with `If-Match`                  | `204`; a stale ETag gets `412`                                                 |
| `DELETE`                               | `204`, tombstone, `GET` `404`                                                  |
| `PUT`/`DELETE` an occurrence           | exception row / tombstone, series untouched                                    |
| `PUT` a `VTODO` completed              | `done`, `done_at`, `STATUS:COMPLETED` on the next `GET`                        |
| Apple Calendar over HTTPS              | account added, events show and edit                                            |
| Python `caldav` (phase 2)              | both collections listed; creates and deletes a `VEVENT` and a `VTODO`          |
| iOS Reminders                          | new `VTODO` collection; the Python client covers the protocol, test on a phone |
| `php artisan test --filter=CalDavTest` | 40 tests, 194 assertions                                                       |

## Limits and risks

| Risk                | Why it matters                                                                  | Mitigation                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Client quirks       | Apple's discovery is picky; a missing property can fail the whole account setup | Test matrix (Apple Calendar, Reminders, Thunderbird, DAVx5, GNOME); the endpoint passes `caldav` and `vdirsyncer` |
| iOS over HTTP       | iOS will not send Basic credentials during account setup                        | Require HTTPS in the docs; the error is "account verification failed"                                             |
| Infinite series     | A daily series over a huge range is unbounded                                   | Per-request expansion, 1y/2y clamp, 5000 cap                                                                      |
| No `sync-token`     | A full sync transfers every resource in the window                              | `getctag` skips unchanged syncs; add `sync-collection` in phase 3                                                 |
| Deletions           | Without `sync-token`, a client only notices a deletion on its next full sync    | Most clients do one periodically; `getctag` triggers it                                                           |
| Series split        | New series id → new `UID`s                                                      | Documented; clients show a brief delete + create                                                                  |
| Bad `PUT`           | A bad write can corrupt a day's order or resurrect a tombstone                  | `If-Match`, same row/position/version rules as the app, occurrence hrefs mapped to exception rows                 |
| Recurrence creation | A client cannot create a series yet                                             | `409` with a clear message; edit occurrences individually                                                         |
| All-day events      | An all-day VEVENT is a task, not an event                                       | `409`; create it in Reminders                                                                                     |
| Basic auth          | Plaintext password if TLS is missing                                            | Require HTTPS; app passwords are revocable and scoped; 10 failed attempts per IP and minute get `429`             |
| Performance         | Expanding a 2-year window per request                                           | 5000 cap; SQLite handles the queries; the window moves daily                                                      |
| SaaS mode           | A lapsed plan must not keep a live calendar feed                                | `EnsureCalDavAccess` answers `402` in `HandleCalDav`                                                              |

## Effort

| Phase | Scope                                                                                          | Estimate |
| ----- | ---------------------------------------------------------------------------------------------- | -------- |
| 1     | Read-only VEVENT, app passwords, Settings › Integrations card, feature flag, docs, Pest tests  | **Done** |
| 2     | Two collections (events + reminders), `PUT`/`DELETE`, `If-Match`, occurrences, `sabre/vobject` | **Done** |
| 3     | `sync-collection` + change log, creating/editing series over CalDAV, VTODO times               | 2–3 days |
