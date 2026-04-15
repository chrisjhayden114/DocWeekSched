ALTER TABLE "Event" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Session" ADD COLUMN "location" TEXT;

CREATE TABLE "SessionLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionLike_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionLike_userId_sessionId_key" ON "SessionLike"("userId", "sessionId");
ALTER TABLE "SessionLike" ADD CONSTRAINT "SessionLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionLike" ADD CONSTRAINT "SessionLike_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
