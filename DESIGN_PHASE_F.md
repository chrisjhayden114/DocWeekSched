# DESIGN_PHASE_F — content-first: the interaction-model shift

**Written 2026-08-07. The founder's key insight: the app feels "boxy / fill-this-
box-then-that-box / like a table being filled out." That is not a decoration
problem — it is an interaction-model problem. E28–E30 polished the boxes; this
phase changes what greets the user.**

Direction confirmed: warmer than "quietly excellent," but "quietly excellent" was
never meant to mean basic. Priority order the founder set: **functionality and
flow first** (can a user understand what a page needs, navigate, feel the whole),
aesthetics in service of that.

## The diagnosis
**The app is form-first. It should be content-first.** Every page leads with empty
inputs to fill. Professional software leads with *content and state*, and makes
creation a contextual, on-demand action.

## The five principles (apply app-wide)
1. **Content-first, compose-on-demand.** Content is the hero; creation collapses
   to one affordance that expands (inline or slide-over) only when invoked. No
   page opens as a stack of empty fields.
2. **Wayfinding header on every page** — title + one-line state + primary action.
   ("Draft · Jun 8–10 · 3 steps from publishing.")
3. **An orienting overview.** A real organizer home: event state, a "before you
   publish" checklist, next step. The bigger-picture entry point. Earned home for
   tasteful count-ups (stat cards).
4. **Progressive disclosure.** Essential fields shown; advanced tucked behind
   "More options." The edit drawer is the worst current offender.
5. **Rich, scannable cards** — people, status pills, inline actions; a glance
   says what a thing is and what you can do.

## Count-ups (founder ok'd "a few more, not everywhere")
Allowed: organizer-overview stat cards (sessions/speakers/registered/rooms) and
the ingest result. Nowhere else. Still `prefers-reduced-motion`-gated.

## Visual language (warmer than E28–E30, still calm/academic)
Softer radii (12–16px cards, pill controls), layered surfaces (page → card →
inner), filled-accent primary button, tinted icon tiles for section identity,
status pills in role colors, real empty states ("Start the conversation," not
"Nothing here yet"). No gradients/glass/neon. Reference mockups shown in chat
2026-08-07 (community content-first; organizer overview dashboard).

## Rollout (proposed chunks — build after the founder locks the direction)
- **F1 — pattern kit.** Codify the reusable pieces as components: `PageHeader`
  (title/state/action), `Composer` (collapsed→expanded), `FeedCard`, `StatCard`
  (with count-up), `FilterPills`, `EmptyState`, `SlideOver` (progressive
  disclosure). Tokens for the warmer radii/surfaces. One chunk, no page rewrites
  yet — just the kit + a styleguide page.
- **F2 — organizer overview.** New content-first home using the kit (the mockup).
- **F3 — Community + Messages** content-first (the feed mockup).
- **F4 — edit drawer & forms** to progressive disclosure via SlideOver.
- **F5 — agenda + session page** polish onto the kit; assistant (old E31 scope)
  folds in here as a content-first panel.
Each chunk: build on the kit → founder reviews on ukedl.com → iterate.

## Non-negotiables
Reduced-motion respected; contrast held; tokens/config only; no schema/API
changes (presentation + the assistant's response rendering only); anti-goals hold
(no engagement theatre, dark patterns, manufactured urgency).
