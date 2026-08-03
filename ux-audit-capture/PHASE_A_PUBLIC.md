# Capture — Phase A: public pages

Captured 2026-08-02 on production ukedl.com, Chrome at 1440×900.
**Neutral record. No recommendations here — observations only.**

Note: the capturing browser was signed in as the founder. Several pages first
paint in the signed-out state and then swap to signed-in (see A0).

---

## A0. Auth-state flash on first paint (observed on every page)

The header renders **"Product · Pricing · Help · Sign in · [Create your event]"**
on first paint, then swaps to **"[Open event app] · avatar · Sign out"** once
client JS hydrates. On `/e/demo` the primary button changed from
**"Join / Sign in"** to **"Open event app"**.

Every visitor sees the signed-out header briefly, and a returning signed-in user
sees the wrong header for a moment before it corrects.

---

## A1. Homepage (`/`)

**Hero.** Wordmark "UKEDL" in blue, then headline over two lines:
"**Paste your program. Your event is live.**" Sub: "Turn an uploaded agenda into
a calm, publishable event in minutes — without notification spam or sales-call
pricing." Two buttons: **Create your event** (filled navy), **Try the demo**
(outline). Right side: a browser-chrome mockup showing `/e/demo` with Event
Schedule / My Schedule tabs and four sample sessions (Opening plenary, Paper
session: Research design, Practice workshop, Poster session & coffee), each with
time, room and track, colour-coded by left border.

**Live paste demo.** A monospace textarea prefilled with a sample program:
```
09:00  Opening remarks — Dr. A. Chen (Hall A)
09:30  Panel: Field notes at scale
       • Paper: Sampling bias in diary studies — Rivera, Okonkwo
       • Paper: Consent UX for longitudinal apps — Patel
11:00  Coffee
11:30  Workshop: Agenda design for multi-track days
13:00  Lunch
```
Buttons: **Extract draft sessions**, **Reset sample**. Caption below:
"Local demo only — nothing is uploaded or metered."

**"What organizers actually need"** (eyebrow: BUILT FOR ACADEMIC EVENTS).
Sub: "Papers, authors, CFP, and series — treated as product, not afterthoughts."
Three columns:
- PAPERS & AUTHORS — "Academic structure, first-class" — sessions nest papers
  with author order preserved, discussants, individual times
- AI PROGRAM INGEST — "AI generated, always reviewable" — upload a PDF or paste
  a schedule; nothing publishes until you confirm
- ATTENDEE EXPERIENCE — "Calm by design" — digest-first notifications, quiet
  hours, no engagement bait

**"Three steps from program to published"** (eyebrow: HOW IT WORKS).
Sub: "Review every draft before attendees see it."
1. Paste or upload your program — "Bring a PDF, spreadsheet, or plain text.
   Ingest drafts the structure for review."
2. Edit tracks, rooms, and papers — "Tighten titles, assign rooms, keep author
   order. Publish when the draft is right."
3. Share the public schedule — "Attendees open a clean agenda, build My
   Schedule, and join without an app-store gate."

**"What we publish as true"** (eyebrow: TRUST).
Sub: "Specific product facts — not logos, testimonials, or invented user counts."
Bullets seen: Open pricing (links to /pricing), Data export, No ads (cut off).

---

## A2. Pricing (`/pricing`)

Eyebrow PRICING, H1 "**Open pricing**". Sub: "Catalog amounts match what we
charge before tax. Checkout is handled by Stripe (merchant of record) — they
collect payment and applicable sales tax/VAT."

**Recurring-event price lock** panel above the plans: "When you run the same
conference every year as an Event Series, we lock the plan price you purchased
for that series. Your next edition keeps that rate — no surprise annual reprice."
Fine print: "Price lock is stored on the series at purchase time and shown from
this plan catalog."

**Three plan cards:**
| | Free | Pro · Monthly (POPULAR) | Enterprise |
|---|---|---|---|
| Price | Free | $79/mo | Contact us |
| Blurb | One active event, 50 attendees, core agenda and community — with a small "Powered by" badge | Unlimited events, higher caps, analytics, engagement features, and the full AI suite | SSO, white-label, and custom limits — contact us |
| Ticks | 1 active event … small "Powered by" badge on attendee surfaces | Unlimited active events · Up to 2,000 attendees per event · … · No "Powered by" badge · Annual option: $790/yr | Unlimited active events · Unlimited attendees per event · White-label · Priority support · Custom limits and procurement |
| CTA | Start free | Upgrade | Contact us |

**"Which plan?"** panel: under 50 attendees → Free; one event this year →
per-event plan; two or more events a year or want the full AI suite → Pro.
Fine print: "For 51–250 attendees, Pro at $79/month is usually the better buy
than the $149 per-event tier — it costs less if your event wraps within a month
or two and includes the full AI suite."

**Per-event plans** (eyebrow ONE-TIME OPTIONS): $149 / $249 / $399 one-time for
250 / 500 / 1,000 attendees. "Single-event purchases from the same catalog —
useful when you are not ready for a Pro subscription."

**FAQ "Common questions"** — five items rendered as plain bold text rows with
horizontal rules, no visible expand affordance (no chevron, +, or arrow):
- What counts as an attendee?
- How do refunds work?
- What happens when I archive an event?
- What is the recurring-event price lock?
- What happens to a published event if I cancel Pro?

Tax note beneath: "Stripe adds applicable sales tax/VAT at checkout where
required. Displayed catalog prices are the pre-tax amounts from our plan config."

**Footer** (all pages): UKEDL + "Calm event software for academic programs and
recurring conferences." Columns — PRODUCT: Features, Demo, Pricing ·
RESOURCES: Help, Security, Status, Support · LEGAL: Terms, Privacy.

---

## A3. Help (`/help`)

Eyebrow RESOURCES, H1 "**Help**", sub "Guides for organizers and attendees."
Three bulleted links, left-aligned to a narrow column that starts roughly at the
horizontal centre of the viewport (large empty area to the left):
- **Getting started** — "Create an organization, build your first event, invite
  attendees, and publish."
- **Attendee FAQ** — "How attendees open the schedule, save sessions, and join
  without an app download."
- **Contact** — "How to reach support — email and honest support hours."

Three articles total.

---

## A4. Public event page (`/e/demo`)

**Header block.** Date line "Mon, Aug 3 – Wed, Aug 5, 2026", H1 "**UKEDL Public
Demo**", "Hosted by UKEDL", venue line "University Conference Center · 100 Campus
Drive, Example City, CA", description "A read-only demo of UKEDL: sessions,
papers, speakers, and sponsors. Sign up to create your own event.", then a
filled **Join this event** button.

**Schedule toolbar.** "Schedule" heading, then a segmented control
**List | Grid | By room** (List selected), then **Download program (.ics)**,
a printer icon + **Print**, and the timezone string "America/Los_Angeles"
(truncated at the panel edge). Below: day pills **All days | Mon, Aug 3 |
Tue, Aug 4 | Wed, Aug 5**.

**Sessions (List view).** Grouped by day with a bold day heading. Each row: time
+ timezone abbreviation in a left gutter, then a card with a coloured left border
(track colour), title, a meta line "time · room · track", speaker names, and for
sessions with papers a right-aligned pill "2 papers" plus nested paper rows with
title and authors.

Sessions seen: Opening keynote: Designing calm conferences (9:00–10:00, Hall A,
Plenary, Dr. Maya Chen) · Paper session: Mentoring networks (10:30–12:00, Room
214, Research, Jonas Okonkwo + Elena Ruiz, 2 papers: "Weak ties that stick:
cohort messaging norms" — Aisha Rahman, Jonas Okonkwo; "Office hours as
infrastructure" — Elena Ruiz) · Workshop: Importing your program in minutes
(Tue 9:30–10:45, Room 108, Practice, Elena Ruiz) · Closing roundtable
(Wed 11:00–12:00, Gallery, Plenary, Dr. Maya Chen + Jonas Okonkwo).

After the last day: an outline button **Join to build your schedule**.

**Right filter rail** (sticky card): search box "Search sessions, speakers,
papers…"; **DAY** (All days / Mon / Tue / Wed); **TRACK** (All tracks, then
colour-dotted Plenary, Research, Practice); **ROOM** (All rooms, Hall A, Room
214, Room 108, Gallery). Selected filter is highlighted with a light blue fill.

Note: day filtering exists in **two** places — the pill row above the schedule
and the DAY list in the right rail.

**Speakers section** below the schedule: name in bold, then "— Title,
Institution" in grey (Dr. Maya Chen — Associate Professor, Westbrook University;
Jonas Okonkwo — Director of Graduate Studies, Northbridge College; Elena Ruiz —
Research Fellow, Open Methods Lab).
