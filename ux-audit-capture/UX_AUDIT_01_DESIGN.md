# UX Audit 01 — Interaction & visual design

Reviewer: senior UX / interaction design pass.
Date: 2026-08-02. Build `9d128e5`/`654d593`.
Evidence base: `PHASE_A_PUBLIC.md`, `PHASE_BCD_APP.md`, plus direct reading of
`apps/web` and `apps/api` source to verify mechanism before asserting a defect.

**Scope note:** mobile and responsive behaviour were not captured and are not
evaluated here. Nothing in this report is a claim about phone or tablet layout.
Speakers, Invites, Maps, Announcements, Ops Inbox, Recap, Features, CFP,
Sponsors, Analytics and Check-in were not opened in the capture and are largely
absent below.

**How to read the labels:**
- *Observed* = in the capture, or read directly in source (file:line given).
- *Inferred* = my reasoning from partial evidence; stated as such.
- *Taste* = professional judgement, not a defect.
- **KNOWN** = already in `CUSTOMER_TEST_FINDINGS.md` or `PARITY_AUDIT.md`.

---

## Overall read

UKEDL does not have a visual-design problem. The tokens are disciplined, the
type scale is obeyed, one accent colour does the work, and several individual
pieces of interaction copy are better than what most funded SaaS ships — the
delete confirmations in the Program tab tell you exactly what happens to your
data, and the ingest changeset defaults deletions to unchecked. Someone thought
carefully at the level of the individual component.

What is missing is the level above that: page-level hierarchy and information
architecture. Nearly every problem below is a *composition* problem — correct
components stacked in the wrong order, at one visual level, with no strong
second tier. The founder's "text and stuff all over the place" reaction to the
Program tab is accurate, and it has a specific structural cause, not a styling
one.

Three findings are different in kind and more serious: two controls that assert
something untrue (a permanently read-only search field, and ingest "assumption"
answers that are stored but never applied), and a console whose navigation state
is invisible to the URL. Those are failures of trust and of user control, and
all three are small fixes.

---

# Findings

---

## F1 — Ingest "assumption" answers are recorded and then discarded

**Severity: BLOCKER · Effort: S · Screen: Agenda ingest → review panel**

**Observed (source-verified).** The review panel renders each AI assumption as a
question with an editable input pre-filled with the model's own answer
(`ReviewChangeset.tsx:236–255`). Editing it calls `onAssumptionAnswer`, which
updates local state. On confirm, `ingest.tsx:316–341` does two calls:
`PATCH /ai/ingest/{id}` with `{ changeset, assumptions }`, then
`POST /ai/ingest/{id}/confirm` with `{ changeset }` only. The PATCH handler
(`agendaIngest.ts:336–349`) writes `assumptions` onto the run row. The confirm
handler (`agendaIngest.ts:354–413`) reads only `rows` and passes only `rows` to
`confirmAgendaChangeset`. **Nothing downstream reads the answer.**

Concretely, using the captured example: an organizer who reads *"page 1 says
'Potterton', page 5 says 'Potterson'. Which spelling is correct?"*, types
`Potterton`, and confirms, will still get whatever spelling the model already
wrote into the changeset rows. The correction is stored for audit and has no
effect on the programme.

*(Confidence: high on the confirm path, which I traced end to end. I did not
audit every code path that touches `run.assumptions`, so there is a small chance
something else consumes it.)*

**Why it matters.** The product's stated standing rule is *"agents draft, humans
publish."* This is the one screen where that rule is enacted, and it contains an
input that accepts a human correction and silently drops it. For an academic
buyer, the specific failure mode is a misspelled colleague's name published on a
programme after they personally corrected it. That is worse than not offering
the input at all.

**Recommendation (tiered).**
1. *Today, S:* stop the input from lying. Either render assumptions as read-only
   statements with a single line — *"Recorded with this run. To change a
   session, edit the row below."* — or keep the input and add that exact line
   above the group. This costs one paragraph and removes the false promise.
2. *Next, M:* the extract schema already carries `appliesTo` on each assumption
   (`lib/ai/ingest/schema.ts`). Use it: render the assumption inline above the
   rows it affects, and when the organizer changes a name, do a literal
   find/replace of the old string in those rows' titles/speaker fields before
   confirming. No re-run, no model call, no schema change.

**Not KNOWN.**

---

## F2 — The global search field is permanently read-only on every signed-in page

**Severity: MAJOR · Effort: S · Screen: every organizer and attendee page (AppShell top bar)**

**Observed (source-verified).** `AppShell.tsx`:

```jsx
<input className="input" type="search" placeholder="Search" aria-label="Search" readOnly />
```

It occupies `flex: 1` up to 360px of the top bar on every authed screen. It is
still in the tab order and still focusable — a keyboard user lands on a search
box that will not accept a character, with no explanation.

**Why it matters.** This is the same class of defect as **KNOWN #24** (grid /
by-room blocks carrying button semantics but doing nothing) — announcing a
control that does nothing — but it is a different, and much more prominent,
instance: it is on every page, it is the widest element in the chrome, and
"search" is the first thing an organizer with 22 sessions reaches for. It is
also plausibly the cause of the second observed defect below.

**Second-order effect (inferred).** The capture recorded the organisation
switcher rendering as **"Orga…"** — four characters — at 1440px, and
**"Sample Academic Confer…"** on the event page. The top bar is a flex row
(`globals.css:4588`) in which the switcher has `min-width: 0` and no
`flex-shrink: 0`, while the dead search box claims `flex: 1`. The primary
"where am I" indicator is being squeezed by a control that does nothing. I have
not reproduced this in a browser, so treat the mechanism as inferred and the
truncation itself as observed.

**Recommendation.** Delete the input from `AppShell` until search exists. It
removes a lie, reclaims 360px, and probably fixes the switcher truncation for
free. If you want to keep the affordance visible as a roadmap signal, make it a
`disabled` button labelled "Search (coming soon)" — disabled removes it from the
tab order; `readOnly` does not. Separately, add `flex-shrink: 0` to
`.shell-event-switcher` and raise its `max-width` so the event name is never the
thing that gets sacrificed.

**Not KNOWN as this instance.**

---

## F3 — Two parallel navigation systems, and the sidebar's active state is wrong

**Severity: MAJOR · Effort: S (honest fix) / M (real fix) · Screen: event console**

**Observed.** Fifteen navigation targets are visible at once: six sidebar items
under ORGANIZE (Overview, Agenda ingest, CFP, Sponsors, Analytics, Check-in)
plus a nine-item horizontal pill row (Overview, Program, Speakers, Invites,
Maps, Announcements, Ops Inbox, Recap, Features). **"Overview" appears in both.**

Worse, the two systems disagree. `pages/organizer/events/[eventId]/index.tsx:271`
hardcodes `<OrganizerShell active="overview" …>`. So when the organizer is on
the **Program** tab, the sidebar still highlights **Overview** as the current
location while the tab row highlights Program. Two "you are here" indicators,
pointing at different places, on the same screen, one of which contains the
other's label.

**Why it matters.** This is a straight visibility-of-system-status failure, and
it is the root of the "where is anything" feeling in the console. The two
systems are also not conceptually distinct in a way a user could learn: CFP and
Sponsors are in the sidebar; Invites and Features are in the tabs; both sets are
scoped to the same event. There is no rule the organizer can infer.

**Recommendation (tiered).**
1. *Today, S:* (a) pass the real state — `active={tab === "overview" ? "overview" : undefined}`
   — so the sidebar stops asserting a location the user has left; (b) rename the
   Overview **tab** to what it actually contains. It holds Publish, Event
   settings and Create next edition, nothing else. Call it **"Settings &
   publish."** The name collision disappears and the tab becomes self-describing.
2. *Real fix, M:* collapse to one navigation. My recommendation is the sidebar,
   because it is the pattern the design system already committed to
   (`DESIGN_PHASE_D.md` Part 2, "Layout architecture") and because nine pills
   will not survive the next feature. Move the nine tabs into the ORGANIZE group
   as real routes (`/organizer/events/{id}/program`, `/speakers`, …), grouped:
   *Programme* (Program, Speakers, Agenda ingest, CFP) · *Attendees* (Invites,
   Announcements, Check-in) · *Event* (Settings & publish, Maps, Sponsors,
   Features) · *After* (Analytics, Recap, Ops Inbox). This also resolves F4 for
   free, since routes are URLs.

**Partially KNOWN** — the capture records the duplication neutrally; the wrong
active state and the naming collision are new.

---

## F4 — Console tabs are not addressable: Back, refresh and sharing all break

**Severity: MAJOR · Effort: S · Screen: event console**

**Observed (source-verified).** Tab selection is local React state
(`index.tsx:90`, `onClick={() => setTab(id)}`). Nothing is pushed to the router.
A `useEffect` reads `?tab=` **once, on query change only** (`index.tsx:94–99`).
Consequences, all of which follow directly:

- **Back leaves the console.** After ten minutes in Program, Back returns to
  whatever page preceded the event — the user's place is gone.
- **Refresh resets to Overview.** Any accidental reload during a long editing
  session discards the tab.
- **You cannot send anyone a link to a tab.** For a solo founder doing support,
  "go to the Program tab" cannot be a URL.
- **A stale query traps the user.** Arriving via the ingest success link
  (`?tab=program`) and then clicking Overview leaves `?tab=program` in the
  address bar; a refresh silently bounces back to Program. The URL and the
  screen now disagree.

**Why it matters.** User control and freedom. The browser's Back button is the
universal undo for navigation, and this screen removes it. It is also the
cheapest fix in this report.

**Recommendation.** Derive `tab` from `router.query.tab` and write it on click:
`router.push({ query: { ...router.query, tab: id } }, undefined, { shallow: true })`.
Roughly ten lines. If you adopt F3's real fix, this disappears entirely.

**Not KNOWN.**

---

## F5 — The Program tab has one visual level for everything

**Severity: MAJOR · Effort: M · Screen: Program tab**

This is the founder's own "text and stuff all over the place." I think that
reaction is correct and I can name the cause. It is structural, not stylistic —
restyling will not fix it.

**Observed (source-verified, `components/organizer/ProgramTab.tsx`).**

1. **The content is third on the page.** Tracks (8 rows in the captured event)
   and Rooms (6 rows) render as full panels *above* Sessions. Fourteen rows of
   configuration chrome, each with its own Edit and Delete, before a single
   session appears. A fourth panel (CSV import) sits below the entire programme.
2. **Four nested left edges.** A session card carries a 3px track-colour left
   border (`:949`). Inside it, papers render in a block with
   `borderLeft: 2px solid --gray-100` (`:1022`), and resources render in a
   **second, visually identical** `borderLeft: 2px` block (`:1173`). Same
   treatment, different meaning, stacked.
3. **One typographic weight for three kinds of information.** The session meta
   line (`time · track · room`), the resource provenance ("— File · added by
   Chris Hayden"), and the panel-level "Times in America/Los Angeles (PDT)" all
   render as `help-text` at 12px grey. Structure, provenance and page settings
   are indistinguishable at a glance.
4. **The same two links, forty to a hundred times.** Edit + Delete repeat at
   three nesting levels — session, paper, resource — as 13px ghost text links
   (`smallButton`, `:79`). On a real 22-session programme with papers, that is
   a field of blue and red text with no dominant element. *This is the literal
   source of "stuff all over the place."*
5. **A green success line persists inside the card.** `resourceNotices`
   (`:1307`) stays until the next add, so a card can carry a confirmation
   sentence indefinitely alongside the thing it confirmed.

**Why it matters.** The organizer's daily job on this screen is *scan and
verify* — "is Tuesday right?" Scanning needs a strong second level: one dominant
element per row and everything else subordinate. Right now everything competes.

**Recommendation (all CSS/JSX, no data changes).**
1. **Move Tracks and Rooms out of the vertical flow.** Either a single
   collapsed `<details>` labelled "Tracks & rooms (8 tracks · 6 rooms)" above
   Sessions, or a right-hand column. Sessions becomes the first thing on the
   tab. This is the highest-leverage single change on this screen.
2. **Collapse Edit/Delete into one kebab per row.** You already have
   `components/KebabMenu.tsx`. One quiet ⋯ per row instead of two coloured text
   links removes the confetti and fixes F6 at the same time.
3. **Merge papers and resources into one children list** with a small kind label
   (`Paper` / `Slides`) instead of two identical bordered blocks — one indent
   level, one border treatment.
4. **Give the card a header rule.** Title + meta, then a 1px `--gray-200` rule,
   then children. One rule buys the second hierarchy level the page lacks.
5. **Auto-dismiss the resource notice** after ~6 seconds, or drop it entirely —
   the resource now appears in the list, which is its own confirmation.
6. **Move the CSV import panel** into the Sessions empty state and the Agenda
   ingest page. It does not need to sit under every event's full programme.

**Partially KNOWN** — **KNOWN #9** said the Program tab was add-only; that has
been fixed and fixed well. The hierarchy cost of the fix is new.

---

## F6 — Destructive actions sit 8px from benign ones, at 13px

**Severity: MINOR · Effort: S · Screen: Program tab (all three nesting levels)**

**Observed (source-verified).** `smallButton = { fontSize: 13, padding: "2px 10px" }`
against `.button`'s `line-height: 20px` gives roughly a 26px-tall target. Edit
and Delete are adjacent with `gap: 8`. On resources it is Open and Remove — one
opens a file, the neighbour destroys it.

**Calibration, so this is not overstated.** 26px *clears* WCAG 2.2 SC 2.5.8
(Target Size Minimum, 24×24 CSS px), and `--danger` `#c22f2f` on white measures
~5.6:1, which passes AA. So this is neither a contrast nor a target-size
failure, and I am not claiming it is. It is an *adjacency* problem, and it is
already well mitigated: every delete routes through `ConfirmDialog` with
consequence-specific copy (see "What is working well"). That mitigation is why
this is MINOR and not MAJOR.

Worth noting: the project's own `DESIGN_PHASE_D.md` D5 specifies 44px minimum
targets, and the CSS honours that elsewhere (`.schedule-*` controls use
`min-height: 44px`). The console rows are the exception.

**Recommendation.** Fold Delete into the kebab (F5.2). Destructive actions
should require one deliberate extra step to *reach*, not just to *confirm*.

**Not KNOWN.**

---

## F7 — Ingest latency: the copy promises a minute, the poll gives up at 40 seconds, reality was two minutes

**Severity: MAJOR · Effort: S · Screen: Agenda ingest, during extraction**

**Observed.** The capture measured a 7-page, 184 KB PDF taking **over two
minutes**. Source (`ingest.tsx:355–360`) shows there *is* an `aria-live="polite"`
status line during that time — so the capture's "no progress indicator" is not
quite right; what is missing is *progress*, not *status*. The line reads, fixed
and unchanging for two minutes:

> ⏳ Extracting your program… this usually takes under a minute.

Meanwhile the polling loop is `for (let i = 0; i < 100 …)` at 400ms —
**a 40-second ceiling** (`:246`). On exhaustion the user gets an error-styled
message telling them to retry or reopen from history (`:250–255`).

*(Inference, flagged: the POST is sent with `processInline: true`, so the
two-minute wait may be spent inside the POST `await` rather than in the poll,
which would explain why the capture eventually saw a review panel. Either way
the two facts stand: the only real measurement is 2×–3× the promised time, and
the client's own patience budget is 40 seconds.)*

**Why it matters.** Visibility of system status is the classic case, but the
specific harm is worse: the copy sets an expectation the product then misses by
2–3×, on the single feature the homepage is built around. A user who waits 90
seconds past a stated one-minute promise reasonably concludes it has hung, and
either reloads (losing the run) or retries (paying for a second AI call).

**Recommendation.**
1. Make the promise honest and observed: *"Reading your programme. A long PDF
   can take two to three minutes."* Ship this today; it is one string.
2. Add an elapsed timer — `Extracting… 1:12` — driven by a `setInterval` on a
   start timestamp. Elapsed time is not progress, but it is proof of life, and
   it costs about eight lines. Do not fake a percentage.
3. Drive the label from `run.status` rather than a single constant, so the text
   moves through *Uploading → Reading the file → Extracting sessions → Building
   the changeset*. The statuses already exist.
4. Raise the poll ceiling to ~5 minutes, and add the escape hatch to the status
   line, not just the failure: *"You can leave this page — the run will be in
   Ingest history."*

**Adjacent to KNOWN #5** (ingest failures are silent), which has been fixed —
the failure and empty states are now genuinely good. The *latency* case is new.

---

## F8 — The ingest review screen cannot be scanned

**Severity: MAJOR · Effort: M · Screen: Agenda ingest → review**

**Observed.** The captured run put this on one screen, in this order: a source
panel; a counts line ("18 create · 4 update · 5 delete proposed · 0 errors");
four free-text Assumptions; a numbered create list of 18 pre-checked rows; an
update list; a delete list; Confirm/Cancel.

Source adds two things the capture could not see:
- The create list is `maxHeight: 280, overflow: "auto"` and the update list
  `maxHeight: 200, overflow: "auto"` (`ReviewChangeset.tsx:274, :320`). These are
  **nested scroll regions inside a scrolling page**: at ~21px per row, roughly
  13 of 18 creates are visible, the rest are behind a scrollbar most people will
  not notice, and mouse-wheel scrolling gets captured by whichever list the
  cursor happens to be over.
- **There is no select-all/none anywhere.** To reject a whole day, the organizer
  unticks rows one at a time.

Day is present only as a grey `YYYY-MM-DD` prefix on each row — the same
information the Program tab renders as bold day headers, here demoted to inline
grey text.

**Why it matters.** This is the approval gate for the entire product promise.
The organizer's actual task is not "read 22 rows"; it is "does Tuesday morning
look right?" The screen offers no structure to support that question: no day
grouping, no bulk action, no persistent count of what is selected, and a Confirm
button that scrolls out of view while you scan. The July fixes made this screen
*honest* (see below); they did not make it *scannable*.

**Recommendation, in priority order (all client-side).**
1. **Delete the `maxHeight`/`overflow`.** Let the lists scroll with the page.
   This is a two-line change and the single biggest improvement here.
2. **Group creates under bold day headers**, reusing the exact heading style
   from `ProgramTab.tsx:927–935` so the two screens teach the same shape.
3. **Add "Select all / none" per section**, plus a per-day "none" once grouped.
4. **Sticky footer bar** carrying `18 of 22 selected` + `Confirm drafts` +
   `Cancel`, so the count and the action stay visible while scanning. The
   selected count currently exists only as `acceptedCount` internal state and is
   never shown.
5. **Move Assumptions below the lists**, or into the rows they affect (see F1.2).
   Four unanswerable-looking questions are currently the first thing between the
   user and their programme.

**Not KNOWN.**

---

## F9 — Two-digit row numbers are clipped: item 10 renders as "0."

**Severity: MINOR · Effort: S · Screen: Agenda ingest → Will create list**

**Observed.** The capture shows items 10 and 11 rendering as `0.` and `1.`.
Cause is `<ol style={{ paddingLeft: 18 }}>` (`ReviewChangeset.tsx:274`) — 18px is
not enough to hold a two-digit marker, so the tens digit is clipped outside the
content box. Any programme with 10+ sessions — i.e. every real one — hits this.

**Why it matters.** Small, but it appears at exactly the moment the organizer is
deciding whether to trust the AI's output, and it makes the list look
miscounted. Trust is the scarce resource on this screen.

**Recommendation.** The numbers carry no meaning — they are not references the
organizer can use anywhere else. **Remove the `<ol>` and render an unstyled
list.** If you want to keep them, `paddingLeft: 32` fixes it.

**Not KNOWN.**

---

## F10 — Ingest history is fourteen unlabelled timestamp buttons

**Severity: POLISH · Effort: S · Screen: Agenda ingest, page bottom**

**Observed.** A bulleted `<ul>` of `.button.secondary` elements whose entire
label is `8/2/2026, 7:13:24 PM · PDF · READY_FOR_REVIEW`
(`ingest.tsx:554–581`). Nothing states that clicking reopens the run. Fourteen
entries, no pagination, no grouping, statuses (READY_FOR_REVIEW / CONFIRMED /
FAILED) as raw enum strings. Reopening a CONFIRMED run renders the full review
panel with `onConfirm` undefined — the Confirm button simply is not there, with
no explanation of why.

**Why it matters.** This is the recovery path the F7 timeout message points
users to. If the escape hatch is the fix for a two-minute wait, it should not be
the least legible thing on the page.

**Recommendation.** A small table — Date · Source · Result · Status · Open — with
`+22 / ~0 / −0` in the Result column. Hide confirmed and failed runs behind
"Show all runs" so the list defaults to what is actionable. When a CONFIRMED run
is reopened, replace the missing button with one line: *"Confirmed 2 Aug —
created 22 sessions. This run is read-only."* Recognition over recall, and it
explains an absence rather than leaving a hole.

**Not KNOWN.**

---

## F11 — Four mutually exclusive input methods, all expanded, before any choice

**Severity: MINOR · Effort: S · Screen: Agenda ingest, top of page — Taste**

**Observed.** Four full-width bordered panels stack vertically, each with its
own label, helper text and button: Paste program text · Fetch URL · Upload file ·
Import sessions from CSV. All are expanded on arrival. The organizer reads
roughly 80 words of helper copy to decide where to click, and the panels are
ordered by neither frequency nor likelihood (paste first, upload — the case the
homepage advertises — third).

Note also that the CSV panel's copy carries the single strongest reassurance on
the page for a cautious academic buyer — *"You review every row before anything
is created. No AI involved."* — and it is the last thing on the screen.

**Why it matters.** Aesthetic and minimalist design: showing four alternatives
at full weight when exactly one will be used is a decision cost paid on every
visit. This is taste, not a defect; the page works.

**Recommendation.** One panel with a segmented control — `Upload · Paste · URL ·
CSV` — defaulting to Upload. Reuse the segmented-control pattern from the
agenda's view switcher so it is not a new component. Move the "No AI involved"
line up into the CSV pane where it will actually be read.

**Not KNOWN.**

---

## F12 — Prose pages align to a different column than their own header and footer

**Severity: MINOR · Effort: S · Screens: /help, /help/[slug], /terms, /privacy, /security**

**Observed (source-verified).** `.mkt-header-inner`, `.mkt-footer-inner`,
`.mkt-section-inner` and `.mkt-hero-inner` all share
`width: min(1120px, calc(100% - 40px)); margin: 0 auto` (`globals.css:3768–3774`).
`.mkt-prose` sets `max-width: 720px` (`:4370`). Five pages apply **both classes
to the same element**, so the body column clamps to 720px while the header and
footer stay at 1120px. At 1440px the site nav starts at ≈160px and the page
content starts at ≈360px — a 200px disagreement on the left edge, which is
exactly the "large empty area to the left" the capture recorded on /help.

**Why it matters.** Consistency and standards. Nothing is broken, but the page
reads as misaligned rather than as a deliberate reading column, and it affects
Security and Privacy — the two pages an institutional procurement reader will
actually open.

**Recommendation.** Nest instead of combining:
`<div className="mkt-section-inner"><div className="mkt-prose">…</div></div>`.
The prose column then starts at the site's left edge, where the eye expects it.
Five files, one line each.

**Adjacent to KNOWN #3** (/help was empty — since fixed, and the article index
now renders). The alignment defect is new.

---

## F13 — The pricing FAQ is an accordion with its disclosure affordance deleted

**Severity: MINOR · Effort: S · Screen: /pricing**

**Observed (source-verified).** The FAQ is real `<details>/<summary>`
(`pricing.tsx:271–277`), so it does expand. But `globals.css:4113–4122` sets
`.mkt-faq summary { list-style: none }` and hides the WebKit marker, **with no
replacement indicator**. The result is exactly what the capture recorded: five
bold text rows separated by hairlines, with no chevron, plus, or arrow. The only
cue is `cursor: pointer` on hover.

**Why it matters.** The five hidden answers are *"How do refunds work?"*,
*"What happens when I archive an event?"*, *"What happens to a published event
if I cancel Pro?"* — the exact objections a buyer needs resolved before paying,
and the answer to **KNOWN #25** (the undefined cancellation story) is literally
sitting inside an invisible container. Hidden affordance on the revenue page.

**Recommendation.** Add a rotating indicator:
`.mkt-faq summary { display: flex; justify-content: space-between; }` plus
`summary::after { content: "+"; }` and
`details[open] summary::after { content: "−"; }`. Six lines of CSS on the
highest-intent page on the site.

**Not KNOWN.**

---

## F14 — Every attendee session row leads with three zeros

**Severity: MINOR · Effort: S · Screen: attendee agenda (`/dashboard`)**

**Observed (source-verified).** `dashboard.tsx:2457–2461` builds `countBits`
unconditionally, so before anyone joins, every row's meta line reads:

> 9:00 AM–10:00 AM · 0 in-person · 0 virtual · 0 async

Room and speakers are pushed further right behind three zeros.

**Why it matters.** Two reasons, and the second is the one that counts.
First, on a pre-event schedule "0 · 0 · 0" reads as *nobody is coming* — the
opposite of the intended neutral fact.
Second: `PARITY_AUDIT.md` lists *"counts-everywhere FOMO"* as a **deliberate
skip**, a positioning anti-goal. The calmest surface in the product is currently
shipping the pattern the positioning explicitly rejects. I am not recommending
you add anything here — I am pointing out that the anti-goal has leaked in, and
the fix is a deletion.

**Recommendation.** Render a mode count only when it is non-zero, or when the
session has a capacity set — where `12/40 in-person` means "seats left" and is
genuinely useful to an attendee. Suppress everything else. Same treatment for
the trailing `n likes`.

**KNOWN as a principle** (`PARITY_AUDIT.md`, deliberate skips) — **not KNOWN as
a live instance.**

---

## F15 — Form errors arrive as native browser tooltips

**Severity: MINOR · Effort: S · Screens: Program tab forms, session Q&A, polls**

**Observed.** The capture recorded native *"Please fill out this field."*
bubbles on submit. Source confirms the mechanism: `required` on inputs with no
`noValidate` on the form and no submit-time error handling
(`ProgramTab.tsx:589, 598, 608`, and the same pattern on session forms).

**Why it matters.** Native validation bubbles are outside the product's visual
language, vanish on the next click with no way to recall them, are positioned by
the browser rather than by the layout, and on a long form they attach to the
first invalid field, which may be scrolled out of view — so the form appears to
do nothing when you press the button. Assistive-technology announcement of these
bubbles is inconsistent across browsers.

**Notably, the app already has the right pattern.** `ProgramTab`'s `rowError()`
renders a `role="alert"` message in the row for *server* errors, and it is good.
The gap is that client-side validation never reaches it.

**Recommendation.** Add `noValidate` to those forms, keep `required` for
semantics, and on submit route the first missing field into the existing
`setRowError` path plus `.focus()` on that input. Reuses code that already
exists and already looks right.

**Partially KNOWN** — recorded in the capture's Recovery section; not in the July
findings.

---

## F16 — Auth-state flash on first paint

**Severity: MINOR · Effort: S–M · Screen: every public page**

**Observed.** Every page paints
`Product · Pricing · Help · Sign in · [Create your event]`, then swaps to
`[Open event app] · avatar · Sign out` once client JS hydrates. On `/e/demo` the
primary button's label changes from "Join / Sign in" to "Open event app".

**Why it matters.** Mostly it reads as jank on the surface whose job is
credibility. But there is a real interaction hazard: a returning user can click
a button during the window in which its label is about to change, and end up on
a login screen they did not ask for. The button is in the same position with a
different meaning.

**Recommendation.** Do not swap text in place. Reserve the slot with a
fixed-width neutral skeleton until auth resolves, then render once. That removes
both the flicker and the mis-click, and needs no server change.

*(The stronger fix — resolving auth server-side — is harder here: `HANDOFF_BRIEF`
says auth is an httpOnly cookie, so it would need a `getServerSideProps` read on
marketing pages, which costs their static rendering. I would not do it for this.)*

**Not KNOWN.**

---

## F17 — Day filtering exists twice, in two different control idioms

**Severity: POLISH · Effort: S · Screens: `/e/{slug}`, attendee agenda**

**Observed.** Day pills sit above the schedule (`All days | Mon, Aug 3 | …`) and
a DAY list repeats the same state in the right filter rail. On the attendee
agenda the timezone toggle is duplicated the same way.

**Why it matters.** Two controls for one state is a small consistency tax: the
user must work out whether they are the same filter, and the design must keep
them synchronised. It also makes the rail longer than it needs to be, pushing
TRACK and ROOM — the filters with no duplicate — below the fold.

**Recommendation.** Keep the pills (`DESIGN_PHASE_D.md` explicitly calls per-day
chips a deliberate advantage over Sched) and drop DAY from the rail. The rail
keeps search, TRACK and ROOM. One deletion, and the two genuinely useful filters
move up.

**Not KNOWN** (noted neutrally in the capture; not raised as a finding).

---

# What is working well — do not change these

This is not filler. Several of these are better than what competitors ship, and
some are the kind of thing a redesign would casually destroy.

**1. The delete confirmations in the Program tab are the best-designed thing in
the console.** `confirmCopy()` (`ProgramTab.tsx:528–570`) computes the actual
blast radius and states it:

> *"3 sessions currently use this track. They stay on the schedule with their
> times, but lose the 'Academia' label and colour."*

Most products ship "Are you sure?". This tells the user what will happen to
their data, with the real count, in their own vocabulary. **Do not genericise
this into a shared confirm component that loses the counts.**

**2. The ingest changeset defaults deletions to unchecked — and reframes the
whole panel when the run is destructive.** `zeroCreateWithDeletes`
(`ReviewChangeset.tsx:130, 344–354`) detects the "found nothing new but proposes
five deletions" case and leads with the explanation, tucking the delete list
behind a disclosure. That is someone designing for the worst case rather than
the happy path. Rare. Keep.

**3. `stripUniformConfidence`.** Suppressing the AI's confidence scores when
they are identical across every row, because a uniform score carries no
information and reads as "the AI is unsure of everything"
(`ingest.tsx:80–88`). This is a genuinely sophisticated piece of judgement about
what a number *communicates* versus what it *contains*. Keep, and reuse the
thinking elsewhere.

**4. `friendlyIngestError`.** Detecting provider JSON blobs and refusing to show
them (`ingest.tsx:91–101`). The user never meets a raw error object.

**5. The empty-extraction state is a model error state.** It says what happened,
diagnoses the likely cause with a concrete example — *"Include times like
'9:00–10:15' and one session per line"* — and offers a Try again that reuses
`lastRequest` so nothing is re-entered. Diagnosis + action + no lost work. This
is exactly what **KNOWN #5** asked for and it landed well.

**6. `OutsideDatesWarning` warns without blocking.** *"This is outside your event
dates (Jun 8 – Jun 10) — is that right? You can still save."* Correct on error
prevention *and* on user control: the system flags, the human decides. This is
the right default for every soft validation in the product.

**7. Domain fluency in the small print.** *"Order is preserved exactly — never
alphabetized"* under the authors textarea. That single line tells an academic
organizer this product was built by someone who understands author order matters.
It is worth more than a testimonial.

**8. State-machine copy on the Publish panel.** *"Draft events 404 for
outsiders. Published events are reachable via slug/join link. Archive hides them
from attendees while keeping data."* Three sentences, complete mental model, no
jargon-free hedging. **KNOWN** as a strength.

**9. The design system is real and largely obeyed.** One accent, a neutral
ramp, borders instead of shadows, small radii, no gold in-app. The
`--track-1..10` palette is AA-checked. Discipline at this level is the reason
the problems in this report are compositional rather than cosmetic — the hard
part is already done.

**10. Accessibility fundamentals that are usually missing are present.** A
global `:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px }`
(`globals.css:49`) — not `outline: none`. Inputs at 16px below the small
breakpoint and 14px above, which is the correct deliberate fix for iOS focus
zoom. `min-height: 44px` on the agenda and schedule controls. Pinch-zoom left
enabled, explicitly rejecting Sched's `user-scalable=no`. Track colour is
**never** the sole carrier of meaning: the track *name* is always in the meta
line beside the dot or bar, and low-confidence ingest rows carry the literal text
*"(confidence 0.70)"* alongside the amber tint. That last point matters — it is
the one place a colour-only pattern would have been easy and it was avoided.

---

# The three highest-value changes

If only three things ship, these.

### 1. Stop the interface asserting things that are not true — F1 + F2. Effort: S.

Two controls currently make false claims: the ingest assumption inputs, which
accept a correction and discard it, and the top-bar search field, which is
permanently `readOnly` on every authed page. Both are small edits. Both matter
far more than their size, because this product's entire differentiation is
*"AI drafts, you review, nothing publishes until you confirm."* A review surface
that silently drops the reviewer's correction is not a bug in a feature — it is a
crack in the premise. Fix the assumption text first (one paragraph of copy),
then delete the search input.

### 2. Give the console one navigation, and put location in the URL — F3 + F4. Effort: S now, M properly.

Today: pass the real active state so the sidebar stops claiming the user is on
Overview when they are on Program; rename the Overview tab to "Settings &
publish" to kill the name collision; push `?tab=` on click so Back, refresh and
link-sharing work. That is under an hour and removes the console's two worst
orientation failures. When there is a bigger window, collapse the nine tabs into
the sidebar as real routes — the design system already committed to that shape,
and the tab row will not survive the next feature.

### 3. Make the two dense screens scannable — F8 + F5. Effort: M.

The ingest review and the Program tab are where organizers spend their time, and
both fail the same way: no second level of hierarchy. Four changes carry most of
the value:
- delete the nested `maxHeight`/`overflow` scrollers on the review lists;
- group ingest creates under the same bold day headers the Program tab uses;
- add select-all/none plus a sticky `18 of 22 selected · Confirm drafts` footer;
- move Tracks and Rooms behind a disclosure so Sessions is first on the Program
  tab, and collapse the repeated Edit/Delete pairs into the existing `KebabMenu`.

That last pair is the direct, structural answer to "text and stuff all over the
place." It is not a styling problem and no amount of restyling will fix it —
the page needs fewer competing elements and one dominant one per row.
