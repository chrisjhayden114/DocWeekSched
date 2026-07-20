# Phase 1 migration — tenancy, roles, security

This migration is **self-sufficient**: it creates the org/billing enums and tables that existed only in `schema.prisma` (never in prior migration folders), then backfills, then enforces `Event.organizationId NOT NULL`.

## Dev

Apply only against the Neon **dev** branch (local `.env` `DATABASE_URL`):

```bash
cd apps/api && npx prisma migrate deploy
```

If a previous attempt failed mid-run, Prisma may have recorded the migration as failed — inspect `_prisma_migrations`, then `prisma migrate resolve` as appropriate before re-deploy. Confirm hostname is **not** `ep-square-lab` before running.

## Production deploy (CRITICAL)

Local `.env` and Render historically shared the same Neon host. Production must use Render’s `DATABASE_URL` only.

**Sequence for production:** deploy the new API code **and** run this migration **in the same release**. Render’s build already runs `prisma migrate deploy` before start — ship this branch as one deploy so schema and code that require `Organization` / hashed tokens / required `organizationId` land together.

Do **not**:
- Point a laptop `.env` at production and migrate “early”
- Deploy Phase 1 code without this migration (boot/queries will fail)
- Run this migration against production from a local machine unless you intentionally intend a production schema change with a matching deploy

Rollback is documented at the bottom of `migration.sql` (manual).
