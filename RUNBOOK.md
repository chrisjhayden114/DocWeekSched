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

There is no separate worker process: stopping/restarting the API stops all jobs and interval loops.

## 2. Backups (Neon)

- **What exists:** Neon's built-in point-in-time restore (PITR). Every write is in the WAL
  history; you can create a branch of the database as of any timestamp inside the
  retention window. There is no separate nightly dump job yet (Phase S2 adds an
  automated weekly restore drill).
- **Retention window:** depends on the Neon plan — verify in the Neon console under
  Project → Settings → History retention (free tier is on the order of 1 day; paid
  plans allow multi-day windows). **Before launch, confirm the retention window
  meets the recovery objective and record it here.**
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
| _none yet_ | | | |

## 4. Deploy

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
| Billing checkout | Unset Lemon Squeezy vars (checkout returns unconfigured) + restart |
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
| Lemon Squeezy | Billing (merchant of record) | `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_VARIANT_*` | Webhooks are the entitlement source of truth |
| Anthropic | AI gateway provider | `ANTHROPIC_API_KEY`, `AI_PROVIDER=anthropic` | `mock` = kill switch |
| S3/R2-compatible storage | Uploads (optional) | `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, … | Unset → data-URL fallback in Postgres |
| Web push (VAPID) | Self-generated keypair, no vendor account | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Rotating keys invalidates subscriptions |

No-account dependencies: Google Fonts (CSS), `api.qrserver.com` (QR images).

## 9. "Someone else takes over" (skeleton — complete before launch)

Access needed: the provider dashboards above + GitHub repo + the domain registrar for
ukedl.com (and the post-rename domain). Escalation contacts, customer commitments, and
support-hours policy live in `packages/config` (`supportHours`) and the ToS. Expand this
chapter during the launch-checklist session.
