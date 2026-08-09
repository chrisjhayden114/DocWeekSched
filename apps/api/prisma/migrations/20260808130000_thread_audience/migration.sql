-- General post targeting: EVERYONE (default), SESSION, TRACK, or GROUP
ALTER TABLE "NetworkThread" ADD COLUMN "audienceType" TEXT NOT NULL DEFAULT 'EVERYONE',
ADD COLUMN     "audienceSessionId" TEXT,
ADD COLUMN     "audienceTrackId" TEXT,
ADD COLUMN     "audienceUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
