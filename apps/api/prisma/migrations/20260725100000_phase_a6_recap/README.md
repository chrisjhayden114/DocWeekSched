# Phase A6 — Post-Event Recap Agent (schema)

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

Depends on prior migrations through **`20260724100000_phase_p4_badges_certificates`**.

---

## Must-confirms (verify against the SQL)

1. **Every `CREATE TYPE` in this file** (new enums only; used **only** on tables created here):
   - `RecapStatus` — `'PENDING'`, `'GENERATING'`, `'READY'`, `'FAILED'`
   - `RecapSectionKind` — `'REPORT'`, `'FEEDBACK_SYNTHESIS'`, `'CERTIFICATES'`, `'SPONSOR_ONE_PAGER'`
   - `RecapSectionStatus` — `'DRAFT'`, `'SUPERSEDED'`
   - `RecapEmailKind` — `'CERTIFICATE_AVAILABILITY'`, `'THANK_YOU_ATTENDEE'`, `'THANK_YOU_SPEAKER'`
   - `RecapEmailStatus` — `'DRAFT'`, `'SENT'`, `'SUPERSEDED'`

2. **Every `CREATE TABLE` in this file**:
   - `EventRecap` — one workspace per event (`UNIQUE eventId`)
   - `EventRecapSection` — report / feedback / certificates / sponsor one-pagers
   - `EventRecapEmail` — certificate availability + thank-you drafts

3. **Three PARTIAL unique indexes** (live drafts only — `status <> SUPERSEDED`):
   - `EventRecapSection_live_recapId_kind_key`  
     on `("recapId", "kind")`  
     **WHERE** `"sponsorId" IS NULL AND "status" <> 'SUPERSEDED'::"RecapSectionStatus"`
   - `EventRecapSection_live_recapId_kind_sponsorId_key`  
     on `("recapId", "kind", "sponsorId")`  
     **WHERE** `"sponsorId" IS NOT NULL AND "status" <> 'SUPERSEDED'::"RecapSectionStatus"`
   - `EventRecapEmail_live_recapId_kind_key`  
     on `("recapId", "kind")`  
     **WHERE** `"status" <> 'SUPERSEDED'::"RecapEmailStatus"`

4. **Zero `ALTER TABLE` on existing tables** — no column adds/changes on `Event`, `User`, `Organization`, `EventMembership`, `Sponsor`, `BackgroundJob`, `Announcement`, or any other pre-existing table. FKs are added only onto the three new tables.

5. **Zero `ADD VALUE` on any existing enum** — `AiMeterFeature` (including existing `RECAP`), `AuditAction`, `BackgroundJobStatus`, `NotificationKind`, etc. are untouched.

6. **`EventMembership.checkInCode` untouched** — including its `@default(cuid())` in Prisma (no SQL touches that column). Confirmed still: `checkInCode String @default(cuid())`.

7. **Idempotent** — `IF NOT EXISTS` / `duplicate_object`-guarded FKs.

---

## Soft links vs real FKs

| Column | Kind | ON DELETE |
|--------|------|-----------|
| `EventRecap.organizationId` | Real FK → `Organization` | `CASCADE` |
| `EventRecap.eventId` | Real FK → `Event` | `CASCADE` |
| `EventRecap.lastJobId` | **Soft** plain `TEXT` (→ `BackgroundJob.id`) | n/a — jobs may be pruned independently |
| `EventRecapSection.recapId` | Real FK → `EventRecap` | `CASCADE` |
| `EventRecapSection.sponsorId` | Real FK → `Sponsor` (nullable) | `CASCADE` |
| `EventRecapEmail.recapId` | Real FK → `EventRecap` | `CASCADE` |
| `EventRecapEmail.sentViaAnnouncementId` | **Soft** plain `TEXT` (→ `Announcement.id`) | n/a — announcements may be pruned independently |

---

## Design intent for the build (not enforced in SQL)

### Numbers integrity — placeholder substitution ONLY

- Narrative path is **placeholder-substitution only**. The LLM returns prose with metric-path placeholders (and/or a citations list of metric paths). TypeScript substitutes verified values from `EventRecap.metricsSnapshot` into the stored `bodyMarkdown`.
- There is **no** free-text-number mode and **no** subset-validator fallback. A literal number must be **incapable** of entering the narrative except via substitution.

### Feedback synthesis — commentCount from code

- Theme `commentCount` is computed in code from resolved `quoteIds` (or SQL), **never** taken from the LLM.
- Unknown `quoteIds` returned by the model are **dropped**.

### Regeneration

- Mark prior live `DRAFT` sections/emails `SUPERSEDED`; insert fresh live rows. Partial uniques guarantee one live row per key.
- Never mutate `SENT` emails (`sentAt` stays). Never re-send. Certificate issue stays on the P4 idempotent path (`publicId` / `issuedAt` stable).

---

## What this migration does

### Enums
| Type | Values |
|------|--------|
| `RecapStatus` | `PENDING`, `GENERATING`, `READY`, `FAILED` |
| `RecapSectionKind` | `REPORT`, `FEEDBACK_SYNTHESIS`, `CERTIFICATES`, `SPONSOR_ONE_PAGER` |
| `RecapSectionStatus` | `DRAFT`, `SUPERSEDED` |
| `RecapEmailKind` | `CERTIFICATE_AVAILABILITY`, `THANK_YOU_ATTENDEE`, `THANK_YOU_SPEAKER` |
| `RecapEmailStatus` | `DRAFT`, `SENT`, `SUPERSEDED` |

### Tables
| Table | Purpose |
|-------|---------|
| `EventRecap` | Per-event workspace; frozen `metricsSnapshot` / quote bank / fix-list |
| `EventRecapSection` | Draftable non-email artifacts (incl. per-sponsor one-pagers) |
| `EventRecapEmail` | Draftable outbound copy; `SENT` is terminal for that kind until superseded on regen of drafts only |

### Not included (app layer — after you approve migrate)
- Generate job, metrics SQL, placeholder substitution, gateway `RECAP` drafting
- Send endpoints (announcements rate-limited channel), P4 batch_issue wiring
- `recap_agent` feature registry + PRO entitlement
- Series checklist merge, PDF/CSV export, tests

---

## Mid-failure recovery

If deploy fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

Do not attempt partial repair on a half-applied schema.

---

## Reverse (dev only) — documented drop order

```sql
DROP TABLE IF EXISTS "EventRecapEmail";
DROP TABLE IF EXISTS "EventRecapSection";
DROP TABLE IF EXISTS "EventRecap";
DROP TYPE IF EXISTS "RecapEmailStatus";
DROP TYPE IF EXISTS "RecapEmailKind";
DROP TYPE IF EXISTS "RecapSectionStatus";
DROP TYPE IF EXISTS "RecapSectionKind";
DROP TYPE IF EXISTS "RecapStatus";
```

Also remove the migration row from `_prisma_migrations` only on a disposable branch reset (or prefer a full Neon reset).

---

## After you migrate

1. Confirm `\d "EventRecap"`, `\d "EventRecapSection"`, `\d "EventRecapEmail"`.
2. Confirm the three partial unique indexes and their `WHERE` clauses (`\d` / `\di+`).
3. Confirm `\d "EventMembership"` — `checkInCode` unchanged.
4. Tell the agent migrate succeeded — app layer follows in a later session.
