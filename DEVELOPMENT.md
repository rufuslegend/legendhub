# Local development

LegendHUB runs as four core Docker Compose services and one opt-in test service:

- `mysql`: MySQL 5.7 database
- `www`: Node/Express website and GraphQL API
- `python`: notification and authentication-token maintenance jobs
- `mysql-backup`: daily private and sanitized public database backups
- `content-sync`: profile-gated production-content synchronization for
  Dunwichmass only

## First-time setup

Prerequisites:

- Docker Desktop
- Git

From the repository root:

```sh
cp .env_example .env
./scripts/prepare-dev-database.sh
docker compose up --build -d
```

In `.env`, `MYSQL_USER` must remain `legendhub`. Replace the example database
passwords with local-only values. Git ignores `.env` and the generated
development seed.

Open `http://localhost:7000`. If that port is occupied, change
`EXTERNAL_PORT` in `.env` before starting the stack.

The first startup is slower because MySQL imports the development seed. Docker
waits for the database health check before starting the other services. The web
service then applies the numbered migrations automatically.

## Feedback configuration

Anonymous feedback is submitted as a public Issue in
`rufuslegend/legendhub`. `GITHUB_TOKEN` must be a fine-grained token with
Issues write permission for that repository only. Set `GITHUB_REPOSITORY` to
the readable repository slug `rufuslegend/legendhub`; it is not a GraphQL node
ID. Feedback titles and descriptions are public once submitted.

## Everyday commands

```sh
# Start
docker compose up -d

# View service status
docker compose ps

# Follow application logs
docker compose logs -f www

# Stop without deleting the database
docker compose down

# Rebuild after Dockerfile or dependency changes
docker compose up --build -d
```

To intentionally recreate the local database from the seed:

```sh
docker compose down --volumes
docker compose up -d
```

The `--volumes` command permanently removes the local database and generated
backup volumes. Do not use it against an environment containing data you need.

## Smoke checks

The website has a small Node test suite that does not require a running
database:

```sh
cd www
npm ci
npm test
```

The browser accessibility checks run separately from the fast Node suite. After
installing the Chromium test browser once, scan the home, login, registration
error, and feedback states in High Contrast mode with:

```sh
npx playwright install chromium
npm run test:a11y
```

The accessibility tests start the Express application on an ephemeral local
port with database metadata stubbed and external resources blocked. They check
WCAG A and AA rules that axe can detect automatically; passing them does not
replace keyboard, screen-reader, or other manual accessibility testing.

Validate the registry publishing and Compose tooling from the repository root:

```sh
node --test scripts/test/*.test.js
```

Run the focused production-content synchronization tests from the repository
root with:

```sh
python3 -m unittest discover -s mysql/test -p 'test_content_sync*.py' -v
node --test scripts/test/content-sync-*.test.js \
  scripts/test/deploy-test.test.js scripts/test/mysql-backup-cron.test.js
```

The `content-sync` service is not part of ordinary local startup. Its SSH,
staging, profile, manual-run, health, revocation, and recovery procedures are
documented in the
[production-to-test content sync operations guide](docs/operations/production-to-test-content-sync.md).
The runtime transfer is directly from LegendMUD production to the Dunwichmass
container and then Dunwichmass MySQL; a local Mac is only an operator and
verification endpoint.

Run only the fast characterization checks or HTTP smoke test with:

```sh
npm run test:characterization
npm run test:smoke
```

The smoke test starts the Express application on an ephemeral local port and
checks the home page, a static asset, the GraphQL API and explorer, and the 404
page. Database metadata is stubbed; database-backed routes still need manual
integration testing.

GitHub is used only for source control; there is no CI workflow. Before
pushing, run the website tests above and the stylesheet checks locally:

```sh
cd ../css
npm ci
npm test
```

With the Docker stack running, manually check:

- `/`
- `/items/`
- `/mobs/`
- `/quests/`
- `/wiki/`
- `/builder/`
- `/login.html`

The GraphQL endpoint is `/api`.

Run each scheduled Python job manually with:

```sh
docker compose exec python python3 /python/notification_listener.py
docker compose exec python python3 /python/routine_maintenance.py
```

Generate a database backup immediately with:

```sh
docker compose exec mysql-backup /usr/local/bin/backup-mysql
```

The command must print one `backup-mysql: success` line. Verify both artifacts
without displaying their contents:

```sh
docker compose exec mysql-backup bash -c '
  private_backup="/backups/private/database_$(date +%m-%d-%Y).sql.gz"
  test -s "$private_backup"
  stat -c "%n %s bytes" "$private_backup"
  test -s /backups/public/database.sql
  stat -c "%n %s bytes" /backups/public/database.sql
'
docker compose logs --tail=100 mysql-backup
```

Scheduled backups run daily at 06:11 UTC. Treat a missing success line, an
empty artifact, or a nonzero command as a failed backup.

## Publish x86_64 images

The publisher requires clean committed inputs under `www`, `python`, and `mysql`,
an authenticated `tmckimmey` Docker Hub session, and a Buildx builder with
`linux/amd64` support.

Before publishing, explicitly confirm that each exact Docker Hub repository
exists and its visibility is `Private`:

- `tmckimmey/legendhub-www`
- `tmckimmey/legendhub-python`
- `tmckimmey/legendhub-mysql-backup`

Stop if any repository is missing or its private visibility cannot be
confirmed. Do not rely on the Docker Hub account's default visibility.

```sh
./scripts/publish-images.sh
```

The script publishes all three service images with the 12-character `HEAD` SHA,
verifies their remote manifests, and then moves their `test` tags to those same
digests. Deployments use the printed SHA, not `test`. The script never publishes
`latest`.

## Changelog and release maintenance

Root `CHANGELOG.md` is the public release record rendered at `/changelog`. The
application version in `www/package.json`, the root package version in
`www/package-lock.json`, and the README version badge must match the current
release heading. Check them together with
`node scripts/verify-release-version.js` before committing release metadata.

During the 2.6 beta, add public-facing changes under `2.6.0-beta`. Do not
promote that version to `2.6.0` until the maintainer explicitly says to release.

After the release commit has been reviewed and every verification gate is green,
run the following beta procedure from the repository root. The tag command
requires a clean worktree and must not run before that review and verification.
Tagging and publishing do not authorize a test deployment.

```sh
node scripts/verify-release-version.js
cd www && npm test && cd ..
node --test scripts/test/*.test.js
git status --short --branch
git push origin feat/public-changelog
git fetch --tags origin
./scripts/tag-release.sh
git push origin v2.6.0-beta
./scripts/publish-images.sh
```

Test deployment is a separate, opt-in operation. Run it only after the
maintainer explicitly authorizes that specific deployment; authorization must
be requested again every time.

```sh
./scripts/deploy-test.sh "$(git rev-parse --short=12 HEAD)"
```

For final promotion, change every release metadata value from `2.6.0-beta` to
`2.6.0`: the current release heading in `CHANGELOG.md`, the versions in
`www/package.json` and `www/package-lock.json`, and the README badge text and
URL. Commit and review that metadata transition, then rerun the release gates
and publish the final tag and immutable images:

```sh
node scripts/verify-release-version.js
cd www && npm test && cd ..
node --test scripts/test/*.test.js
git status --short --branch
git push origin feat/public-changelog
git fetch --tags origin
./scripts/tag-release.sh
git push origin v2.6.0
./scripts/publish-images.sh
```

If the maintainer separately authorizes deployment of this final release, run:

```sh
./scripts/deploy-test.sh "$(git rev-parse --short=12 HEAD)"
```

`v2.6.0-beta` and `v2.6.0` are one-time annotated release tags. Never move,
reuse, or delete either tag.

## Deploy registry images to test

Authenticate the server once for private pulls:

```sh
ssh -a dunwichmass
docker login --username tmckimmey
```

From a local LegendHUB repository checkout, deploy the immutable release SHA
with the checked entry point:

```sh
release_sha='REPLACE-WITH-12-CHARACTER-RELEASE-SHA'
./scripts/deploy-test.sh "$release_sha"
```

The script rejects anything except exactly 12 lowercase hexadecimal characters
before invoking SSH. On `dunwichmass` it operates only in
`/home/rufus/legendhub`: it checks that the server's ignored `.env` and
`docker-compose.test.yaml` files exist, fetches Git, expands the requested SHA
to a full commit, checks out that exact commit detached, and confirms the
checkout's 12-character SHA still matches the requested image tag. It checks
the ignored files again, requires exactly one literal
`COMPOSE_PROJECT_NAME=legendhub-test` definition, clears any ambient project
override, exports that fixed project identity, requires the checked-out
`docker-compose.registry.yaml`, and inspects the target Git tree. A current
tree must also contain `docker-compose.content-sync.yaml`; the script validates
all four overlays, pulls `www`, `python`, `mysql-backup`, and `content-sync`,
and runs `up -d --no-build`. The ignored
`COMPOSE_PROFILES=content-sync` setting alone controls automatic sync startup.
The checks never print `.env` values.

A genuine legacy target whose Git tree predates the content-sync overlay uses
the original three overlays and pulls the original three application images.
Before startup, the script finds at most one stale content-sync container by
the exact `legendhub-test` project and `content-sync` service labels and removes
only that container. It does not remove the private sync volume or database
data. A current target with a missing tracked overlay fails instead of being
treated as legacy.

Check `docker compose ... ps`, recent logs, `http://127.0.0.1:7001`, and
`https://legendhub.dunwichmass.com/`. Roll back through the same checked path:

```sh
previous_release_sha='REPLACE-WITH-12-CHARACTER-ROLLBACK-SHA'
[[ "$previous_release_sha" =~ ^[abcdef0123456789]{12}$ ]]
./scripts/deploy-test.sh "$previous_release_sha"
```

Release and rollback both check out the commit matching the image tag before
Compose validation, pull, or startup. Never deploy a movable `test` or `latest`
tag, and never use `down --volumes` during a deployment or rollback.
