-- Fix: schema.prisma (phase 1 rebuild) declares User.participantType as String?,
-- but no migration ever converted the column from the legacy "ParticipantType"
-- Postgres enum. Rows holding enum values (e.g. 'EDL_ALUMNI') made every
-- prisma.user read throw P2032-style conversion errors in production (login 500s).
-- Dev never caught it because seeded users have NULL here.
--
-- Convert the column to TEXT, preserving existing values verbatim.
ALTER TABLE "User" ALTER COLUMN "participantType" TYPE TEXT USING "participantType"::text;

-- Nothing references the enum type after the conversion.
DROP TYPE IF EXISTS "ParticipantType";
