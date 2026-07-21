# HANDOFF_BRIEF.md

**One-page orientation for a new collaborator — human or AI.**
Last verified against the codebase: **2026-07-21**. Branch `main`, HEAD `fc2d061`.

If you read only one file before starting work, read this one. It tells you what
the product is, what is actually true today, what is broken, and which of the
other documents you can trust.

---

## 1. What this is

**UKEDL** (ukedl.com) is a calm, AI-native **event workspace for recurring academic
and education conferences** — the 50–2,000 attendee band: annual departmental
conferences, scholarly societies, education programmes, meetups.

The pitch in one line: *paste your programme, your event is live.* An organiser
pastes or uploads an existing conference programme; an AI ingest agent extracts
sessions, papers, authors, rooms and tracks into a reviewable changeset; the
organiser approves it; attendees get a fast web app with no app-store download.

**Competitors:** Whova (feature-maximal, notification-heavy, quote-priced),
Sched (simple but rigid), EventPilot (deep but dated, 75-day app-store lead time).
Note: the repo folder is called `DocWeekSched` and older docs sometimes say
"EventPilot" — that is a historical naming accident, **not** the competitor.

**Built and run by one person** (Chris Hayden). Assume no team, no ops rota, no
QA function. Solutions that require staff do not apply here.

**Deliberate anti-goals — do not "helpfully" add these:** engagement leaderboards
or gamification, unsolicited push notifications, auto-generated activity
("X viewed your profile"), dark-pattern upgrade prompts, ads or attendee-data
monetisation, sales-call-gated pricing. These are positioning, not oversights.

---

## 2. Stack and shape

| Layer | Reality |
|---|---|
| Monorepo | npm workspaces — `apps/api`, `apps/web`, `apps/mobile`, `packages/*` |
| Web | Next.js **14.2.5, Pages Router**, React 18 → **Netlify** (`ukedl.com`) |
| API | **Express 4** + TypeScript → **Render** service `docweeksched-api` (`api.ukedl.com`) |
| Database | **Postgres on Neon**; Prisma 5.18 |
| Shared code | `packages/config` (brand/product config), `packages/shared` (types) — both compile to `dist/`, do not point `main` back at `src/*.ts` |
| Auth | Custom JWT + httpOnly cookies (`COOKIE_DOMAIN=.ukedl.com`) |
| AI | `@anthropic-ai/sdk` through a gateway in `apps/api/src/lib/ai` (metering, caps, audit) |
| Email | Resend via `apps/api/src/lib/email` |
| Billing | Lemon Squeezy (merchant of record) |
| Mobile | `apps/mobile` is a **dormant Expo shell — not deployed, not maintained.** The mobile story is the PWA. Ignore this folder. |

**Size:** 80 Prisma models · 41 migrations · 37 API route modules · 40 web pages ·
41 components · 56 test files. This is a large, feature-complete application, not
a prototype — the gaps below are configuration and polish, not missing substance.

---

## 3. Status: what is actually true today

**Live in production since 2026-07-20.** Public demo event: `ukedl.com/e/demo`.

Working and verified by end-to-end test: organisation → event → tracks → rooms →
sessions → papers with author ordering → publish → public page → archive. Plus
per-session in-person/virtual/async attendance modes, timezone handling, CFP with
review and decisions, certificates, badges, check-in/QR, capacity and waitlists,
venue maps, community boards, DMs, meeting requests, per-event feature toggles.

**Three things are configured off, and this is the whole story of the current
moment:**

1. **`RESEND_API_KEY` is unset → no email is sent.** Registration creates users
   with `emailVerifiedAt: null` and login returns 403 until verification. With no
   email provider, **every new signup is permanently locked out.** This is the
   single most important fact about the product right now.
2. **`ANTHROPIC_API_KEY` is unset, `AI_PROVIDER=mock`** → every AI surface returns
   canned output. The homepage's central claim is currently not demonstrable.
3. **Lemon Squeezy keys are unset** → no one can buy anything. The billing code
   path has never executed in production.

Two further blockers found by an independent logged-out audit: the public signup
form offers "Organizer (invite code)" and demands an invite code that no customer
can obtain (the backend does *not* require this — it is a pure UI dead end), and
the homepage ingest demo silently truncates at 8 rows.

**Everything above is being fixed in Phase E.** See `FIX_PLAN.md`.

---

## 4. Document map — and which docs to trust

| File | Status | Use it for |
|---|---|---|
| `README.md` | **current** | Setup, scripts, structure, conventions |
| `HANDOFF_BRIEF.md` | **current** | This file. Orientation |
| `CUSTOMER_TEST_FINDINGS.md` | **current** (2026-07-21) | 31 findings from three logged-in walkthroughs plus an independent logged-out audit. The best single picture of real defects |
| `FIX_PLAN.md` | **current** | Phase E work: Track A config, Track B chunks E0–E4. What is being fixed and in what order |
| `LAUNCH_CHECKLIST.md` | **current** | Everything required before charging money. §0 is the blocker list |
| `PARITY_AUDIT.md` | **current** (2026-07-20) | Feature-by-feature vs Whova / EventPilot / Sched, with deliberate skips |
| `DESIGN_PHASE_D.md` | **current** (2026-07-19) | Design language, tokens, competitor CSS teardowns. The visual system in force |
| `RUNBOOK.md` | mostly current | Env vars, restore procedure, incident steps |
| `PRODUCT_SPEC.md` | **HISTORICAL** | The build plan for Phases 0–7, all of which are now complete. Strategy sections (Parts II–III) are still authoritative; the phase instructions are finished work |
| `GAP_REPORT.md` | **HISTORICAL — do not trust for facts** | A snapshot of the codebase on 2026-07-17, *before* Phases 1–7 were built. It says AI, billing, background jobs and object storage do not exist. All four now exist |

Also on the Desktop (not in the repo): `CURSOR_INSTRUCTIONS_*.md` and
`EVENTPILOT_*.md` from 16 July. **Superseded — ignore.**

---

## 5. If you are reviewing this product, do this

The highest-value thing anyone can do is **use the live site logged out, as a
stranger who wants to run a conference.** Every serious defect found so far came
from that angle and none came from reading code. Go to `ukedl.com`, try to become
a customer, and write down the exact point where you cannot continue.

Second-highest: try to *build* an event end to end. The build chain works; the
friction is in editing after the fact.

If you are changing code, read `README.md` for conventions first. Two standing
rules override everything: **agents draft, humans publish** — no AI output reaches
an attendee without an organiser approving it; and **every AI call goes through
the gateway** in `apps/api/src/lib/ai` for grounding, metering, labelling and audit.
