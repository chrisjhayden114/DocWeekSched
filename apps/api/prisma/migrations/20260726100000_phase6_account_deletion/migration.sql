-- Phase 6 Chunk B — Account deletion cascade + grace period
-- DO NOT APPLY until founder review. Per process: review SQL first, then migrate deploy.
--
-- IMPORTANT (Postgres): ALTER TYPE ... ADD VALUE cannot be used in the same transaction
-- as statements that reference the new values. This migration ONLY adds the enum values;
-- application code uses them after deploy. No INSERT/UPDATE with new AuditAction values here.
--
-- EventMembership.checkInCode retains client @default(cuid()) — this SQL does not touch that column.

-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'COMPLETE', 'CANCELLED');

-- AlterEnum (AuditAction) — ADD VALUE only; do not use in this migration.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DATA_EXPORT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETE_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETE_COMPLETE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETE_CANCELLED';

-- AlterTable User — grace-period deactivation flag
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);

-- CreateTable AccountDeletionRequest
CREATE TABLE "AccountDeletionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "hardDeleteJobId" TEXT,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountDeletionRequest_userId_key" ON "AccountDeletionRequest"("userId");
CREATE INDEX "AccountDeletionRequest_status_scheduledFor_idx" ON "AccountDeletionRequest"("status", "scheduledFor");

ALTER TABLE "AccountDeletionRequest"
  ADD CONSTRAINT "AccountDeletionRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Personal tables: Restrict → Cascade
ALTER TABLE "SessionBookmark" DROP CONSTRAINT IF EXISTS "SessionBookmark_userId_fkey";
ALTER TABLE "SessionBookmark"
  ADD CONSTRAINT "SessionBookmark_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionAttendance" DROP CONSTRAINT IF EXISTS "SessionAttendance_userId_fkey";
ALTER TABLE "SessionAttendance"
  ADD CONSTRAINT "SessionAttendance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionLike" DROP CONSTRAINT IF EXISTS "SessionLike_userId_fkey";
ALTER TABLE "SessionLike"
  ADD CONSTRAINT "SessionLike_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SurveyAnswer" DROP CONSTRAINT IF EXISTS "SurveyAnswer_userId_fkey";
ALTER TABLE "SurveyAnswer"
  ADD CONSTRAINT "SurveyAnswer_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationMember" DROP CONSTRAINT IF EXISTS "ConversationMember_userId_fkey";
ALTER TABLE "ConversationMember"
  ADD CONSTRAINT "ConversationMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CheckIn" DROP CONSTRAINT IF EXISTS "CheckIn_userId_fkey";
ALTER TABLE "CheckIn"
  ADD CONSTRAINT "CheckIn_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve authored content: Cascade/Restrict → SetNull + nullable
ALTER TABLE "ConversationMessage" DROP CONSTRAINT IF EXISTS "ConversationMessage_userId_fkey";
ALTER TABLE "ConversationMessage" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "ConversationMessage"
  ADD CONSTRAINT "ConversationMessage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NetworkThread" DROP CONSTRAINT IF EXISTS "NetworkThread_authorId_fkey";
ALTER TABLE "NetworkThread" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "NetworkThread"
  ADD CONSTRAINT "NetworkThread_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NetworkReply" DROP CONSTRAINT IF EXISTS "NetworkReply_authorId_fkey";
ALTER TABLE "NetworkReply" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "NetworkReply"
  ADD CONSTRAINT "NetworkReply_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SessionDiscussionThread" DROP CONSTRAINT IF EXISTS "SessionDiscussionThread_authorId_fkey";
ALTER TABLE "SessionDiscussionThread" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "SessionDiscussionThread"
  ADD CONSTRAINT "SessionDiscussionThread_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SessionDiscussionReply" DROP CONSTRAINT IF EXISTS "SessionDiscussionReply_authorId_fkey";
ALTER TABLE "SessionDiscussionReply" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "SessionDiscussionReply"
  ADD CONSTRAINT "SessionDiscussionReply_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CfpReview" DROP CONSTRAINT IF EXISTS "CfpReview_reviewerUserId_fkey";
ALTER TABLE "CfpReview" ALTER COLUMN "reviewerUserId" DROP NOT NULL;
ALTER TABLE "CfpReview"
  ADD CONSTRAINT "CfpReview_reviewerUserId_fkey"
  FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnnouncementAuditLog" DROP CONSTRAINT IF EXISTS "AnnouncementAuditLog_actorId_fkey";
ALTER TABLE "AnnouncementAuditLog" ALTER COLUMN "actorId" DROP NOT NULL;
ALTER TABLE "AnnouncementAuditLog"
  ADD CONSTRAINT "AnnouncementAuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Shared session materials (slides/papers/links) — keep row, null uploader
ALTER TABLE "SessionResource" DROP CONSTRAINT IF EXISTS "SessionResource_userId_fkey";
ALTER TABLE "SessionResource" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "SessionResource"
  ADD CONSTRAINT "SessionResource_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Event creator + legacy Session.speaker User link → SetNull
ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_createdById_fkey";
ALTER TABLE "Event" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Session" DROP CONSTRAINT IF EXISTS "Session_speakerId_fkey";
ALTER TABLE "Session" ALTER COLUMN "speakerId" DROP NOT NULL;
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_speakerId_fkey"
  FOREIGN KEY ("speakerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
