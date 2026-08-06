# Public Changelog and Versioning Design

**Date:** 2026-08-05
**Status:** Approved

## Purpose

LegendHUB's visible version and changelog stopped at `2.5.0` in 2023 even
though development resumed. The repository also has no release tags, and its
public `/changelog` page depends on manually edited database records.

This change establishes one reviewable changelog in the repository, restores
consistent application versioning, and makes releases identifiable in Git.
The first maintained version is `2.6.0-beta`. It becomes `2.6.0` only when the
maintainer explicitly declares the release.

## Goals

- Make a root `CHANGELOG.md` the only changelog source of truth.
- Render that file at the existing public `/changelog` URL.
- Keep the application version, npm lockfile, README badge, changelog heading,
  and Git tag consistent.
- Create immutable annotated Git tags for releases and prereleases.
- Provide public-facing notes rather than a raw commit log.
- Include the changelog in local and registry-built web containers.
- Fail closed when release metadata is absent or inconsistent.

## Non-goals

- Export or reproduce changelog entries older than `2.6.0-beta`.
- Delete the legacy changelog tables or their data.
- Generate release notes automatically from commit messages.
- Create a GitHub Actions release workflow at this time.
- Publish GitHub Releases or packages to npm.

## Source of Truth and Format

The repository root contains `CHANGELOG.md`, following the useful parts of
Keep a Changelog without requiring historical backfill. It begins with a short
introduction and a `2.6.0-beta` section. Notes use user-oriented categories
such as `Added`, `Changed`, and `Fixed`.

The beta section summarizes meaningful changes since `2.5.0`: visible
features, behavior changes, reliability improvements, and important fixes.
Dependency upgrades, internal refactors, and deployment mechanics appear only
when they materially affect users or operators.

While the beta is active, new notes accumulate in the `2.6.0-beta` section.
When the maintainer declares the final release, that section becomes `2.6.0`
and receives the release date. After the final release, subsequent work starts
under an `Unreleased` section.

`www/package.json` remains the machine-readable application version. The root
changelog is the human-readable release record. A consistency verifier ensures
that these surfaces agree:

- the newest released or prereleased changelog heading;
- `www/package.json`;
- the root package entry in `www/package-lock.json`;
- the README version badge.

The accepted version syntax is semantic versioning, including prerelease
identifiers. The initial exact version is `2.6.0-beta`.

## Public Changelog Page

`GET /changelog` and `GET /changelog/index.html` load the tracked Markdown
document and render it as a normal server-rendered LegendHUB page. Markdown is
converted on the server with embedded HTML disabled. The page therefore has
useful content without requiring AngularJS or client-side Markdown execution.

The application loads the changelog through a small, independently testable
document component. Its file location is explicit for local execution, tests,
and the container image. Missing, unreadable, or empty content causes a
contextual startup failure rather than an empty public page.

Legacy public detail URLs (`/changelog/details.html?...`) permanently redirect
to `/changelog`. The add and edit routes and their public controls are removed.
The changelog router no longer calls the GraphQL changelog API or permission
lookup. Database tables, resolvers, schema fields, permissions, and stored data
remain untouched in this change so retirement is non-destructive and can be
reconsidered independently.

## Container Integration

The root file must be inside the immutable web image, so the web image build
context expands from `www` to the repository root. `www/Dockerfile` continues
to be the Dockerfile but copies only the required inputs:

- `www/package.json` and `www/package-lock.json`;
- `www/src`;
- root `CHANGELOG.md`.

Compose selects the repository root as the `www` build context and names
`www/Dockerfile` explicitly. The manual three-image publisher makes the same
targeted adjustment for the web image while leaving the Python and MySQL
backup contexts unchanged. Its clean-input check includes `CHANGELOG.md`
because changelog content becomes part of the published web artifact.

The registry Compose override continues to remove local build configuration
and source mounts, so test deployment remains pinned to the immutable image.

## Release and Tag Workflow

A repository command verifies release consistency without silently inventing
release notes. Preparing `2.6.0-beta` or promoting it to `2.6.0` requires an
intentional edit of the public notes and coordinated version metadata.

The release sequence is:

1. Curate the public changelog entry.
2. Set the same semantic version in the npm package, lockfile, README badge,
   and newest changelog heading.
3. Run the release-consistency verifier and the full application, deployment,
   Dockerfile, and Compose checks.
4. Commit the complete release metadata and code.
5. Create an annotated tag by prefixing the verified version with `v`.
6. Publish and deploy the commit's immutable container SHA through the existing
   registry workflow when the release is intended to become public.

The initial prerelease tag is `v2.6.0-beta`. When the maintainer says
"release," promotion creates a new `v2.6.0` tag; the beta tag remains where it
was created. Tags are never moved or reused.

The workflow stops before committing or tagging when the changelog is missing,
metadata versions disagree, the version is invalid, release inputs are dirty,
or the requested tag already exists.

## Testing

Automated coverage includes:

- changelog document loading and server-side Markdown rendering;
- failure on missing, unreadable, or empty changelog content;
- public route rendering without a database or GraphQL request;
- redirects from legacy detail URLs;
- absence of the retired add/edit controls and routes;
- version agreement across changelog, npm package, lockfile, and README badge;
- rejection of malformed or mismatched versions;
- Compose rendering with the root web build context and explicit Dockerfile;
- publisher command construction and dirty-input coverage for the root file;
- confirmation that the registry override still produces image-only services;
- the existing application test suite and Dockerfile syntax/build checks.

Tag creation is verified with a temporary local Git repository so tests never
create or move a real project tag. Publishing and deployment retain their
existing explicit operational verification gates.

## Branch and Integration Strategy

Implementation occurs on `feat/public-changelog`, created from the reviewed
`feat/docker-registry-deployment` branch. This leaves the original Docker
deployment branch unchanged while allowing the web build-context and publisher
updates to be tested against the actual registry workflow. The beta tag is
created only on the final verified prerelease commit, after review and before
the beta is published or deployed.
