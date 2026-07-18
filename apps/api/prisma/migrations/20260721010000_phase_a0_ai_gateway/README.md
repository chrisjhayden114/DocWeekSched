# Phase A0 — AI gateway foundation

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

---

## Must-confirms (in the SQL)

1. **NotificationKind ADD VALUE isolation** — Section 1 only adds `AGENT_ATTENDEE_TOUCH`. It is **not** inserted or compared as a `"NotificationKind"` enum value anywhere else in the same migration (Postgres forbids using a freshly-added enum value in the same transaction). DIGEST-class routing for this kind is **app-layer post-migrate**.

2. **New CREATE TYPE enums** — `BackgroundJobStatus`, `AiMeterFeature`, and `AuditAction` are used **only** on tables created in this migration (`AiUsageRecord`, `AuditLog`, `BackgroundJob`). That is allowed (new types, not ADD VALUE).

3. **Additive only** — no ALTER of existing NOT NULL columns, no row backfills, no grandfathering.

---

## What this migration does

### Enums
| Type | Values |
|------|--------|
| `NotificationKind` (extend) | +`AGENT_ATTENDEE_TOUCH` (ADD VALUE only; forward-only in Postgres) |
| `BackgroundJobStatus` | `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `DEAD` |
| `AiMeterFeature` | `AGENDA_INGEST`, `CONCIERGE`, `SETUP_COPILOT`, `MATCHMAKER`, `OPS_DRAFT`, `RECAP`, `OTHER` |
| `AuditAction` | `AI_CHAT`, `AI_EXTRACT`, `AI_DRAFT`, `AI_TOOL`, `AI_NOTIFY`, `JOB_ENQUEUE`, `JOB_COMPLETE`, `JOB_FAIL`, `OTHER` |

### Tables
- **`AiUsageRecord`** — per-call metering (`orgId`, optional `eventId`/`userId`, feature, provider, model, tokens in/out, cost cents, latency, optional `jobId`/`requestId`)
- **`AuditLog`** — agent drafts/actions stream (`aiGenerated` flag + JSON payload); Phase 7 merges sensitive actions here
- **`BackgroundJob`** — progress-polling job infra (status, 0–100 progress, input/result JSON, attempts)

### Not included
- Content-table `aiGenerated` columns (Community / Announcement / Session) — later agent phases
- Entitlement catalog SQL (`aiConciergePerEvent` etc. stay in `packages/shared`)
- App gateway / lint / admin UI (post-migrate)

---

## Mid-failure recovery

If deploy fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

Do not attempt partial repair on a half-applied schema.

---

## Reverse (dev only)

```sql
DROP TABLE IF EXISTS "BackgroundJob";
DROP TABLE IF EXISTS "AiUsageRecord";
DROP TABLE IF EXISTS "AuditLog";

DROP TYPE IF EXISTS "AuditAction";
DROP TYPE IF EXISTS "AiMeterFeature";
DROP TYPE IF EXISTS "BackgroundJobStatus";

-- NotificationKind.AGENT_ATTENDEE_TOUCH cannot be removed cheaply in Postgres
-- (enum values are forward-only). Leave it, or rebuild the enum on a reset branch.
```

Also remove the migration row from `_prisma_migrations` if you fully reverse on a disposable branch, or prefer a full Neon reset.

---

## After you migrate

1. Confirm with `\d "AiUsageRecord"` / `\d "AuditLog"` / `\d "BackgroundJob"` (or Prisma Studio).
2. Tell the agent migrate succeeded — app layer (gateway, mock provider, caps, digest hook, jobs, `/organizer/ai-usage`, ESLint rule, tests) follows in small commits.
