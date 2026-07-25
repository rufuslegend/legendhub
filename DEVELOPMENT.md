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

There is no automated test suite yet. After a change, check at least:

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
