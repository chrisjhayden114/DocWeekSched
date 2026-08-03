# UX_AUDIT_MERGED.md — three-persona audit, consolidated

**Run 2026-08-02 against production build `654d593`.**
Three agents (UX/design expert, novice organiser, Whova/Sched veteran) read
identical captured evidence and reported independently. This document merges
them, marks what was independently verified, and turns it into a work plan.

Individual reports: `UX_AUDIT_01_DESIGN.md`, `UX_AUDIT_02_NOVICE.md`,
`UX_AUDIT_03_VETERAN.md`. Evidence: `PHASE_A_PUBLIC.md`, `PHASE_BCD_APP.md`.

---

## 1. Two blockers, verified in code before being written down

Both were found by agents and then **independently re-verified against the
source** rather than taken on trust. Both are silent failures of the same shape
as the defects found earlier on 2026-08-02: the system had the information to
behave correctly and did something else without saying so.

### B1 — Sessions created by AI ingest can never become attendee-visible (P0)

- `apps/api/prisma/schema.prisma:800` — `publishStatus SessionPublishStatus @default(PUBLISHED)`
- `apps/api/src/lib/ai/ingest/confirm.ts:213` — ingest **explicitly overrides** that default to `DRAFT`
- `apps/api/src/lib/ai/ingest/visibility.ts` — non-managers see only
  `publishStatus: PUBLISHED` on an `ACTIVE` event
- **No route in `apps/api/src/routes/` ever writes `publishStatus: PUBLISHED`.**
  The only writers in the repo are `lib/demoEvent/reset.ts` (the seed) and test
  fixtures. `apps/web` contains **zero** references to `publishStatus` — there is
  no UI control anywhere.

Consequence: an organiser pastes or uploads their programme, confirms 22
sessions, clicks **Publish**, and the public page shows the event with **no
sessions**. `POST /event/publish` flips the *event* to ACTIVE; it does not touch
sessions.

Why nobody noticed: managers see all sessions including drafts, so the Program
tab looks correct from the inside. `/e/demo` looks correct because its seed
writes `PUBLISHED` directly, bypassing ingest entirely.

**Scope:** ingest only. Manually created sessions and (apparently) CSV import
inherit the `PUBLISHED` default and are fine. This makes it precisely the
headline feature that is broken.

### B2 — Edited ingest assumptions are stored and then discarded (P0)

- `apps/api/src/routes/agendaIngest.ts:345` — `PATCH /ai/ingest/:id` persists
  `assumptions` onto the run row
- `apps/api/src/lib/ai/ingest/confirm.ts:164` — `confirmAgendaChangeset` accepts
  `{ prisma, organizationId, eventId, timezone, actorUserId, runId, rows }`.
  **No `assumptions` parameter.** Nothing downstream reads them.

Consequence: the Assumptions panel is the clearest expression of "agents draft,
humans publish" in the product — the model surfaces what it guessed and invites
correction. Correcting it does nothing. The founder's own capture shows the model
flagging "Potterson vs Potterton" and a timezone it says may be wrong; editing
either has no effect on what gets created.

---

## 2. Where all three personas agreed independently

Highest-confidence findings. Three different lenses reached these without
seeing each other's work.

| # | Finding | Fix shape |
|---|---|---|
| C1 | **The 2+ minute ingest wait shows nothing.** No progress, no elapsed time, no "still working". The novice said they would have refreshed the page; the UX expert found copy promising "under a minute" and a poll ceiling of 40s (100 × 400ms); the veteran called it the moment a trialist bails. | Progress state + honest expectation-setting. S |
| C2 | **"(confidence 0.70)" is not actionable.** Nobody could say what to do differently at 0.70 versus 0.95, or which *field* was uncertain. | Point confidence at the specific field, or replace the number with a plain-English reason. S–M |
| C3 | **The ingest review screen is the product's best idea and its densest screen.** Assumptions + numbered create list + update list + delete list, with nested scroll containers and no select-all. All three rated it hard to act on with confidence. | Structural, not styling. M |
| C4 | **"Draft" is overloaded and unexplained.** Event draft vs session draft vs "DRAFT sessions only" in the ingest copy — three meanings, no definition, and (per B1) one of them is a trap. | Copy + the B1 fix. S |

---

## 3. Strong single-persona findings worth keeping

Not independently corroborated — but specific, and several are code-cited.
**These have not been re-verified by me.** Treat the code line references as
leads to check, not as established fact.

**From the UX expert**
- Global search input is `readOnly` on every authenticated page (`AppShell.tsx`)
  — focusable, un-typeable, and occupying ~360px of the top bar. Likely also the
  cause of the truncated "Orga…" / "Sample Academic Confer…" org switcher.
- Console navigation misreports state: `active="overview"` is hardcoded, so the
  sidebar highlights Overview while the tab row highlights Program. Tabs are
  local state with no router push — Back exits the console entirely and refresh
  resets the tab.
- The Program tab's "text all over the place" has a *structural* cause: ~14 rows
  of Tracks/Rooms chrome stacked above the content, four nested left-borders per
  session card, three information types rendered at the same 12px grey weight,
  and Edit/Delete repeated at three nesting levels.
- `.mkt-faq summary { list-style: none }` with no replacement chevron — the
  pricing FAQ looks like five inert headings (matches the capture exactly).
- The attendee agenda renders "0 in-person · 0 virtual · 0 async" on every row —
  counts-everywhere, which is the engagement-metrics anti-goal leaking in. The
  fix is a deletion.
- Explicitly checked and **cleared**: colour contrast (~5.2:1 amber, ~5.6:1
  danger red), 26px row targets against SC 2.5.8, and track colour is never the
  sole carrier of meaning. Worth noting the agent said so rather than padding.

**From the novice**
- An "update fields" row `deleteMany`s that session's speakers and papers before
  rewriting them (`confirm.ts:233–234`) — so re-importing a corrected programme
  destroys hand-fixed author order. Deletes are hard, no undo. **Verify this
  next; if true it is a third P0**, because re-import is the workflow the product
  is built around.
- "Track" is never defined anywhere, including the help articles.
- The Getting-started help article describes UI that does not exist ("Setup
  Copilot", an onboarding checklist) and does not mention agenda ingest at all.

**From the veteran** (competitor claims verified via web search on the day)
- Whova remains quote-only (3.0% + $0.99 per paid ticket; add-ons reported ~$2,000)
  and actively markets leaderboards and gamified surveys in 2026. Sched now
  publishes pricing (~$600 / ~$1,500 / ~$3,900 per year, attendees in 250-buckets).
- **Both now offer web access without an app-store download** — so "no app
  download" is no longer a differentiator on its own. This contradicts current
  positioning and matters for messaging.
- Sched's own docs confirm one row = one session with semicolon-joined
  participants: **no ordered-author paper object exists** in either competitor.
- The `/pricing` line "Checkout is handled by Stripe (merchant of record)" will
  be read by university procurement; make sure it is exactly true before a
  purchase order depends on it.
- Grid view reported as built but non-functional (the capture shows it rendering;
  needs a direct check).

---

## 4. Where they disagreed — the interesting part

**Is the ingest a moat or a novelty?**
The veteran was emphatic that it is real: two minutes against roughly six hours
of Sched spreadsheet surgery, and that the Assumptions list — catching a name
spelled two ways across pages, reading a strikethrough as a withdrawal — *is*
the product and should be the demo. The UX expert and the novice both found that
same screen the hardest to act on. **Both are right, and that is the finding:
the strongest feature sits behind the weakest screen.** That combination is
worth more attention than either report alone.

**What should lead the pitch?**
The veteran argued: lead with the **papers-with-ordered-authors model**, not the
AI — everyone will claim AI ingest within a year, and neither Whova nor Sched
models academic structure. The homepage currently leads with the AI. This is a
strategic judgement, not a defect; it deserves a decision rather than a fix.

---

## 5. What is working — do not change these

Named independently by more than one persona:

- The **"+ Add paper or resource" chooser** (shipped hours before this audit) was
  called the best writing in the product by the novice.
- **"No AI involved"** on the CSV panel — the novice said this, not the AI
  features, is what would earn their trust. Applying that honesty pattern more
  widely is cheap and high-value.
- The **Assumptions concept** — genuinely novel, and the veteran's strongest
  reason to switch.
- **Public pricing** with a real matrix, against two quote-gated competitors.
- The **anti-goals are landing**: no gamification, no push spam, no dark
  patterns. The veteran classified these as deliberate and mostly winning.
- **Papers with ordered authors nested under sessions** — no competitor has it.

---

## 6. Proposed chunk plan

**E13 — the two verified blockers (do first, nothing else matters)**
- B1: give ingested sessions a real path to PUBLISHED. Decide deliberately
  whether ingest should create DRAFT at all, or whether "Publish event" should
  publish its sessions, or whether the Program tab needs a per-session and
  bulk publish control. Whichever: the Program tab must **show** draft state,
  and publishing an event with only draft sessions must warn.
- B2: thread edited `assumptions` through `confirmAgendaChangeset` and apply
  them, or — if applying them is genuinely hard — stop presenting them as
  editable. Do not leave an editable field that does nothing.
- Verify and fix the `deleteMany` on update (novice finding) before it
  destroys a real organiser's author ordering.

**E14 — the ingest review screen (the moat, made usable)**
C1, C2, C3, C4 from the consensus table. Progress indication; confidence pointed
at fields; restructured review screen; "Draft" defined.

**E15 — console truthfulness and chrome**
Read-only search input; hardcoded nav highlight; tabs in the URL; Program tab
density; remove the "0 in-person · 0 virtual · 0 async" counts; FAQ chevrons.

**E16 — copy and help**
"Track" defined; Getting-started rewritten to match the product that exists and
to cover ingest; Stripe merchant-of-record line checked for literal accuracy.

**Not a chunk — a decision for the founder:** whether the homepage leads with
the AI ingest or the academic papers model.

---

## 7. Method notes and limits

- **Mobile was not captured.** Window resizing through the browser extension did
  not change the rendered viewport. Every persona was told this and instructed to
  make no claim about phone behaviour. **Responsive quality remains unevaluated.**
- Signup, email verification, organisation setup and the create-event wizard were
  not walked — an account already existed, and agents cannot create accounts. The
  novice report reasons about these from the captured pages, not from use.
- Speakers, Invites, Maps, Announcements, Ops Inbox, Recap, Features, CFP,
  Sponsors, Analytics and Check-in were not opened.
- The novice persona is an agent roleplaying inexperience it does not have. It
  reliably catches undefined jargon and dead ends; it cannot feel genuine
  confusion. Real value there still requires watching one actual department
  administrator use the product.
- Only the two blockers in §1 were re-verified against source by the primary
  agent. Everything in §3 is a lead.
