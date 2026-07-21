# Competitive Parity Audit — UKEDL vs Whova / EventPilot / Sched
July 2026, based on founder-captured screenshot folders (19 Whova shots + app guide PDF, 38 EventPilot organizer/CMS shots, 4 Sched shots) reviewed exhaustively, plus the live-site teardowns in DESIGN_PHASE_D.md.

## Verdict in one paragraph
UKEDL is at or above competitor quality on its core surfaces and *ahead* on several (AI program ingest, papers/authors hierarchy in the UI, CFP, certificates, capacity/waitlist, modern visual design — all three competitors ship visibly dated UI: Whova is 2018-iOS idiom, EventPilot is Material-1 + legacy PHP, Sched's product CSS is Bootstrap-era). The genuine gaps cluster in three areas: (1) **schedule views** — both Sched and EventPilot offer a calendar/grid timetable and Sched offers print; UKEDL has only the list view; (2) **the personal layer** — Whova's per-session/per-attendee notes, custom personal agenda items, attendee bookmarking; (3) **networking micro-frictions** — Whova's "Say Hi" templated one-tap greeting. Nothing found threatens parity claims; several competitor "features" (session ads, engagement leaderboards, count-everywhere FOMO) are deliberate UKEDL anti-goals and should stay out.

## Feature-by-feature parity map

### Agenda & schedule
| Capability | Whova | EventPilot | Sched | UKEDL | Status |
|---|---|---|---|---|---|
| Day-by-day list w/ time rail | ✓ | ✓ | ✓ | ✓ (D2, Sched-grade) | PARITY+ |
| Full vs My Schedule + count | ✓ | ✓ | ✓ | ✓ | PARITY |
| Track color coding + filter legend | dots | 15px bars | row tints | 3px bars + dot legend | PARITY |
| Search (sessions/speakers/papers) | ✓ | "Search Everything" | ✓ | ✓ | PARITY |
| Timezone handling | — | ✓ | — | ✓ (toggle) | AHEAD |
| Concurrency side-by-side | — | grid | ✓ wrap | ✓ | PARITY |
| **Calendar/grid timetable view** | — | ✓ Visual Schedule | ✓ Grid + By-Venue views | ✗ | **GAP — build (G1)** |
| **Print-friendly program / print button** | — | print QR signage | ✓ print button | ✗ | **GAP — build (G1)** |
| ICS / add-to-calendar | ✓ | ✓ | ✓ | ✓ API exists (routes/ics) — verify exposed in UI | VERIFY (G1) |
| Custom personal agenda items ("Add my own activity") | ✓ | ✓ (Add Meeting in grid) | — | ✗ | GAP — backlog (B1) |
| Session capacity / waitlist | — | — | ✓ (seats chips) | ✓ | PARITY+ |

### Session & academic objects
| Capability | Competitors | UKEDL | Status |
|---|---|---|---|
| Session detail (time/room/desc/speakers) | all | ✓ | PARITY |
| Papers/presentations nested in sessions w/ authors | EventPilot only (Abstracts module) | ✓ first-class in rows + detail | AHEAD |
| Session Q&A w/ upvotes | Whova (comments) | ✓ | PARITY |
| Likes / ratings / feedback | Whova (like+comment+rate) | ✓ (like, star, feedback rating) | PARITY |
| **Per-session private notes** | Whova, EventPilot (Bookmarks\|Notes + export) | ✗ | GAP — backlog (B2) |
| Slides/handouts on sessions | Whova, EventPilot Media | ✓ SessionResources | PARITY |
| Certificates / attendance credit | EventPilot (scan log substrate; CME at Pro) | ✓ full cert engine + verify page | AHEAD |
| CFP / abstract intake | Whova (separate product) | ✓ built-in | AHEAD |
| AI program ingest | none (EventPilot has import feeds) | ✓ (differentiator) | AHEAD |

### Networking & community
| Capability | Whova | UKEDL | Status |
|---|---|---|---|
| Attendee directory + profiles | ✓ (rich) | ✓ | PARITY |
| Recommendations / matchmaking | ✓ cohorts (city/employer/interests) | ✓ AI matchmaker + meeting slots | PARITY (different mechanism) |
| Meeting requests | ✓ Let's Meet | ✓ meetings module | PARITY |
| DM / group chat / event chat | ✓ | ✓ (DIRECT/GROUP/EVENT) | PARITY |
| Community board w/ topic types (meetups, icebreakers, local) | ✓ | ✓ (MEETUP/MOMENTS/LOCAL/ICEBREAKER/GENERAL) | PARITY |
| **"Say Hi" templated one-tap greeting** | ✓ | ✗ (DM exists, no template affordance) | GAP — build, cheap (G2) |
| Attendee bookmarking + notes on people | ✓ | ✗ | backlog (B2) |
| Contact-info exchange (vCard swap) | ✓ | ✗ | backlog (B3, low) |
| Leaderboard / gamification / counts-everywhere | ✓ | ✗ | **SKIP — anti-goal (calm positioning)** |

### Organizer / ops
| Capability | EventPilot | UKEDL | Status |
|---|---|---|---|
| Import pipelines | recurring import sources | AI ingest + CSV invites | PARITY+ |
| Publish gating | ✓ versioned publish | ✓ draft/publish status | PARITY |
| Announcements / push / digests | ✓ Alerts | ✓ + quiet hours + budgets | AHEAD (calm) |
| Check-in / QR / scan log | ✓ scan log | ✓ QR scanner + check-in | PARITY |
| Badges | ✓ (badge product) | ✓ PDF badge sheets | PARITY |
| Analytics | deep (per-tab, search terms, ad CTR) | event analytics (attendance, engagement) | PARTIAL — backlog (B4: search-term + top-session insights) |
| Session ads / sponsor banners w/ CTR | ✓ | ✗ | **SKIP — "No ads" principle** |
| Floor plans / maps | ✓ | ✓ venue maps | PARITY |
| Custom info pages (policies/logistics) | ✓ | ✓ event FAQ editor + help | PARITY |
| Event marketing kit (QR signage PDF) | ✓ auto-generated | ✗ | backlog (B5, nice) |
| Moderation | ✓ (users/comments/photos) | ✓ reports panel | PARITY |
| Native app stores | container app (75-day lead time, fees) | PWA (instant) | DIFFERENT — UKEDL's model is a *selling point*; keep positioning it |

## Decision: build now vs later
The "later = more work" worry is mostly unfounded here: every backlog item is an **additive** schema/UI change (new tables, no drops), exactly the migration class that has never caused pain. The two things genuinely cheaper to do NOW, while the agenda code is fresh from D2:

**G1 — Schedule views + print (do as Chunk D6, right after D5):** Grid/timetable view (day columns × time axis, EventPilot "Visual Schedule" / Sched "Grid"), a By-Room view, a print stylesheet + Print button on the public event page, and surfacing the existing ICS export as "Add to calendar" buttons. All read-only rendering of data the agenda already fetches — no schema changes.
**G2 — "Say Hi" intro template (fold into D6):** on attendee profiles/rows, a one-tap greeting that opens the existing DM composer pre-filled: "Hi {firstName} — I'm also at {event.name}. Would love to compare notes on {shared interest if present}." Pure UI over the existing messages API.

**Backlog (post-launch, all additive, ordered by value):**
- B1 Custom personal agenda items (new table PersonalAgendaItem; UI in My Schedule)
- B2 Personal notes on sessions + attendees, with export (new Note table; Whova-parity feature academics actually use)
- B3 Contact-info exchange (consent-gated vCard swap)
- B4 Analytics additions: attendee search terms, top sessions by saves, per-surface usage
- B5 Auto-generated event marketing kit (QR poster PDF for organizers)

**Deliberate skips (write these into sales copy as principles, not absences):** session ads, engagement leaderboards/gamification, counts-everywhere FOMO patterns, native app-store container (PWA install is the calmer, zero-lead-time answer — EventPilot's own 75-day launch runway and store-resubmission fees are the counter-pitch).
