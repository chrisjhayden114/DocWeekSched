# Phase 2.6 — EventFeatureConfig

**Status: written, not applied.** Review `migration.sql`, then on the **dev** Neon branch:

```bash
cd apps/api && npx prisma migrate deploy
```

## What it does
- Creates `EventFeatureConfig` (`eventId` unique → `Event`, CASCADE delete).
- `overrides` JSONB default `{}` — feature key → bool or digest string (`daily` / `weekly` / `interrupts_only`).
- No backfill; existing events keep registry defaults until an organizer saves overrides.
- No enum casts.

## Reverse
```sql
DROP TABLE IF EXISTS "EventFeatureConfig";
```

## After apply
Tell the agent migrate succeeded; then registry + `featureEnabled` + GET/PUT `/event/features` + wizard/settings UI + tests will be implemented.
