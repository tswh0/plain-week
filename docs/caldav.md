# CalDAV

Status: **phase 1**, read-only. The branch `caldav-spike` has the server, the Settings › Integrations card and the app
passwords. Write support is phase 2.

## Using it

Set `CALDAV_ENABLED=true` and redeploy. Then open **Settings › Integrations**, create an app password and add
`APP_URL/dav/` to the client with the account email and that password. It is read-only: edit tasks in Plain Week.

## Verdict

CalDAV is a good fit and does not need a new service, a new database or a change to the offline-first rule. Plain Week
already has the two hard parts:

- a server-side expansion of the planner into dated items (`App\Tasks\TaskOccurrences`, `App\Tasks\Occurrence`), with
  exceptions, moved occurrences, duplicate-exception settling and series windows;
- a one-way calendar projection (`App\Integrations\GoogleCalendar\CalendarEvent`) that already answers "what does this
  task look like as a calendar event?" — all-day or 20 minutes from its time, a stable key per item, notes and a deep
  link.

A read-only CalDAV collection is that projection with an iCalendar serializer and a WebDAV front end. The spike is
about 1,100 lines (962 of them the DAV layer) and works with two real clients.

## What "CalDAV" means here

CalDAV is WebDAV plus iCalendar. A client (Apple Calendar, Thunderbird, DAVx5, GNOME Calendar, …) discovers a calendar
home, lists collections, and reads resources with `PROPFIND`, `REPORT` and `GET`. Writes are `PUT`/`DELETE`.

Two different features hide under the same word:

| Feature                           | Direction                      | What it gives                                                |
| --------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| **CalDAV server** (this document) | Plain Week → clients           | Your planner shows up in a calendar app on every device.     |
| CalDAV client                     | external calendar → Plain Week | Events from Fastmail/Nextcloud/Google appear in the planner. |

The request was "this calendar can sync with third party clients", so this is the server. A client integration is a
separate feature and would fight the offline-first rule unless it syncs through the same outbox.

## Mapping planner → iCalendar

One collection per user, `Plain Week`, containing one `VEVENT` per planner item:

| Planner                                       | VEVENT                                                           |
| --------------------------------------------- | ---------------------------------------------------------------- |
| plain task / exception / generated occurrence | one resource each, no `RRULE`                                    |
| `text`                                        | `SUMMARY`, `✅ ` prefix when done (VEVENT has no `COMPLETED`)    |
| `notes`                                       | `DESCRIPTION`, plus `Open in Plain Week: APP_URL/?task=<id>`     |
| `date`, no `time`                             | all-day: `DTSTART;VALUE=DATE`, `DTEND` the next day              |
| `date` + `time`                               | 20-minute event, `DTSTART`/`DTEND` in UTC                        |
| `color`                                       | `COLOR` (RFC 7986), when not `none`                              |
| `updated_at`                                  | `DTSTAMP` and `LAST-MODIFIED`                                    |
| —                                             | `UID` = the stable key, `TRANSP:TRANSPARENT`, `STATUS:CONFIRMED` |

The **key** is the same one the Google Calendar integration uses (`CalendarEvent::keyFor`): the task id for a plain
task or exception row, `seriesId:YYYY-MM-DD` for an occurrence. It survives the changes that matter:

- an occurrence edited for one date turns into an exception row with a new id, but keeps its key, so the client updates
  instead of delete + create;
- moving an occurrence keeps its key and changes `DTSTART`;
- deleting an occurrence is a tombstone row, so the resource disappears.

Two exceptions to the stable key, both acceptable and worth documenting for users:

- "this and all future" splits a series: the new series has a new id, so every occurrence from the split date gets a
  new `UID` and the client sees a delete + create for each;
- changing a series rule changes the set of occurrences the same way.

## Protocol surface

| Method               | Path                           | Purpose                                               |
| -------------------- | ------------------------------ | ----------------------------------------------------- |
| `GET`, `PROPFIND`    | `/.well-known/caldav`          | `301` to `/dav/`                                      |
| `PROPFIND`           | `/dav/`                        | `current-user-principal`                              |
| `PROPFIND`           | `/dav/principals/{id}/`        | `principal-URL`, `calendar-home-set`                  |
| `PROPFIND` Depth 0/1 | `/dav/calendars/{id}/`         | the calendar home and its collections                 |
| `PROPFIND` Depth 0/1 | `/dav/calendars/{id}/planner/` | calendar props; Depth 1 lists resources               |
| `REPORT`             | `…/planner/`                   | `calendar-query` (time range) and `calendar-multiget` |
| `GET`                | `…/planner/{key}.ics`          | one resource, with `ETag`                             |
| `OPTIONS`            | anywhere under `/dav/`         | `DAV: 1, 2, 3, calendar-access`                       |

Calendar properties: `resourcetype` (collection + calendar), `displayname`, `supported-calendar-component-set`
(`VEVENT`), `supported-report-set`, `current-user-privilege-set` (read), `calendar-description` and
`CS:getctag`. `getctag` is the highest `tasks.version` of the user, so it changes on every accepted push and clients can
poll it cheaply.

**No `sync-token` in v1.** `sync-collection` is optional in CalDAV. Clients fall back to a full `calendar-query` over
their window and reconcile by `ETag`/`href`. That is fine for a personal planner (hundreds of resources) and removes a
change-log table and a whole class of bugs. `getctag` still lets a client skip a sync when nothing changed.

## Design decisions

### VEVENT, not VTODO

Plain Week items are tasks, so `VTODO` is semantically closer: `DUE`, `STATUS:COMPLETED`, `PERCENT-COMPLETE`, and real
checkboxes in Apple Reminders, Tasks.org and Thunderbird. But:

- `VTODO` is not shown by Apple Calendar (Reminders shows them); a "calendar" that does not appear in the calendar
  app is a hard sell;
- the existing Google integration already chose the VEVENT projection, so VEVENT keeps one mental model and one set of
  rules;
- a VEVENT collection works in every client.

Recommendation: **VEVENT first**, and optionally a second collection `Plain Week Tasks` with `VTODO` later (the same
generator with a different serializer, maybe 100 lines). Users pick the collection their client supports.

### Expanded occurrences, not `RRULE`

A series could be one VEVENT with `RRULE` plus `RECURRENCE-ID` exceptions and `EXDATE`. It is prettier in the client
and much harder on the server: Plain Week's exceptions can move, split and duplicate, and the client would then own a
recurrence model that must round-trip. The Google integration already expands every occurrence into its own event, and
`TaskOccurrences` makes that free. Keep it.

The cost is a bounded window: the collection cannot contain an infinite series. The server expands only what a
`REPORT` asks for, clamped to **1 year back / 2 years ahead** and at most **5000 resources** per response. A client
asking 1970–2100 gets the window, which is what it needs anyway.

### Read-only first

Reading is the 80% case: see the week on a phone, in a calendar widget, next to meetings. Writing from a calendar client
is where the sharp edges are:

- a `PUT` must create a task with a server-generated UUID, a `position` at the end of its day, and a `version` that the
  sync engine will pull — all doable, but it is a new write path into the sync contract;
- `DELETE` must tombstone, not hard-delete;
- a `PUT` to an occurrence key must be refused (`409`), because an occurrence has no row; editing one occurrence would
  need to create an exception with the right `(series_id, occurrence_date)`;
- `If-Match`/`If-None-Match` must map to `updated_at`, or two clients overwrite each other.

Phase 2 is plain tasks only: `PUT`/`DELETE` with `If-Match`, new tasks appended to their day, occurrence hrefs refused
with a clear error. Recurring series stay read-only until the exception mapping is designed.

### App passwords, HTTP Basic

CalDAV clients speak HTTP Basic; they cannot use the Fortify session or a passkey. The account password must not be
used: clients store it in plaintext and some sync it to their vendor.

- a `caldav_credentials` table: `user_id`, `name`, `password_hash` (SHA-256 of a 40-character random secret),
  `last_used_at`;
- the username is the account email (or id);
- the password is shown once, on creation, and can be revoked;
- the DAV endpoint is a global middleware (`HandleCalDav`), before routing: no session, no cookies, no CSRF;
- failed attempts are rate-limited per IP (10 per minute, then `429`);
- **HTTPS is mandatory** in the docs; Basic over plain HTTP is a plaintext password.

This also gives a clean future: a read-only vs read-write scope per credential.

### One container, no sidecar

The alternative is running Radicale or Baïkal next to Plain Week and syncing into it. That adds a service, a second
database, a second auth system and a consistency problem — exactly what the project avoids. The Laravel app already
owns the data and the time zone; the DAV front end belongs there.

### Why not `sabre/dav`

`sabre/dav` is the reference implementation and would get the protocol right. But it brings its own HTTP kernel and a
"stored ICS blob" model that does not match generated occurrences, and it is a large dependency for a minimal,
single-container app. The spike implements the subset clients actually use (discovery, `PROPFIND`, `calendar-query`,
`calendar-multiget`, `GET`) in about 960 lines with no new Composer dependency. If write support grows, `sabre/vobject`
for ICS parsing is a small, focused addition (not the whole server).

## What is built

Branch `caldav-spike` (fork `tswh0/plain-week`), files:

- `app/Http/Middleware/HandleCalDav.php` — answers `/dav/*` and `/.well-known/caldav` before routing (PROPFIND and
  REPORT are not router verbs);
- `app/Integrations/CalDav/CalDavAuth.php` — Basic auth against app passwords;
- `app/Integrations/CalDav/CalDavController.php` — discovery, `PROPFIND`, `REPORT`, `GET`, `OPTIONS`;
- `app/Integrations/CalDav/CalendarObjects.php` — the planner → resource projection;
- `app/Integrations/CalDav/CalendarObject.php`, `Ics.php` — the resource and the iCalendar serializer;
- `app/Models/CalDavCredential.php` + migration;
- `app/Http/Controllers/Settings/CalDavCredentialController.php` — create and revoke app passwords;
- `app/Http/Controllers/Settings/IntegrationsController.php` — the Settings › Integrations page (Google + CalDAV);
- `resources/js/pages/settings/integrations.tsx` — the CalDAV card: server, username, credentials, one-time password;
- `app/Console/Commands/CalDavCredentialCommand.php` — `php artisan caldav:credential <email> <name>`, for scripts;
- `tests/Feature/Integrations/CalDavTest.php` and `tests/Feature/Settings/CalDavTest.php` — the endpoint and the card.

Verified locally with a seeded account (Europe/Berlin, plain tasks, a timed task, a done task, a weekly Mon/Wed/Fri
series with one moved occurrence):

| Check                                       | Result                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `PROPFIND /dav/`, principal, home, calendar | `207`, correct `current-user-principal` and `calendar-home-set`                      |
| `REPORT calendar-query` November            | 17 resources, correct UTC times (`09:00` Berlin → `08:00Z`)                          |
| `REPORT calendar-multiget`                  | one response per existing href                                                       |
| `GET …/{key}.ics`                           | `200`, stable `ETag`, RFC 5545 folding and escaping                                  |
| `ETag` across two GETs                      | identical; changes after an edit                                                     |
| `getctag`                                   | follows `tasks.version`                                                              |
| tombstoned task                             | `GET` `404`, gone from `REPORT`                                                      |
| Python `caldav` client                      | principal, home, calendar list, `search()` and single fetch                          |
| `vdirsyncer`                                | discovered the collection and synced **320 resources** into a local filesystem store |
| `php artisan test --filter=CalDavTest`      | the endpoint and the Settings card, all passing                                      |
| `/.well-known/caldav`                       | `301`, followed by both clients                                                      |

Not yet: `PUT`/`DELETE`, `sync-collection`, `VTODO`.

## Limits and risks

| Risk             | Why it matters                                                                  | Mitigation                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Client quirks    | Apple's discovery is picky; a missing property can fail the whole account setup | Test matrix (Apple Calendar, Thunderbird, DAVx5, GNOME); the spike already passes `caldav` and `vdirsyncer`       |
| Infinite series  | A daily series over a huge range is unbounded                                   | Per-request expansion, 1y/2y clamp, 5000 cap                                                                      |
| No `sync-token`  | A full sync transfers every resource in the window                              | `getctag` skips unchanged syncs; add `sync-collection` in phase 3                                                 |
| Deletions        | Without `sync-token`, a client only notices a deletion on its next full sync    | Most clients do one periodically; `getctag` triggers it                                                           |
| Series split     | New series id → new `UID`s                                                      | Documented; clients show a brief delete + create                                                                  |
| Writes (phase 2) | A bad `PUT` can corrupt a day's order or resurrect a tombstone                  | Plain tasks only, `If-Match`, validate with the same rules as `PushRequest`, refuse occurrence hrefs              |
| Basic auth       | Plaintext password if TLS is missing                                            | Require HTTPS in the docs; app passwords are revocable and scoped; 10 failed attempts per IP and minute get `429` |
| Performance      | Expanding a 2-year window per request                                           | 5000 cap; SQLite handles the queries; the window moves daily                                                      |
| SaaS mode        | A lapsed plan must not keep a live calendar feed                                | `EnsureCalDavAccess` answers `402` in `HandleCalDav`                                                              |

## Effort

| Phase | Scope                                                                                         | Estimate |
| ----- | --------------------------------------------------------------------------------------------- | -------- |
| 1     | Read-only VEVENT, app passwords, Settings › Integrations card, feature flag, docs, Pest tests | **Done** |
| 2     | `PUT`/`DELETE` for plain tasks, `If-Match`, `sabre/vobject`, validation                       | 2–3 days |
| 3     | `sync-collection` + change log, `VTODO` collection                                            | 2–3 days |

Phase 1 is enough to use it daily: the planner stays the source of truth, the phone shows the week.

## Open questions

1. **Which clients?** Apple Calendar (iOS/macOS), Thunderbird, DAVx5/Tasks.org, GNOME? The test matrix and the
   VEVENT/VTODO choice depend on it.
2. **Is read-only enough?** If editing from the phone must write back, phase 2 moves into the first release.
3. **VEVENT or VTODO?** Or both collections?
4. **Upstream or personal fork?** The fork is MIT (`tswh0/plain-week`). A PR to `victor-falcon/plain-week` would need
   Pest tests, PHPStan, Pint, docs and a CHANGELOG entry, and should be gated behind an env flag like the Google
   integration.
