# MySQL Backup Cron Environment Design

**Date:** 2026-08-11

## Goal

Make scheduled LegendHUB database backups receive the same required database
environment as the backup container, without committing, baking, or printing
secret values. Make scheduled failures and successes visible through ordinary
container logs.

## Production Evidence

The production backup container is running Debian cron as root. Its system cron
entry runs `/usr/local/bin/backup-mysql` as root every day at 06:11 UTC. Docker
created the container with a non-empty `MYSQL_PASSWORD`, but each scheduled job
failed with:

```text
/usr/local/bin/backup-mysql: line 4: MYSQL_PASSWORD: unbound variable
```

The mounted `legendhub260_database-backups` volume consequently contains no
private or public backup files. The container-internal `/var/log/cron.log`
contains four failures. An interactive process started with `docker exec` sees
the configured variable, confirming that Compose interpolation and container
creation are correct and the environment is lost only at the cron boundary.

Debian cron gives jobs a controlled environment and supports explicit
environment settings in a crontab. Docker documents that `docker exec`
processes inherit the environment configured when the container was created.

## Scope

### In scope

- Add a repository-owned entrypoint for the MySQL backup image.
- Validate the environment required by `backup-mysql` before starting cron.
- Serialize the required environment to an ephemeral, root-only runtime file.
- Make the cron job source that runtime file before running the existing backup
  command.
- Route cron job output to container stdout and stderr.
- Emit a secret-free success record after both backup artifacts are written.
- Add regression coverage for propagation, quoting, permissions, logging, and
  fail-closed startup.
- Document and verify the safe test and production rollout sequence.

### Out of scope

- Changing the daily 06:11 UTC schedule.
- Moving scheduling to the production host.
- Adding a third-party scheduler.
- Changing database schemas, retention rules, backup contents, or volume names.
- Fixing the separate production collation/search issue.
- Deploying to production without a new, explicit deployment authorization.

## Selected Approach

The backup image will start through `/usr/local/bin/backup-entrypoint` rather
than invoking `cron` directly.

At container startup, the entrypoint will:

1. require non-empty `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and
   `MYSQL_DATABASE` values;
2. set `umask 077`;
3. write Bash-safe `export` statements for those values to a temporary file in
   `/run` without echoing them to stdout or stderr;
4. set the file mode to `0600` and atomically rename it to
   `/run/legendhub-backup.env`; and
5. replace itself with `cron -f -L 15` so signals and container lifecycle remain
   straightforward.

The cron file will select Bash explicitly and execute a static command that
sources `/run/legendhub-backup.env` before invoking `backup-mysql`. The secret
itself will never be embedded in the image, Dockerfile, cron table, command
line, or logs. The static cron command avoids cron's special handling of `%`
inside command text, while Bash-safe serialization preserves passwords that
contain whitespace, quotes, dollar signs, backslashes, or percent signs.

Cron output will be directed to PID 1's stdout and stderr so `docker logs`
captures failures. On success, `backup-mysql` will report only a timestamp,
artifact paths, and byte sizes; it will not print database contents or
credentials.

## Alternatives Considered

### Host cron invoking `docker exec`

This is a useful immediate recovery command because `docker exec` receives the
container's configured environment. It is not the durable design: it would put
critical scheduling state outside the repository, make host rebuilds harder,
and allow test and production to drift.

### Environment assignments directly in the cron table

Debian cron supports this, but placing the database password in a world-readable
cron file would weaken secret handling. Arbitrary password characters also make
safe generated cron syntax needlessly fragile.

### Replace cron with another scheduler

A scheduler designed for containers could inherit the environment and improve
logging, but it adds a new binary and supply-chain dependency for one daily
job. The entrypoint corrects the existing architecture with less change.

## Failure Handling and Observability

- Missing or empty required values prevent the container from starting cron.
- Startup errors identify only the missing variable name, never its value.
- The runtime environment file is created with mode `0600` and exists only in
  the running container's writable layer.
- Backup command failures remain nonzero and appear in `docker logs`.
- A success line is emitted only after both private and public outputs exist and
  have nonzero size.
- The backup script retains `set -euo pipefail`, so dump, compression, or file
  errors stop the job rather than reporting success.

## Testing

Repository tests will exercise the entrypoint with a fake `cron` executable so
no daemon or real database is required. They will verify:

- startup fails before cron when each required variable is absent or empty;
- the error names the missing variable without leaking other values;
- the runtime environment file is mode `0600`;
- passwords containing spaces, quotes, `$`, backslashes, and `%` survive an
  entrypoint-write and Bash-source round trip exactly;
- cron is replaced with the expected foreground invocation;
- the cron command sources only the fixed runtime path and does not contain a
  password placeholder or secret;
- job output targets container stdout and stderr; and
- the success record is secret-free and requires two nonempty artifacts.

Existing script, Compose, web, and CSS suites remain green. The built backup
image must remain `linux/amd64`, and publication must continue to cover all
three private LegendHUB repositories under one immutable Git SHA.

## Rollout

Every operational mutation below requires its own applicable authorization.

1. Before changing production, run the current backup script once with
   `docker exec` and verify the private gzip and public SQL artifacts are
   nonempty without displaying their contents.
2. Implement and test the repository change on a feature branch.
3. Publish all three `linux/amd64` images under the new immutable 12-character
   Git SHA and matching `test` aliases.
4. Deploy the SHA to Dunwichmass. Verify the runtime file permissions, run the
   exact cron child command, confirm both artifacts, inspect container logs,
   and ensure application routes remain healthy.
5. Prepare and validate a production Compose change against the actual current
   mixed-image production state; do not rely on the older `6ddaeab948a1`
   staging document as-is.
6. With explicit production authorization, capture another current backup,
   deploy the fixed backup image and approved web image, run and verify an
   on-demand backup, then confirm the next scheduled execution.

## Rollback

The change has no database or volume migration. Preserve the current immutable
backup image and the previous production Compose file. If the new backup
container fails a gate, restore the previous image reference and recreate only
the backup service. Existing backup artifacts and the database volume remain
untouched. A manual `docker exec` backup remains the temporary recovery path
until the scheduled job is proven.
