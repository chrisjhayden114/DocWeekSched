-- AlterTable
ALTER TABLE "User" ADD COLUMN     "engagementPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "imageUrl" TEXT;

-- CreateTable
CREATE TABLE "NetworkThread" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "NetworkThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkReply" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "NetworkReply_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "NetworkThread" ADD CONSTRAINT "NetworkThread_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkThread" ADD CONSTRAINT "NetworkThread_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkReply" ADD CONSTRAINT "NetworkReply_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "NetworkThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkReply" ADD CONSTRAINT "NetworkReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
