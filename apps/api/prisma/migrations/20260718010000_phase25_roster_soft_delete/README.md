# Phase 2.5 — roster soft-delete

**Status: NOT APPLIED.** Review and run `npx prisma migrate deploy` on the **dev** Neon branch when ready.

Adds `EventMembership.deletedAt`. DELETE `/attendees/:id` sets this timestamp instead of hard-deleting the membership. Active roster / access checks ignore rows with `deletedAt` set. A later job (or admin restore) can purge after 30 days.
