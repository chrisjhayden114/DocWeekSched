# Phase P3 (1/2) — EventMemberRole.REVIEWER

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only (after reviewing migration 2 as well):

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

This is **migration 1 of 2**. Apply both pending folders together; Prisma commits each file in its own transaction so migration 2 may create CFP tables after `REVIEWER` exists — but **neither SQL file ever uses the `REVIEWER` literal** (no insert/compare). Assignment is app-layer only.

---

## Must-confirms (in the SQL)

1. **This file is ONLY** `ALTER TYPE "EventMemberRole" ADD VALUE IF NOT EXISTS 'REVIEWER';` — zero other statements.
2. **`'REVIEWER'` is never used** (compared/inserted) in this file or in migration 2’s SQL.
3. **Postgres ADD VALUE isolation** — using the new label in the same transaction is forbidden; we do not.

---

## What this migration does

| Type | Change |
|------|--------|
| `EventMemberRole` (extend) | +`REVIEWER` (ADD VALUE only; forward-only in Postgres) |

Event-scoped program-committee role. Not on `OrgRole` / global `User.role` (those would expose billing/rosters/settings).

---

## Mid-failure recovery

If deploy fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

---

## Reverse (dev only)

Postgres enum values are **forward-only**. You cannot cheaply `DROP VALUE`.

- Prefer a full **Neon branch reset**, or
- Leave `REVIEWER` on the type unused.

Also remove the migration row from `_prisma_migrations` only on a disposable reset.

---

## After both migrations

1. Confirm `\dT+ "EventMemberRole"` lists `REVIEWER`.
2. Confirm CFP tables from migration 2 (see that README).
3. Tell the agent migrate succeeded — app layer follows in small commits (no further migrate from the agent).
