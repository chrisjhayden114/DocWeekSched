# Phase A1 — Agenda Ingest Agent

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

---

## Must-confirms (in the SQL)

1. **`SessionPublishStatus` is a NEW `CREATE TYPE`** — not ADD VALUE on an existing enum. Using it in the same migration for column add + backfill cast (`'PUBLISHED'::"SessionPublishStatus"`) is allowed.

2. **`Session.publishStatus`** — ADD COLUMN nullable → UPDATE existing rows to `PUBLISHED` with explicit cast → SET NOT NULL + DEFAULT `PUBLISHED`. All existing sessions become PUBLISHED so the live DocWeek agenda stays visible.

3. **No `NotificationKind` (or other) ADD VALUE** in this migration.

4. **Idempotent** — `IF NOT EXISTS` / `duplicate_object`-guarded FKs.

---

## What this migration does

### Enums
| Type | Values |
|------|--------|
| `SessionPublishStatus` | `DRAFT`, `PUBLISHED` |
| `AgendaIngestSourceKind` | `PASTE`, `PDF`, `DOCX`, `XLSX`, `CSV`, `IMAGE`, `URL` |
| `AgendaIngestRunStatus` | `PENDING`, `EXTRACTING`, `READY_FOR_REVIEW`, `CONFIRMING`, `CONFIRMED`, `FAILED`, `CANCELLED` |

### Columns / tables
- **`Session.publishStatus`** — backfilled `PUBLISHED` for all existing rows; index `(eventId, publishStatus)`
- **`AgendaIngestRun`** — ingest history + raw source link (`sourceUrl` / `sourceStorageKey`), extraction JSON, assumptions, changeset, review state, confirm counts, `aiGenerated`

### Not included
- App-layer attendee filter (event ACTIVE ∧ session PUBLISHED) — post-migrate
- Fixtures, gateway extract, review UI
- Entitlement SQL (FREE 1 ingest/event stays A0 metering)

---

## Mid-failure recovery

If deploy fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

Do not attempt partial repair on a half-applied schema.

---

## Reverse (dev only) — documented order

```sql
DROP TABLE IF EXISTS "AgendaIngestRun";

DROP INDEX IF EXISTS "Session_eventId_publishStatus_idx";
ALTER TABLE "Session" DROP COLUMN IF EXISTS "publishStatus";

DROP TYPE IF EXISTS "AgendaIngestRunStatus";
DROP TYPE IF EXISTS "AgendaIngestSourceKind";
DROP TYPE IF EXISTS "SessionPublishStatus";
```

Also remove the migration row from `_prisma_migrations` if you fully reverse on a disposable branch, or prefer a full Neon reset.

---

## After you migrate

1. Confirm `\d "Session"` shows `publishStatus` NOT NULL DEFAULT PUBLISHED, and `\d "AgendaIngestRun"`.
2. Tell the agent migrate succeeded — app layer (ingest pipeline, ReviewChangeset UI, attendee visibility filter + regression test that existing PUBLISHED sessions on ACTIVE events stay attendee-visible) follows in small commits.

### Post-migrate visibility note (app layer, not this SQL)

Attendee session lists must require **both**:

- event `status = ACTIVE` (existing), and
- session `publishStatus = PUBLISHED` (new)

…and must not regress visibility of any session that was live before this migration (all backfilled to PUBLISHED). Include a test that an existing published session on a live event remains attendee-visible after the change.
