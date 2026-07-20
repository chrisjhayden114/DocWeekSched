# Phase A4 — Matchmaker Agent

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

Depends on prior migrations through **`20260721110000_phase_a3_attendee_concierge`**.

---

## Must-confirms (in the SQL)

1. **`EventMembership.matchMeEnabled`** — single  
   `ADD COLUMN IF NOT EXISTS "matchMeEnabled" BOOLEAN NOT NULL DEFAULT true`.  
   Postgres applies the constant DEFAULT to every existing row (no separate UPDATE).  
   **All existing members end up `matchMeEnabled = true`.**  
   Nullable→backfill→NOT NULL was **not** used (unnecessary for a new column with a constant non-null default).

2. **No `ADD VALUE` on any existing enum** — `NotificationKind`, `AiMeterFeature`, `AuditAction`, etc. untouched.  
   **No status enum** on `MatchSuggestion`. Delivery reuses `AGENT_ATTENDEE_TOUCH` (DIGEST app-layer).  
   If a status enum were added later: new `CREATE TYPE` only, used only on the new table.

3. **Additive only** — `MatchProfileEmbedding` + `MatchSuggestion`. No other ALTER of existing NOT NULL columns. No other backfills.

4. **Idempotent** — `IF NOT EXISTS` / `duplicate_object`-guarded FKs.

---

## What this migration does

### Column
| Column | Notes |
|--------|-------|
| `EventMembership.matchMeEnabled` | NOT NULL DEFAULT **true**. Mute = app sets false. Still requires `directoryOptIn` both ways to participate. |

### Tables
| Table | Purpose |
|-------|---------|
| `MatchProfileEmbedding` | Per-user embedding cache (`userId` unique); `sourceHash` for skip-if-unchanged; recompute on profile edit |
| `MatchSuggestion` | Top-5 ranked suggestions per `batchKey` (`join` / `week:YYYY-Www`); `draftIntro` pre-fill only; optional `proposedSlots` JSON |

### Not included (app layer)
- Gateway MOCK embed + rank; cosine shortlist; exclude DIRECT chat partners
- DIGEST delivery via `notifyAgentAttendeeTouch`; never push; never auto-send
- Attendee UI card, draft-intro → DM composer, paid-tier / `featureEnabled('matchmaker')` gates
- Tests listed in PRODUCT_SPEC Phase A4

---

## Mid-failure recovery

If deploy fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

Do not attempt partial repair on a half-applied schema.

---

## Reverse (dev only) — documented drop order

```sql
DROP TABLE IF EXISTS "MatchSuggestion";
DROP TABLE IF EXISTS "MatchProfileEmbedding";
ALTER TABLE "EventMembership" DROP COLUMN IF EXISTS "matchMeEnabled";
```

Also remove the migration row from `_prisma_migrations` only on a disposable branch reset.

---

## After you migrate

1. Confirm `\d "EventMembership"` — `matchMeEnabled` is `boolean not null default true`.
2. Spot-check: existing membership rows all have `matchMeEnabled = true`.
3. Confirm `\d "MatchProfileEmbedding"` and `\d "MatchSuggestion"`.
4. Tell the agent migrate succeeded — app layer (gateway embed/rank, digest card, draft intro, tests) follows in small commits.
