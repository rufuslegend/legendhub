# Local development

LegendHUB runs as four Docker Compose services:

- `mysql`: MySQL 5.7 database
- `www`: Node/Express website and GraphQL API
- `python`: notification and authentication-token maintenance jobs
- `mysql-backup`: daily private and sanitized public database backups

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

Validate the registry publishing and Compose tooling from the repository root:

```sh
node --test scripts/test/*.test.js
```

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
ssh -A dunwichmass
docker login --username tmckimmey
```

From a local LegendHUB repository checkout, deploy the immutable release SHA
with the checked entry point:

```sh
./scripts/deploy-test.sh <12-character-release-sha>
```

The script rejects anything except exactly 12 lowercase hexadecimal characters
before invoking SSH. On `dunwichmass` it operates only in
`/home/rufus/legendhub`: it checks that the server's ignored `.env` and
`docker-compose.test.yaml` files exist, fetches Git, expands the requested SHA
to a full commit, checks out that exact commit detached, and confirms the
checkout's 12-character SHA still matches the requested image tag. It checks
the ignored files again, requires the checked-out
`docker-compose.registry.yaml`, validates the merged Compose configuration,
pulls `www`, `python`, and `mysql-backup`, and runs `up -d --no-build`. The
checks never print `.env` values.

Check `docker compose ... ps`, recent logs, `http://127.0.0.1:7001`, and
`https://legendhub.dunwichmass.com/`. Roll back through the same checked path:

```sh
./scripts/deploy-test.sh <previous-12-character-release-sha>
```

Release and rollback both check out the commit matching the image tag before
Compose validation, pull, or startup. Never deploy a movable `test` or `latest`
tag, and never use `down --volumes` during a deployment or rollback.
