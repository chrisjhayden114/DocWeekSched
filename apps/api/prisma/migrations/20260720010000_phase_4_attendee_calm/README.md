# Phase 4 — Attendee baseline + Calm Notification System

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

---

## Must-confirms (in the SQL)

1. **NotificationKind ADD VALUE isolation** — Section 1 only adds the 7 new labels (`ANNOUNCEMENT`, `MEETING_REQUEST`, `MEETING_ACCEPTED`, `SESSION_CHANGED`, `SESSION_STARTING_SOON`, `DIGEST_ROLLUP`, `USER_REPORT`). They are **not** inserted or compared as `"NotificationKind"` enum values anywhere else in the same migration (Postgres forbids using a freshly-added enum value in the same transaction). Class backfill uses `"kind"::text` against **existing** labels only (`MESSAGE`, `ADMIN_REQUEST`, `WAITLIST_PROMOTED` → INTERRUPT; else → DIGEST). Newly `CREATE TYPE`'d enums (`NotificationClass`, etc.) **are** used — that is fine.

2. **UserNotification.class / delivery** — Added **NULLABLE** first → backfill with explicit casts (`'INTERRUPT'::"NotificationClass"`, etc.) → then `SET NOT NULL` + defaults. Existing live rows are preserved.

3. **directoryOptIn** — `BOOLEAN NOT NULL DEFAULT false` (privacy-first). **No** grandfathering of existing members to opted-in. Optional opt-in backfill is a separate step you may run later.

---

## What this migration does

### Enums
| Type | Values |
|------|--------|
| `NotificationKind` (extend) | +7 labels (ADD VALUE only; forward-only in Postgres) |
| `NotificationClass` | `INTERRUPT`, `DIGEST` |
| `NotificationDelivery` | `INBOX`, `QUEUED_PUSH`, `PUSHED`, `DIGESTED`, `SUPPRESSED` |
| `AnnouncementAudience` | `EVERYONE`, `ROLE`, `SESSION_JOINERS`, `ATTENDANCE_MODE` |
| `MeetingRequestStatus` | `PENDING`, `ACCEPTED`, `DECLINED`, `CANCELLED` |
| `ModerationReportStatus` | `OPEN`, `REVIEWED`, `DISMISSED` |
| `PersonalAgendaSource` | `MEETING`, `CUSTOM` |

### Columns / tables
- `User`: `title`, `affiliation`, `bio` (nullable)
- `EventMembership.directoryOptIn` default **false**
- `NotificationPreference` (quiet hours / digest / mutes; partial unique global + per-event)
- `NotificationPushDay` (daily push budget ledger; ceiling is app config = 5)
- `UserNotification`: `class`, `delivery`, `queuedUntil`, FKs, `pushDedupKey`, `budgetCharged`
- `Announcement`: audience / segment / email / emergency / preview / `publishedAt` / `updatedAt`
- `AnnouncementAuditLog`
- `MeetingRequest`, `MeetingSlot`, `PersonalAgendaBlock`
- `UserBlock`, `UserReport`
- `IcsFeedToken`, `PushSubscription`

### Not included
- Feature-registry SQL (`daily_digest` unhide is app layer)
- PWA / service worker files
- Grandfathering directory opt-in
- Entitlement catalog changes

---

## Mid-failure recovery

This migration is **large** and updates existing `UserNotification` / `Announcement` rows. If it fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

Do not attempt partial repair on a half-applied schema.

---

## Reverse

```sql
DROP TABLE IF EXISTS "PushSubscription";
DROP TABLE IF EXISTS "IcsFeedToken";
DROP TABLE IF EXISTS "UserReport";
DROP TABLE IF EXISTS "UserBlock";
DROP TABLE IF EXISTS "AnnouncementAuditLog";
DROP TABLE IF EXISTS "PersonalAgendaBlock";
DROP TABLE IF EXISTS "MeetingSlot";
DROP TABLE IF EXISTS "MeetingRequest";
DROP TABLE IF EXISTS "NotificationPushDay";
DROP TABLE IF EXISTS "NotificationPreference";

-- Then strip added columns from UserNotification, Announcement, EventMembership, User
-- (ALTER TABLE … DROP COLUMN …)

DROP TYPE IF EXISTS "PersonalAgendaSource";
DROP TYPE IF EXISTS "ModerationReportStatus";
DROP TYPE IF EXISTS "MeetingRequestStatus";
DROP TYPE IF EXISTS "AnnouncementAudience";
DROP TYPE IF EXISTS "NotificationDelivery";
DROP TYPE IF EXISTS "NotificationClass";

-- NotificationKind ADD VALUE labels cannot be removed in Postgres — forward-only.
```

---

## After you apply successfully

Tell the agent migrate succeeded. Next (small commits):

1. Calm notification platform lib + tests + unhide `daily_digest` + one inbox (no per-tab badges)
2. Announcements segmented / preview / emergency + budget meter
3. Directory opt-in, profile fields, meetings, block/report
4. Agenda filters/search/now-next/ICS/stars; session page polish; PWA + web push
