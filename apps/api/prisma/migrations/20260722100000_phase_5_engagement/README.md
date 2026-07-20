# Phase 5 — Engagement & organizer analytics

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

Depends on prior migrations through **`20260721120000_phase_a4_matchmaker`**.

---

## Must-confirms (in the SQL)

1. **No `ADD VALUE` on any existing enum** — `NotificationKind`, `EventMemberRole`, `AiMeterFeature`, etc. untouched. Staff scanner uses existing **`OrgRole.STAFF`**.
2. **`CheckInMethod` + `SessionPollStatus`** — new `CREATE TYPE`s only.
3. **`CheckIn.method`** — nullable → backfill `'SELF'::"CheckInMethod"` → `NOT NULL` + default `SELF`.
4. **`EventMembership.checkInCode`** — nullable → backfill `replace(gen_random_uuid()::text, '-', '')` → `NOT NULL` + unique `(eventId, checkInCode)`.
5. **Q&A columns** (`answeredAt` / `answeredById` / `hiddenAt` / `hiddenById`) — nullable ADD only.
6. **Seven new tables** — `SessionDiscussionUpvote`, `SessionPoll`, `SessionPollOption`, `SessionPollVote`, `SessionFeedback`, `Sponsor`, `SponsorLead`.
7. **Offline idempotency** — partial unique index on `CheckIn.clientMutationId` where not null.
8. **Idempotent** — `IF NOT EXISTS` / `duplicate_object`-guarded FKs.

---

## What this migration does

### Enums
| Type | Values |
|------|--------|
| `CheckInMethod` | `SELF`, `STAFF_SCAN`, `QR_SCAN` |
| `SessionPollStatus` | `DRAFT`, `OPEN`, `CLOSED` |

### Columns
| Column | Notes |
|--------|-------|
| `EventMembership.checkInCode` | NOT NULL after backfill; QR / offline roster key |
| `CheckIn.method` | NOT NULL DEFAULT `SELF` after cast backfill |
| `CheckIn.scannedByUserId` | nullable FK → User |
| `CheckIn.clientMutationId` | nullable; partial unique for offline sync |
| `SessionDiscussionThread.answered*` / `hidden*` | nullable moderation fields |

### Tables
| Table | Purpose |
|-------|---------|
| `SessionDiscussionUpvote` | One upvote per user per Q&A thread |
| `SessionPoll` / `SessionPollOption` / `SessionPollVote` | Live MC polls |
| `SessionFeedback` | 1–5 + comment; unique per session+user |
| `Sponsor` / `SponsorLead` | Tiered sponsors + lead capture |

### Not included (app layer)
- Q&A upvote/sort/answered/moderation UI; poll + feedback UI
- Staff offline scanner (IndexedDB + `clientMutationId`)
- Analytics dashboard, adoption rate, CSV, EventSeries YoY
- Feature registry keys + PER_EVENT/PRO entitlements; quiet points / opt-in leaderboard

---

## Mid-failure recovery

If deploy fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

---

## Reverse (dev only) — documented drop order

```sql
DROP TABLE IF EXISTS "SponsorLead";
DROP TABLE IF EXISTS "Sponsor";
DROP TABLE IF EXISTS "SessionFeedback";
DROP TABLE IF EXISTS "SessionPollVote";
DROP TABLE IF EXISTS "SessionPollOption";
DROP TABLE IF EXISTS "SessionPoll";
DROP TABLE IF EXISTS "SessionDiscussionUpvote";

ALTER TABLE "SessionDiscussionThread" DROP COLUMN IF EXISTS "hiddenById";
ALTER TABLE "SessionDiscussionThread" DROP COLUMN IF EXISTS "hiddenAt";
ALTER TABLE "SessionDiscussionThread" DROP COLUMN IF EXISTS "answeredById";
ALTER TABLE "SessionDiscussionThread" DROP COLUMN IF EXISTS "answeredAt";

ALTER TABLE "CheckIn" DROP CONSTRAINT IF EXISTS "CheckIn_scannedByUserId_fkey";
ALTER TABLE "CheckIn" DROP COLUMN IF EXISTS "clientMutationId";
ALTER TABLE "CheckIn" DROP COLUMN IF EXISTS "scannedByUserId";
ALTER TABLE "CheckIn" DROP COLUMN IF EXISTS "method";

ALTER TABLE "EventMembership" DROP COLUMN IF EXISTS "checkInCode";

DROP TYPE IF EXISTS "SessionPollStatus";
DROP TYPE IF EXISTS "CheckInMethod";
```

Also remove the migration row from `_prisma_migrations` only on a disposable branch reset.

---

## After you migrate

1. Confirm `\d "EventMembership"` — `checkInCode` NOT NULL; unique with `eventId`.
2. Confirm `\d "CheckIn"` — `method` NOT NULL; partial unique on `clientMutationId`.
3. Confirm the seven new tables exist.
4. Tell the agent migrate succeeded — app layer follows in small commits.
