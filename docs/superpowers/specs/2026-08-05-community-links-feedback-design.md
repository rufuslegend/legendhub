# Community Links and Feedback Design

**Date:** 2026-08-05  
**Status:** Approved for implementation planning

## Context

LegendHUB still exposes links and integration identifiers from earlier project
owners. Visible and legacy repository links point to obsolete locations, the
homepage loads an unwanted Discord widget twice for responsive layouts, and
Vote links remain in both active and legacy navigation. The anonymous feedback
form still builds a GraphQL mutation with obsolete repository, label, and
assignee node IDs.

The maintained public repository is
`https://github.com/rufuslegend/legendhub`. GitHub Issues are enabled there,
the `triage` label exists, and website feedback should be assigned to the
`rufuslegend` account.

## Goals

- Point every LegendHUB repository and issue URL at
  `rufuslegend/legendhub`, including visible links, package metadata, README
  instructions, and retained legacy client templates.
- Remove every Vote link from active and legacy UI code.
- Stop rendering or loading the Discord widget while retaining its iframe
  source for a later code-level re-enable.
- Keep feedback available to visitors who do not have GitHub accounts.
- Create public GitHub Issues safely from valid feedback submissions, labeled
  `triage` and assigned to `rufuslegend`.
- Tell submitters before submission that their feedback will be public.

## Non-goals

- No runtime or environment-variable Discord toggle.
- No anonymous GitHub identity: issues are created by the account represented
  by the server's GitHub token.
- No replacement chat/community service.
- No broader homepage redesign.
- No release promotion, image publication, or test deployment. Those remain
  separate actions requiring explicit maintainer authorization.

## Homepage and Link Behavior

The home route will supply `showDiscordWidget: false` to the index view. Both
existing responsive Discord iframe blocks will remain in the EJS source behind
that condition. Because the condition is false during server rendering, the
iframe markup and Discord URL will not enter the response and the browser will
make no Discord request. Re-enabling the widget requires changing source code,
reviewing the change, and deploying a new release.

The active footer Vote link and the Vote link in the retained Angular template
cache will be removed. Repository links in the active footer, legacy issue
menu, README, and `www/package.json` will all use the new repository. A final
scoped search will ensure no obsolete LegendHUB repository URLs remain.

## Anonymous Feedback Flow

The `/feedback.html` form remains public and retains the existing reCAPTCHA v2
challenge. The form will state that the submitted title and body become
publicly visible in the LegendHUB GitHub repository.

After server-side input checks and successful reCAPTCHA verification, a small
GitHub Issues client will send a JSON request to:

```text
POST https://api.github.com/repos/rufuslegend/legendhub/issues
```

The payload will contain:

- the visitor-supplied title;
- a body identified as feedback submitted through the LegendHUB website;
- `labels: ["triage"]`;
- `assignees: ["rufuslegend"]`.

The client will use `GITHUB_REPOSITORY=rufuslegend/legendhub` rather than a
GraphQL repository node ID. `GITHUB_TOKEN` remains server-only and must have
permission to create Issues in that repository. Docker Compose will continue
passing both variables to the web service, while `.env_example` and durable
documentation will explain the new readable repository value and token
permission. Existing secret values will not be printed or committed.

The REST API and JSON serialization replace interpolated GraphQL. Quotes,
backslashes, and newlines in visitor input therefore remain data and cannot
change the API operation.

## Validation and Failure Handling

The server will reject missing or invalid required input before creating an
Issue. The HTML title limit will be backed by equivalent server-side
validation. reCAPTCHA failure will return the existing feedback error state
without contacting GitHub.

The GitHub client will require a successful HTTP response and a valid Issue URL
in the response body. Non-success responses, network failures, or malformed
responses will enter the application's existing error boundary and must never
render a false success. Error handling must not log or display the GitHub
token. The Issue URL on the success page will use escaped EJS output.

## Testing

Focused tests will cover:

- the homepage response omits Discord iframe markup and Discord URLs;
- Vote links are absent from active and retained legacy UI sources;
- all repository and issue links use `rufuslegend/legendhub`;
- invalid form data and failed reCAPTCHA never call GitHub;
- a valid submission sends the exact REST method, repository path, title,
  website-feedback body, `triage` label, and `rufuslegend` assignee;
- quotes, backslashes, and newlines remain ordinary JSON content;
- GitHub HTTP, network, and response-shape failures never report success;
- a valid response renders the escaped Issue URL.

The full web and deployment-script suites will run after focused tests. A
scoped stale-link search and `git diff --check` will complete verification.

## Release Record and Operations

These public-facing corrections will be added beneath the existing
`2.6.0-beta` entry in `CHANGELOG.md`. The package version and existing
`v2.6.0-beta` tag remain unchanged; the tag will never be moved, reused, or
deleted.

Implementation and local verification do not authorize image publication or a
test deployment. Either operation requires a separate explicit request from
the maintainer.
