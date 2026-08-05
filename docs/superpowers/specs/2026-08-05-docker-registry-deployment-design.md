# Docker Registry Deployment Design

Date: 2026-08-05

## Summary

LegendHUB will publish its three locally built services to private Docker Hub
repositories under the existing `tmckimmey` account. Images will be built for
`linux/amd64` because both the test and deployment servers are x86_64. Publishing
and deployment will remain manual for now, while the repository-owned publishing
logic will be suitable for reuse by GitHub Actions later.

The three repositories are:

- `tmckimmey/legendhub-www`
- `tmckimmey/legendhub-python`
- `tmckimmey/legendhub-mysql-backup`

MySQL is not republished. Deployments continue to use the upstream
`mysql:5.7.44` image for the test database.

## Goals

- Publish all three LegendHUB-built services as private `linux/amd64` images.
- Give every release an immutable-by-policy Git SHA tag and a movable `test` tag.
- Package the web application source inside the `www` image.
- Deploy and roll back using an explicit Git SHA tag.
- Preserve existing named database, backup, and log volumes.
- Keep the manual workflow small enough for a single operator.
- Make the publishing entry point reusable by a future GitHub Actions workflow.

## Non-goals

- Publishing a multi-platform image index.
- Publishing or mirroring the MySQL image.
- Adding GitHub Actions now.
- Adding separate Docker Hub users, teams, collaborators, or deployment identities.
- Automating production deployment.
- Publishing a `latest` tag.

## Current Constraint

The current `www/Dockerfile` installs dependencies but does not copy `www/src`
into the image. Local Compose supplies that directory through a bind mount. A
registry image must be self-contained, so the Dockerfile will copy the source
tree and the registry deployment configuration will remove the development bind
mount. Local development may continue using the bind mount.

The `www` build context also contains a local `node_modules` directory of roughly
267 MB. Service-specific `.dockerignore` files will exclude local dependencies,
tests, caches, and other files that are not runtime inputs. The Python and MySQL
backup contexts will receive similarly narrow exclusions where useful.

## Release Artifacts

Each release publishes these immutable-by-policy tags, where `<sha>` is the
12-character commit ID for `HEAD`:

```text
tmckimmey/legendhub-www:<sha>
tmckimmey/legendhub-python:<sha>
tmckimmey/legendhub-mysql-backup:<sha>
```

After all three SHA-tagged images pass remote manifest verification, the same
image digests are promoted to:

```text
tmckimmey/legendhub-www:test
tmckimmey/legendhub-python:test
tmckimmey/legendhub-mysql-backup:test
```

The `test` tags are convenience pointers. Deployments record and use the SHA tag.
The publishing workflow never produces `latest`.

## Manual Publishing Flow

A repository-owned shell script, `scripts/publish-images.sh`, will be the single
publishing entry point. It will:

1. Confirm Docker and Buildx are available and Docker Hub authentication works.
2. Confirm `HEAD` is a commit and derive its 12-character SHA.
3. Refuse to publish when tracked, staged, or untracked changes exist within the
   `www`, `python`, or `mysql` build inputs. Unrelated files outside those paths do
   not block publishing.
4. Build each service with `docker buildx build --platform linux/amd64 --push` and
   its SHA tag.
5. Inspect every pushed manifest, require the `linux/amd64` deployment platform,
   and reject any other runnable OS/architecture platform. BuildKit attestation
   records with no runnable platform may remain attached.
6. Promote the verified SHA images to `test` without rebuilding them.
7. Inspect the final `test` manifests and print the published tags and digests.

An existing valid SHA tag is not overwritten with a newly built image. This
preserves tag immutability by policy. A resumable run may verify and reuse an
already published SHA image when recovering from a partial prior run.

If a build, push, or verification fails, the script exits nonzero and does not
begin `test` promotion until all three SHA images are available and verified.
Already published SHA images are harmless and can be reused on the next run.

## Registry Compose Override

A committed `docker-compose.registry.yaml` override will provide registry image
names for `www`, `python`, and `mysql-backup`. Each name will interpolate the
required `LEGENDHUB_IMAGE_TAG` value. A missing tag is a configuration error.

The override will use Docker Compose's `!reset` merge tag to:

- clear `build` for all three published services; and
- clear the `www/src` development bind mount.

The registry override is applied after the base and environment-specific Compose
files. For the test server the effective order is:

```text
docker-compose.yaml
docker-compose.test.yaml
docker-compose.registry.yaml
```

The final merged configuration must contain registry images and no build section
for the three published services, no web source bind mount, the test-only MySQL
initialization mount, and the existing loopback-bound application port.

## Authentication

The existing Docker Hub account `tmckimmey` remains the only publishing and
deployment identity. The workstation is already authenticated for publishing.
Each deployment server will run `docker login --username tmckimmey` once so it can
pull the private repositories. No Docker credential is committed to the repository
or written into an image.

## Test Deployment Flow

The operator selects an immutable SHA and runs the merged Compose configuration:

```bash
export LEGENDHUB_IMAGE_TAG=<sha>

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

Pulling is explicit so authentication or missing-tag errors occur before Compose
recreates any container. `--no-build` prevents an accidental server-side build.
The MySQL service and named volumes remain in the same Compose project.

## Verification

Publishing verification will confirm:

- all three SHA tags exist in Docker Hub;
- all three manifests support `linux/amd64`;
- the `test` tags resolve to the same digests as the verified SHA tags; and
- the publisher reports the exact release SHA and digests.

Pre-deployment configuration verification will render the merged Compose model
and confirm:

- all three services reference `tmckimmey` registry images with the chosen SHA;
- no published service retains a `build` section;
- `www` has no host source bind mount; and
- MySQL retains its expected persistent and initialization volumes.

Post-deployment verification will confirm:

- all four services are running and MySQL is healthy;
- the three published containers use the requested SHA-tagged images;
- local HTTP smoke routes through `127.0.0.1:7001` respond successfully;
- the public test URL responds successfully; and
- recent logs contain no startup or migration failure.

## Rollback

Rollback selects the previously deployed SHA, repeats the explicit pull, and runs
the same `up -d --no-build` command. Rollback does not run `docker compose down`
and never passes `--volumes`; therefore database, backup, and log volumes remain
intact. The operator verifies the same health, route, and log checks after rollback.

## Future GitHub Actions Integration

A future workflow will authenticate to Docker Hub using GitHub secrets and invoke
the same repository-owned publishing entry point. The build contexts, image names,
platform checks, tag policy, and manifest verification will remain in the script
instead of being duplicated in workflow YAML. Adding that workflow is explicitly
deferred.
