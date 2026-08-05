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

```sh
./scripts/publish-images.sh
```

The script publishes all three service images with the 12-character `HEAD` SHA,
verifies their remote manifests, and then moves their `test` tags to those same
digests. Deployments use the printed SHA, not `test`. The script never publishes
`latest`.

## Deploy registry images to test

Authenticate the server once for private pulls:

```sh
ssh -A dunwichmass
docker login --username tmckimmey
```

From `/home/rufus/legendhub`, select the immutable release SHA:

```sh
export LEGENDHUB_IMAGE_TAG=<12-character-sha>

docker compose \
  -f docker-compose.yaml \
  -f docker-compose.test.yaml \
  -f docker-compose.registry.yaml \
  pull www python mysql-backup

docker compose \
  -f docker-compose.yaml \
  -f docker-compose.test.yaml \
  -f docker-compose.registry.yaml \
  up -d --no-build
```

Check `docker compose ... ps`, recent logs, `http://127.0.0.1:7001`, and
`https://legendhub.dunwichmass.com/`. Roll back by exporting the previous SHA and
repeating `pull` and `up -d --no-build`. Never use `down --volumes` during a
deployment or rollback.
