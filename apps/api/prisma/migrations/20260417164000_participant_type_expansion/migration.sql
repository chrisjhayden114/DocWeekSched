DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'ParticipantType' AND e.enumlabel = 'EDD_STUDENT'
  ) THEN
    ALTER TYPE "ParticipantType" ADD VALUE 'EDD_STUDENT';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'ParticipantType' AND e.enumlabel = 'PHD_STUDENT'
  ) THEN
    ALTER TYPE "ParticipantType" ADD VALUE 'PHD_STUDENT';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'ParticipantType' AND e.enumlabel = 'EDL_ALUMNI'
  ) THEN
    ALTER TYPE "ParticipantType" ADD VALUE 'EDL_ALUMNI';
  END IF;
END $$;
