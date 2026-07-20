# Phase P2 — Venue maps

**Status: written, not applied.** Review `migration.sql` in full, then on the **dev** Neon branch only:

```bash
cd apps/api && npx prisma migrate deploy
```

Do **not** run against production / `ep-square-lab`.

---

## What this migration does

### `VenueMap`
| Column | Notes |
|--------|--------|
| `eventId` | FK → `Event`, **ON DELETE CASCADE** |
| `name` | Floor / building label |
| `imageUrl` | String from existing `getStorageProvider()` (object store **or** data-URL fallback) |
| `sortOrder` | Default `0` — multiple maps per event |

Indexes: `(eventId)`, `(eventId, sortOrder)`.

### `MapPin`
| Column | Notes |
|--------|--------|
| `mapId` | FK → `VenueMap`, **ON DELETE CASCADE** |
| `roomLabel` | Pin display label |
| `x`, `y` | `DOUBLE PRECISION` — **percentages** of image size (app validates 0–100) |
| `linkedRoomId` | Optional FK → `Room`, **ON DELETE SET NULL** |

Indexes: `(mapId)`, `(linkedRoomId)`.

### Not included
- No enums / casts / backfill
- No feature-registry SQL (`venue_maps` unhide is app layer after apply)
- No storage-provider changes — uploads stay on the Phase 2 interface

---

## Reverse

```sql
DROP TABLE IF EXISTS "MapPin";
DROP TABLE IF EXISTS "VenueMap";
```

---

## After you apply successfully

Tell the agent migrate succeeded. Next (small commits):

1. Maps/pins API CRUD + upload via `getStorageProvider()`
2. Organizer editor (click/drop/drag pins, link Room)
3. Attendee Maps section + “View on map” (CSS zoom)
4. Unhide `venue_maps` and gate via `featureEnabled`
5. Tests: pin CRUD, room linking, percentage positioning across sizes
