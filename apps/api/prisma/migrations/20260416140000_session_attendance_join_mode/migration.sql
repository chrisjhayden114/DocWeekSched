-- CreateEnum
CREATE TYPE "SessionJoinMode" AS ENUM ('VIRTUAL', 'IN_PERSON');

-- AlterTable
ALTER TABLE "SessionAttendance" ADD COLUMN "joinMode" "SessionJoinMode";
