# LegendHUB 3.1 Email Identity and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unique verified email identity, username-or-email login, secure email changes, and password recovery without locking out existing accounts.

**Architecture:** Add nullable email metadata and hashed account-action tokens through an additive MySQL 5.7 migration. Put normalization, token generation, transactions, mail delivery, and account actions behind focused CommonJS services; keep GraphQL resolvers and Express pages as thin adapters. Grandfathered members retain existing access, while verified email gates the later account-storage phase.

**Tech Stack:** Node.js 22 CommonJS, Express 5, GraphQL 16, MySQL 5.7, React 19, Nodemailer SMTP, Node test runner, Playwright/axe.

**Spec:** `docs/superpowers/specs/2026-08-26-v31-account-storage-design.md`

## Global Constraints

- Existing members without email retain every pre-3.1 capability.
- New registration requires a case-insensitively unique email.
- Only verified email may be used for login, recovery, or account storage.
- Email normalization is trim plus lowercase only; do not apply provider-specific dot or plus rules.
- Verification tokens expire after 24 hours; recovery tokens expire after one hour.
- Password recovery invalidates every login session and does not auto-login the reset browser.
- Raw tokens, passwords, email addresses, SMTP credentials, and Builder payloads must never be logged.
- Database changes must be additive and remain readable by the v3.0 application.
- MySQL runtime compatibility is 5.7.44.
- Do not modify root `docker-compose-prod.yaml`; production configuration remains maintainer-owned.
- Update root `CHANGELOG.md` with player-facing language before completing this phase.

## File Structure

- `www/src/routes/api/migrations/8.js`: state-aware additive email/action-token schema migration.
- `www/src/routes/api/database.js`: Promise query and transaction boundary shared by account services.
- `www/src/routes/api/email-address.js`: email validation and normalization.
- `www/src/routes/api/account-action-token.js`: selector/validator creation, parsing, hashing, and expiry constants.
- `www/src/routes/api/account-rate-limit.js`: database-backed delivery throttling.
- `www/src/mail.js`: validated SMTP configuration and purpose-specific mail delivery.
- `www/src/routes/api/account-email-service.js`: email status, registration claims, resend, change, and verification.
- `www/src/routes/api/password-recovery-service.js`: generic recovery request and atomic reset.
- `www/src/routes/api/auth.js`: username-or-email login and email-required registration GraphQL fields.
- `www/src/routes/api/account.js`: protected account email GraphQL fields.
- `www/src/routes/account-actions.js`: same-origin HTML verification, resend, recovery, and prompt-dismiss routes.
- `www/src/views/login.ejs`: email registration field and username-or-email copy.
- `www/src/views/account-actions/*.ejs`: verification and password-recovery pages.
- `www/client/features/account/*`: email editor API, reducer, and accessible UI.
- `www/src/views/shared/emailVerificationPrompt.ejs`: grandfathered-account prompt.
- `www/test/*email*.test.js`, `www/test/password-recovery.test.js`: service, route, and schema coverage.
- `www/accessibility/account-email.spec.js`: keyboard and assistive-technology journeys.

---

### Task 1: Add the additive email and action-token schema

**Files:**
- Create: `www/src/routes/api/migrations/8.js`
- Create: `www/test/account-email-migration.test.js`
- Modify: `www/test/migrations.integration.test.js`

**Interfaces:**
- Produces: nullable `Members.Email`, `Members.NormalizedEmail`, `Members.EmailVerifiedOn`, `Members.PendingEmail`, `Members.PendingNormalizedEmail`, and unique `Members.StorageNamespace`.
- Produces: `AccountActionTokens` and `AccountActionAttempts` tables consumed by Tasks 3–7.
- Consumes: migration context `{query(operation, sql, values): Promise<results>}` from `migrations.js`.

- [ ] **Step 1: Write failing migration contract tests**

```js
test("email migration declares recoverable non-transactional DDL", async function() {
    const migration = require("../src/routes/api/migrations/8");
    assert.equal(migration.mode, "non-transactional");
    assert.equal(typeof migration.up, "function");
    assert.equal(typeof migration.verify, "function");
});

test("email migration creates every column, index, and action table", async function() {
    const context = createSchemaContext();
    await migration.up(context);
    assert.deepEqual(context.memberColumns(), [
        "Email", "EmailVerifiedOn", "NormalizedEmail",
        "PendingEmail", "PendingNormalizedEmail", "StorageNamespace"
    ]);
    assert.deepEqual(context.tables(), ["AccountActionAttempts", "AccountActionTokens"]);
    assert.equal(await migration.verify(context), true);
});
```

- [ ] **Step 2: Run the tests and verify the missing migration failure**

Run: `node --test test/account-email-migration.test.js` from `www/`
Expected: FAIL with `Cannot find module '../src/routes/api/migrations/8'`.

- [ ] **Step 3: Implement state-aware MySQL 5.7 DDL**

Use `mode = "non-transactional"`. Make `up(context)` query
`information_schema` before each `ALTER` or `CREATE`, so a partial DDL run is
safe to retry. The target schema is:

```sql
ALTER TABLE Members
  ADD COLUMN Email VARCHAR(254) NULL,
  ADD COLUMN NormalizedEmail VARCHAR(254) NULL,
  ADD COLUMN EmailVerifiedOn DATETIME NULL,
  ADD COLUMN PendingEmail VARCHAR(254) NULL,
  ADD COLUMN PendingNormalizedEmail VARCHAR(254) NULL,
  ADD COLUMN StorageNamespace CHAR(32) CHARACTER SET ascii NULL;

CREATE UNIQUE INDEX UX_Members_NormalizedEmail
  ON Members (NormalizedEmail);
CREATE UNIQUE INDEX UX_Members_PendingNormalizedEmail
  ON Members (PendingNormalizedEmail);
CREATE UNIQUE INDEX UX_Members_StorageNamespace
  ON Members (StorageNamespace);

CREATE TABLE AccountActionTokens (
  Id BIGINT NOT NULL AUTO_INCREMENT,
  MemberId INT NOT NULL,
  Purpose VARCHAR(32) CHARACTER SET ascii NOT NULL,
  Selector CHAR(12) CHARACTER SET ascii NOT NULL,
  HashedValidator CHAR(64) CHARACTER SET ascii NOT NULL,
  PendingEmail VARCHAR(254) NULL,
  PendingNormalizedEmail VARCHAR(254) NULL,
  RequestIPHash CHAR(40) CHARACTER SET ascii NOT NULL,
  CreatedOn DATETIME NOT NULL,
  ExpiresOn DATETIME NOT NULL,
  ConsumedOn DATETIME NULL,
  PRIMARY KEY (Id),
  UNIQUE KEY UX_AccountActionTokens_Selector (Selector),
  KEY IX_AccountActionTokens_MemberPurpose (MemberId, Purpose, CreatedOn),
  KEY IX_AccountActionTokens_Expiry (ExpiresOn),
  CONSTRAINT FK_AccountActionTokens_Members
    FOREIGN KEY (MemberId) REFERENCES Members (Id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE AccountActionAttempts (
  Id BIGINT NOT NULL AUTO_INCREMENT,
  Purpose VARCHAR(32) CHARACTER SET ascii NOT NULL,
  IdentityHash CHAR(64) CHARACTER SET ascii NOT NULL,
  RequestIPHash CHAR(40) CHARACTER SET ascii NOT NULL,
  CreatedOn DATETIME NOT NULL,
  PRIMARY KEY (Id),
  KEY IX_AccountActionAttempts_Identity (Purpose, IdentityHash, CreatedOn),
  KEY IX_AccountActionAttempts_IP (Purpose, RequestIPHash, CreatedOn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Populate existing `StorageNamespace` values in batches with
`LOWER(HEX(RANDOM_BYTES(16)))`, then make the column `NOT NULL`. `verify()`
must assert all six columns, three unique indexes, both tables, and zero null
storage namespaces.

- [ ] **Step 4: Run unit and optional MySQL integration verification**

Run: `node --test test/account-email-migration.test.js test/migrations.test.js`
Expected: PASS.

When the dedicated migration database is configured, run:
`MYSQL_MIGRATION_INTEGRATION=1 node --test test/migrations.integration.test.js`
Expected: migration 8 reaches its verified state on MySQL 5.7 and succeeds on a second run.

- [ ] **Step 5: Commit the schema**

```bash
git add www/src/routes/api/migrations/8.js www/test/account-email-migration.test.js www/test/migrations.integration.test.js
git commit -m "feat: add account email schema"
```

---

### Task 2: Add transaction, email, and token primitives

**Files:**
- Create: `www/src/routes/api/database.js`
- Create: `www/src/routes/api/email-address.js`
- Create: `www/src/routes/api/account-action-token.js`
- Create: `www/test/database.test.js`
- Create: `www/test/email-address.test.js`
- Create: `www/test/account-action-token.test.js`
- Modify: `www/src/routes/api/utils.js`
- Modify: `www/test/api-utils.test.js`

**Interfaces:**
- Produces: `query(executor, sql, values = []) -> Promise<results>`.
- Produces: `withTransaction(pool, operation) -> Promise<T>` where `operation(connection)` commits on success, rolls back on failure, and always releases.
- Produces: `normalizeEmail(value) -> {display, normalized}`; throws `BadRequestError` for empty, over-254-byte, or malformed input.
- Produces: `createActionToken({randomBytes, now, lifetimeMs}) -> {selector, validator, token, hashedValidator, expiresOn}`.
- Produces: `parseActionToken(token) -> {selector, validator}` and `hashValidator(validator)`.
- Produces: `BadRequestError` (400), `ConflictError` (409), and `PayloadTooLargeError` (413) from `api/utils.js`.

- [ ] **Step 1: Write failing primitive tests**

```js
test("email normalization is provider-neutral", function() {
    assert.deepEqual(normalizeEmail("  Player+Work@Example.COM  "), {
        display: "Player+Work@Example.COM",
        normalized: "player+work@example.com"
    });
    assert.throws(() => normalizeEmail("not-an-address"), /valid email/);
});

test("action tokens store only a validator hash", function() {
    const result = createActionToken({
        randomBytes: size => Buffer.alloc(size, 7),
        now: new Date("2026-08-26T12:00:00Z"),
        lifetimeMs: 60 * 60 * 1000
    });
    assert.equal(result.token, `${result.selector}-${result.validator}`);
    assert.equal(result.hashedValidator, hashValidator(result.validator));
    assert.equal(result.expiresOn.toISOString(), "2026-08-26T13:00:00.000Z");
});
```

- [ ] **Step 2: Run the primitive tests and verify missing-module failures**

Run: `node --test test/database.test.js test/email-address.test.js test/account-action-token.test.js test/api-utils.test.js`
Expected: FAIL on the three new module imports.

- [ ] **Step 3: Implement the exact primitives**

```js
function normalizeEmail(value) {
    const display = typeof value === "string" ? value.trim() : "";
    if (Buffer.byteLength(display, "utf8") > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(display)) {
        throw new BadRequestError("Enter a valid email address.");
    }
    return {display, normalized: display.toLowerCase()};
}

function createActionToken(options = {}) {
    const random = options.randomBytes || crypto.randomBytes;
    const selector = random(6).toString("hex");
    const validator = random(24).toString("hex");
    const expiresOn = new Date((options.now || new Date()).getTime() + options.lifetimeMs);
    return {
        selector, validator, expiresOn,
        token: `${selector}-${validator}`,
        hashedValidator: hashValidator(validator)
    };
}
```

`withTransaction` must use `pool.getConnection`, `beginTransaction`,
`commit`, `rollback`, and `release`; preserve both operation and rollback
errors with `AggregateError`.

- [ ] **Step 4: Run primitive and existing authentication tests**

Run: `node --test test/database.test.js test/email-address.test.js test/account-action-token.test.js test/api-utils.test.js test/account-characterization.test.js`
Expected: PASS.

- [ ] **Step 5: Commit the shared boundaries**

```bash
git add www/src/routes/api/database.js www/src/routes/api/email-address.js www/src/routes/api/account-action-token.js www/src/routes/api/utils.js www/test/database.test.js www/test/email-address.test.js www/test/account-action-token.test.js www/test/api-utils.test.js
git commit -m "feat: add account action primitives"
```

---

### Task 3: Add rate-limited SMTP delivery

**Files:**
- Create: `www/src/mail.js`
- Create: `www/src/routes/api/account-rate-limit.js`
- Create: `www/test/mail.test.js`
- Create: `www/test/account-rate-limit.test.js`
- Modify: `www/package.json`
- Modify: `www/package-lock.json`
- Modify: `.env_example`
- Modify: `docker-compose.yaml`
- Modify: `docker-compose.local.yaml`
- Modify: `www/src/app.js`
- Modify: `www/test/startup.test.js`

**Interfaces:**
- Produces: `readMailConfig(environment) -> {host, port, secure, auth, from, baseUrl}` with no secret-bearing error strings.
- Produces: `createMailer({transport, config})` with `sendVerification`, `sendEmailChanged`, `sendPasswordReset`, and `sendPasswordChanged`.
- Produces: `createAccountRateLimiter({pool, clock})` with `recordAndCheck({purpose, identity, ipHash})`.
- Rate defaults: one delivery per identity per 60 seconds, five per identity per hour, and twenty per IP per hour.

- [ ] **Step 1: Write failing mail and rate-limit tests**

```js
test("verification mail contains the public HTTPS link without logging its token", async function() {
    const sent = [];
    const mailer = createMailer({
        transport: {sendMail: async message => sent.push(message)},
        config: {from: "LegendHUB <noreply@example.com>", baseUrl: "https://legendhub.org"}
    });
    await mailer.sendVerification({to: "player@example.com", username: "Player", token: "selector-validator"});
    assert.match(sent[0].text, /https:\/\/legendhub\.org\/verify-email\.html\?token=selector-validator/);
    assert.doesNotMatch(JSON.stringify(sent[0]), /SMTP_PASSWORD/);
});

test("rate limiter blocks the second delivery inside sixty seconds", async function() {
    await limiter.recordAndCheck(input);
    await assert.rejects(limiter.recordAndCheck(input), error => error.extensions.code === 429);
});
```

- [ ] **Step 2: Install Nodemailer and verify the red tests**

Run: `npm install nodemailer@^7.0.0` from `www/`.
Run: `node --test test/mail.test.js test/account-rate-limit.test.js test/startup.test.js`.
Expected: FAIL because `mail.js` and `account-rate-limit.js` do not exist.

- [ ] **Step 3: Implement validated mail configuration and database throttling**

Require these variables in production: `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `APP_BASE_URL`.
Accept an injected transport in tests. Construct messages with fixed subjects
and text/HTML bodies; never pass a logger to Nodemailer.

```js
const LIMITS = Object.freeze({minimumMs: 60_000, identityPerHour: 5, ipPerHour: 20});

async function recordAndCheck({purpose, identity, ipHash}) {
    const identityHash = crypto.createHash("sha256").update(identity).digest("hex");
    return withTransaction(pool, async connection => {
        const counts = await readCountsForUpdate(connection, purpose, identityHash, ipHash, clock());
        if (counts.withinMinute || counts.identityHour >= 5 || counts.ipHour >= 20)
            throw new TooManyRequestsError("Try again later.");
        await query(connection, INSERT_ATTEMPT, [purpose, identityHash, ipHash, clock()]);
    });
}
```

Validate mail configuration during `start()` before migrations/listen. Add the
seven variables to `.env_example` and pass them only to the `www` service in
tracked Compose files. Local tests inject a fake transport rather than adding
a credential-logging mode.

Require an HTTPS `APP_BASE_URL` in production. During each accepted rate-limit
write, delete `AccountActionAttempts` older than 24 hours; during token
creation or consumption, delete consumed or expired action tokens older than
24 hours. Cover both cleanup statements with clock-controlled tests.

- [ ] **Step 4: Run mail, startup, Compose, and secret-hygiene tests**

Run: `node --test test/mail.test.js test/account-rate-limit.test.js test/startup.test.js ../scripts/test/local-compose.test.js` from `www/`.
Expected: PASS, and no assertion output contains SMTP credentials or message tokens.

- [ ] **Step 5: Commit mail delivery**

```bash
git add www/src/mail.js www/src/routes/api/account-rate-limit.js www/test/mail.test.js www/test/account-rate-limit.test.js www/test/startup.test.js www/package.json www/package-lock.json .env_example docker-compose.yaml docker-compose.local.yaml www/src/app.js
git commit -m "feat: add secure account email delivery"
```

---

### Task 4: Require email registration and allow username-or-email login

**Files:**
- Create: `www/src/routes/api/account-email-service.js`
- Create: `www/test/account-email-service.test.js`
- Modify: `www/src/routes/api/auth.js`
- Modify: `www/src/routes/auth.js`
- Modify: `www/src/routes/index.js`
- Modify: `www/src/views/login.ejs`
- Modify: `www/test/account-characterization.test.js`
- Modify: `www/test/request-security.test.js`
- Modify: `www/test/auth-logging.test.js`

**Interfaces:**
- Produces: `createAccountEmailService({pool, mailer, rateLimiter, clock, randomBytes})`.
- Produces: `register({username, email, passwordHash, recaptchaVerified, ipHash}) -> {registered: true}`.
- Produces: authenticated user fields `email`, `emailVerified`, `pendingEmail`, and `storageNamespace`.
- `authLogin` accepts `identity`; retain optional `username` GraphQL input for backward compatibility and resolve `identity || username`.

- [ ] **Step 1: Extend characterization tests first**

```js
test("login accepts a verified normalized email but rejects pending email", async function() {
    const auth = loadAuthApi(mysqlWithMembers([
        {Id: 7, Username: "Player", NormalizedEmail: "player@example.com", EmailVerifiedOn: new Date(), Password: hash, Banned: 0}
    ]));
    assert.ok(await auth.utils.authLogin(" PLAYER@EXAMPLE.COM ", password, false, "ip"));
    await assert.rejects(auth.utils.authLogin("pending@example.com", password, false, "ip"), /Invalid username or password/);
});

test("registration requires email and stores an unverified account", async function() {
    const result = await register({username: "Player", email: "Player@example.com", password: "long-password", recaptcha: "ok"});
    assert.equal(result, true);
    assert.equal(insertedMember.NormalizedEmail, "player@example.com");
    assert.equal(insertedMember.EmailVerifiedOn, null);
});
```

- [ ] **Step 2: Run targeted auth tests and observe contract failures**

Run: `node --test test/account-characterization.test.js test/account-email-service.test.js test/request-security.test.js test/auth-logging.test.js`
Expected: FAIL because registration has no email argument and login only queries `Username`.

- [ ] **Step 3: Implement registration and identity lookup**

Use a MySQL named lock derived from `SHA2(normalizedEmail, 256)` for every
registration or pending-email claim. Inside one transaction:

```sql
SELECT Id FROM Members
WHERE NormalizedEmail = ? OR PendingNormalizedEmail = ?
FOR UPDATE;

INSERT INTO Members
  (Username, Password, Email, NormalizedEmail, EmailVerifiedOn, StorageNamespace)
VALUES (?, ?, ?, ?, NULL, ?);
```

Insert role and notification rows, create a `verify-email` token, commit, then
send mail. A mail failure leaves the member pending and returns registration
success plus resend guidance.

Login must choose one parameterized query path: username when the trimmed
identity lacks `@`; otherwise normalized verified email. Keep the public error
exactly `Invalid username or password.`. Extend `authToken`'s member select and
response with the four account-status fields without logging them.

Update the form label to **Username or email**, add required
`register_email` with `autocomplete="email"`, and preserve entered username
and email after validation errors using escaped EJS output.

- [ ] **Step 4: Run auth, route-security, and login-page tests**

Run: `node --test test/account-characterization.test.js test/account-email-service.test.js test/request-security.test.js test/auth-logging.test.js test/characterization.test.js`
Expected: PASS.

- [ ] **Step 5: Commit registration and login**

```bash
git add www/src/routes/api/account-email-service.js www/src/routes/api/auth.js www/src/routes/auth.js www/src/routes/index.js www/src/views/login.ejs www/test/account-email-service.test.js www/test/account-characterization.test.js www/test/request-security.test.js www/test/auth-logging.test.js www/test/characterization.test.js
git commit -m "feat: add verified email identity"
```

---

### Task 5: Add verification, resend, email change, and the account editor

**Files:**
- Create: `www/src/routes/account-actions.js`
- Create: `www/src/views/account-actions/verify-email.ejs`
- Create: `www/src/views/account-actions/action-result.ejs`
- Create: `www/test/account-actions.test.js`
- Modify: `www/src/create-app.js`
- Modify: `www/src/routes/api/account-email-service.js`
- Modify: `www/src/routes/api/account.js`
- Modify: `www/src/routes/account.js`
- Modify: `www/src/views/account/index.ejs`
- Modify: `www/client/features/account/account-api.js`
- Modify: `www/client/features/account/account-reducer.js`
- Modify: `www/client/features/account/AccountSettings.jsx`
- Modify: `www/test/client/account-reducer.test.js`
- Modify: `www/test/account-characterization.test.js`

**Interfaces:**
- Produces: `getAccountEmailStatus(auth) -> {email, verified, pendingEmail, canUseAccountStorage}`.
- Produces: `requestEmailChange({auth, currentPassword, email, ipHash})` and `resendVerification({auth, ipHash})`.
- Produces: `verifyEmailToken(token) -> {success, message}`; token consumption and email promotion are atomic.
- Account React props gain `emailStatus` matching the server return shape.

- [ ] **Step 1: Write failing service, route, and reducer tests**

```js
test("email change keeps the verified address active until token verification", async function() {
    await service.requestEmailChange({auth, currentPassword: "secret", email: "new@example.com", ipHash: "ip"});
    assert.equal(member.Email, "old@example.com");
    assert.equal(member.PendingNormalizedEmail, "new@example.com");
    await service.verifyEmailToken(deliveredToken);
    assert.equal(member.Email, "new@example.com");
    assert.equal(member.PendingEmail, null);
    assert.ok(member.EmailVerifiedOn);
});

test("email editor clears the password after success and returns to viewing", async function() {
    let state = createInitialAccountState(settings, emailStatus);
    state = accountReducer(state, {type: "email/edit"});
    state = accountReducer(state, {type: "email/change", field: "password", value: "secret"});
    state = accountReducer(state, {type: "email/save-succeeded", pendingEmail: "new@example.com"});
    assert.equal(state.emailEditor.password, "");
    assert.equal(state.emailEditor.status, "viewing");
});
```

- [ ] **Step 2: Run targeted tests and verify missing flow failures**

Run: `node --test test/account-email-service.test.js test/account-actions.test.js test/account-characterization.test.js test/client/account-reducer.test.js`
Expected: FAIL on missing methods, routes, and reducer state.

- [ ] **Step 3: Implement the verified account flow**

`requestEmailChange` must verify the current password, claim the normalized
address under the same named email lock used by registration, store pending
fields, invalidate earlier change tokens, create a 24-hour token, commit, and
then send. `verifyEmailToken` must lock the token/member rows, compare the
validator with `crypto.timingSafeEqual`, reject expired/consumed tokens,
promote the pending address, clear pending fields, consume sibling tokens,
commit, and notify the old verified address.

The email link opens `GET /verify-email.html?token=...`, which renders a
confirmation form. `POST /verify-email.html` uses `requireSameOrigin` and
consumes the token; scanners cannot consume a GET request. The account API
returns structured status and mutations; the React editor uses current focus
management, `aria-live`, and never retains the current password after a
request finishes.

- [ ] **Step 4: Run account API, client, and CSRF tests**

Run: `node --test test/account-email-service.test.js test/account-actions.test.js test/account-characterization.test.js test/request-security.test.js test/client/account-reducer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit verification and account email settings**

```bash
git add www/src/routes/account-actions.js www/src/views/account-actions/verify-email.ejs www/src/views/account-actions/action-result.ejs www/src/create-app.js www/src/routes/api/account-email-service.js www/src/routes/api/account.js www/src/routes/account.js www/src/views/account/index.ejs www/client/features/account/account-api.js www/client/features/account/account-reducer.js www/client/features/account/AccountSettings.jsx www/test/account-actions.test.js www/test/account-email-service.test.js www/test/account-characterization.test.js www/test/client/account-reducer.test.js www/test/request-security.test.js
git commit -m "feat: verify and manage account email"
```

---

### Task 6: Add password recovery and session invalidation

**Files:**
- Create: `www/src/routes/api/password-recovery-service.js`
- Create: `www/src/views/account-actions/forgot-password.ejs`
- Create: `www/src/views/account-actions/reset-password.ejs`
- Create: `www/test/password-recovery.test.js`
- Modify: `www/src/routes/api/auth.js`
- Modify: `www/src/routes/account-actions.js`
- Modify: `www/src/views/login.ejs`
- Modify: `www/test/account-actions.test.js`
- Modify: `www/test/auth-logging.test.js`

**Interfaces:**
- Produces: `requestRecovery({identity, ipHash}) -> {accepted: true}` for every syntactically valid request.
- Produces: `resetPassword({token, newPassword}) -> {success: true}`.
- Public GraphQL mutations: `requestPasswordRecovery(identity: String!): Boolean!` and `resetPassword(token: String!, newPassword: String!): Boolean!`.

- [ ] **Step 1: Write failing recovery tests**

```js
test("recovery response is identical for missing and verified accounts", async function() {
    assert.deepEqual(await service.requestRecovery({identity: "missing@example.com", ipHash: "a"}), {accepted: true});
    assert.deepEqual(await service.requestRecovery({identity: "player@example.com", ipHash: "b"}), {accepted: true});
    assert.equal(sent.length, 1);
});

test("reset consumes the token and invalidates all sessions atomically", async function() {
    await service.resetPassword({token, newPassword: "replacement-password"});
    assert.equal(authTokensForMember.length, 0);
    await assert.rejects(service.resetPassword({token, newPassword: "second-password"}), /invalid or expired/i);
});
```

- [ ] **Step 2: Run recovery tests and verify missing service failures**

Run: `node --test test/password-recovery.test.js test/account-actions.test.js test/auth-logging.test.js`
Expected: FAIL because the recovery service and views do not exist.

- [ ] **Step 3: Implement generic request and atomic reset**

Lookup by username or normalized verified email. Record/rate-limit every
syntactically valid request before revealing no account state. For a verified
member, invalidate earlier reset tokens, create a one-hour token, commit, and
send the message.

Inside one reset transaction:

```sql
SELECT T.*, M.Id AS MemberId
FROM AccountActionTokens T
JOIN Members M ON M.Id = T.MemberId
WHERE T.Selector = ? AND T.Purpose = 'password-reset'
FOR UPDATE;

UPDATE Members SET Password = ? WHERE Id = ?;
DELETE FROM AuthTokens WHERE MemberId = ?;
UPDATE AccountActionTokens SET ConsumedOn = NOW()
WHERE Id = ? AND ConsumedOn IS NULL;
```

Validate the password with the existing minimum policy, use timing-safe token
comparison, commit before sending the password-changed notice, and never issue
a login token. Add same-origin GET/form/POST pages and the **Forgot password?**
link.

- [ ] **Step 4: Run recovery, session, route, and log-hygiene tests**

Run: `node --test test/password-recovery.test.js test/account-actions.test.js test/account-characterization.test.js test/request-security.test.js test/auth-logging.test.js`
Expected: PASS.

- [ ] **Step 5: Commit recovery**

```bash
git add www/src/routes/api/password-recovery-service.js www/src/routes/api/auth.js www/src/routes/account-actions.js www/src/views/account-actions/forgot-password.ejs www/src/views/account-actions/reset-password.ejs www/src/views/login.ejs www/test/password-recovery.test.js www/test/account-actions.test.js www/test/account-characterization.test.js www/test/request-security.test.js www/test/auth-logging.test.js
git commit -m "feat: add secure password recovery"
```

---

### Task 7: Add the grandfathered-account prompt and phase gate

**Files:**
- Create: `www/src/views/shared/emailVerificationPrompt.ejs`
- Create: `www/accessibility/account-email.spec.js`
- Modify: `www/src/views/shared/header.ejs`
- Modify: `www/src/routes/account-actions.js`
- Modify: `www/src/routes/index.js`
- Modify: `www/src/routes/auth.js`
- Modify: `www/test/characterization.test.js`
- Modify: `www/test/request-security.test.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: session cookie `emailPromptDismissed=true`, cleared on successful login and logout.
- Produces: `res.locals.user.emailVerified` and `canUseAccountStorage` for Plan 2.

- [ ] **Step 1: Write failing prompt and accessibility assertions**

```js
test("grandfathered member sees a dismissible prompt after each login", async function() {
    const response = await renderAuthenticatedPage({emailVerified: false});
    assert.match(response.body, /Enter and verify your email address now/);
    assert.match(response.body, /action="\/dismiss-email-prompt"/);
});

test("verified member never sees the prompt", async function() {
    const response = await renderAuthenticatedPage({emailVerified: true});
    assert.doesNotMatch(response.body, /dismiss-email-prompt/);
});
```

- [ ] **Step 2: Run prompt tests and verify the absent-banner failure**

Run: `node --test test/characterization.test.js test/request-security.test.js`
Expected: FAIL because the prompt and dismiss route do not exist.

- [ ] **Step 3: Implement per-login dismissal and player-facing copy**

Render the prompt only when a member is logged in, email is unverified, and
the dismissal cookie is absent. Dismiss through a same-origin POST and set a
session cookie with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`. Clear
it on successful login and logout so a new login always prompts again.

Add player-friendly changelog entries for required new-account email,
verification, username-or-email login, secure email changes, grandfathered
prompts, and password recovery.

- [ ] **Step 4: Run the complete phase verification**

Run from `www/`:

```bash
npm test
npm run test:a11y -- --grep "email|verification|password recovery"
```

Run from the repository root:

```bash
node scripts/verify-release-version.js
git diff --check
```

Expected: all Node and selected accessibility tests pass; release version is
`3.1.0-beta`; diff check is clean.

- [ ] **Step 5: Commit the phase gate**

```bash
git add www/src/views/shared/emailVerificationPrompt.ejs www/src/views/shared/header.ejs www/src/routes/account-actions.js www/src/routes/index.js www/src/routes/auth.js www/accessibility/account-email.spec.js www/test/characterization.test.js www/test/request-security.test.js CHANGELOG.md
git commit -m "feat: complete email identity and recovery"
```

## Phase Completion Gate

Do not begin the account-storage backend plan until a reviewer confirms:

- Migration 8 is retry-safe on MySQL 5.7 and leaves v3.0 reads intact.
- Existing members can still log in without an email.
- New members cannot register without an email.
- Email login accepts only verified addresses.
- Verification and recovery tokens are hashed, expiring, single-use, and absent from logs.
- Password reset deletes every session in the same transaction.
- SMTP configuration is present in tracked test/development Compose without exposing values.
- All Task 7 verification commands pass.
