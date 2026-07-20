# Phase A5 — Organizer Ops Agent

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

Depends on prior migrations through **`20260722100000_phase_5_engagement`**.

---

## Must-confirms (in the SQL)

1. **No `ADD VALUE` on any existing enum** — `NotificationKind`, `AiMeterFeature`, `AuditAction`, `SessionPublishStatus`, `ModerationReportStatus`, etc. are untouched.  
   Metering reuses existing **`AiMeterFeature.OPS_DRAFT`**. Audit reuses existing **`AuditLog`** / **`AuditAction`**.

2. **Three new enums are `CREATE TYPE` only**, used **only** on **`OpsInboxCard`**:
   - `OpsDetectorKind`
   - `OpsCardStatus`
   - `OpsDraftActionType`  
   That is allowed in one transaction (new types on new tables — not ADD VALUE).

3. **`Room.capacity`** — single  
   `ADD COLUMN IF NOT EXISTS "capacity" INTEGER` (nullable).  
   **No backfill** — existing rooms stay `NULL` (unknown; not ranked as “larger”).

4. **`Event.communityBlocklist`** — single  
   `ADD COLUMN IF NOT EXISTS "communityBlocklist" JSONB NOT NULL DEFAULT '[]'::jsonb`.  
   Postgres applies the constant DEFAULT to every existing row (**no separate UPDATE**).

5. **Additive only** — no ALTER of existing NOT NULL columns; no destructive drops.  
   New tables: `SessionScheduleChange`, `OpsInboxCard`.

6. **Idempotent** — `IF NOT EXISTS` / `duplicate_object`-guarded FKs.

7. **Sticky dismiss + idempotent create** —  
   `UNIQUE ("eventId", "triggerInstanceKey")` on `OpsInboxCard`.

---

## What this migration does

### Columns
| Column | Notes |
|--------|-------|
| `Room.capacity` | `INTEGER NULL` — seats; NULL = unknown |
| `Event.communityBlocklist` | `JSONB NOT NULL DEFAULT '[]'` — keyword list for community moderation detector |

### Enums (new)
| Type | Values |
|------|--------|
| `OpsDetectorKind` | `SESSION_CHANGED`, `QA_STALE`, `LOW_CHECKIN`, `CAPACITY_PRESSURE`, `MODERATION`, `DAILY_DIGEST` |
| `OpsCardStatus` | `OPEN`, `APPLIED`, `DISMISSED` |
| `OpsDraftActionType` | `ANNOUNCEMENT`, `DM`, `SPEAKER_NUDGE`, `ROOM_MOVE`, `OPEN_VIRTUAL`, `MODERATION_REVIEW`, `DIGEST_NOTE` |

### Tables
| Table | Purpose |
|-------|---------|
| `SessionScheduleChange` | Feed for published session time/room changes; detector consumes via `consumedAt` |
| `OpsInboxCard` | Review-and-send cards; nothing executes without explicit Apply/Send click |

### Not included (app layer)
- Deterministic detector jobs + MOCK draft copy (`OPS_DRAFT` metered; detector runs free)
- Session PUT → `SessionScheduleChange` insert
- Ops Inbox API + organizer tab (active `startDate−48h` … `endDate+24h`)
- Apply/Send via existing announcement/DM channels + calm budget; `writeAuditLog` with evidence snapshots
- Feature registry / plan gates; tests (positives, boundary negatives, dismiss stickiness, zero autonomous sends)

---

## Mid-failure recovery

If deploy fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

Do not attempt partial repair on a half-applied schema.

---

## Reverse (dev only) — documented drop order

```sql
DROP TABLE IF EXISTS "OpsInboxCard";
DROP TABLE IF EXISTS "SessionScheduleChange";
ALTER TABLE "Event" DROP COLUMN IF EXISTS "communityBlocklist";
ALTER TABLE "Room" DROP COLUMN IF EXISTS "capacity";
DROP TYPE IF EXISTS "OpsDraftActionType";
DROP TYPE IF EXISTS "OpsCardStatus";
DROP TYPE IF EXISTS "OpsDetectorKind";
```

Also remove the migration row from `_prisma_migrations` only on a disposable branch reset (or prefer a full Neon reset).

---

## After you migrate

1. Confirm `\d "OpsInboxCard"`, `\d "SessionScheduleChange"`.
2. Confirm `Room.capacity` is nullable integer; `Event.communityBlocklist` is `jsonb not null default '[]'`.
3. Spot-check: existing events have `communityBlocklist = []`; existing rooms have `capacity IS NULL`.
4. Tell the agent migrate succeeded — app layer (detectors, draft/apply API, Ops Inbox UI, MOCK tests) follows in small commits.
