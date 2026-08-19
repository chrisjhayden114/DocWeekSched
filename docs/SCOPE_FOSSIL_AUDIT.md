# Scope-fossil audit — 2026-08-20

Trigger: PART-1 replaced the legacy account-global hardcoded `User.participantType`
enum with organizer-defined per-event labels. Founder asked whether other features
share the same disease. A dedicated audit agent swept the schema, UI option lists,
and copy for three tells: wrong scope (global vs per-event), hardcoded lists that
should be organizer-defined, and old-DocWeek jargon — plus single-event behavioral
assumptions.

## Fix BEFORE pilot outreach (chunk FOSSIL-1)

1. Setup copilot event types (shared/setupCopilot.ts:9, api dialogue.ts:158/303,
   extract.ts:35, parse.ts:7-11): no PD-day/training type exists; bare word
   "program" mis-routes to academic_program. Add `pd_day` type + question copy +
   keyword patterns (pd, professional development, in-service, inset, training) +
   preset + skeleton tracks (skeleton.ts:45-64 — "Keynote / Workshops /
   Grade-level breakouts" instead of "Plenary / Paper sessions / Methods").
   Also features.ts:314/393 preset trio gains/renames a PD-day preset.
2. Demo/sample event fixture (api lib/demoEvent/fixture.ts) is doctoral-program
   content (doctoral mentoring bios, cohort papers) — shown at /e/demo AND offered
   to every new organizer. Make audience-neutral or type-aware.
3. "Research interests" copy → neutral "Interests / topics you care about":
   WelcomeFlow.tsx:199, dashboard.tsx:3448/4343/2900/2996, matchmaker fallback
   "shared research interests" (embedding.ts:11-18, batch.ts:117). Copy-only;
   field/scope move is backlog.
4. Profile placeholder "Title (e.g. PhD Candidate)" (dashboard.tsx:3418) → neutral.
5. Analytics + recap sum GLOBAL lifetime engagementPoints into per-event reports
   (analytics.ts:50/140/226, recap/metrics.ts:63/90/177; points.ts:17 increments
   globally). Read-side fix now: scope or clearly label; storage move is backlog.
6. Homepage hero ingest-demo sample text is an academic methods workshop
   (marketing/HeroIngestDemo.tsx:4-14) — swap to a PD-day agenda sample.

## Backlog (wrong shape, will bite later)

- User.role global vs EventMembership.role: directory/roster/messages show the
  GLOBAL role (attendees.ts:199/219 returns user.role; dashboard.tsx:5263;
  messagesView.ts:103) — a speaker at event A shows "Speaker" everywhere; global
  ADMIN leaks; sessions.ts:790 gates a sweep on global role; register still asks
  for a global role (authRegisterSchema.ts:10). Migrate reads to eventRole
  (already in payloads), then drop User.role + register-time choice.
- engagementPoints storage → EventMembership or per-event ledger; then gem tiers
  and the "reset my points" escape hatch follow.
- Per-event interests + per-(user,event) MatchProfileEmbedding (currently
  userId-unique); WelcomeFlow edits the global profile on every event's welcome.
- Drop User.participantType column + /auth/me + export fields after backfill.
- NotificationPreference: schema supports a global default row (eventId null) but
  no UI/route ever writes it — quiet hours/digest re-configured per event. Add an
  account-level settings surface.
- localStorage.activeEventId is one global key (organizerLinks.ts:18,
  dashboard.tsx:459-518, session pages) — two tabs on different events fight;
  derive event context from route. ConciergeChat open-state key likewise
  un-scoped (cosmetic).
- Wizard review shows raw `academic_program` token (new.tsx:597).
- Test-fixture naming hygiene (DocWeek strings in tests only; not user-visible).

## Verified clean (not fossils)

Messaging strictly per-event (Conversation.eventId required); directoryOptIn,
matchMeEnabled, messagePolicy, welcomeSeenAt, participantLabel, checkInCode all on
EventMembership; UserBlock/UserReport/IcsFeedToken event-scoped; CFP custom fields
organizer-defined; sponsor tier free-text; report reasons + community channel enum
acceptable product decisions; scanner offline cache per-event; no Test60/DocWeek
strings user-visible; NotificationPushDay global daily cap is a deliberate
device-level calm budget.
