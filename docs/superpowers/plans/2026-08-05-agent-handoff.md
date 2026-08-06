# Agent Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a clone-local root `AGENTS.md` that gives future Codex sessions durable LegendHUB conventions and a dated, secret-free operational handoff without adding it to the repository.

**Architecture:** Keep automatically discovered agent guidance in one root file. Separate durable instructions from time-sensitive state, date the latter, and require re-verification before future mutations.

**Tech Stack:** Markdown, Git, shell verification

## Global Constraints

- Do not record the GitHub token, Docker credentials, `.env` contents, or any other secret.
- Record only that the token is stored in the ignored server `.env` file and that read access was verified.
- Preserve the user-owned untracked `docker-compose-prod.yaml`.
- Create `AGENTS.md` only at `/Users/toddmckimmey/projects/legendhub/AGENTS.md` and exclude it through the clone-local `.git/info/exclude`.
- Do not add `AGENTS.md` to `.gitignore`, stage it, commit it, or push it.
- Do not deploy, publish, tag, or push merely because the handoff records those workflows.
- Do not alter application behavior as part of this documentation task.
- Mark operational state as dated `2026-08-05` and instruct future agents to verify it before acting.

---

### Task 1: Add the durable agent handoff

**Files:**
- Create locally: `/Users/toddmckimmey/projects/legendhub/AGENTS.md`
- Modify locally: `.git/info/exclude`

**Interfaces:**
- Consumes: Git state, the completed test deployment state, and the conventions approved in `docs/superpowers/specs/2026-08-05-agent-handoff-design.md`.
- Produces: Automatically discovered, clone-local guidance for future Codex sessions.

- [ ] **Step 1: Verify the time-sensitive source facts**

Run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/master
git rev-parse 'v2.6.0-beta^{}'
ssh -A dunwichmass 'cd /home/rufus/legendhub && git rev-parse HEAD'
```

Expected:

- The only unrelated worktree item is `?? docker-compose-prod.yaml`.
- Documentation-only commits may make local `master` newer than the deployed application commit.
- `origin/master` contains application commit `5e6978a314dc390fa35a16082097f0755e1025fb` unless the documentation commits have since been pushed.
- `v2.6.0-beta` resolves to `72e5f24e10212439a4a19f57b1729e49daa3d193`.
- Dunwichmass resolves to deployed commit `5e6978a314dc390fa35a16082097f0755e1025fb`.

- [ ] **Step 2: Exclude and create the local handoff file**

Add this exact line to the common Git directory's `info/exclude` if it is not
already present:

```text
/AGENTS.md
```

Create `/Users/toddmckimmey/projects/legendhub/AGENTS.md` with this content:

```markdown
# LegendHUB Agent Guidance

## Durable conventions

- The primary branch is `master`; this repository has no `main` or `develop` branch. Create feature branches from `master` for new work.
- Test deployment is opt-in for every deployment. Do not publish images, deploy, tag, or push without authorization that covers that specific action.
- GitHub Actions are planned for later but are not the current publishing or deployment mechanism.
- Test and deployment servers require `linux/amd64` (`x86_64`) images. Publish all three private Docker Hub repositories: `tmckimmey/legendhub-www`, `tmckimmey/legendhub-python`, and `tmckimmey/legendhub-mysql-backup`.
- Treat release tags as immutable. Never move, delete, or reuse `v2.6.0-beta` or `v2.6.0`.
- Maintain public-facing changes in root `CHANGELOG.md`. Keep the version at `2.6.0-beta` until the maintainer explicitly authorizes promotion to `2.6.0`.
- The maintainer prefers `vi` for server-side editing.
- Root `docker-compose-prod.yaml` is user-owned, intentionally untracked, and must remain untouched unless the maintainer explicitly places it in scope.
- Never record or print GitHub tokens, Docker credentials, `.env` contents, or other secrets.

## Current operational handoff — 2026-08-05

This section is time-sensitive. Verify Git, Docker Hub, and server state before relying on it.

- The application commit pushed to `origin/master` and deployed to test was `5e6978a314dc390fa35a16082097f0755e1025fb` (`5e6978a314dc`). Documentation-only commits may be newer.
- The previous test deployment was `72e5f24e10212439a4a19f57b1729e49daa3d193` (`72e5f24e1021`), which is the immediate rollback candidate after verifying its images still exist.
- Dunwichmass runs from `/home/rufus/legendhub` at the deployed commit in detached-HEAD state.
- All four test services were running after deployment, MySQL was healthy, and `/`, `/feedback.html`, and `/changelog` returned HTTP 200 locally and through `https://legendhub.dunwichmass.com/`.
- The three SHA-tagged Docker images were verified as `linux/amd64`; their movable `test` aliases pointed to the same `5e6978a314dc` digests. Deployments use the immutable SHA, not `test`.
- Dunwichmass Git fetch configuration was corrected from an obsolete single-feature-branch refspec to `+refs/heads/*:refs/remotes/origin/*`.
- `/home/rufus/legendhub/.env` contains the ignored feedback configuration. `GITHUB_REPOSITORY` is `rufuslegend/legendhub`; the token itself must never be read into logs or committed. Authenticated repository and `triage`-label reads succeeded, but no test Issue was created.
- Feedback creates GitHub Issues labeled `triage` and assigned to `rufuslegend`. The page warns submitters about Issue visibility.
- Repository links point to `rufuslegend/legendhub`; Vote and Discord displays are disabled while the Discord iframe source remains retained in code.
- The immutable `v2.6.0-beta` tag still targets `72e5f24e10212439a4a19f57b1729e49daa3d193`, not the later deployed commit. Do not move it. Use a distinct prerelease tag such as `v2.6.0-beta.1` if another beta tag is authorized.
- Latest merged verification passed 44 script tests, 100 web tests with one expected skip, CSS lint, shell syntax checks, and merged Compose validation.
- Local feature branches and the isolated worktree were removed. Remote `feat/docker-registry-deployment` still existed and can be deleted only when explicitly requested.
- Production was not deployed.
```

- [ ] **Step 3: Verify the handoff is complete and secret-free**

Run:

```bash
handoff=/Users/toddmckimmey/projects/legendhub/AGENTS.md
test -f "$handoff"
rg -n '^## Durable conventions$|^## Current operational handoff — 2026-08-05$' "$handoff"
rg -n '5e6978a314dc390fa35a16082097f0755e1025fb|72e5f24e10212439a4a19f57b1729e49daa3d193|docker-compose-prod.yaml|v2.6.0-beta.1' "$handoff"
if rg -n 'github_pat_|ghp_|GITHUB_TOKEN[[:space:]]*=[[:space:]]*[^[:space:]]+' "$handoff"; then exit 1; fi
git -C /Users/toddmckimmey/projects/legendhub check-ignore -q AGENTS.md
if git -C /Users/toddmckimmey/projects/legendhub ls-files --error-unmatch AGENTS.md >/dev/null 2>&1; then exit 1; fi
```

Expected:

- Both required sections and all key operational facts are present.
- The secret-pattern scan prints nothing and exits successfully through the conditional.
- Git reports `AGENTS.md` as ignored and not tracked.

- [ ] **Step 4: Confirm the diff is documentation-only**

Run:

```bash
git -C /Users/toddmckimmey/projects/legendhub status --short
git -C /Users/toddmckimmey/projects/legendhub diff -- .gitignore
```

Expected:

- `AGENTS.md` does not appear because it is clone-locally ignored.
- `docker-compose-prod.yaml` remains untracked and unchanged.
- No application, deployment, environment, or credential file is modified.
- The tracked `.gitignore` has no diff.

- [ ] **Step 5: Finish without tracking the handoff**

Run:

```bash
git -C /Users/toddmckimmey/projects/legendhub check-ignore -v AGENTS.md
git -C /Users/toddmckimmey/projects/legendhub status --short --branch
```

Expected:

- `AGENTS.md` is excluded by `.git/info/exclude` and remains untracked.
- `docker-compose-prod.yaml` remains the only untracked file.
- No commit or push is made for `AGENTS.md`.
