ALTER TABLE "User"
ADD COLUMN "photoUrl" TEXT,
ADD COLUMN "researchInterests" TEXT;

CREATE TABLE "SessionBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionBookmark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionBookmark_userId_sessionId_key" ON "SessionBookmark"("userId", "sessionId");

ALTER TABLE "SessionBookmark" ADD CONSTRAINT "SessionBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionBookmark" ADD CONSTRAINT "SessionBookmark_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
