-- CreateEnum
CREATE TYPE "SessionResourceKind" AS ENUM ('LINK', 'FILE');

-- CreateTable
CREATE TABLE "SessionResource" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "SessionResourceKind" NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SessionResource_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SessionResource" ADD CONSTRAINT "SessionResource_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionResource" ADD CONSTRAINT "SessionResource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
