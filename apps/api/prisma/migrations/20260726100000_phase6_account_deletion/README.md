# Phase 6 — Account deletion cascade + 7-day grace

**DO NOT APPLY until founder reviews this SQL.**

```bash
# After approval only:
npm --workspace @event-app/api exec prisma migrate deploy
# or: prisma migrate deploy
```

## Contents

- `AccountDeletionStatus` enum + `AccountDeletionRequest` table
- `User.deactivatedAt` for grace-period lockout
- `AuditAction` ADD VALUE only: `DATA_EXPORT`, `ACCOUNT_DELETE_REQUEST`, `ACCOUNT_DELETE_COMPLETE`, `ACCOUNT_DELETE_CANCELLED` (not used in this SQL)
- Personal FKs → `ON DELETE CASCADE`
- Authored content FKs → nullable + `ON DELETE SET NULL`
- `SessionResource.userId` → nullable + `ON DELETE SET NULL` (shared session materials survive)
- `Event.createdById` / `Session.speakerId` → `ON DELETE SET NULL`
- `UserReport` reporter/reported cascades left as-is (future option)
- Does **not** alter `EventMembership.checkInCode` (must keep `@default(cuid())` in schema)

## App layer (ships with this commit; needs migrate for DB tests)

See `apps/api/src/lib/accountDeletion/` and `USER_FK_ENUMERATION.md` under `prisma/proposed/`.
