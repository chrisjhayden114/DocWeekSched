# Phase 2 migration — organizer self-service

Creates EventSeries, Track, Room, Speaker, SessionItem (+ authors), event enrichments, and session track/room FKs.

## Critical backfill

**All existing events are set to `ACTIVE` (Published)** so pre-Phase-2 public `/e/<slug>` and join links stay reachable. Only **new** events created by the app after this deploy start as `DRAFT`.

## Dev

Confirm `DATABASE_URL` hostname is the Neon **dev** branch (not `ep-square-lab`), then:

```bash
cd apps/api && npx prisma migrate deploy
```

## Production

Deploy API code that enforces publish-gating **in the same release** as this migration so existing events are ACTIVE before public routes start returning 404 for drafts.

## Rollback

See comments at the bottom of `migration.sql` (manual).
