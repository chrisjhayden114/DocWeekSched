# Phase P4 — Badges & certificates

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

Depends on prior migrations through **`20260723100000_phase_a5_ops_agent`**.

---

## Must-confirms (verify against the SQL)

1. **Zero `ADD VALUE` on any existing enum** — `NotificationKind`, `EventMemberRole`, `CheckInMethod`, `SessionAttendanceStatus`, `BackgroundJobStatus`, `AiMeterFeature`, `AuditAction`, etc. are untouched.

2. **Every `CREATE TYPE` in this file** (new enums only):
   - `BadgeSheetSize` — `'SIZE_3X4'`, `'SIZE_4X6'`, `'SIZE_A6'`
   - `CertificateEligibilityRule` — `'ANY_CHECKIN'`, `'MIN_SESSIONS'`, `'REQUIRED_SESSIONS'`  
   Both are used **only** on tables created in this migration (fine in one transaction).

3. **Every `CREATE TABLE` in this file**:
   - `BadgeTemplate`
   - `CertificateTemplate`
   - `IssuedCertificate`

4. **Two unique constraints on `IssuedCertificate`**:
   - `IssuedCertificate_publicId_key` on `("publicId")` — public verify id (`randomBytes(16).toString("base64url")` in app layer)
   - `IssuedCertificate_certificateTemplateId_userId_key` on `("certificateTemplateId", "userId")` — idempotent re-issue (one cert per attendee per template)

5. **`IssuedCertificate` timestamp columns all present**:
   - `issuedAt` `TIMESTAMP(3) NOT NULL` — set once at first issue; never rewritten on regenerate
   - `regeneratedAt` `TIMESTAMP(3)` nullable — updated on re-issue
   - `voidedAt` `TIMESTAMP(3)` nullable — reserved; `/verify` treats non-null as miss (identical 404)

6. **`IssuedCertificate_certificateTemplateId_fkey` is `ON DELETE RESTRICT`** — deleting a `CertificateTemplate` while issued rows still reference it fails. Issued certificates cannot be destroyed by deleting a template; void them first (`voidedAt`). (`userId` stays `ON DELETE CASCADE` for GDPR erasure; `eventId` / `organizationId` stay CASCADE.)

7. **Zero `ALTER TABLE` on existing tables** — no column adds/changes on `Event`, `User`, `Organization`, `EventMembership`, `CheckIn`, `SessionAttendance`, `BackgroundJob`, or any other pre-existing table. FKs are added only onto the three new tables.

8. **`EventMembership.checkInCode` untouched** — including its `@default(cuid())` in Prisma (no SQL touches that column).

9. **Idempotent** — `IF NOT EXISTS` / `duplicate_object`-guarded FKs.

---

## What this migration does

### Enums
| Type | Values |
|------|--------|
| `BadgeSheetSize` | `SIZE_3X4`, `SIZE_4X6`, `SIZE_A6` |
| `CertificateEligibilityRule` | `ANY_CHECKIN`, `MIN_SESSIONS`, `REQUIRED_SESSIONS` |

### Tables
| Table | Purpose |
|-------|---------|
| `BadgeTemplate` | One Avery layout per event (`UNIQUE eventId`); element toggles |
| `CertificateTemplate` | Merge-field template + eligibility rule; `minSessions` / `requiredSessionIds` |
| `IssuedCertificate` | Issued PDF row; unguessable `publicId`; snapshots for `/verify` |

### App-layer notes (not in SQL — carry into build)
- **Eligibility:** `ANY_CHECKIN` → `CheckIn`; `MIN_SESSIONS` / `REQUIRED_SESSIONS` → `SessionAttendance.status = JOINING` (registration, not door scan). Organizer certificate-template UI **must** state honestly that session rules are based on session registration, not verified door attendance.
- **Upsert:** rewrite snapshots / `pdfStorageKey` / `regeneratedAt`; leave `issuedAt` and `publicId` untouched.
- **`/verify`:** name / event / date only; forged or `voidedAt IS NOT NULL` → identical 404.
- Entitlements, PDF pipelines, batch job, feature registry — app layer after migrate.

### Not included (app layer)
- Prisma model sync for these tables
- Badge/certificate designers, PDF generation (`pdfkit`), batch job, `/verify` page
- Plan flags `badges` / `certificates` + feature registry key
- Tests (merge fields, eligibility, verify, 500-attendee batch)

---

## Mid-failure recovery

If deploy fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

Do not attempt partial repair on a half-applied schema.

---

## Reverse (dev only) — documented drop order

Drop `IssuedCertificate` **before** `CertificateTemplate` — the template FK is `ON DELETE RESTRICT`, so a template delete (or reverse drop out of order) fails while issued rows still reference it. In app layer, void via `voidedAt` rather than destroying issued rows by deleting the template.

```sql
DROP TABLE IF EXISTS "IssuedCertificate";
DROP TABLE IF EXISTS "CertificateTemplate";
DROP TABLE IF EXISTS "BadgeTemplate";
DROP TYPE IF EXISTS "CertificateEligibilityRule";
DROP TYPE IF EXISTS "BadgeSheetSize";
```

Also remove the migration row from `_prisma_migrations` only on a disposable branch reset (or prefer a full Neon reset).

---

## After you migrate

1. Confirm `\d "BadgeTemplate"`, `\d "CertificateTemplate"`, `\d "IssuedCertificate"`.
2. Confirm unique indexes: `IssuedCertificate_publicId_key`, `IssuedCertificate_certificateTemplateId_userId_key`.
3. Confirm `IssuedCertificate` columns `issuedAt`, `regeneratedAt`, `voidedAt`.
4. Confirm `\d "EventMembership"` — `checkInCode` unchanged.
5. Tell the agent migrate succeeded — Prisma models + app layer follow in small commits.
