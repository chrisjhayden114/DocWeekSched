-- AlterEnum
ALTER TYPE "SessionJoinMode" ADD VALUE 'ASYNC';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "allowVirtualJoin" BOOLEAN NOT NULL DEFAULT true;
