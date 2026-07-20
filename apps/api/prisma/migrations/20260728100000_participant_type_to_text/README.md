# participant_type_to_text

Aligns the database with schema.prisma for `User.participantType`.

The SaaS rebuild (phase 1) changed this field from the legacy `ParticipantType`
Postgres enum to a plain `String?`, but shipped no column conversion. Production
users created by the original app hold enum values (`EDL_ALUMNI`, `PROFESSOR`,
etc.), and Prisma refuses to convert an unknown enum into the expected string
type — every `prisma.user` read on such rows failed, breaking login after the
launch cutover.

This migration:

1. `ALTER TABLE "User" ALTER COLUMN "participantType" TYPE TEXT USING ::text`
   — values are preserved exactly (`EDL_ALUMNI` stays `EDL_ALUMNI`).
2. Drops the now-unreferenced `ParticipantType` enum type.

Verified against the full legacy enum inventory: every other pre-rebuild enum
(`Role`, `QuestionType`, `ConversationType`, `SessionAttendanceStatus`,
`SessionJoinMode`, `SessionResourceKind`, `NetworkChannel`, `NotificationKind`)
still exists in schema.prisma — `ParticipantType` was the only enum→String
change, so this is the only column needing conversion.
