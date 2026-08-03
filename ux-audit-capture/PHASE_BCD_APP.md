# Capture — Phases B/C/D: organizer console and attendee app

Captured 2026-08-02 on production ukedl.com (build `9d128e5`/`654d593`),
Chrome at 1440×900, signed in as the founder/owner.
**Neutral record. Observations only, no recommendations.**

Sources: a live browser pass, plus screens observed during the same day's
verification work on the same build.

---

## B1. Organizer home (`/organizer`)

Left sidebar, three groups:
- **ORGANIZE** — Events (selected), New event
- **WORKSPACE** — Billing, AI usage
- **ACCOUNT** — Attendee app, Settings

Top bar: an organization switcher rendering as **"Orga…"** (truncated to about
four characters plus ellipsis), a wide **Search** field, and a circular **?**
button at the far right.

Main area: H1 "Your events" with three buttons right-aligned — **New
organization** (outline), **Set up with AI** (outline), **New event** (filled
navy). Below, four grey skeleton bars while events load.

Loading behaviour: skeleton placeholders persisted for roughly 2–3 seconds
before content appeared.

---

## B2. Event console (`/organizer/events/{id}`)

Sidebar changes to: **ORGANIZE** — Overview (selected), Agenda ingest, CFP,
Sponsors, Analytics, Check-in · **WORKSPACE** — All events, Billing, AI usage ·
**ACCOUNT** — Attendee app, Settings. Sidebar header shows the event name
("Sample Academic Conference").

Top bar switcher shows **"Sample Academic Confer…"** (truncated).

Main area: H1 event name, then a status line: a grey **Draft** chip, the slug
`/e/sample-mrtwok16`, and the full URL `https://ukedl.com/e/sample-mrtwok16` as a
blue link.

**A second, horizontal tab row** beneath: **Overview · Program · Speakers ·
Invites · Maps · Announcements · Ops Inbox · Recap · Features** (Overview
selected, rendered as pill buttons).

Note: "Overview" appears in **both** the left sidebar and the horizontal tab row.
The sidebar switches sections of the console; the tabs switch sections of the
event. Nine horizontal tabs plus six sidebar items are visible at once.

### Overview tab contents, in order top to bottom

1. **PUBLISH** panel (first thing on the page): "Draft events 404 for outsiders.
   Published events are reachable via slug/join link. Archive hides them from
   attendees while keeping data." Buttons **Publish** (filled navy) and
   **Archive** (outline).
2. **EVENT SETTINGS** panel: "Everything from the create wizard, editable after
   the fact. Changing the timezone keeps the wall-clock times below and
   reinterprets them in the new zone." Fields: Event name · Description
   (textarea) · Timezone (free-text-looking input containing
   `America/Los_Angeles`) · Starts (event time) `2026/07/27, 07:00` (native
   datetime-local) · Ends (event time) `2026/07/29, 14:00` · Venue name · Venue
   address · Online URL (placeholder `https://…`) · Brand color (a small navy
   swatch, native colour input) · **Save settings** button.

---

## B3. Program tab

Header row: "SESSIONS" label, right side "Times in America/Los Angeles (PDT)"
and **+ Add session**.

Explainer line: "A session can hold papers (with author lists) and resources
(slides, links, files). Speakers (from the Speakers tab) present sessions — a
person can be both."

Above sessions, two stacked panels: **TRACKS** (list with Edit / Delete per row,
`+ Add track` top-right; colour swatch per track) and **ROOMS** (same pattern).
Tracks seen: Academia/Administration, EdD, PhD, Plenary, Research, Practice,
Building Community & Framing the Journey, Navigating the Process & Sustaining
Success. Rooms seen: Dr. Bathon's House, Drs. Rous's and Nash's House, Main Hall,
Room 201, Room 305, Student Union.

Sessions are grouped under bold day headings ("Mon, Jun 8, 2026"). Each session
card shows: title, a time line ("9:00 AM – 10:00 AM"), optionally the track name
appended after a middle dot, **Edit** and **Delete** links right-aligned (Delete
in red), an indented resource list where present
("TEST — File · added by Chris Hayden" with **Open** and **Remove**), and a blue
**+ Add paper or resource** link.

After adding a resource, a green line appears inside the card: "Resource added —
attendees who join this session can open it from the session page." It persists
alongside the now-listed resource.

**+ Add paper or resource** opens a two-option chooser: **Paper** ("A submission
with authors and an abstract — appears in the program under the session.") and
**Resource** ("A link or file, e.g. slides, a reading list, a Drive folder.").

**Remove** on a resource opens a modal: title "Remove resource "TEST"?", body
"This removes it from "Welcome, Navigating DocWeek & Networking". Attendees will
no longer see it on the session page.", buttons **Cancel** (outline) and
**Remove** (filled red).

---

## B4. Agenda ingest tab

Intro: "Upload a program (≤20 MB), paste text, or fetch a URL. Review the
changeset, then confirm to create **DRAFT** sessions only."

Four input panels stacked vertically, each in its own bordered card, in this
order:
1. **PASTE PROGRAM TEXT** — label "Program text", a textarea with placeholder
   "Paste agenda text…", button **Extract from paste**
2. **FETCH URL** — label "URL", input `https://…`, button **Extract from URL**
3. **UPLOAD FILE** — caption "PDF / DOCX / XLSX / CSV / image", a native
   `Choose File` control
4. **IMPORT SESSIONS FROM CSV** — with a **Download CSV template** link
   top-right, and the explainer: "Already have your program in a spreadsheet?
   Upload a CSV (columns: title, start, end, track, room, speakers, description
   — times as YYYY-MM-DD HH:MM in the event timezone). You review every row
   before anything is created. No AI involved."

Below the inputs, once a run completes, a two-column area:
- **Source** (left): file name, then `application/pdf · 184 KB · 8/2/2026,
  7:13:24 PM`, then italic "No text preview — the file was read directly by the
  model."
- **Review …** (right): heading "Review 22 sessions found in 2026 DocWeek
  Schedule and Session Overview.pdf", counts line "18 create · 4 update ·
  5 delete proposed · 0 errors".

**Assumptions** section: a series of question/answer pairs. The question is body
text; the answer sits in a bordered input-looking box beneath it. Observed
examples:
- "Page 1 lists 'Drs. Hains and Potterton' for the PhD Research Design Workshop,
  but page 5 spells it 'Potterson'. Which spelling is correct?" → `Potterton`
- "Robert Appino's name is struck through on page 2 with 'email' also struck
  through, suggesting he may have been removed as an alumni presenter for
  Masterclass 2. Should he be excluded from the speaker list?" → `Excluded
  (struck through in source)`
- "The Research Design Workshop (9:00AM-12:00PM Tuesday) is split into concurrent
  PhD and EdD tracks per program. Assumed these run simultaneously as two
  separate sessions rather than sequential." → `Concurrent sessions`
- "Event timezone was not explicitly stated in the source document; used the
  provided hint (America/Los_Angeles). Actual location/timezone may differ (event
  appears to be at a university, possibly not in Pacific time)." →
  `America/Los_Angeles`

**Will create** — a numbered checklist, every row pre-checked, format
`2026-06-08 · Welcome, Navigating DocWeek & Networking · 09:00`. Low-confidence
rows are rendered in orange text on a pale yellow background with a suffix
"(confidence 0.70)". The numbering column visibly renders `0.` and `1.` for
items 10 and 11 (truncated tens digit).

**Will update** — checked rows with the change named: "Program Dinner — update
fields", "Masterclass 3: Presenting & Publishing — move track".

**Propose delete (unchecked by default)** — unchecked rows: "Test — Not found in
new import — propose delete", etc.

Buttons: **Confirm drafts** (filled navy), **Cancel** (outline).

After confirming, a green panel appears in place: "Created 22 draft session(s),
updated 0, deleted 0. Drafts stay hidden from attendees until published." with
**View program** (filled navy) and **Import another** (outline). The panel
scrolls itself into view.

**Ingest history** at the page bottom: a bulleted list of runs, each a grey chip
`8/2/2026, 7:13:24 PM · PDF · READY_FOR_REVIEW` followed by "· audit linked".
Statuses observed: READY_FOR_REVIEW, CONFIRMED (with `+22 / ~0 / −0`), FAILED.
Fourteen runs listed with no pagination or grouping.

**Timing:** a 7-page, 184 KB PDF took over two minutes to process. During that
time the page showed no progress indicator, percentage, or elapsed timer.

---

## B5. Other event tabs (not opened in this pass)

Present but uncaptured: Speakers, Invites, Maps, Announcements, Ops Inbox,
Recap, Features, CFP, Sponsors, Analytics, Check-in.

---

## D1. Attendee app — agenda (`/dashboard`)

Left sidebar: **EVENT** — Agenda (selected), Attendees, Community, Maps,
Messages · **ORGANIZE** (visible because signed in as organizer) — Participants
and Invites, Organizer console · **ACCOUNT** — Profile, Notifications, Settings.

Top: a Sponsors panel — "Gold: Campus Press", "Silver: Scholar Tools Co."

Controls row: **Event Schedule | My Schedule (1)** tabs; **List | Grid | By
room**; **My timezone | Event timezone**; a **+ New session** button; then day
pills **All days | Mon, Jun 8 | Tue, Jun 9 | Wed, Jun 10 | Mon, Jul 27 | Tue,
Jul 28 | Wed, Jul 29 | Sun, Aug 2**. Caption: "Times shown in
America/Los_Angeles (your device setting)".

Right rail: search box, then DAY / TRACK / ROOM filter lists — duplicating the
day pills and the timezone toggle above.

Session rows show: title, a meta line "9:00 AM-10:00 AM · 0 in-person · 0 virtual
· 0 async", speaker names, an empty circle at the right (join control), and a row
of four small text links **Q&A · Like · Star · Edit**.

Concurrent sessions render side by side under a "2 concurrent sessions" label.

---

## D2. Attendee app — session detail (`/session/{id}`)

Order of panels down the page:
1. "← Back to agenda"
2. Title, date/time line, **My timezone | Event timezone** toggle, description
3. Action row: an empty circle + **Join**, **Add to Google Calendar**, **Add to
   calendar**, **Like**. Once joined, the circle fills and the row gains a
   three-way segmented control **Virtual | In person | Async** plus the label
   "Joined · In person".
4. **Speakers** — avatar initial, name, "Title, Institution"
5. **Session resources** — helper line "Add a link, or upload a file up to
   4.5 MB. Anyone who joins this session can open it." Then the resource list
   (bold title; "Chris Hayden · File · 8/2/2026, 8:04:20 PM"; **Open** and
   **Remove** buttons), then a horizontal rule, then a **+ Add a resource**
   outline button.
6. **Session Q&A** — "Ask questions, upvote what matters, and (for organizers)
   mark answered or hide. Updates every few seconds." **Top votes | Recent**
   toggle, "Conversation title" input, "Start a new session conversation…"
   textarea, **Start conversation** button, then "No conversations yet — start
   the first one."
7. **Live polls** — "No polls for this session yet." Poll question input, an
   Option A/B/C textarea, **Create draft poll** button.

A floating **Concierge** button (filled navy) sits fixed at the bottom-right of
attendee pages.

---

## D3. Messages (`/dashboard?tab=Messages`)

Two panels side by side. Left: "Messages", **+ New**, explainer "Your chats are
listed below. Use **+ New** for a direct or group conversation. **Everyone —
event chat** reaches all attendees; session Q&A stays on each session page.",
a "Filter chats" input, then "Your chats" with one item **Everyone — event chat**
(selected, filled navy). Right: "Everyone — event chat", explainer "Everyone at
this event can read and post here. When an admin posts, participants get a
notification.", "No messages yet — introduce yourself below.", a "Your message"
textarea and a **Send** button.

---

## E. Recovery paths (partially captured)

- Submitting a poll/Q&A form with an empty required field produces the **native
  browser tooltip** "Please fill out this field." rather than in-page validation
  (observed on the session page and on the Program tab).
- Invalid/unparseable ingest source: an empty extract now ends the run as FAILED
  with "No sessions found in the source — nothing was changed…" and proposes no
  deletions.
- A programme too long for one model pass reports "The programme was too long to
  process in one pass. Split it into smaller sections and ingest each one
  separately, or use the CSV import instead."

---

## Known gaps in this capture

- **Mobile widths were not captured.** Window resizing through the browser
  extension did not change the rendered viewport; every screenshot came back at
  desktop width. Mobile/responsive behaviour is therefore **unevaluated** — do
  not infer anything about it.
- **Signup, email verification, organisation setup and the create-event wizard
  were not walked** in this pass (an account already existed; agents cannot
  create accounts).
- Speakers, Invites, Maps, Announcements, Ops Inbox, Recap, Features, CFP,
  Sponsors, Analytics and Check-in tabs were not opened.
- A 404/nonexistent URL was not tested.
