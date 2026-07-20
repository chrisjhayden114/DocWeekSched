# Account deletion — PROPOSED (not applied)

**Status:** Awaiting founder approval. Do **not** run `prisma migrate` on this folder.
**Location:** Outside the live `prisma/migrations/` pipeline on purpose.

See `USER_FK_ENUMERATION.md` for the full foreign-key inventory and delete design.

## Goals

1. Hard-delete the User row after cascading **personal** data.
2. **Preserve** conference content (sessions, papers, CFP conversions, announcements) via SetNull / anonymize.
3. Block deletion when the user is the **sole OWNER** of any Organization until transfer or org closeout.
4. Keep `EventMembership.checkInCode String @default(cuid())` on any schema edit.

## Proposed schema changes (review only)

### 1. AuditAction enum values

```sql
-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DATA_EXPORT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETE_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETE_COMPLETE';
```

(Prisma enum edit equivalent — generate via migrate after approval.)

### 2. AccountDeletionRequest table

```sql
-- CreateTable
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountDeletionRequest_userId_key" ON "AccountDeletionRequest"("userId");
CREATE INDEX "AccountDeletionRequest_status_requestedAt_idx" ON "AccountDeletionRequest"("status", "requestedAt");

ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### 3. FK behavior changes required before hard-delete can succeed

Today these **Restrict** (Prisma default) FKs would **block** `DELETE FROM "User"`:

| Table | Column | Proposed fix |
|---|---|---|
| SessionBookmark | userId | ON DELETE CASCADE |
| SessionAttendance | userId | ON DELETE CASCADE |
| SessionLike | userId | ON DELETE CASCADE |
| SurveyAnswer | userId | ON DELETE CASCADE |
| ConversationMember | userId | ON DELETE CASCADE |
| ConversationMessage | userId | ON DELETE CASCADE **or** SetNull + nullable userId + body redaction |
| CheckIn | userId | ON DELETE CASCADE |
| Event | createdById | ON DELETE SET NULL (already optional) |
| Session | speakerId | ON DELETE SET NULL (already optional; roster Speaker rows are separate) |

Example SQL (illustrative — exact Prisma migration to be generated after approval):

```sql
ALTER TABLE "SessionAttendance" DROP CONSTRAINT IF EXISTS "SessionAttendance_userId_fkey";
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_createdById_fkey";
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_speakerId_fkey";
ALTER TABLE "Session" ADD CONSTRAINT "Session_speakerId_fkey"
  FOREIGN KEY ("speakerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

**Do not apply until the accompanying application delete path and sole-OWNER guard are reviewed.**
