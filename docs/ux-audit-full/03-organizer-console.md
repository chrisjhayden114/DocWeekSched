# 03 — Organizer Console UX Audit

**Scope:** the organizer console — the daily-use surface. Every screen below was read in source (`apps/web/pages/organizer/**`, `apps/web/components/**`, and the admin session drawer in `pages/dashboard.tsx`). Lens: DESIGN_PHASE_F's **form-first → content-first** shift, applied against the founder's UX/UI framework. Observations are separated from recommendations; inferences are flagged. No code was changed.

Prior work is honoured: E11–E30 and the E13–E16 chunks have already fixed much of what the 2026-08-02 merged audit flagged (ingest progress, confidence, draft visibility, one-input chooser, read-only assumptions). This audit credits those and targets what remains.

---

## Overall read (≈150 words)

The console is **functionally complete and, in places, genuinely well-made** — the ingest flow, the QR scanner, the Program tab's draft-publish and destructive-action copy, and the Ops Inbox are strong. But it is still overwhelmingly **form-first**: most screens open with a stack of empty inputs to fill, and the event "home" (Overview) leads with the entire settings form rather than the state of the event. The most-used surfaces are dense — Program stacks Tracks + Rooms chrome above the schedule with three information types at one grey weight; the edit-session drawer shows ~15 fields at once. Two navigation systems (sidebar vs in-page tabs) disagree about where you are, and the global search is a dead control. CFP is the clear laggard, still exposing raw JSON and user-IDs. The fix pattern is consistent and already prototyped in SetupAssistantPanel: lead with content and state, collapse creation to an on-demand affordance.

---

## Console shell & information architecture (applies to every screen)

**Purpose / who:** `AppShell` + `OrganizerShell` wrap every console page with a left sidebar, top bar, and event switcher. Seen by every organizer, constantly.

**What it does well:** Proven left-nav pattern with grouped labels (Organize / Workspace / Account), event switcher, mobile bottom-tab fallback (`OrganizerShell.tsx:180`), tidy stroke icons.

**Top issues**
1. **Two parallel navigation systems that don't reconcile.** *Proven pattern / cognitive load.* The sidebar Organize group (when an event is open) is: Overview, Agenda ingest, CFP, Sponsors, Analytics, Check-in (`OrganizerShell.tsx:130–138`). But the event page renders a *second* nav — nine in-page tabs: Overview, Program, Speakers, Invites, Maps, Announcements, Ops Inbox, Recap, Features (`events/[eventId]/index.tsx:308–331`). Program, Speakers, Invites, Maps, Announcements, Ops, Recap and Features exist **only** as in-page tabs and never appear in the sidebar; Ingest/CFP/Sponsors/Analytics/Check-in exist only in the sidebar. "Overview" is the sole item in both. A user cannot form one mental model of "where things live." **Severity: High.** *Fix:* one nav. Promote the tabs into the sidebar Organize group (or make the sidebar items tabs), so there is a single map of the event.
2. **Sidebar highlight is hardcoded wrong.** *Proven pattern.* The event page mounts the shell with `active="overview"` (`events/[eventId]/index.tsx:283`) regardless of the selected tab, so the sidebar always highlights Overview even while you're on Program or Features. (Flagged in the prior audit; still present.) **Severity: Med.**
3. **Tab state isn't in the URL.** *Minimise friction.* `?tab=` is read once on mount (`index.tsx:96–101`) but tab clicks only call `setTab` (`index.tsx:326`) — no `router` push. Browser Back exits the console entirely; a refresh on the Program tab lands you on Overview. **Severity: Med.** *Fix:* push the tab to the query on click.
4. **Global search is a dead control.** *Micro-interactions / trust.* `AppShell.tsx:337` renders the top-bar search `readOnly` — focusable, ~full-width, does nothing, on every page. **Severity: Med.** *Fix:* wire it or remove it until it works.

---

## organizer/index.tsx — events list (org home)

**Purpose / who:** the organizer's landing page after login — pick an org, see its events, create the next thing.

**What it does well:** A real table (name, dates, status chip, Manage), not card tiles (`index.tsx:142–178`); genuine empty states via `ListEmpty` for "no orgs" and "no events" (lines 111–140); `StatusChip` for status.

**Top issues**
1. **No orienting overview.** *Content-first / early aha (F#3).* The page is a bare list. There are no count-ups, no "3 events, 1 draft, next: publish X," no health at a glance — the exact "orienting overview" F calls for is absent at the org level too. **Severity: Med.** *Fix:* a compact header strip with real counts and the single most useful next action.
2. **Three competing top-right CTAs.** *Visual hierarchy / friction.* "New organization" (secondary), "Use the [assistant]" (secondary), "New event" (primary) sit together (`index.tsx:88–104`). Two of the three lead to event creation by different doors. **Severity: Low–Med.** *Fix:* one primary ("New event"); fold the assistant in as the default *inside* creation, not a sibling button.
3. **Table omits attendee count.** *Content-first.* DESIGN_PHASE_D D3 specified "attendee count from existing data" in this table; only name/dates/status render. **Severity: Low.** *(Inference: `OrganizerEvent` may not carry the count — verify before adding.)*
4. **Org selector is chrome.** With a single org, the labelled "Organization" `Select` panel (lines 121–130) is noise above the list. *Fix:* only show when >1 org, and move it into the header.

---

## organizer/org/new.tsx — create organization

**Purpose / who:** first-run: create the org that owns events.

**What it does well:** Minimal and honest — two fields, sentence-case helper ("This is the home for your events…"), auto-slug sanitising (`org/new.tsx:60`). This is a legitimate creation action, so opening on inputs is acceptable per F ("creation as a contextual action").

**Top issues**
1. **Slug's effect is unexplained.** *Cognitive load.* "URL slug (optional)" gives no hint of what it controls or that it can be skipped safely. **Severity: Low.** *Fix:* one line — "Used in links; leave blank and we'll generate one."

---

## events/new.tsx — the create-event wizard (dedicated section — highest traffic, most friction)

**Purpose / who:** every new event starts here. Two modes share the file: an **AI assistant** path (`?mode=ai`) with a chat plus a live-filling detail card, and a **manual 4-step** path (basics → dates/place → branding → features → created).

**What it does well (real strengths — keep):**
- **Draft persistence.** In-progress input is serialised to `sessionStorage` on every change and restored on remount (`events/new.tsx:122–203`), so auth settling or query hydration never wipes typed input. Excellent friction reduction.
- **The AI mode is authentically content-first.** As you chat, the right-hand "Event details" card fills in — Name, Dates, Timezone, Place, Size, Type, Program document, Networking — under an `AiGeneratedChip` (lines 453–513). You watch content assemble instead of confronting a form. This is the F direction, already realised.
- **Honest framing.** "New events start as Draft — only your org can see them until you publish" (line 369); live slug preview (lines 549–572).

**Top issues**
1. **The manual path is the archetypal form-first open.** *Content-first (F#1) / friction (UX#4).* Step 0 greets the user with four stacked empty inputs — Organization, Event name, Description, Public slug (lines 535–577) — the "fill this box then that box" the founder called out. **Severity: High.** *Fix:* collapse manual creation to one card (name auto-slugs, dates, timezone) with everything else behind "More options"; make the assistant the default hero, manual the fallback link.
2. **Branding is its own wizard step for a single field.** *Progressive disclosure (F#4) / friction.* Step 2 is one control — brand colour (lines 632–647) — yet it blocks the road to Features. **Severity: Med.** *Fix:* move brand colour under "More options"; it is not a gate.
3. **The full feature matrix is a creation step.** *Cognitive load / time-to-value.* Step 3 embeds the entire `FeatureConfigPanel` (six categories of toggles) before the event can be created (lines 649–673). A first-time user cannot judge these yet. **Severity: Med.** *Fix:* apply a sensible preset by default and defer the panel to the Features tab; offer presets only, inline.
4. **Two entry doors + in-flow mode-switching double the surface.** *Cognitive load.* "New event" vs "Use the assistant" on the org home, then a "Switch to manual entry" / "Use the assistant" toggle inside (lines 447, 524–532). Decision overhead before any value. **Severity: Med.**
5. **The success state has four co-equal buttons.** *Visual hierarchy.* "Build the program," "Import program document," "Edit event details," "Back to dashboard" (lines 688–703) with no dominant next step. **Severity: Low–Med.** *Fix:* one primary keyed to what the user told the assistant (ingest if they have a document, else "Build the program").

**Content-first target for this screen:** one "New event" card — title + one-line state ("Draft · not scheduled yet") + the three essential fields; the assistant offered as the primary way to fill it; branding/features/venue tucked behind disclosure; created-state resolves to a single obvious next action.

---

## events/[eventId] — Overview tab (the event "home")

**Purpose / who:** the landing tab when you open an event. Should be the orienting home F#3 describes.

**What it does well:** `SetupAssistantPanel` (`components/SetupAssistantPanel.tsx`) is the **seed of the content-first overview** — it reads live state, names the next incomplete step with a deep link ("Next step: … [link]", lines 36–45) and shows a ✓/○ checklist. This is exactly right; the F2 overview should grow from it.

**Top issues**
1. **The home tab leads with the entire settings form.** *Content-first (F#1) / this is the console's central form-first offence.* `EventSettingsPanel` renders inline on Overview (`index.tsx:413`) — ~nine fields (name, description, timezone, start/end, venue, address, online URL, brand colour; `EventSettingsPanel.tsx:130–217`). The event's "home" is half a settings form. **Severity: High.** *Fix:* move settings into a slide-over/modal (`EventSettingsModal` already exists) or its own screen; the home should show state, not editable fields.
2. **No stat cards, though F explicitly allows them here and the data is already loaded.** *Content-first / early aha (F#3, count-ups).* `refresh()` already fetches sessions, rooms, speakers, tracks (`index.tsx:133–147`); nothing surfaces them as sessions/speakers/registered/rooms tiles. **Severity: Med (high value, low cost).**
3. **A rare advanced action gets permanent prime real estate.** *Visual hierarchy.* "Create next edition" is a fixed panel on the home tab (lines 415–436) with equal weight to Publish. **Severity: Low–Med.** *Fix:* tuck it behind an action/menu.
4. **The header lacks a state line.** *Wayfinding (F#2).* `console-page-header` shows name + status chip + slug (lines 289–302) but no dates and no "N steps from publishing." **Severity: Low.**

---

## events/[eventId] — Program tab (ProgramTab.tsx) (the daily-use core)

**Purpose / who:** build and edit tracks, rooms, day-grouped sessions, papers, and resources — the most-used organizer surface.

**What it does well (substantial, much improved):**
- **Draft state is visible and actionable** (fixes prior B1): per-session "Draft" badge (lines 1197–1212) and a draft-count banner with a bulk "Publish N draft sessions" button when the event is live (lines 987–1017).
- Collapsible add-forms (no always-open forms), bulk-select + bulk-assign track/room toolbar (lines 1054–1115), day grouping, event-timezone display with a local-time toggle.
- **Best destructive-action copy in the app** — `confirmCopy` tells you exactly what a delete affects, e.g. tracks in use "stay on the schedule… but lose the label and color" (lines 619–661).
- The "+ Add" paper/resource chooser (lines 1551–1604) and "Order is preserved exactly — never alphabetized" (line 1287).

**Top issues**
1. **"Text everywhere" — structural density persists.** *Cognitive load / visual hierarchy (prior audit's finding).* Tracks and Rooms panels stack in full above the schedule (lines 733–945), so on a configured event you scroll two panels of chrome before the sessions. **Severity: Med–High.** *Fix:* lead with sessions; compress Tracks & Rooms into one compact strip or a settings popover.
2. **Up to three nested left-borders.** *Visual hierarchy.* Session card has a track-colour left border (line 1161); papers nest under a 2px grey left border (line 1257); resources under another (line 1408); the add-resource form under another (line 1461). Visually busy at depth. **Severity: Med.**
3. **Three information types at one grey weight.** *Visual hierarchy.* Session meta (time · track · room, line 1214), paper authors (line 1312) and resource meta ("— Link · added by X", line 1419) all render as 12px `help-text` grey — hierarchy flattens into a wall of grey. **Severity: Med.** *Fix:* one meta weight, a stronger title, and iconography to distinguish papers vs resources.
4. **Edit/Delete ghost buttons repeat at every level** (track, room, session, paper, resource). *Cognitive load.* Many low-contrast repeated controls. **Severity: Low–Med.** *Fix:* a kebab menu per row.
5. **Two divergent session editors exist.** *Consistency.* ProgramTab's inline edit exposes only title/time/track/room (`sessionFormFields`, lines 670–728), while the admin drawer in `dashboard.tsx` edits ~15 fields (materials, capacity, waitlist). Same object, different fields depending on entry point. **Severity: Med.** *(Inference on intent; the divergence itself is observable.)*

---

## events/[eventId] — Speakers tab

**Purpose / who:** list speakers and add one; explains speaker vs author/presenter.

**What it does well:** clear `ListEmpty`, and a genuinely useful distinction note ("Authors and presenters are listed under each paper… a person can be both", `index.tsx:455–458`).

**Top issues**
1. **Bare list + always-open name field.** *Content-first.* The add-speaker form sits permanently below the list (lines 476–484). **Severity: Low.**
2. **Can't add title/affiliation here.** *Friction.* The list *shows* title/affiliation (lines 466–471) but the only input is `name` (line 479) — no way to set the details this tab displays. **Severity: Med.** *(Inference: editing may live elsewhere or be missing — verify.)*

---

## events/[eventId] — Invites tab

**Purpose / who:** CSV bulk-invite with a dry-run review.

**What it does well:** reuses `ReviewChangeset` for column-mapping + per-row dry-run, and the honest fallback "If email isn't set up, you'll get copyable invite links instead" (`index.tsx:491–494`).

**Top issues**
1. **Opens on a bare file input; no template or example.** *Friction.* Nothing shows the expected columns before you upload (lines 495–503). **Severity: Med.** *Fix:* inline a sample CSV / column list.
2. **No single-invite quick path and no roster-first view.** *Content-first.* The tab is only bulk CSV; it doesn't lead with who's already invited. **Severity: Low–Med.**

---

## events/[eventId] — Maps tab

**Purpose / who:** venue map editing via `VenueMapEditor`.

**Limit / not audited in depth:** `VenueMapEditor.tsx` was outside the named component set and was **not read** for this pass — no findings claimed. *Recommend a dedicated review; a floor-plan editor is a likely density/responsive risk.*

---

## events/[eventId] — Announcements tab (AnnouncementComposer.tsx)

**Purpose / who:** compose and send segmented announcements; preview; emergency broadcast; sent-history.

**What it does well:** strong destructive-action friction on emergency broadcasts (checkbox warning + type-"EMERGENCY"-to-confirm + relabelled button); a real sent-log audit trail (audience, time, sender); `ListSkeleton` while loading.

**Top issues**
1. **The most form-first tab — opens on blank Title + Body.** *Content-first (F#1).* The composer's empty inputs are the first thing on the panel; state (budget, sent history) is below. **Severity: Med.** *Fix:* lead with the sent-log + budget state; collapse compose to a "New announcement" affordance.
2. **Budget is an opaque server string, not a gauge.** *Visual hierarchy.* The daily push budget renders as `{budget.meter}` text. **Severity: Low.**

---

## events/[eventId] — Ops Inbox tab (OpsInboxPanel.tsx)

**Purpose / who:** an AI-drafted review queue — detectors watch the event and propose actions the organizer approves.

**What it does well (a model to copy):** content-first — loads into suggestion cards, never empty inputs; carries `AiGeneratedChip`; humanises detector/action kinds instead of showing raw enums; persistent reassurance "Nothing is ever sent to attendees until you review it and click Send/Apply"; real empty states ("No open cards" with a "Run detectors" action); the one raw input (comma-separated blocklist) is tucked behind a `<details>` disclosure.

**Top issues:** none material. This is the console's best expression of "agents draft, humans publish." **Keep and use as the pattern reference.**

---

## events/[eventId] — Recap tab (RecapPanel.tsx)

**Purpose / who:** post-event AI-drafted recap sections + recap emails to edit and send.

**What it does well:** content-first (loads sections, real `ListEmpty`); prominent trust framing ("Numbers come from verified SQL metrics… Emails send only when you click Send"); send-gating (the send button shows only for `DRAFT` emails); `AiGeneratedChip` on panel and emails.

**Top issues**
1. **Highest per-panel density of the AI panels.** *Cognitive load.* Section editing is a **raw monospace Markdown textarea** (18 rows, `ui-monospace`) and email bodies render in `<pre>` — no rendered preview, nested scroll within the panel. **Severity: Med.** *Fix:* rendered preview + edit toggle.
2. **Inconsistent AI labelling.** *Consistency.* Sections use a plain-text "· AI" suffix while the panel and emails use the real `AiGeneratedChip`. **Severity: Low.**
3. **Raw status strings** (`DRAFT`) shown in email meta. **Severity: Low.**

---

## events/[eventId] — Features tab (FeatureConfigPanel.tsx)

**Purpose / who:** turn attendee-facing capabilities on/off; also embedded as wizard step 3.

**What it does well (a well-designed form):** grouped by category with a single purpose line each ("Spaces where attendees post and reply…"); accessible `role="switch"` toggles; dependency blocking with plain reasons ("This channel needs Community to be on"); a confirm-off dialog that promises data preservation; starting presets; explicit "Unsaved changes" + Save.

**Top issues**
1. **Presets are underplayed vs the long toggle list.** *Time-to-value.* For a novice the preset row (lines 80–101) is the fast path but reads as secondary to the full matrix. **Severity: Low.** *Fix:* lead with presets, "customise" reveals the toggles.
2. **Assistant duplication.** The "Ask the assistant" chat appears here *and* on Overview (`SetupAssistantPanel`). **Severity: Low.**

---

## events/[eventId]/ingest.tsx + ReviewChangeset.tsx — agenda ingest (dedicated section — the moat, highest friction historically)

**Purpose / who:** the headline feature — paste/upload/URL/spreadsheet a programme; AI extracts a reviewable changeset of DRAFT sessions the organizer confirms.

**What it does well (this screen has been transformed — the prior audit's "strongest feature behind the weakest screen" is largely resolved):**
- **One input at a time behind a chooser** (Paste / Upload / URL / Import spreadsheet, Upload default) — fixes the old four-inputs-at-once (`ingest.tsx:556–654`).
- **Honest live progress** during the multi-minute run: spinner + reported stage + a counting elapsed timer, with "Large programs can take 2–3 minutes. You can leave this page — the run keeps going and appears in Ingest history" (lines 444–465). No fake progress bar. Poll backs off to a ~30-min ceiling with "taking longer than usual" overtime copy (lines 306–320). This directly fixes prior C1.
- **Actionable empty result** ("No sessions found… include times like '9:00–10:15'", lines 484–509) and **friendly error mapping** that never shows raw provider JSON (lines 106–117).
- **Confidence pointed at fields, not blanket numbers**: per-field min, amber highlight, and uniform-confidence stripped when it carries no information (lines 96–104; `ReviewChangeset.tsx:293–314`) — addresses prior C2.
- **Assumptions are read-only with an honest explanation** ("These can't be edited here… untick affected rows and correct the source before re-importing", `ReviewChangeset.tsx:253–272`) — the correct resolution of prior B2.
- Review replaces the input; success message routes to "View program" or "Import another" (lines 516–551); the review scrolls into view; the earned count-up on the heading (the one F-sanctioned count-up).

**Top issues (what remains)**
1. **The review is still a long, multi-scroll stack, with no accept-all/none.** *Cognitive load (prior C3, partially).* "Will create" (max-height 280, own scroll), "Will update" (max-height 200, own scroll), deletes, errors and assumptions stack within the page, each row an individual checkbox (`ReviewChangeset.tsx:291, 337`). For a 40-session import there is no select-all/deselect-all. **Severity: Med.** *Fix:* select-all/none per section; flatten nested scrolls.
2. **Confidence still surfaces a bare number.** *Cognitive load (prior C2, residual).* Low rows read "(confidence 0.70)" (`ReviewChangeset.tsx:314`); the number is now targeted and amber-highlighted but the phrasing is still a raw score rather than a plain reason. **Severity: Low.**
3. **Ingest history is a developer-log list.** *Visual hierarchy.* Runs render as bulleted buttons "date · KIND · STATUS" (`ingest.tsx:742–769`) rather than scannable cards. **Severity: Low.**
4. **"DRAFT" is shouted in copy** (line 442) — softened by explanation but the all-caps residue of the overloaded-"draft" problem (prior C4) remains. **Severity: Low.**

**Verdict:** the weakest screen in the last audit is now among the better ones; remaining work is polish, not structural.

---

## events/[eventId]/cfp/index.tsx — Call for proposals (the console's laggard)

**Purpose / who:** organizers create CFP forms, add reviewers, run decisions, convert accepted proposals into the draft programme.

**What it does well:** bulk accept/reject; a decisions table sorted by weighted average; "Convert accepted → draft programme" reuses `ReviewChangeset`; CSV export.

**Top issues (this screen has not received the D3/E polish the rest has):**
1. **Raw "Rubric JSON" textarea.** *Cognitive load — severe.* Organizers must author/edit JSON by hand (`cfp/index.tsx:191–194`, default `'[{"id":"novelty","criterion":"Novelty","weight":1}…]'`). No academic will accept this. **Severity: High.** *Fix:* a criteria builder (rows of name + weight).
2. **"User id to add as reviewer" free-text input.** *Cognitive load / friction — severe.* Adding a reviewer requires pasting a raw user ID (line 265); no email/name lookup. **Severity: High.** *Fix:* search by name/email.
3. **Dashboard rendered as concatenated strings.** *Visual hierarchy.* "Status: k=v · …" and "Over time: date:count, …" (lines 214–223) are debug dumps, not a chart or table. **Severity: Med.**
4. **Form-first open.** With no forms yet, the screen is the create-CFP form (title/opens/closes/rubric JSON) (lines 176–198). **Severity: Med.**

---

## events/[eventId]/cfp/review.tsx — reviewer workspace

**Purpose / who:** reviewer-only surface — score assigned submissions.

**What it does well:** clean and content-first (shows assigned submissions as cards); rubric criteria as 1–5 number inputs; blind-review note; recuse; no billing/rosters/settings leak into the reviewer's view.

**Top issues**
1. **Abstract in a `<pre>` block** (line 120) — reads as code, not prose. **Severity: Low.**
2. **Numeric score inputs** rather than a rating control. *Micro-interactions.* **Severity: Low.**

---

## events/[eventId]/analytics.tsx

**Purpose / who:** engagement/registration analytics for one event (+ year-over-year across a series).

**What it does well:** honest and anti-goal-aware ("no public leaderboard unless you enable it", `analytics.tsx:108–110`); headline stat tiles; CSV export; YoY when a series exists; restrained.

**Top issues**
1. **"Charts" are hand-rolled CSS bars.** *Visual hierarchy / UI polish.* Registrations render as `<span>`s with `width = count*12` (lines 177–186) — no axis, can overflow on busy days. **Severity: Med.**
2. **Palette drift.** Bars use `var(--accent, #2F6FED)` (line 182) — a non-token blue fallback, not the DESIGN_PHASE_D primary `#0033a0`. **Severity: Low.**

---

## events/[eventId]/sponsors.tsx

**Purpose / who:** sponsor CRUD + per-sponsor lead-CSV export.

**What it does well:** clear CRUD, per-sponsor "Leads CSV," and a real `ListEmpty`.

**Top issues**
1. **Form-first: the 6-field add form sits above the list.** *Content-first.* "Add sponsor" (incl. a numeric "Sort order") renders before the sponsors it manages (lines 137–172). **Severity: Med.** *Fix:* list leads; "Add sponsor" is an action; drag-reorder replaces the numeric sort field.
2. **Native `confirm()` for delete.** *Consistency.* Line 97 uses `window.confirm` while the rest of the console uses `ConfirmDialog`. **Severity: Low.**

---

## events/[eventId]/scanner.tsx — check-in

**Purpose / who:** staff QR check-in at the door; the one surface explicitly built mobile-first (D5).

**What it does well (best-executed screen in the console):** full-bleed camera, high-contrast success/danger flash with large hallway-readable result text, offline queue + cached roster + auto-sync on reconnect, manual-code fallback when the camera is unavailable, and a clear online/checked-in/queued status line. Purpose-fit and calm.

**Top issues**
1. **Roster capped at 40 with no search.** *Friction at scale.* `attendees.slice(0, 40)` (line 359) — for a 500-person event you can't locate someone past the first 40 to check in manually. **Severity: Med.** *Fix:* a search field over the roster.

---

## organizer/billing.tsx

**Purpose / who:** plan, usage limits, upgrade/portal, invoices.

**What it does well:** honest states (read-only, grace period) with semantic tints; one primary action per panel; an honest fallback when billing isn't configured ("Self-serve checkout is opening soon — email us"); invoice list.

**Top issues**
1. **Upgrade options are bare buttons, not comparable plans.** *Time-to-value / hierarchy.* Five secondary buttons ("Per-event 250," "Pro monthly," …, lines 236–246) with no price or what-you-get at the decision point; comparison lives only on `/pricing`. **Severity: Low–Med.**

---

## organizer/ai-usage.tsx

**Purpose / who:** metered AI gateway usage (30-day totals, by feature, recent calls).

**What it does well:** clear totals, by-feature breakdown, a recent-calls table, honest "estimated cost."

**Top issues**
1. **Styling drift.** *Consistency.* Uses `.card` / `text-display-sm` rather than the `console-panel` / `console-panel-label` pattern used across the rest of the console. **Severity: Low.**
2. **By-feature is a bulleted list, not a table or bars.** *Visual hierarchy.* **Severity: Low.**

---

## The edit-session drawer (dashboard.tsx ~3441–3679) — F#4's named "worst offender"

**Purpose / who:** admin create/edit of a session, opened from the attendee-dashboard agenda (`isAdmin`). F names this the worst progressive-disclosure offender.

**What it does well:** real sectioning (Basics / Schedule / Speakers / Materials / Roster) with `h4` headings; inline roster + waitlist management with promote/remove when editing (lines 3585–3660); timezone-aware start/end; an E30 attempt to consolidate materials into "one materials area."

**Top issues**
1. **~15 inputs open at once — no progressive disclosure.** *F#4 directly.* Everything is expanded: Basics (3), Schedule (allow-virtual, zoom link, in-person capacity, virtual capacity), Speakers (2), and a **Materials block with six controls** — three URL inputs plus three upload dropzones (lines 3537–3582). Capacities, virtual join, materials and linked-speaker are all advanced and should sit behind "More options." **Severity: High.** *Fix:* essentials (title, time, track/room) visible; the rest disclosed on demand (the F4 SlideOver pattern).
2. **Divergence from ProgramTab's inline editor.** *Consistency.* Same object, two editors with different field sets (see Program tab issue 5). **Severity: Med.**

**Related — EventSettingsModal vs EventSettingsPanel:** two event-settings editors coexist — a modal with dirty-guard + logo/banner uploads (`EventSettingsModal.tsx`) and the inline `EventSettingsPanel` used on Overview (no image-upload fields). Different field sets for the same settings depending on entry point. **Severity: Low–Med.** *(Inference: the modal is used from the attendee-dashboard admin path; the duplication is observable and worth consolidating.)*

---

## Cross-cutting UI notes

- **Hardcoded colours outside the token system.** `ReviewChangeset.tsx` uses literal hex (`#b42318`, `#b54708`, `#fffaeb`, `#f4f6f9`, `#41506D` at lines 220/240/276/298/472/509) and analytics uses `#2F6FED` (line 182). Some are the blue-tinted greys DESIGN_PHASE_D explicitly retired. *Observation; erodes the "restrained palette" goal.*
- **Pervasive inline `style={{}}`** across pages and ProgramTab rather than token-backed classes — makes visual consistency (radii, spacing, meta weights) hard to hold centrally.
- **Responsive risk (inferred, not verified — mobile was not captured).** Row action buttons use `smallButton` (13px, `padding: 2px`), well under a 44px touch target (D5 goal); multi-column flex toolbars (Program panel heads, bulk-assign bar, wizard steps) rely on `flexWrap` with only occasional `@media(max-width:800px)` overrides. The scanner is the only surface tuned for phones. **Do not claim mobile is broken — flag it as an untested risk.**

---

## Top 5 highest-impact fixes across the console (ranked)

1. **Invert the event Overview from settings-form to content-first home (F2).** Move `EventSettingsPanel` off the home tab into a slide-over/modal; make Overview lead with stat cards (sessions/speakers/registered/rooms — data already fetched at `index.tsx:133–147`), the `SetupAssistantPanel` checklist, a wayfinding header ("Draft · Jun 8–10 · N steps from publishing"), and Publish. Highest impact because Overview is the daily entry point and is currently the console's central form-first offence.
2. **Unify navigation and fix the "where am I" signals.** One nav (fold the nine in-page tabs and the sidebar items into a single map), remove the hardcoded `active="overview"` (`index.tsx:283`), push the active tab to the URL, and either wire or remove the dead `readOnly` global search (`AppShell.tsx:337`). Fixes disorientation on every screen.
3. **Collapse the create-event wizard to one content-first card.** Manual path opens as one screen (name/dates/timezone) with branding + features + venue behind "More options"; assistant is the default; branding is not a standalone step; features default to a preset. Targets the highest-traffic, highest-friction creation path.
4. **Bring CFP up to the standard of the rest of the console.** Replace the raw "Rubric JSON" textarea with a criteria builder and the "User id" reviewer field with name/email search; render the dashboard as a table/chart, not concatenated strings. CFP is the clear laggard and the JSON/ID exposure is disqualifying for the academic buyer.
5. **Reduce density on the two heaviest daily surfaces.** Program tab: lead with sessions, compress Tracks & Rooms into a strip, collapse to one meta weight, kebab the repeated Edit/Delete. Edit-session drawer: progressive disclosure — essentials visible, capacity/materials/virtual behind "More options" (F#4). These are the surfaces organizers live in.

*Reference pattern already in the codebase:* `OpsInboxPanel` and `SetupAssistantPanel` show the target — lead with content and state, keep the reassurance, collapse creation to an on-demand affordance. The console doesn't need new ideas so much as this existing pattern applied to the form-first screens.
