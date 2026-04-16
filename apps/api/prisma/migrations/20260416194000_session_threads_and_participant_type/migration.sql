-- CreateEnum
CREATE TYPE "ParticipantType" AS ENUM ('GRAD_STUDENT', 'PROFESSOR');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "participantType" "ParticipantType";

-- CreateTable
CREATE TABLE "SessionDiscussionThread" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "SessionDiscussionThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionDiscussionReply" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "SessionDiscussionReply_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SessionDiscussionThread" ADD CONSTRAINT "SessionDiscussionThread_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscussionThread" ADD CONSTRAINT "SessionDiscussionThread_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscussionReply" ADD CONSTRAINT "SessionDiscussionReply_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "SessionDiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscussionReply" ADD CONSTRAINT "SessionDiscussionReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
