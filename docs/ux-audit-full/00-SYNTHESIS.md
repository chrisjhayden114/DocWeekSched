# Full UX audit — synthesis and revised plan (2026-08-07)

Three code-grounded audits (01-public-marketing, 02-attendee-app,
03-organizer-console) covering ~60 screens against the founder's UI/UX
principle framework. They converged on three cross-cutting themes plus two
issues that should be fixed immediately, outside the design phase.

## The three themes (every area agreed)

### Theme A — form-first, everywhere it matters
The single biggest problem, and exactly the founder's diagnosis. Screens that
greet the user with empty inputs instead of content + an on-demand compose:
- **Organizer Overview** leads with the entire settings form (the daily entry
  point shows a form, not the event's state).
- **Create-event wizard** opens on stacked empty inputs; branding is its own step.
- **Community** — permanent empty "New post" form wedged above the feed.
- **Session Q&A** — empty "Start conversation" form above the threads.
- **CFP, Sponsors, Announcements, Profile** — all form-first.
Fix: DESIGN_PHASE_F content-first inversion, applied screen by screen.

### Theme B — navigation and wayfinding contradict themselves
- Two parallel nav systems (sidebar vs nine in-page tabs) never reconcile.
- Sidebar highlight hardcoded to "Overview"; tab state not in the URL, so Back
  exits the whole console and refresh resets the tab.
- Global search is a dead `readOnly` control on every page.
- No consistent page header (title + state + primary action) anywhere.

### Theme C — a two-tier surface + card-soup hierarchy
- Marketing pages and the agenda are mature and on-system; but CFP flow, and
  every token/recovery page (verify-email, reset-password, invite) are
  off-system — bare shells, hardcoded hex instead of tokens, no brand chrome.
- On dense screens everything is an equal white card ("card soup") with no
  hierarchy; hardcoded colors and `window.alert()` validation in places.

## Two things to fix NOW (not design-phase work)
1. **Anti-goal breach:** the attendee Event assistant shows a "See plans" pricing
   upsell (`ConciergeChat.tsx:237-244`) to attendees who can't act on it. This
   violates the no-dark-pattern positioning. Remove it — small, urgent.
2. **Credibility crack:** live Terms and Privacy still show a "DRAFT — requires
   legal review" banner at the exact trust moment. Resolve the legal review or
   drop the banner before real customers read it.

## Highest-impact, most-agreed fixes (ranked)
1. **Invert the organizer Overview** into the content-first home (F2) — stat
   cards + existing SetupAssistantPanel checklist + wayfinding header; settings
   to a slide-over. Biggest single "flow/bigger-picture" win; patterns already
   exist in the codebase (OpsInboxPanel, SetupAssistantPanel).
2. **Community + session Q&A compose-on-demand** (the founder's flagship
   example; two heaviest form-first offenders; presentation-only).
3. **Fix navigation truth:** tab state in URL, real sidebar highlight, make or
   remove the dead search.
4. **Surface the open CFP on the public event page** (discoverability of a
   first-class feature; doubles as the F wayfinding header).
5. **Bring the off-system pages onto tokens + brand chrome** (CFP, auth/recovery).

## Revised Phase F rollout (was F1–F5; reordered by audit impact)
- **F0 — quick wins (do first, tiny):** remove the attendee pricing upsell;
  resolve/hide the Terms/Privacy DRAFT banner; put console tab state in the URL +
  fix the hardcoded sidebar highlight; decide the dead global search (build or
  remove).
- **F1 — pattern kit:** PageHeader (title/state/action), Composer
  (collapsed→expanded), FeedCard, StatCard (count-up), FilterPills, EmptyState,
  SlideOver, plus warmer radii/surface tokens. Styleguide page. No page rewrites.
- **F2 — organizer Overview** content-first home (audit's #1).
- **F3 — Community + Messages + session Q&A** content-first (audit's #2).
- **F4 — create-event wizard + edit drawer + Announcements/Sponsors/Profile**
  to progressive disclosure via SlideOver.
- **F5 — CFP end-to-end** (organizer create, reviewer, public submission) —
  onto tokens + content-first; retire the raw "Rubric JSON" and "paste user ID"
  fields. Also fold the off-system auth/recovery pages onto brand chrome here.
- **F6 — public event page** upgrade (banner/logo, speaker/sponsor cards, CFP
  link) + agenda/session polish + the Event assistant elevation (old E31 scope)
  as a content-first grounded panel.
- **E31 (AI spreadsheet)** rides into F5-adjacent ingest work so it's built in
  the new pattern, not bolted on then redone.

## Non-negotiables (unchanged)
Reduced-motion respected; contrast held; tokens/config only; no schema/API
changes (presentation + assistant response-rendering only); anti-goals hold.
