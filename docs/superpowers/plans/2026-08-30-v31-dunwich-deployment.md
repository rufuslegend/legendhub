# LegendHUB 3.1 Dunwich Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the completed LegendHUB 3.1 account-storage work into `master`, publish immutable `linux/amd64` images, and deploy and verify that exact Git SHA on the Dunwich test site.

**Architecture:** Treat `feat/v31-account-storage` as the release candidate because it forks from the current local `master` and contains the complete email identity, recovery, Builder storage, and refinement history. Verify and review the candidate before fast-forwarding `master`; publish all three required Docker images under the resulting 12-character Git SHA, then let the existing deployment script fetch that commit and recreate the Dunwich test stack from immutable registry references.

**Tech Stack:** Git, Node.js 22, npm, Playwright, Docker Buildx, Docker Compose, MySQL 5.7, SSH, IONOS SMTP.

**Spec:** `docs/superpowers/specs/2026-08-26-v31-account-storage-design.md`

## Global Constraints

- The integration base is `master`; the release candidate is `feat/v31-account-storage`.
- Preserve the user-owned untracked root `docker-compose-prod.yaml` and `.mcp.json`; do not edit or commit either file.
- Do not expose `.env`, GitHub tokens, Docker credentials, SMTP credentials, database credentials, or private account data in commands or logs.
- Publish `tmckimmey/legendhub-www`, `tmckimmey/legendhub-python`, and `tmckimmey/legendhub-mysql-backup` for `linux/amd64`.
- Deploy the immutable 12-character Git SHA, never the movable `test` tag.
- Do not create or move a Git release tag during this test deployment.
- Do not modify or deploy production.
- Require a player-friendly `CHANGELOG.md` entry for every player-facing 3.1 change.
- Stop before publication if any repository, browser, CSS, migration, security, review, or merged-tree gate fails.
- Stop the rollout if a Dunwich service is unhealthy, migration 9 is absent, an endpoint fails, or the application mailer cannot submit through IONOS.

---

### Task 1: Freeze and validate the release candidate

**Files:**
- Modify: `docs/superpowers/plans/2026-08-30-v31-dunwich-deployment.md`
- Inspect: `CHANGELOG.md`
- Inspect: all paths reported by `git status --porcelain=v1 --untracked-files=all`

**Interfaces:**
- Consumes: `feat/v31-account-storage` at its current committed and uncommitted state.
- Produces: one documented, reviewable release candidate whose base is the current local `master`.

- [ ] **Step 1: Confirm branch ancestry and repository state**

Run from `.worktrees/v31-account-storage`:

```bash
git status --short --branch
git merge-base master HEAD
git rev-parse master
git rev-list --left-right --count master...HEAD
```

Expected: the merge base equals `master`, and the feature branch is only ahead of `master`.

- [ ] **Step 2: Verify the complete uncommitted diff is structurally clean**

```bash
git diff --check
git diff --stat
git status --porcelain=v1 --untracked-files=all
```

Expected: `git diff --check` exits zero and all changed paths belong to the 3.1 refinement work or this plan.

- [ ] **Step 3: Verify the player-facing changelog**

Read the `3.1.0-beta` section and confirm it covers email identity, recovery, account Builder storage, preference sync, migration, login/account refinements, privacy policy, dark default theme, item-picker targets, and local-data migration behavior.

- [ ] **Step 4: Verify Dunwich SMTP prerequisites without printing values**

Check only set/missing state for `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `APP_BASE_URL`, and resolve the three DKIM CNAME selectors.

Expected: all seven settings are non-empty and selectors resolve respectively to `s1.dkim.ionos.com`, `s2.dkim.ionos.com`, and `s42582890.dkim.ionos.com`.

---

### Task 2: Run all pre-integration release gates

**Files:**
- Test: `scripts/test/*.test.js`
- Test: `www/test/**/*.test.js`
- Test: `www/accessibility/*.spec.js`
- Test: `css/scss/**/*.scss`

**Interfaces:**
- Consumes: the complete dirty release-candidate worktree.
- Produces: fresh pass/fail evidence for the exact candidate that will be committed.

- [ ] **Step 1: Run repository script tests**

```bash
node --test scripts/test/*.test.js
```

Expected: exit zero with no failed tests.

- [ ] **Step 2: Run the complete web test suite and client build**

```bash
npm test
```

Run from `www/`. Expected: Vite build and every Node test pass, with only documented skips.

- [ ] **Step 3: Run the complete accessibility and browser suite**

```bash
npm run test:a11y
```

Run from `www/` against the existing local 3.1 stack. Expected: all scenarios pass, including account email, Builder sync, privacy, theme, migration, and authentication flows.

- [ ] **Step 4: Run the CSS lint and build gate**

```bash
npm test
npm run build
```

Run from `css/`. Expected: style lint, compilation, prefixing, minification, and public asset copy all succeed.

- [ ] **Step 5: Run the MySQL migration integration suite**

```bash
MYSQL_MIGRATION_INTEGRATION=1 node --test test/migrations.integration.test.js
```

Run from `www/` with the local MySQL 5.7-compatible stack available. Expected: migrations 8 and 9 apply, verify, and safely retry.

- [ ] **Step 6: Run dependency and shell safety gates**

```bash
npm audit --audit-level=critical
npm --prefix css audit --audit-level=critical
bash -n scripts/publish-images.sh scripts/deploy-test.sh scripts/preflight-production.sh
git diff --check
```

Expected: no critical audit findings, shell syntax exits zero, and the diff remains clean.

---

### Task 3: Commit and independently review the 3.1 candidate

**Files:**
- Commit: every tracked and new 3.1 path reported by Task 1
- Exclude: root `.mcp.json`
- Exclude: root `docker-compose-prod.yaml`

**Interfaces:**
- Consumes: green Task 2 evidence.
- Produces: one final refinement commit on `feat/v31-account-storage` and an independent review of `master..HEAD`.

- [ ] **Step 1: Stage only the 3.1 worktree changes**

```bash
git add CHANGELOG.md docs/superpowers/plans/2026-08-30-v31-dunwich-deployment.md www
git diff --cached --check
git status --short
```

Expected: only intended 3.1 files and the deployment plan are staged.

- [ ] **Step 2: Commit the refinement checkpoint**

```bash
git commit -m "fix: refine 3.1 account workflows"
```

Expected: commit succeeds and the feature worktree is clean.

- [ ] **Step 3: Dispatch an independent read-only review**

Provide the reviewer with the account-storage design, the complete `master..HEAD` range, the release-gate results, and explicit focus on authentication, token lifecycle, privacy boundaries, migration safety, conflict handling, quota enforcement, browser-local migration, SMTP configuration, and rollback compatibility.

- [ ] **Step 4: Resolve review findings**

Fix every Critical and Important finding with focused tests and a separate commit. Re-run every affected gate plus `git diff --check`. Do not proceed while the reviewer verdict is `No` or `With fixes` with unresolved Important findings.

---

### Task 4: Integrate and verify `master`

**Files:**
- Update branch: `master`
- Preserve: `/Users/toddmckimmey/projects/legendhub/.mcp.json`
- Preserve: `/Users/toddmckimmey/projects/legendhub/docker-compose-prod.yaml`

**Interfaces:**
- Consumes: reviewed `feat/v31-account-storage` HEAD.
- Produces: local `master` pointing at the exact reviewed release commit.

- [ ] **Step 1: Reconfirm the root worktree has no tracked modifications**

```bash
git -C /Users/toddmckimmey/projects/legendhub status --short --branch
```

Expected: only known untracked user-owned files may appear.

- [ ] **Step 2: Fast-forward `master` to the reviewed feature commit**

```bash
git -C /Users/toddmckimmey/projects/legendhub merge --ff-only feat/v31-account-storage
```

Expected: fast-forward succeeds without touching untracked user files.

- [ ] **Step 3: Re-run the merged-tree release gates**

From the root worktree, run repository script tests, `www` tests, browser tests, CSS tests/build, migration integration, audits, shell syntax checks, and `git diff --check` using the commands from Task 2.

Expected: every gate remains green on `master`, and `git status --short --branch` shows only the known untracked user files.

---

### Task 5: Push and publish the immutable release candidate

**Files:**
- Push branch: `master`
- Publish: `tmckimmey/legendhub-www:<12-char-sha>`
- Publish: `tmckimmey/legendhub-python:<12-char-sha>`
- Publish: `tmckimmey/legendhub-mysql-backup:<12-char-sha>`

**Interfaces:**
- Consumes: green local `master` HEAD.
- Produces: one remote Git commit and three verified `linux/amd64` Docker image references.

- [ ] **Step 1: Resolve and record the immutable release SHA**

```bash
git rev-parse --short=12 HEAD
git log -1 --format='%H%n%s'
```

Expected: a 12-character lowercase SHA matching the full `master` HEAD.

- [ ] **Step 2: Push `master` without force**

```bash
git push origin master
```

Expected: remote `master` advances to the release commit.

- [ ] **Step 3: Publish all required images**

```bash
./scripts/publish-images.sh
```

Expected: the script builds or reuses the SHA-tagged `linux/amd64` images, advances each movable `test` alias to the same digest, and prints one verified digest per repository.

- [ ] **Step 4: Independently inspect image platforms and digests**

Use `docker buildx imagetools inspect` for all three SHA references and all three `test` aliases, passing each manifest through `scripts/verify-image-platform.js`.

Expected: every image is `linux/amd64`, and each `test` digest equals its corresponding immutable SHA digest.

---

### Task 6: Deploy and verify Dunwich

**Files:**
- Remote deploy root: `/home/rufus/legendhub`
- Remote environment: `/home/rufus/legendhub/.env`
- Remote private Compose overlay: `/home/rufus/legendhub/docker-compose.test.yaml`

**Interfaces:**
- Consumes: the published immutable 12-character SHA and the already configured Dunwich `.env`.
- Produces: a healthy Dunwich test stack running the exact 3.1 release commit and images.

- [ ] **Step 1: Run the existing immutable deployment script**

```bash
./scripts/deploy-test.sh <12-character-release-sha>
```

Expected: Dunwich fetches the commit, checks it out detached, validates Compose, pulls all required SHA images, and starts the stack without local builds.

- [ ] **Step 2: Verify Git and container provenance**

Check remote `HEAD`, Compose project labels, image references, immutable image IDs, service status, MySQL health, and container restart counts.

Expected: remote `HEAD` equals the release SHA; `www`, `python`, `mysql`, and `mysql-backup` run under `legendhub-test`; all application images use the release SHA.

- [ ] **Step 3: Verify migration 9 and account schema without exposing data**

Query only migration identifiers and schema metadata. Confirm migration 9 is recorded and `Members`, `AccountActionTokens`, `BuilderProfiles`, `AccountPreferences`, and `BuilderImportReceipts` have the expected columns, keys, and JSON metadata on Dunwich MySQL.

- [ ] **Step 4: Verify public endpoints and security headers**

Request `/`, `/login.html`, `/privacy.html`, `/account/`, `/verify-email.html`, `/forgot-password.html`, `/builder/`, `/items/`, `/changelog`, and `/api` through `https://legendhub.dunwichmass.com`.

Expected: public pages return their intended 200 or authentication redirect/status; TLS and account-action pages omit sensitive query strings from logs and referrers; static assets load from the release bundle.

- [ ] **Step 5: Inspect startup and migration logs**

Read bounded recent logs for `www`, `python`, `mysql`, and `mysql-backup`. Search for migration, SMTP, unhandled rejection, uncaught exception, database, crash-loop, and credential-leak indicators without printing environment values.

Expected: clean startup, completed migrations, no crash loops, and no secrets or action tokens in logs.

- [ ] **Step 6: Send one message through the deployed application mailer**

Execute the deployed `www/src/mail.js` inside the running `www` container, using its existing environment, to send one controlled verification message to `todd.mckimmey@gmail.com` with a deliberately nonfunctional test token and no database mutation.

Expected: Nodemailer reports acceptance through IONOS; the recipient confirms delivery; no SMTP credential is printed.

- [ ] **Step 7: Run final external and rollback-readiness checks**

Confirm the public homepage and key feature pages remain reachable after the mail test, record the previous deployed SHA `123167dac249` as the immediate rollback candidate, and verify its three immutable images still exist before declaring the deployment complete.
