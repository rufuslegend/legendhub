# React CSS Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the confirmed Angular-to-React modal and Builder table presentation contracts and add a reusable UI-parity audit command.

**Architecture:** Deterministic Playwright regressions run against the local Express application and protect the corrected user-facing behavior. A separate operator-invoked audit script opens two supplied deployments, captures mapped computed styles and geometry across supported themes and viewports, and reports consolidated differences without making the normal test suite depend on external services.

**Tech Stack:** React 19, Bootstrap 4, Node.js 22, Playwright, Node's built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-22-react-ejs-migration-design.md`

## Global Constraints

- Preserve semantic React controls, table headings, focus trapping, and trigger-focus restoration.
- Keep routine tests local and deterministic; production and Dunwich are audit inputs, never test dependencies.
- Do not change application data contracts, cookies, routes, themes, or Builder calculations.
- Update root `CHANGELOG.md` in player-friendly language.
- Do not push, publish images, deploy, or tag without separate authorization.

---

### Task 1: Restore shared modal scrolling

**Files:**
- Modify: `www/accessibility/high-contrast.spec.js`
- Modify: `www/accessibility/react-builder.spec.js`
- Modify: `www/client/components/ColumnsDialog.jsx`
- Modify: `www/client/components/FiltersDialog.jsx`

- [x] Add mobile browser regressions that open Builder Columns and Item Search Columns/Filters, prove the page body is locked, wheel scrolling advances the dialog rather than the page, and closing restores the body and trigger.
- [x] Run the focused Playwright tests and confirm they fail because React lacks Bootstrap's visible-modal overflow state and `body.modal-open`.
- [x] Add the minimal open/close lifecycle and modal class needed to restore scrolling.
- [x] Re-run the focused tests and confirm they pass.

### Task 2: Restore Builder equipment body-cell parity

**Files:**
- Modify: `www/accessibility/react-builder.spec.js`
- Modify: `www/client/features/builder/EquipmentPanel.jsx`

- [x] Add desktop and mobile browser assertions for centered Slot/Lock values, non-wrapping Slot/Total cells, legacy responsive row density, and normal visual weight on the semantic Total row header.
- [x] Run the focused test and confirm it fails on the current omitted utility classes.
- [x] Restore the minimal Bootstrap utility classes while retaining real buttons and `<th scope="row">` semantics.
- [x] Re-run the focused test and confirm it passes.

### Task 3: Add the reusable parity audit

**Files:**
- Create: `www/scripts/audit-ui-parity.js`
- Create: `www/test/ui-parity-audit.test.js`
- Modify: `www/package.json`
- Modify: `DEVELOPMENT.md`

- [x] Add failing unit tests using literal snapshots for material style/geometry differences, tolerance handling, and consolidation of the same root difference across themes/viewports.
- [x] Run the focused Node test and confirm it fails because the audit module is absent.
- [x] Implement comparison/consolidation helpers and an operator CLI accepting `--reference-base-url`, `--candidate-base-url`, and optional `--fail-on-diff`.
- [x] Map shared shell, Builder, Item Search, and shared dialog targets across all nine themes at 1280x720 and 375x667.
- [x] Add `npm run audit:ui-parity -- --reference-base-url=... --candidate-base-url=...` and document output and exit behavior.
- [x] Re-run focused Node tests and a local CLI smoke check.

### Task 4: Changelog and complete verification

**Files:**
- Modify: `CHANGELOG.md`

- [x] Describe the restored modal scrolling and compact, aligned Builder rows in player-facing language.
- [x] Run focused Node and Playwright tests, the full Node/Playwright gates, CSS lint/build checks, audit checks, and `git diff --check`.
- [x] Review the final diff for unrelated changes, secrets, generated artifacts, and the user-owned `docker-compose-prod.yaml`.
- [x] Commit the verified slice; do not push or deploy without new authorization.
