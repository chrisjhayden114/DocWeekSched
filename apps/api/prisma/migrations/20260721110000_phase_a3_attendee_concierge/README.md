# Phase A3 — Attendee Concierge

**Status: applied on dev.** App layer follows in subsequent commits.

---

## Must-confirms (in the SQL)

1. **No `ADD VALUE` on any existing enum** — `ConversationType`, `NotificationKind`, `AiMeterFeature`, `EventMemberRole`, `AuditAction`, etc. are untouched.
2. **`ConciergeMessageRole` and `ConciergePendingActionStatus`** are new `CREATE TYPE`s used only on new tables — fine in one transaction.
3. **Additive only** — no `ALTER` of existing NOT NULL columns, no row backfills.
4. **Idempotent** — `IF NOT EXISTS` / `duplicate_object`-guarded FKs.
5. **`ConciergePendingAction.userId` + `eventId`** are FK-constrained. App layer: propose mints the row; confirm executes only when those columns match the **server session** (never model output). Default pending TTL is **30 minutes** (`expiresAt`, set by app).

---

## What this migration does

### Enums
| Type | Values |
|------|--------|
| `ConciergeMessageRole` | `USER`, `ASSISTANT`, `SYSTEM` |
| `ConciergePendingActionStatus` | `PENDING`, `CONFIRMED`, `CANCELLED`, `EXPIRED` |

### Tables
| Table | Purpose |
|-------|---------|
| `EventFaq` | Organizer-editable FAQ for grounding |
| `ConciergeConversation` | One chat thread per `(eventId, userId)` |
| `ConciergeMessage` | Persisted turns + optional tool proposal metadata |
| `ConciergePendingAction` | Confirm-gated mutations (server-minted) |

### Not included (app layer)
- Gateway tools, mock dialogue, confirm endpoint, fab UI, FAQ settings editor
- Clearing `concierge` `plannedPhase` in the feature registry (TS only)
- Extending the grounding builder for FAQ / agenda / maps

---

## Mid-failure recovery

If deploy fails partway:

1. **Reset the dev Neon branch from its parent** (do not hand-patch).
2. Re-run `npx prisma migrate deploy`.

Do not attempt partial repair on a half-applied schema.

---

## Reverse (dev only) — documented drop order

```sql
DROP TABLE IF EXISTS "ConciergePendingAction";
DROP TABLE IF EXISTS "ConciergeMessage";
DROP TABLE IF EXISTS "ConciergeConversation";
DROP TABLE IF EXISTS "EventFaq";

DROP TYPE IF EXISTS "ConciergePendingActionStatus";
DROP TYPE IF EXISTS "ConciergeMessageRole";
```

Also remove the migration row from `_prisma_migrations` only on a disposable branch reset, or prefer a full Neon reset.

---

## After you migrate

1. Confirm `\d "EventFaq"`, `ConciergeConversation`, `ConciergeMessage`, `ConciergePendingAction`.
2. Tell the agent migrate succeeded — app layer (mock concierge, typed tools, confirm cards, UI, tenancy tests) follows in small commits.
