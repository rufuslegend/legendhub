# Agent Handoff Design

## Goal

Give future Codex sessions the operational context needed to work safely in the
LegendHUB repository after conversation history is cleared.

## Location

Create a root-level `AGENTS.md` in the primary local checkout. Codex discovers
this file automatically, unlike an ordinary handoff note that a future session
might not know to open. Keep it local by adding `/AGENTS.md` to the clone-local
`.git/info/exclude`; do not add it to the repository's `.gitignore`, stage it,
commit it, or push it.

## Structure

The file will have two sections:

1. **Durable conventions** for facts that should remain applicable across
   sessions, including the primary branch name, feature-branch practice,
   explicit authorization for test deployments, the preference for `vi` on
   servers, and ownership of the untracked production Compose file.
2. **Current operational handoff**, dated `2026-08-05`, for state that can become
   stale, including Git and deployment SHAs, Docker image state, the test-server
   configuration, release-tag state, completed verification, and known cleanup
   items.

The handoff will explicitly instruct future agents to verify time-sensitive
facts before acting.

## Security and Scope

- Do not record the GitHub token, Docker credentials, `.env` contents, or any
  other secret.
- Record only that the token is stored in the ignored server `.env` file and
  that read access was verified.
- Preserve the user-owned untracked `docker-compose-prod.yaml`.
- Keep `AGENTS.md` untracked and clone-local.
- Do not deploy, publish, tag, or push merely because the handoff records those
  workflows.
- Do not alter application behavior as part of this documentation task.

## Validation

- Confirm the primary checkout's `AGENTS.md` contains the agreed handoff facts
  and no token-like value.
- Confirm Git ignores `AGENTS.md` through `.git/info/exclude` and does not track
  it.
- Confirm the documented local and remote `master` SHA before recording it.
- Confirm the immutable `v2.6.0-beta` tag target before recording it.
- Confirm the only unrelated worktree item remains the user-owned untracked
  `docker-compose-prod.yaml`.
