# UX_AUDIT_PLAN.md — three-persona agent walkthrough

**Written 2026-08-02. Status: ready to run.**

A structured usability evaluation of ukedl.com by three AI agents, each reading
the same captured evidence through a different professional lens.

---

## Why this, and why now

Every serious defect found in this product so far came from someone using it as a
stranger, not from reading code. The July logged-out audit found the invite-code
dead end and the ingest truncation. Tonight's console walkthrough found a dead
feature and a P0 regression. Chris and I are both too close to the product to see
it fresh; three independent personas can.

**Deliberately not a bug hunt.** Chunks E9–E12 already fixed the functional
defects. This is about whether the product is *understandable* — whether an
organiser who has never seen it can get from "I have a programme" to "my event is
live" without confusion, and whether someone who has run events on Whova or Sched
finds it credible.

---

## The three personas

### 1. UX / interaction design expert
Evaluates against established heuristics — visibility of system status, match to
the real world, user control, consistency, error prevention, recognition over
recall, aesthetic and minimalist design, help users recover from errors. Also:
information hierarchy, visual rhythm, affordance clarity, form design, empty
states, loading and latency communication, accessibility (contrast, target size,
keyboard path, screen-reader implications).

*Specifically asked to be blunt about hierarchy and density — the founder's own
words after using the Program tab were "text and stuff all over the place."*

### 2. Novice organiser, never used event software
A department administrator asked to put the annual doctoral programme week
online. Competent with email and Word; has never used Whova, Sched, Eventbrite or
similar. Reads labels literally. Does not know what a "track", "changeset",
"ingest", "CFP" or "entitlement" is unless the product explains it.

*Records the exact moment they would stop and email someone for help — those
moments are the deliverable.*

### 3. Experienced Whova / Sched organiser
Has run 5+ conferences on Whova and/or Sched. Knows what those tools do well and
badly, has muscle memory and expectations, and will notice both missing table
stakes and welcome departures. Must **web-search current Whova and Sched UX**
before judging — not rely on stale recollection — and must distinguish
"different from Whova" (possibly good, see the anti-goals) from "worse than
Whova" (a gap).

*The anti-goals in `HANDOFF_BRIEF.md` §1 are deliberate positioning, not
oversights: no gamification, no unsolicited push, no dark patterns, no ads,
no sales-gated pricing. Departures from competitors in those directions are
features. This persona should say so where relevant rather than flagging them
as gaps.*

---

## Method

**Phase 1 — capture (Chris + Claude, ~30–45 min at the keyboard).**
Claude drives Chrome and captures page text plus screenshots at every step below.
Chris stays logged in and performs the actions that require an account. Capture is
neutral: no commentary, no fixes, just evidence. Everything lands in one folder.

**Phase 2 — three parallel agents.**
Each receives the *identical* capture set plus its persona brief, and produces its
own report. They do not see each other's work. Each must:
- read `CUSTOMER_TEST_FINDINGS.md` and `PARITY_AUDIT.md` first, and mark any
  finding already recorded there as **KNOWN** rather than presenting it as new
- cite the specific screen or step for every finding
- rate severity (blocker / major / minor / polish) and effort (S/M/L)
- separate *observation* from *recommendation*
- state explicitly where it is uncertain rather than asserting

**Phase 3 — merge.**
A fourth document: what all three flagged independently (highest confidence, fix
first), what only one flagged and why that may still matter, where they actively
disagreed (usually the most interesting finding), and a prioritised chunk plan in
the E-chunk format ready to hand to Cursor.

---

## Capture script

### A. Logged out, as a stranger
1. `ukedl.com` — homepage, including the paste demo
2. `/pricing`
3. `/help` — index and one article
4. `/security`
5. `/e/demo` — List, Grid, By room; a session detail; search; day and track filters
6. The signup form (view only)
7. Repeat 1 and 5 at **mobile width** (390px)

### B. Becoming a customer
8. Sign up (Chris drives; fresh address)
9. Email verification
10. Organisation setup
11. Create-event wizard, start to finish

### C. Building the programme — the core loop
12. Agenda ingest: paste a short programme
13. Review changeset → Confirm
14. Agenda ingest: upload the DocWeek PDF (note the 2+ min wait and what the UI
    communicates during it)
15. Review → Confirm → View program
16. Program tab: edit a session, add a paper, add a resource, delete something
17. Speakers, Invites, Maps, Announcements, Features toggles
18. CFP, Sponsors, Analytics, Check-in
19. Publish the event

### D. As an attendee
20. Attendee app: agenda in all three views
21. Session detail: join, Q&A, poll, resource, add-to-calendar
22. Messages, Community, Attendees, Profile, Notifications
23. Mobile width for 20–22

### E. Recovery paths
24. Submit an empty required field
25. Upload something invalid to ingest
26. Try to publish an event with no sessions
27. Navigate to a URL for something that doesn't exist

---

## Ground rules for the agents

- **No code changes.** This is evaluation only; recommendations land in
  `FIX_PLAN.md` afterwards, as chunks, in the founder's normal workflow.
- **Respect the anti-goals.** Recommending gamification, push notifications,
  engagement mechanics or dark patterns is a failed report.
- **One-person team.** Every recommendation must be plausible for a solo founder.
  "Hire a designer" and "run a 12-person usability study" are not findings.
- **Distinguish taste from evidence.** Say which is which.
- **Do not pad.** Twelve real findings beat forty recycled heuristics.

---

## Output

- `UX_AUDIT_01_DESIGN.md`
- `UX_AUDIT_02_NOVICE.md`
- `UX_AUDIT_03_VETERAN.md`
- `UX_AUDIT_MERGED.md` — consensus, disagreements, prioritised chunk plan
