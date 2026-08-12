ALTER TABLE "NotificationPreference" ADD COLUMN "messageEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "EventMembership" ADD COLUMN "messagePolicy" TEXT NOT NULL DEFAULT 'ANYONE';
