# Self-hosting

Plain Week is one container: a PHP web server (FrankenPHP) with the app and a SQLite database on a volume. No
database server, cache, queue or mail server is required.

The image is `ghcr.io/victor-falcon/plain-week`, built for `linux/amd64` and `linux/arm64` by GitHub Actions
([`.github/workflows/docker.yml`](../.github/workflows/docker.yml)):

| Tag            | What it is                                      |
| -------------- | ----------------------------------------------- |
| `latest`       | The latest release (from v0.0.3 on)             |
| `X.Y.Z`, `X.Y` | A release (`0.0.3`) or its latest patch (`0.0`) |
| `edge`         | The latest commit on `main`                     |
| `sha-<short>`  | A specific commit on `main`                     |

## One-click deployment

### Coolify

Plain Week ships a Coolify service template: [`deploy/coolify/plain-week.yaml`](../deploy/coolify/plain-week.yaml).

1. In your project, **+ New** > **Docker Compose Empty**.
2. Paste the contents of `deploy/coolify/plain-week.yaml` and save.
3. Set the domain of the `plainweek` service (for example `https://plan.example.com`), then **Deploy**.

Coolify generates `APP_KEY` (`SERVICE_REALBASE64_32_APPKEY`, 32 random bytes in base64) and `APP_URL`
(`SERVICE_URL_PLAINWEEK`) on the first deploy and keeps them, creates the `plainweek-storage` volume and routes the
domain to port 8080 through its proxy, which terminates TLS. Set `APP_NOINDEX=true` in the service's **Environment
Variables** to keep search engines out; to send email, set `MAIL_MAILER=smtp` and fill in the `MAIL_*` variables the
template lists (see [Email](#email)). The optional Google Calendar sync, CalDAV and push notifications are off until you
set their variables, which the template already lists with their defaults: `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` (see [Google Calendar](#google-calendar)), `CALDAV_ENABLED` (see [CalDAV](#caldav)), and
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (see
[Notifications](#notifications)). Redeploy after changing them.

## Deploy with Docker

### Requirements

- Docker (or any OCI runtime) on a host with about 256 MB of free memory.
- For anything beyond `localhost`: a domain and a reverse proxy that terminates HTTPS (Caddy, Traefik, nginx). The
  offline mode relies on a service worker, and browsers only allow those over HTTPS or on `localhost`.

### Configuration

The only required setting is `APP_KEY`. Generate it once and keep it: it encrypts sessions and cookies, so changing it
signs everyone out.

```sh
echo "base64:$(openssl rand -base64 32)"
```

| Variable                | Default                                 | Description                                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_KEY`               | (required)                              | `base64:` plus 32 random bytes in base64. The container refuses to start without a valid key                                                                                                                                                                                |
| `APP_URL`               | `http://localhost`                      | The public URL, for example `https://plan.example.com`. Used in emails, generated links and link previews (og:image)                                                                                                                                                        |
| `APP_NAME`              | `Plain Week`                            | Shown in the page title and emails                                                                                                                                                                                                                                          |
| `APP_NOINDEX`           | `false`                                 | `true` asks search engines not to index the instance (see [Noindex](#noindex))                                                                                                                                                                                              |
| `DB_DATABASE`           | `/app/storage/database/database.sqlite` | The SQLite file. Keep it under `/app/storage` so it lives on the volume                                                                                                                                                                                                     |
| `TRUSTED_PROXIES`       | private ranges                          | Proxies whose `X-Forwarded-*` headers are trusted: comma-separated IPs/CIDRs, or `*` (any caller). The default trusts loopback and private networks (`127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1,fc00::/7`), which covers Coolify and a proxy on the same host |
| `SESSION_SECURE_COOKIE` | on when `APP_URL` is `https://`         | Only send the session cookie over HTTPS. Set `false` if `APP_URL` says `https://` but users reach the app over plain HTTP                                                                                                                                                   |
| `MAIL_MAILER`           | `log`                                   | `log` writes emails (verification, password reset) to the logs instead of sending them. `smtp` sends them through the server below                                                                                                                                          |
| `MAIL_SCHEME`           | (empty)                                 | `smtps` for implicit TLS (port 465); empty for `smtp` with STARTTLS (port 587)                                                                                                                                                                                              |
| `MAIL_HOST`             | (empty)                                 | SMTP server, for example `smtp.resend.com`                                                                                                                                                                                                                                  |
| `MAIL_PORT`             | `587`                                   | SMTP port: `587` (STARTTLS) or `465` (with `MAIL_SCHEME=smtps`)                                                                                                                                                                                                             |
| `MAIL_USERNAME`         | (empty)                                 | SMTP user                                                                                                                                                                                                                                                                   |
| `MAIL_PASSWORD`         | (empty)                                 | SMTP password or API key. Keep it secret                                                                                                                                                                                                                                    |
| `MAIL_FROM_ADDRESS`     | `hello@example.com`                     | Sender address of every email; use one your SMTP provider has verified                                                                                                                                                                                                      |
| `MAIL_FROM_NAME`        | `Plain Week`                            | Sender name                                                                                                                                                                                                                                                                 |
| `LOG_CHANNEL`           | `stderr`                                | Logs go to the container output (`docker logs`)                                                                                                                                                                                                                             |
| `LOG_LEVEL`             | `debug`                                 | `warning` keeps the logs quiet                                                                                                                                                                                                                                              |
| `SAAS_ENABLED`          | `false`                                 | Leave it `false`. `true` turns the instance into the paid hosted service (accounts need a Stripe plan to sync); see [saas.md](./saas.md) for it and its `STRIPE_*` and `SAAS_*` variables                                                                                   |
| `GOOGLE_CLIENT_ID`      | (empty)                                 | OAuth client id for the optional Google Calendar sync; see [Google Calendar](#google-calendar). Empty hides the integration                                                                                                                                                 |
| `GOOGLE_CLIENT_SECRET`  | (empty)                                 | OAuth client secret that goes with `GOOGLE_CLIENT_ID`                                                                                                                                                                                                                       |
| `CALDAV_ENABLED`        | `false`                                 | Turns on the optional read-only CalDAV feed for calendar clients; see [CalDAV](#caldav). Each user creates app passwords on Settings › Integrations                                                                                                                         |
| `VAPID_PUBLIC_KEY`      | (empty)                                 | VAPID public key (base64url) for the optional push notifications; see [Notifications](#notifications). Empty turns them off                                                                                                                                                 |
| `VAPID_PRIVATE_KEY`     | (empty)                                 | VAPID private key that goes with `VAPID_PUBLIC_KEY`. Keep it secret                                                                                                                                                                                                         |
| `VAPID_SUBJECT`         | (empty)                                 | Contact for the push services, `mailto:you@example.com` or an `https://` URL                                                                                                                                                                                                |

With `SAAS_ENABLED=false` (the default) accounts are free and sync without limits, there is no billing anywhere and the
billing, terms and privacy routes are `404`; no Stripe variable is needed. Any other Laravel setting (`config/*.php`)
can be set the same way. Email verification never blocks the app, so an
instance without mail works.

On start, the container creates the storage layout and the SQLite file if they are missing, runs the migrations and
caches the configuration, routes and views. Then FrankenPHP serves the app on port 8080 as the unprivileged user
`plainweek` (uid 1000). `/up` is the health check (the image's `HEALTHCHECK` uses it).

Background work runs in the same container, with nothing to configure: next to the server the entrypoint starts the
Laravel scheduler (`php artisan schedule:work`) and one queue worker (`php artisan queue:work`; the queue is a table in
the SQLite database). Each is restarted if it exits; the worker also restarts every hour to release memory. Their output
goes to the container logs. `tini` runs as PID 1, so their child processes are reaped and `docker stop` ends all three
together (a job cut short by a stop is retried later). The whole container uses about 125 MB of memory at rest.

### Plain Docker

```sh
docker volume create plainweek-storage
docker run -d --name plainweek --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v plainweek-storage:/app/storage \
  -e APP_KEY="base64:..." \
  -e APP_URL="http://localhost:8080" \
  ghcr.io/victor-falcon/plain-week:latest
```

Open http://localhost:8080. To use a host directory instead of a named volume, make it writable by uid 1000 first
(`chown -R 1000:1000 ./storage`).

### Email

Out of the box emails only go to the logs (`MAIL_MAILER=log`), so verification and password reset links never reach
anyone. Any SMTP provider works. With [Resend](https://resend.com), for example:

```sh
MAIL_MAILER=smtp
MAIL_SCHEME=smtps
MAIL_HOST=smtp.resend.com
MAIL_PORT=465
MAIL_USERNAME=resend
MAIL_PASSWORD=re_your_api_key
MAIL_FROM_ADDRESS=plan@example.com   # on a domain verified in Resend
MAIL_FROM_NAME="Plain Week"
```

Both the Coolify template and `deploy/docker-compose.yml` pass these variables to the container: set them in Coolify's
**Environment Variables** or in the `.env` next to the compose file, then redeploy.

### Docker Compose: local

[`deploy/docker-compose.yml`](../deploy/docker-compose.yml) runs Plain Week on `http://localhost:8080`:

```sh
mkdir plain-week && cd plain-week
curl -fsSLO https://raw.githubusercontent.com/victor-falcon/plain-week/main/deploy/docker-compose.yml
echo "APP_KEY=base64:$(openssl rand -base64 32)" > .env
docker compose up -d
```

### Docker Compose: public server behind a reverse proxy

Use the same file and point `APP_URL` at your domain, then send the domain to `127.0.0.1:8080` from your reverse proxy:

```sh
cat >> .env <<'ENV'
APP_URL=https://plan.example.com
ENV
docker compose up -d
```

With Caddy, for example:

```caddyfile
plan.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

The proxy must pass `X-Forwarded-Proto` and `X-Forwarded-Host` (Caddy and Traefik do by default; with nginx add
`proxy_set_header X-Forwarded-Proto $scheme;` and `proxy_set_header X-Forwarded-Host $host;`). The image trusts them
from loopback and private networks (`TRUSTED_PROXIES`); keep port 8080 reachable only through the proxy (the compose
file binds it to `127.0.0.1`), or set `TRUSTED_PROXIES` to the proxy's address. With an `https://` `APP_URL` the
session cookie is marked secure.

Serve Plain Week from the root of its domain (not a sub-path): the service worker and the offline shell assume `/`.

## Google Calendar

Optional. Signed-in users can show their dated tasks in a "Plain Week" calendar in their Google account (one way:
Plain Week → Google). The integration is hidden, and its routes are `404`, until both `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are set. Everything else works without it.

To get the credentials, in the [Google Cloud console](https://console.cloud.google.com/):

1. Create (or pick) a project and enable the **Google Calendar API** (APIs & Services › Library).
2. Configure the **OAuth consent screen** (Google Auth Platform › Branding / Audience): app name, support email, and
   your domain under authorized domains. Add the scope `https://www.googleapis.com/auth/calendar.app.created`
   (Data Access). While the app is in **Testing**, only the test users you list can connect, and Google expires
   their access after 7 days; publish it to lift both limits (Google may ask to verify the app first).
3. Create an **OAuth client ID** (Clients › Create client) of type **Web application**, with the authorized redirect
   URI `APP_URL/settings/integrations/google/callback`, for example
   `https://plan.example.com/settings/integrations/google/callback`. `APP_URL` must match the address users reach.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the client and redeploy.

Users then connect from **Settings › Integrations**. Plain Week asks only for the `calendar.app.created` scope (plus
the account email), so it can see and change the calendars it creates and nothing else. Tokens are stored encrypted
with `APP_KEY`; disconnecting deletes the "Plain Week" calendar and revokes the access.

The events are written in the background by the queue worker (a few seconds after a change syncs) and once a day by
the scheduler (`google-calendar:sync`, at 03:00 in `APP_TIMEZONE`), which the Docker image already runs. Without Docker,
run both as described in [Without Docker](#without-docker): without a worker nothing reaches Google.

`php artisan google-calendar:sync [--user=<id>]` queues a full sync by hand.

If connecting fails ("Google did not connect"), the container logs (`docker logs`) have Google's answer. The usual
causes are a redirect URI that does not match `APP_URL` exactly, the Calendar API not enabled in the project, or a
Google account that is not a test user while the consent screen is in Testing.

## CalDAV

Optional. Signed-in users can add their week to Apple Calendar, Thunderbird, DAVx5 or any CalDAV client. It is
read-only: the calendar shows what the planner shows, and edits belong in Plain Week.

Set `CALDAV_ENABLED=true` and redeploy. Each user then opens **Settings › Integrations**, creates an app password and
adds the server (`APP_URL/dav/`) to the client with their account email and that password. Passwords are shown once,
stored hashed and can be revoked there; they are never the account password.

The endpoint speaks HTTP Basic, so **serve Plain Week over HTTPS**: a Basic password over plain HTTP is a plaintext
password. The routes are `404` while `CALDAV_ENABLED` is off, and in SaaS mode an account without a paid plan gets
`402` instead of the feed. The full design and its limits are in [caldav.md](./caldav.md).

## Notifications

Optional. Signed-in users can get push notifications in their browsers: every morning one listing the pending tasks of
the day without a time (at a time they choose in **Settings › Notifications**, 08:00 by default, in their own time
zone), and a reminder five minutes before every timed task. Clicking one opens its task, or the planner when it lists
several. Notifications are off, their settings page hidden and
their routes `404`, until `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are all set. Everything else
works without them, and no other service is needed: the container's scheduler sends them.

Generate the key pair once and keep it; a new pair invalidates every browser's subscription, so users would have to
turn notifications on again:

```sh
# In the running container (`docker ps` shows its name):
docker exec <container> php artisan tinker --execute 'dump(Minishlink\WebPush\VAPID::createVapidKeys())'
# Or anywhere with Node:
npx web-push generate-vapid-keys
```

Set the two keys and `VAPID_SUBJECT=mailto:<your email>`, and redeploy. Browsers only allow push on `https://`
(or `localhost`). Delivery failures are logged as warnings in the container output; a browser that unsubscribed is
forgotten the next time a notification is sent to it.

## Noindex

With `APP_NOINDEX=true`, every response carries `X-Robots-Tag: noindex, nofollow`, the page has
`<meta name="robots" content="noindex, nofollow">` and `/robots.txt` disallows all crawlers. With the default
(`false`), `/robots.txt` allows everything.

## Backups

Everything the server stores (accounts and synced tasks) is in the SQLite file on the volume. Guest data only lives in
each browser. Back up while the app runs with SQLite's online backup:

```sh
docker exec plainweek php -r '(new SQLite3("/app/storage/database/database.sqlite"))->backup($b = new SQLite3("/app/storage/backup.sqlite")); $b->close();'
docker cp plainweek:/app/storage/backup.sqlite ./plain-week-$(date +%F).sqlite
docker exec plainweek rm /app/storage/backup.sqlite
```

Or stop the container and copy the whole volume:

```sh
docker stop plainweek
docker run --rm -v plainweek-storage:/data -v "$PWD":/backup alpine tar czf /backup/plain-week.tgz -C /data .
docker start plainweek
```

To restore, put the file back at `/app/storage/database/database.sqlite` (owned by uid 1000) and restart. On Coolify,
use the service's **Persistent Storage** tab or the same commands on the server.

## Updating

```sh
docker compose pull && docker compose up -d   # or docker pull + recreate the container
```

Migrations run automatically on start. Pin a version tag (`0.0.3`) instead of `latest` if you prefer to update
deliberately, and back up first.

On Coolify, a plain restart keeps the image it already has. To get the new `latest`, use **Redeploy**, or the restart
option that pulls the latest images. Through the API, the restart has to ask for the pull:

```sh
curl -fsS -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/services/$COOLIFY_SERVICE_UUID/restart?latest=true"
```

Without `?latest=true` (or with `/api/v1/deploy?uuid=…`) the service starts again on the cached image (checked on
Coolify 4.6.0). Either way the container restarts, so the app is down for a few seconds; installed clients keep working
offline and sync once it is back.

### Deploying from CI

The `docker` workflow can do that restart itself once a `v*` tag has been published. Add three repository secrets
(**Settings** > **Secrets and variables** > **Actions**):

| Secret                 | Value                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `COOLIFY_URL`          | Your Coolify instance, e.g. `https://coolify.example.com` (a trailing slash is fine)        |
| `COOLIFY_TOKEN`        | An API token from Coolify > **Keys & Tokens** > **API tokens** with the `deploy` permission |
| `COOLIFY_SERVICE_UUID` | The service's UUID: the last part of its URL in Coolify (`…/service/<uuid>`)                |

The step runs only for release tags (`vX.Y.Z`; not pre-releases, and `edge` builds never deploy), fails the workflow
when Coolify answers with an error, and is skipped with a notice when any of the secrets is missing. A green step means
Coolify queued the restart: check the service in Coolify if the new version doesn't show up.

## Without Docker

Plain Week is a regular Laravel app: see [stack.md](./stack.md#self-hosting-without-docker).

## Maintaining the image

- [`Dockerfile`](../Dockerfile): a build stage (FrankenPHP's PHP plus Composer and bun) installs the PHP
  dependencies without dev packages and runs `bun run build` (the Wayfinder Vite plugin needs PHP); the runtime stage
  is `dunglas/frankenphp` with the PHP version CI uses, the `intl`, `bcmath` and `pcntl` extensions, `tini` as PID 1
  and the built app.
- [`docker/`](../docker): the Caddyfile (port 8080, no TLS, cache headers for `sw.js` and hashed assets, `X-Robots-Tag`
  on static files when `APP_NOINDEX` is on), the PHP ini and the entrypoint (storage layout, migrations, then the
  server with the scheduler and the queue worker beside it).
- Build and run it locally:

    ```sh
    docker build -t plain-week .
    docker run --rm -p 127.0.0.1:8080:8080 -e APP_KEY="base64:$(openssl rand -base64 32)" plain-week
    ```

- Releases are published by CI only: pushing a `vX.Y.Z` tag publishes `X.Y.Z`, `X.Y` and `latest`; every push to
  `main` publishes `edge`. Pull requests build both architectures without pushing.
- The GHCR package must be **public** so Coolify and `docker pull` work without credentials. GitHub creates a new
  container package as private: once, after the first publish, open the package
  (github.com/users/victor-falcon/packages/container/plain-week) > **Package settings** > **Change visibility** >
  **Public**. The image's `org.opencontainers.image.source` label links the package to this repository.
- The Coolify template's `# logo:` points at `svgs/plain-week.svg`, the path Coolify uses for its bundled templates;
  submitting the template upstream means adding [`public/favicon.svg`](../public/favicon.svg) there under that name.
