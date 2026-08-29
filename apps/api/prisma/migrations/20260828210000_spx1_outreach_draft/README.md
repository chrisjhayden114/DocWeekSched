# SPX-1 — AiMeterFeature.OUTREACH_DRAFT

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production.

---

## Must-confirms (in the SQL)

1. **This file is ONLY** `ALTER TYPE "AiMeterFeature" ADD VALUE IF NOT EXISTS 'OUTREACH_DRAFT';` — zero other statements.
2. **`'OUTREACH_DRAFT'` is never used** (compared/inserted) in this file.
3. **Postgres ADD VALUE isolation** — using the new label in the same transaction is forbidden; we do not.

---

## What this migration does

| Type | Change |
|------|--------|
| `AiMeterFeature` (extend) | +`OUTREACH_DRAFT` (ADD VALUE only; forward-only in Postgres) |

Metered "Draft with AI" on the sponsor-outreach composer. Draft-only — UKEDL never sends these emails.

---

## Mid-failure recovery

If deploy fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

---

## Reverse (dev only)

Postgres enum values are **forward-only**. You cannot cheaply `DROP VALUE`.

- Prefer a full **Neon branch reset**, or
- Leave `OUTREACH_DRAFT` on the type unused.
