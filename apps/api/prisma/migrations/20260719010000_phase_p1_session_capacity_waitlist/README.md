# Phase P1 — Session capacity & waitlist

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

---

## What this migration does

### `Session`
| Column | Type | Notes |
|--------|------|-------|
| `inPersonCapacity` | `INTEGER NULL` | Max in-person `JOINING` seats. **NULL = unlimited** |
| `virtualCapacity` | `INTEGER NULL` | Max virtual `JOINING` seats. **NULL = unlimited** |

No backfill — existing sessions stay unlimited. ASYNC has no capacity column (unlimited / no waitlist).

### `WaitlistEntry` (new)
| Column | Notes |
|--------|--------|
| `sessionId` / `userId` | FKs, **ON DELETE CASCADE** |
| `mode` | Reuses existing **`SessionJoinMode`** (`IN_PERSON` / `VIRTUAL` in app logic) |
| `position` | 1-based order within `(sessionId, mode)` |
| `promotedAt` | Set when a seat is offered |
| `holdExpiresAt` | Seat-hold deadline (app default: promote time + 24h) |

Indexes:
- `UNIQUE (sessionId, userId)`
- `(sessionId, mode, position)`
- `(holdExpiresAt)` for expiry sweeps

### `NotificationKind`
```sql
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'WAITLIST_PROMOTED';
```

**Important (Postgres):** A newly added enum label must **not** be used in the same transaction/migration that adds it. This SQL **only adds** `WAITLIST_PROMOTED` and never inserts/casts it. App code may use the value only **after** this migration has committed.

Prisma runs each migration file in a transaction. On Neon (Postgres 15+), `ADD VALUE IF NOT EXISTS` without subsequent use of the label is the safe pattern. If `ADD VALUE` were ever to fail the transaction on an older engine, isolate it into its own one-line migration ahead of the table DDL — not required for current Neon.

Enum labels are **append-only** on reverse (see below).

---

## Race strategy (app layer after apply — not in SQL)

Join path locks the session row:

`SELECT … FROM "Session" WHERE id = $1 FOR UPDATE`

then counts `JOINING` for that mode, then upserts attendance or creates a waitlist row. Leaving frees a seat and promotes `#1` in the same transaction. Concurrent last-seat joins are covered by a race test in app code.

---

## Reverse (manual / disposable)

```sql
DROP TABLE IF EXISTS "WaitlistEntry";
ALTER TABLE "Session" DROP COLUMN IF EXISTS "inPersonCapacity";
ALTER TABLE "Session" DROP COLUMN IF EXISTS "virtualCapacity";
-- NotificationKind 'WAITLIST_PROMOTED' is append-only in Postgres — leave the label
-- (harmless) or rebuild the enum on a disposable branch if you must remove it.
```

---

## After you apply successfully

Tell the agent migrate succeeded. Next (small commits):

1. Capacity fields on session create/update + `SessionForm`
2. `PUT /sessions/:id/attendance` capacity + waitlist + `FOR UPDATE`
3. Promote / hold expiry (default 24h) + in-app `WAITLIST_PROMOTED` + email
4. Organizer roster + attendee “Full — waitlist” UI
5. Unhide `waitlist_visibility` for position display when feature on
6. Tests: fill, concurrent race, promote order, hold expiry, null capacity unchanged
