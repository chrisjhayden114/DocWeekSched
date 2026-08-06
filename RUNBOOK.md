# RUNBOOK.md — Operations

Operational reference for Colloquium (working name; branding lives in `packages/config`).
Owner: Chris Hayden · cjhayden114@gmail.com · America/Los_Angeles.

Keep this file current: any session that changes operational behavior updates it
(same rule as /help articles — see `.cursor/rules/product.mdc`).

---

## 1. Architecture at a glance

| Piece | Where | Config |
|---|---|---|
| Web (Next.js 14, Pages Router, PWA) | Netlify | `netlify.toml` (`@netlify/plugin-nextjs`, Node 20) |
| API (Express + Prisma) | Render, service `docweeksched-api` | `render.yaml` (free plan, **single instance**) |
| Database (PostgreSQL) | Neon | `DATABASE_URL` |
| Background jobs | In-process poller inside the API (`BackgroundJob` table) | `JOB_POLL_INTERVAL_MS` (default 5s) |
| Health | `GET /health` liveness; `GET /health/ready` = DB `SELECT 1` + job-poller heartbeat | Point uptime monitors at `/health/ready` |

There is no separate worker process: stopping/restarting the API stops all jobs and interval loops.

## 2. Backups (Neon)

- **What exists:** Neon's built-in point-in-time restore (PITR). Every write is in the WAL
  history; you can create a branch of the database as of any timestamp inside the
  retention window. There is no separate nightly dump job yet (Phase S2 adds an
  automated weekly restore drill).
- **Retention window: 7 DAYS** (confirmed + set 2026-08-02; was 1 day). Neon console →
  Project → Settings → History window, slider set to 7d and saved. At current DB size
  (~0.2 GB data, ~0.01 GB history) the storage cost of the longer window is negligible.
  UI note (2026): time-travel branch creation moved — the Create-branch dialog makes
  current-point copies; point-in-time restore lives under **Backup & Restore** in the
  branch sidebar.
- **What is NOT covered:** anything outside Postgres. Object storage (if configured)
  and provider-side state (Lemon Squeezy orders, Resend logs) have their own retention.

## 3. Restore drill (do this before launch, then per S2 cadence)

An untested backup doesn't count. Procedure:

1. In the Neon console (or `neonctl`), create a **branch** from a point in time:
   `neonctl branches create --name drill-YYYYMMDD --parent main --timestamp <ISO>`.
2. Copy the branch connection string. Never paste it into a production service.
3. From `apps/api`, verify schema and data integrity against the branch:
   - `DATABASE_URL=<branch-url> npx prisma migrate status` → expect "Database schema is up to date".
   - Spot-check counts (psql or Prisma studio): `Event`, `User`, `Session`,
     `EventMembership`, `BackgroundJob` — compare against production expectations.
   - Optionally run the DB test suite against the branch. The destructive-DB guard
     (section 6) will refuse the Neon hostname; that refusal is working as designed —
     override deliberately for the disposable branch only:
     `DATABASE_URL=<branch-url> ALLOW_DESTRUCTIVE_DB=1 npm test`.
4. Record the drill (date, timestamp restored, checks run, result) below, then delete the branch.

| Date | Restored-to timestamp | Checks | Result |
|---|---|---|---|
| 2026-08-02 | current point (branch `restore-drill-2026-08-02`, auto-delete 1h) | SQL Editor on branch: `SELECT count(*) FROM "Event"` = 5 (matches prod: demo, Sample Academic Conference, QA Test Symposium, EDL DocWeek, Test); `SELECT count(*) FROM "User"` ran OK | **PASS** — full prod copy stood up and queried in <1 min via console (no CLI needed) |

## 4. Deploy

- **CI first:** `.github/workflows/ci.yml` runs lint + typecheck + unit tests, plus the
  full suite against a service Postgres, on every push. Wire deploys to green builds:
  Render → "Wait for CI to pass before deploying"; Netlify → branch protection requiring
  the `checks` and `db-tests` jobs (details in the workflow header comment).
- **Web:** push to the deploy branch → Netlify builds `apps/web` via the Next.js plugin.
- **API:** push → Render builds per `render.yaml` (`prisma generate && tsc`, starts `node dist/index.js`).
- **Migrations:** run `npm run prisma:deploy` (i.e. `prisma migrate deploy`) against production
  **before** the new API code that needs the schema goes live. Never `migrate dev` against prod.
  Never edit a migration that has already run.
- **Env changes:** Render/Netlify dashboards (secrets are `sync: false` in `render.yaml` —
  never committed). After changing env, restart the API service.
- Rollback: redeploy the previous commit from the Render/Netlify dashboard. Schema rollbacks
  are forward-fix only (write a new migration); PITR is the disaster path.

## 5. Background jobs & kill-switch map

All jobs run through the `BackgroundJob` poller. Retries: fixed 30s backoff up to
`maxAttempts` (default 3), then status `DEAD` (rows stay queryable — there is no separate DLQ).

| Job type | Purpose | Notes |
|---|---|---|
| `demo.event.reset` | Nightly (~03:00 UTC) wipe/reseed of the public demo event | Guarded: refuses unless the `demo` slug event belongs to the internal org; slug is reserved so customers can never claim it |
| `account.delete.hard` | GDPR hard delete after the 7-day grace | maxAttempts 5; legitimate in production |
| `ai.agenda_ingest` | Agenda ingest extraction | Metered via AI caps |
| `ai.matchmaker_join` / `ai.matchmaker_weekly` / `ai.matchmaker_weekly_sweep` | Matchmaker suggestions | Digest-class only |
| `ai.ops_detect_event` / `ai.ops_detect_sweep` | Ops Inbox detectors | Sweep enqueued every `OPS_DETECT_SWEEP_INTERVAL_MS` (default 5 min) |
| `certificates.batch_issue` | Batch certificate PDFs | Progress-polled |
| `recap.generate` | Post-event recap workspace | Idempotent regeneration |

Interval loops inside the API process (not `BackgroundJob` rows): push-queue flush +
"session starting soon" every `NOTIFICATION_JOB_INTERVAL_MS` (default 60s).

**Kill switches today (formal per-feature switches land in Phase S2):**

| To stop… | Do this |
|---|---|
| All jobs + intervals | Suspend/restart the API service (jobs resume from the table on boot) |
| One pending job | Set its row `status='DEAD'` (SQL) — this is exactly what deletion-cancel does |
| All AI features | `AI_PROVIDER=mock` (deterministic mock, no external calls) + restart |
| Email delivery | `EMAIL_PROVIDER=none` (UI falls back to copy-link) + restart |
| Web push | Unset `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY` + restart |
| Billing checkout | Unset the active provider's vars — Stripe (`STRIPE_*`) or Lemon Squeezy — (checkout returns unconfigured) + restart |
| Nightly demo reset | Mark the pending `demo.event.reset` row `DEAD`; note it reschedules on next API boot |

## 6. Destructive-DB guard (`apps/api/src/lib/destructiveGuard.ts`)

Protects against dev/test processes pointed at the production Neon URL. Enforced in:
the demo reset, `npm run seed:demo`, the account hard-delete job, and every
`*.db.test.ts` file (vitest setup).

- Production runtime (`NODE_ENV=production`) may run the demo reset and account
  deletions — those are legitimate. DB **tests** are never allowed outside
  local/test databases without an override.
- A `DATABASE_URL` counts as local/test when the host is loopback/`*.local`, or the
  host/database name contains `test`.
- Override: `ALLOW_DESTRUCTIVE_DB=1` — use only when you are certain the target is
  disposable (restore-drill branches, a personal Neon dev branch). **Running the DB
  test suite against a hosted dev database now requires this flag.**

## 7. Rate limiting — single-instance assumption

API rate limits (`apps/api/src/lib/rateLimit.ts`) are an **in-memory Map inside the
API process** — this covers both the per-IP route buckets and the per-account
(hashed email) login backoff. This is correct while the API runs as exactly one
instance (current Render setup). If the service is ever scaled to multiple
instances, limits become per-instance and effectively multiply — move to a shared
store (Postgres/Redis) before scaling out. A restart clears all limit/backoff state.
Buckets are keyed by route pattern (not concrete path) and by `req.ip` only
(`trust proxy 1`); expired buckets are pruned every few minutes.

## 8. Provider account list

| Provider | Used for | Env vars | Notes |
|---|---|---|---|
| Neon | Postgres + PITR | `DATABASE_URL` | Backup/restore path |
| Render | API hosting | dashboard-managed | Single instance (see §7) |
| Netlify | Web hosting | `NODE_VERSION` | Next.js plugin |
| Resend | Transactional email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Unset → copy-link fallback |
| Stripe | Billing (merchant of record via Managed Payments; current — supersedes LS) | `BILLING_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | Webhook: `/billing/webhooks/stripe`; webhooks are the entitlement source of truth |
| Lemon Squeezy | Billing (legacy MoR, provider still selectable) | `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_VARIANT_*` | Webhooks are the entitlement source of truth |
| Anthropic | AI gateway provider | `ANTHROPIC_API_KEY`, `AI_PROVIDER=anthropic` | `mock` = kill switch |
| S3/R2-compatible storage | Uploads (optional) | `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, … | Unset → data-URL fallback in Postgres |
| Web push (VAPID) | Self-generated keypair, no vendor account | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Rotating keys invalidates subscriptions |
| Sentry | Error tracking (API + web) | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_RELEASE` | Entirely off when DSN unset; listed in `brand.subprocessors` |

No-account dependencies: Google Fonts (CSS), `api.qrserver.com` (QR images).

## 9. "Someone else takes over" (skeleton — complete before launch)

Access needed: the provider dashboards above + GitHub repo + the domain registrar for
ukedl.com (and the post-rename domain). Escalation contacts, customer commitments, and
support-hours policy live in `packages/config` (`supportHours`) and the ToS. Expand this
chapter during the launch-checklist session.

## 10. Production environment reference

The API runs a preflight at boot when `NODE_ENV=production` (`apps/api/src/lib/env.ts`):
the **Fatal** rows below abort boot; the **Degraded** rows boot but log one loud
warning line each (`[preflight] …`). Full var-by-var documentation lives in the root
`.env.example`.

### Fatal — API refuses to boot

| Var | What breaks without it |
|---|---|
| `DATABASE_URL` | Everything (required in all environments) |
| `JWT_SECRET` | Everything — also rejected if `<16` chars or `dev-secret` |
| `WEB_BASE_URL` (non-localhost) | Emailed links, CORS allowlist, billing redirects would target localhost |
| `API_PUBLIC_URL` (non-localhost) | ICS calendar feed URLs would point at localhost |
| `COOKIE_SECURE=true` when `COOKIE_SAMESITE=none` | Browsers drop the session cookie entirely |

### Degraded — boots with a warning

| Var(s) | What breaks without it |
|---|---|
| `RESEND_API_KEY` (+ `RESEND_FROM_EMAIL`) | No email: invites, password reset, verification, CFP + decision emails all fall back to copy-link in the UI |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (+ `VAPID_SUBJECT`) | Web push disabled; notification delivery is inbox-only |
| With `BILLING_PROVIDER=stripe`: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_PER_EVENT_250/500/1000` + `STRIPE_PRICE_PRO_MONTHLY` + `STRIPE_PRICE_PRO_ANNUAL` | Billing checkout/portal return 503; no paid upgrades; Stripe webhooks (entitlement source of truth) never verify |
| Without `BILLING_PROVIDER=stripe`: `LEMONSQUEEZY_API_KEY` + `LEMONSQUEEZY_STORE_ID` + `LEMONSQUEEZY_WEBHOOK_SECRET` + `LEMONSQUEEZY_VARIANT_*` | Billing checkout/portal return 503; no paid upgrades; webhooks (entitlement source of truth) never arrive |
| `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` | All agents (agenda ingest, concierge, matchmaker, ops inbox, recap) return deterministic mock output |
| `STORAGE_BUCKET` + `STORAGE_ACCESS_KEY_ID` + `STORAGE_SECRET_ACCESS_KEY` | Uploads (session resources, maps, photos, CFP attachments) stored as data-URLs in Postgres — works but bloats rows and backups |

### Expected but not preflighted

| Var(s) | What breaks without it |
|---|---|
| `ADMIN_INVITE_CODE` | Anyone could self-register as admin via the invite-code path |
| `COOKIE_DOMAIN=.ukedl.com` | Cookies pinned to exact API host; web↔api same-site setup breaks |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | No error tracking (SDKs stay inert) |
| `SENTRY_RELEASE` / `NEXT_PUBLIC_SENTRY_RELEASE` | Errors not attributable to a deploy (Render's `RENDER_GIT_COMMIT` is the API fallback) |
| Job intervals (`JOB_POLL_INTERVAL_MS`, `JOB_POLL_STALE_MS`, `NOTIFICATION_JOB_INTERVAL_MS`, `OPS_DETECT_SWEEP_INTERVAL_MS`) | Defaults are fine; only tune with a reason |
| Product tuning (`NOTIFICATION_DAILY_PUSH_BUDGET`, `WAITLIST_SEAT_HOLD_HOURS`, `ANNOUNCEMENT_EMAIL_RATE_PER_HOUR`) | Defaults 5 / 24h / 3 per hour |
| `ALLOW_DESTRUCTIVE_DB` | Must **never** be set in production (see §6) |

---

## 9. Running the database test suites

**Why this exists.** About 24 `*.db.test.ts` files have never been executed on
this machine. They contain the multi-tenancy and authorization assertions — e.g.
`sessionsBulkAssign.db.test.ts` proves an attendee is rejected at the guard and
that sessions from another event cannot be bulk-assigned. That test was written
*because* a real cross-tenant hole was found in chunk E13. A security property
asserted only by reading code is how the original hole survived.

The destructive guard (`apps/api/src/lib/destructiveGuard.ts`) refuses to run
them unless `DATABASE_URL` looks local or test-only. **Never set
`ALLOW_DESTRUCTIVE_DB` to work around this** — give it a database that is
genuinely disposable instead.

### The guard's actual rule

It accepts the database when **any** of these is true:
- host is `localhost` / `127.0.0.1` / `::1` / `0.0.0.0`
- host ends in `.local` or `.localhost`
- **host contains `test`**
- **database name matches `test$` or `_test_`** — e.g. `ukedl_test`

Nothing else passes.

### One-time setup (Neon, no local installs needed)

1. Neon console → **Branches** → **New branch**. Name it `test`, parent `main`.
   This is a disposable branch; it may be reset or deleted at any time.
2. Inside that branch → **Databases** → **New database** → name it exactly
   **`ukedl_test`**. The name is what satisfies the guard.
3. Copy the **direct / unpooled** connection string for that database. It must
   end `/ukedl_test?sslmode=require`. Use the unpooled one — the pooler causes
   `P1002` advisory-lock failures during migrations.
4. Apply the schema (schema.prisma reads `DATABASE_URL`; there is no
   `directUrl`, so the direct string goes here):

```bash
cd ~/Documents/DocWeekSched/apps/api && \
  DATABASE_URL="<direct ukedl_test url>" npx prisma migrate deploy
```

### Running the suites

`dotenv.config()` in the test setup does **not** override variables already set
in the environment, so an inline `DATABASE_URL` wins. No `.env.test`, no new npm
script.

One suite:
```bash
cd ~/Documents/DocWeekSched/apps/api && \
  DATABASE_URL="<direct ukedl_test url>" npx vitest run src/__tests__/sessionsBulkAssign.db.test.ts
```

All of them:
```bash
cd ~/Documents/DocWeekSched/apps/api && \
  DATABASE_URL="<direct ukedl_test url>" npx vitest run
```

### Skip-vs-fail rule (FIX_PLAN E22)

A skipped DB suite must not report success. The rule is implemented once, in
`vitest.config.ts` + `src/__tests__/setup/dbPreflight.setup.ts` — individual
test files contain no skip logic and cannot opt themselves out.

- **`DATABASE_URL` unset** → every `*.db.test.ts` suite is skipped, with a
  one-line notice at the start **and end** of the run. Unit tests need no
  database (an inert placeholder satisfies `env.ts`'s import-time check).
- **`DATABASE_URL` set** → DB tests were requested. If the host is
  unreachable, auth is rejected, or migrations are missing, every DB suite
  **fails** with a message naming the target and the real cause ("run
  `npx prisma migrate deploy`" is distinguished from "server unreachable").

### Safety notes

- The connection string contains a password. Do **not** paste it into a file that
  git tracks. `.env` and `.env.local` are ignored; a new `.env.test` would **not**
  be — add it to `.gitignore` first if you ever create one.
- These suites `deleteMany` fixture rows and some call `resetPublicDemoEvent()` /
  `hardDeleteUserAccount()`. That is exactly why they must never point at `main`.
- If a run leaves the test branch in a bad state, delete the Neon branch and
  recreate it. It holds nothing of value.
- After running, close the terminal or start a fresh one, so the test
  `DATABASE_URL` does not linger in that shell's environment.

### Log

| Date | Suites run | Result | Notes |
|---|---|---|---|
| 2026-08-03 | All (58 files, 374 tests) | **373 pass / 1 fail** | First execution ever. Only failure: `recap.db.test.ts` "4–7) …certs stable" — **flaky, not a real defect**. Re-run of that file alone passed (8.2s vs 2.1s under parallel load). See FIX_PLAN E20. |
| 2026-08-03 | `sessionsBulkAssign.db.test.ts` | 7/7 pass | Multi-tenancy: attendee rejected at guard, cross-event session and track ids rejected. First execution of the assertions written after the E13 cross-tenant finding. |
| 2026-08-03 | All, ×3 consecutive (E20 acceptance) | **374/374 pass, three times** | Flakiness resolved. Run 3's recap test took **64s** vs 4s in run 2 — the new drain waited through a long job delay instead of giving up, which is exactly the failure mode E20 fixed. |
| 2026-08-03 | All, with a deliberately invalid `DATABASE_URL` | 24 DB suites **refused** by the guard | Accidental (placeholder text pasted literally), but a genuine verification: a non-test database is rejected before any suite runs. |
| 2026-08-04 | All, after E21 | **391/391 pass** (60 files) | Verifies E21: `officeIngest.unit.test.ts` (14, real DOCX/XLSX fixtures) and `spreadsheetImport.db.test.ts` (3, incl. cross-org tenancy rejection). Cursor could not run these — its sandbox has no route to Neon. |

**Tip:** set the URL once per terminal window, then reuse it —
`export UKEDL_TEST_DB="postgresql://…/ukedl_test?sslmode=require"`, then
`DATABASE_URL="$UKEDL_TEST_DB" npx vitest run`. Shell variables do **not** cross
terminal windows; set and run in the same one. Note the window's title changes
with the current directory, so it is not a reliable way to tell windows apart.

---

## 10. Billing go-live (test mode → live mode)

**Do this fresh, with a clear hour, not at the end of a long session.** It is the
one procedure in this project where a tired mistake involves real money, real tax
identifiers, and paperwork to undo.

Everything below has already been proven end-to-end in **test mode**: checkout →
webhook → entitlement → plan label → cancellation. Going live changes credentials
and product records, not logic.

### What the code expects

Set on **Render** (`docweeksched-api`):

| Variable | Test today | Live |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (test endpoint) | `whsec_…` (**new** live endpoint) |
| `STRIPE_API_VERSION` | `2025-03-31.basil` | unchanged — **do not lower it**; Managed Payments requires ≥ this version |
| `STRIPE_PRICE_PRO_MONTHLY` | test price id | **new** live price id |
| `STRIPE_PRICE_PRO_ANNUAL` | test price id | **new** live price id |
| `STRIPE_PRICE_PER_EVENT_250` | test price id | **new** live price id |
| `STRIPE_PRICE_PER_EVENT_500` | test price id | **new** live price id |
| `STRIPE_PRICE_PER_EVENT_1000` | test price id | **new** live price id |

**Price IDs do not carry over between test and live mode.** Every one is new.
When the 2026-08-02 test setup was done, two variables were nearly given the same
value — check each of the five against the Stripe dashboard **individually**
before saving.

### Steps

1. **Business verification** (Stripe → Settings → Business). Legal entity name,
   address, EIN **or** SSN, and the payout bank account. **Do this yourself —
   never paste these into a chat, a file, or an AI tool.** Stripe may take
   minutes or a day or two to approve; nothing else can proceed until it does.
2. **Live secret key** — Stripe dashboard, toggle to **live mode**, Developers →
   API keys → reveal the `sk_live_…`.
3. **Five live products and prices.** Recreate the same catalogue in live mode:
   Pro Monthly $79, Pro Annual $790, Per-event 250 $149, 500 $249, 1,000 $399.
   Each product needs a **`tax_code`** — the test catalogue uses
   `txcd_10103001` (SaaS). Missing tax codes are what blocked Managed Payments
   checkout on 2026-08-02.
4. **New live webhook endpoint.** URL — verified against
   `apps/api/src/index.ts:115`:

   ```
   https://api.ukedl.com/billing/webhooks/stripe
   ```

   Subscribe to exactly these five events. They are the only ones the code
   handles (`apps/api/src/lib/billing/webhooks.ts:265–324`); anything else is
   accepted and ignored:

   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

   Copy the endpoint's **new** `whsec_…`. The test secret will not validate live
   events.
5. **Update Render** with all eight variables, redeploy, and watch the log come up
   clean.
6. **One real purchase.** Buy **Pro Monthly ($79)** with your own card. Confirm:
   checkout completes · webhook is received · the organisation shows **Pro ·
   Monthly** (not Annual — that mislabel was the E5.1 bug) · entitlements unlock.
7. **Refund it** in the Stripe dashboard, and confirm the app returns to Free.
8. Update `LAUNCH_CHECKLIST.md` §0 and log the date below.

### Cautions

- **Never** put an EIN, SSN, bank number or card number into a chat window, a
  repo file, or an AI tool. Stripe's own forms only.
- Keep the **test** keys somewhere retrievable — a test environment is still
  useful after go-live.
- Do not delete the test webhook endpoint; it is harmless and useful.
- Stripe is **merchant of record** here (Managed Payments): Stripe collects the
  payment and remits sales tax/VAT. The `/pricing` page states this — check the
  wording still matches reality once live, because procurement teams read it.

### Log

| Date | Step | Result |
|---|---|---|
| 2026-08-02 | Full lifecycle in **test** mode | PASS — checkout → webhook → entitlement → cancel → revert |
| _(go-live pending)_ | | |

---

## 11. Rotating a Neon database password (causes downtime if done wrong)

**Incident 2026-08-06.** Production was down ~25 minutes after a Neon password
reset. `/health/ready` returned 503 with `"db":false`; Sentry logged
`Can't reach database server at ep-square-lab-am8rfnqg-pooler`. Cause: the
production role password was reset in Neon while Render still held the old one.
Nothing was lost — but the API was down for every visitor for the whole gap.

### Two facts that make this dangerous

1. **Neon scopes role passwords per branch.** Resetting `neondb_owner` on `test`
   does **not** touch `production` or `dev`. The confirmation dialog names the
   branch — read it. Conversely, a password leaked from one branch very likely
   works on the others, because branches inherit the parent's password at
   creation.
2. **Production is down from the moment you click Reset until Render redeploys.**
   There is no overlap window. Prisma reports the failure as
   *"Can't reach database server"*, which reads like a network problem — it is
   actually authentication.

A compute showing **SUSPENDED** during this is a *symptom*, not the cause: Neon
suspends a compute when nothing successfully connects.

### Correct procedure — stage everything first

1. Open **Render → docweeksched-api → Environment** in one tab. Locate
   `DATABASE_URL` and `DIRECT_DATABASE_URL`.
2. Open the **Neon Connect** dialog for the target branch in another tab.
3. **Only now** click **Reset password**. Copy the new string with pooling **ON**
   (for `DATABASE_URL`) and again with pooling **OFF** (for
   `DIRECT_DATABASE_URL` — the host differs by `-pooler`).
4. Paste both into Render immediately and **Save Changes**. Do not stop in
   between; every second here is downtime.
5. Watch **Logs**. A successful recovery looks like a *new instance id* booting
   (`Running 'npm run start'` → `API listening` → `Your service is live`) with no
   errors from it. Errors continuing from the **old** instance id for a minute or
   two afterwards are normal — Render drains it.
6. Confirm: `https://api.ukedl.com/health/ready` returns
   `{"ok":true,"db":true,…}`. Then load a public event page.

### After rotating, also update

- **`dev` branch** — reset it too if the password was shared, then update the
  local `apps/api/.env`.
- **`test` branch** — reset, then re-`export UKEDL_TEST_DB=…` in your terminal or
  the DB suites will fail to connect (RUNBOOK §9).

### Storing the credential

Do **not** keep connection strings in a file on the Desktop — that folder gets
screenshotted and may sync to iCloud. Use Apple Passwords or a locked note.
Production's copy lives in Render; the test one only needs to exist in a shell
variable while you are running tests.
