-- Session detail fields for richer admin-managed session content
ALTER TABLE "Session"
ADD COLUMN "speakers" TEXT,
ADD COLUMN "zoomLink" TEXT,
ADD COLUMN "recordingUrl" TEXT,
ADD COLUMN "fileUrl" TEXT,
ADD COLUMN "fileLink" TEXT;

-- Add per-session attendance status (joining / not joining)
CREATE TYPE "SessionAttendanceStatus" AS ENUM ('JOINING', 'NOT_JOINING');

CREATE TABLE "SessionAttendance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "SessionAttendanceStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SessionAttendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionAttendance_userId_sessionId_key" ON "SessionAttendance"("userId", "sessionId");

ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Session-specific conversations
ALTER TYPE "ConversationType" ADD VALUE 'SESSION';

ALTER TABLE "Conversation" ADD COLUMN "sessionId" TEXT;
CREATE UNIQUE INDEX "Conversation_sessionId_key" ON "Conversation"("sessionId");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
