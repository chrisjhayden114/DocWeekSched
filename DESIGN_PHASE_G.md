# DESIGN_PHASE_G — Community & social deep-dive (7 founder requests, 2026-08-07)

Triage of seven requests after F3. Categorized: BUG (broken) · QUICK WIN ·
FEATURE (real build) · DECISION (needs founder call, incl. cost/positioning).

## The requests, triaged

### 1. Meet-ups
- **1a. Type-ahead participant search (first AND last name).** QUICK WIN /
  possible BUG. Today the invitee picker filters a directory; "No matches" is
  likely empty data (few directory opt-ins in the sample event), but confirm it
  matches on BOTH first and last name substrings. Make search match any
  name-token, case-insensitive.
- **1b. Nicer date/time picker for "Starts at".** QUICK WIN. Currently native
  datetime-local. Replace with a cleaner but simple picker (kit component);
  keep it lightweight.
- **1c. Join control: pill instead of tick-circle.** QUICK WIN. Replace the
  circle toggle with a pill (the segmented/pill pattern from the kit).

### 2. Moments
- **2a. Can't Post after uploading an image.** BUG — diagnose the compose/upload
  state (photo-only posts may be blocked, or upload doesn't enable Post).
- **2b. Better photo experience (gallery/grid, not linear).** FEATURE. A masonry/
  grid gallery + lightbox, Flickr-style, instead of photos stacked in a feed.
- **2c. Same name-search everywhere.** Rolls up with 1a (shared component).

### 3. Local tips
- **3a. "Find on Google Maps" "does nothing".** NOT A BUG — it opens Maps search
  in a new tab (popup blocker / no text typed). Clarify or improve affordance.
- **3b. In-page place autocomplete based on event location.** DECISION (cost).
  Requires Google Places Autocomplete API — paid, metered, needs a key + billing,
  and per-keystroke cost. Free-ish alternative: OpenStreetMap Nominatim
  (rate-limited, lower quality, usage-policy constraints). Founder must choose:
  pay for Places, use Nominatim, or keep the current "open Maps in a tab."

### 4. Break the ice — networking prompt
- FEATURE + DECISION (positioning). Founder wants: a participant banner/carousel
  (movable with ‹ ›), multi-select people to "break the ice" with, and a clear
  distinction from plain messaging (it should PROMPT connections with people you
  don't know).
- **Anti-goal tension:** the product is deliberately "calm, no engagement
  mechanics." A faces-carousel that nudges you to connect is close to Whova's
  engagement territory. It's defensible IF it stays *facilitation* (help people
  find relevant others), not *gamification* (no points, no streaks, no
  leaderboards, no notification spam). Founder should confirm we keep it calm.
  Also privacy: only show people who opted into the directory.

### 5. General — post targeting + better viewing
- FEATURE + DECISION (notifications/anti-goal). Wants posting scoped to: (a)
  registrants of a session, (b) a track, (c) a chosen group, (d) everyone. And a
  better-than-linear view. Real feature: adds audience scoping to posts, with
  notification implications — targeting must NOT become a spam vector (respect
  the existing notification budget). Needs a permissions/visibility model.

### 6. Session Q&A
- **6a. Move Q&A directly below the session title/description** so posted
  questions are immediately visible. QUICK WIN (reorder the session page).
- **6b. Address a question to "everyone" or to the presenter(s).** FEATURE — a
  recipient/visibility option on questions; small-to-medium (adds a field +
  filtering + maybe a presenter notification within budget).

### 7. Messaging → WhatsApp-style
- BIG FEATURE. E18 built messaging phase 1 deliberately scoped; "like WhatsApp"
  (three-pane, rich threads, presence, etc.) is a multi-chunk effort and overlaps
  the deferred request-gate/consent scope from RESEARCH_MESSAGING.md. Treat as
  its own phase, not a single chunk.

## The decisions only the founder can make
1. **Place autocomplete (3b):** pay for Google Places, use free Nominatim, or
   keep "open Maps in a tab"? (Ongoing cost vs quality vs status quo.)
2. **Break the ice (4) & General targeting (5):** proceed, keeping them CALM
   (facilitation, not gamification; respect notification budget; directory
   opt-in only)? Confirm this doesn't drift into the anti-goals.
3. **Messaging (7) scope:** how far? A visual refresh toward a WhatsApp feel is
   bounded; full presence/real-time/consent-gate is a large multi-chunk phase.

## Recommended sequence
- **G1 — bug fixes + quick wins (do first):** 2a Moments post bug; 1a/2c shared
  type-ahead name search (first+last); 1c join pill; 6a Q&A reposition; clarify
  3a. Concrete, safe, no decisions needed. Presentation/interaction only where
  possible.
- **G2 — photo gallery (2b).** Contained feature.
- **G3 — Q&A recipient option (6b).** Small feature.
- **G4 — break the ice (4)** — only after the positioning call.
- **G5 — General post targeting (5)** — after the notifications/anti-goal call.
- **G6 — place autocomplete (3b)** — only after the cost decision.
- **Messaging (7)** — its own later phase; scope TBD.

## Standing rules (unchanged)
Anti-goals hold (no gamification, no notification spam, no dark patterns);
directory features honor opt-in; reduced-motion; tokens/config; agents draft,
humans confirm. NEVER set ALLOW_DESTRUCTIVE_DB.
