ALTER TABLE "UserReport" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "UserReport" ADD COLUMN "transcriptSnapshot" JSONB;
ALTER TABLE "EventMembership" ADD COLUMN "messagingSuspendedAt" TIMESTAMP(3);
