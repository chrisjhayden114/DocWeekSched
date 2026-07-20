# Phase P3 (2/2) — CFP tables

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only (after migration 1):

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

Depends on **`20260721100000_phase_p3_cfp_reviewer_role`** (ADD VALUE isolation). Prisma applies both in order; each file is its own transaction.

---

## Must-confirms (in the SQL)

1. **`'REVIEWER'` is never used** in this file (no insert/compare/CASE). Role assignment is app-layer.
2. **`CfpFormStatus`, `CfpSubmissionStatus`, `CfpDecisionEmailKind`** are new `CREATE TYPE`s used only on new CFP tables — fine in one transaction.
3. **Additive only** — no ALTER of existing NOT NULL columns, no row backfills.
4. **Idempotent** — `IF NOT EXISTS` / `duplicate_object`-guarded FKs.
5. **Tokens hashed** — `verifyTokenHash` / `accessTokenHash` only (Phase 1 invite pattern); never plaintext columns.
6. **No existing-enum ADD VALUE** in this file.

---

## What this migration does

### Enums
| Type | Values |
|------|--------|
| `CfpFormStatus` | `DRAFT`, `OPEN`, `CLOSED`, `ARCHIVED` |
| `CfpSubmissionStatus` | `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `ACCEPTED`, `REJECTED`, `WITHDRAWN` |
| `CfpDecisionEmailKind` | `ACCEPT`, `REJECT` |

### Tables
| Table | Purpose |
|-------|---------|
| `CfpForm` | Per-event CFP; `blindReview` default **true**; rubric + customFields JSON |
| `CfpReviewer` | Committee roster (`cfpFormId` + `userId`) |
| `CfpSubmission` | Public abstract; hashed verify/access tokens; conversion FKs |
| `CfpAttachment` | File metadata + URL/storageKey (object store or data-URL) |
| `CfpReview` | Scores JSON + comment + optional `recusedAt` |
| `CfpDecisionEmail` | Queued editable accept/reject email |

### Not included (app layer)
- Public `/e/<slug>/cfp`, verify links, review UI, convert-to-session/item, dashboard, CSV
- Setting `EventMembership.role` to REVIEWER
- Feature-registry `cfp` key (shared TS)

---

## Mid-failure recovery

If deploy fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

Do not attempt partial repair on a half-applied schema.

---

## Reverse (dev only) — documented order

```sql
DROP TABLE IF EXISTS "CfpDecisionEmail";
DROP TABLE IF EXISTS "CfpReview";
DROP TABLE IF EXISTS "CfpAttachment";
DROP TABLE IF EXISTS "CfpSubmission";
DROP TABLE IF EXISTS "CfpReviewer";
DROP TABLE IF EXISTS "CfpForm";

DROP TYPE IF EXISTS "CfpDecisionEmailKind";
DROP TYPE IF EXISTS "CfpSubmissionStatus";
DROP TYPE IF EXISTS "CfpFormStatus";
```

Then see migration 1 README for `EventMemberRole.REVIEWER` (forward-only / prefer Neon reset).

Also remove migration rows from `_prisma_migrations` only on a disposable branch reset.

---

## After you migrate

1. Confirm `\d "CfpForm"`, `CfpSubmission`, `CfpReview`, `CfpAttachment`, `CfpReviewer`, `CfpDecisionEmail`.
2. Confirm `CfpSubmission` has `verifyTokenHash` / `accessTokenHash` (unique, nullable) — no plaintext token columns.
3. Tell the agent migrate succeeded — app layer (public submit, REVIEWER authz, blind review, convert, dashboard, tenancy tests) follows in small commits.
