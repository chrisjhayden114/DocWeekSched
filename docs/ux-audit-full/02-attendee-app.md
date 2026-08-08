# UX audit — the attendee app

**Scope:** the logged-in attendee experience. `apps/web/pages/dashboard.tsx` (tabbed: Agenda, Attendees, Meet, Community, Maps, Messages, Notifications, Profile — plus the admin-only Participants & Invites tab), `apps/web/pages/session/[sessionId].tsx`, `apps/web/pages/account.tsx`, and the components those render (`MessagesPanel`, `MatchmakerPanel`, `VenueMapsAttendee`, `SponsorsStrip`, `AgendaFilterPanel`, `ConciergeChat`, and the in-file `AttendeeDirectory` / `CommunityBoard` / `ProfileEditor`).
**Lens:** the founder's UX/UI framework and the **DESIGN_PHASE_F content-first test** (does the screen lead with content/state, or with empty inputs to fill?). Anti-goals from HANDOFF_BRIEF §1 apply (no engagement theatre, no manufactured urgency, no dark-pattern upsells).
**Rules honored:** observation vs. recommendation separated; mobile behavior is inferred from code and flagged as such; no code changed.

---

## Overall read (≈150 words)

Phase D landed a real app shell and a genuinely good agenda; Phase F's content-first shift has **not** reached most screens. The strongest surfaces (Agenda, Messages, Maps, Notifications) already lead with content. The weakest — **Community, session Q&A, and Profile** — still open as stacks of empty inputs: the exact "fill-this-box-then-that-box" feeling the founder diagnosed. The **Event assistant (ConciergeChat)** is the biggest single miss: a floating chat bubble that opens to an empty prompt, delivers no proactive value, and shows attendees a pricing upsell they can't act on. Recurring polish debt cuts across everything: card-soup hierarchy (every block an equal-weight white card), hardcoded hex colors and inline styles instead of tokens, `window.alert()` validation, and unpolished copy ("Asynchronous- Time Zone Issues!") that breaks the calm/academic voice. Nothing here is structural; it is presentation and interaction-model work, which is what Phase F scoped.

---

## Agenda tab

**Purpose:** browse the program and build a personal schedule. Seen by every attendee (and organizers, who also get inline edit).

**Content-first verdict:** CONTENT-FIRST. The schedule (`ScheduleBoard`) is the hero; composing (join, filter) is on-demand. This is the reference for the rest of the app.

**Top issues**
1. **Two-modal join flow = friction.** (UX-4) Saving a session opens an "Add to my agenda" mode picker (`dashboard.tsx:2340-2396`), which on choice opens a *second* "Add to your personal calendar" modal (`:2397-2429`). Two stacked dialogs to bookmark one talk. **Severity: high.** *Fix:* collapse to one step — the save dot adds in-person by default with an inline mode switch (which already exists on the card, `:2225-2257`); offer "add to calendar" as a quiet post-save affordance, not a blocking modal.
2. **Alarming, off-voice copy.** (UI-observation) The async option reads `Asynchronous- Time Zone Issues!` (`:2388`) and `title="Asynchronous – Time Zone Issues!"` (`:2252`). DESIGN_PHASE_D voice rule: "No exclamation marks in UI copy." **Severity: medium.** *Fix:* "Asynchronous — join across time zones."
3. **Context bar overload.** (UX-1, UI-6) One row carries the Event/My-Schedule toggle, view switcher, timezone toggle, Filters button, and "New session" (`:1186-1243`), and "New session" then renders *again* in a separate row (`:1246-1260`). **Severity: medium.** *Fix:* group secondary controls; render the admin action once.
4. **Run-on meta line.** (UI-6) The row meta concatenates time · room · track · Zoom · recording · resources · file · map · counts (`:2203-2224`), which on a rich session becomes an unscannable string. **Severity: low-medium.** *Fix:* cap to time · room · track; move link chips to a second, smaller row.
5. **Sponsors push the hero down.** (UX-2) `SponsorsStrip` renders as a full "Sponsors" card *above* the schedule (`:1180-1182`; `SponsorsStrip.tsx:60-89`). **Severity: low.** *Fix:* a slimmer strip, or below the first day group.

**Does well:** true content-first layout; Event/My-Schedule segmented toggle with live count pill; day chips; per-track color bars; filters-as-legend rail (`AgendaFilterPanel.tsx`); ICS download + subscription; skeleton loading; reduced-motion-gated stagger.

---

## Attendees tab (`AttendeeDirectory` + `MeetingRequestsPanel`)

**Purpose:** find and contact people. All attendees (directory is opt-in).

**Content-first verdict:** CONTENT-FIRST. Leads with people rows; search/filter on demand.

**Top issues**
1. **Full A–Z index regardless of size.** (UX-1) 26 letter buttons always render (`:3936, 3957-3968`), most scrolling to nothing at a 40-person event. **Severity: medium.** *Fix:* render only letters that have people.
2. **Two tools crammed on one screen.** (UX-1, UI-6) `MeetingRequestsPanel` (a personal inbox) renders unconditionally *below* the directory (`:1502-1509`) with no hierarchy separating "browse people" from "my requests." **Severity: medium.** *Fix:* make meeting requests a sub-view or move into Messages/Notifications.
3. **Three near-duplicate row actions.** (UX-1/4) Say hi / Message / Meet (`:3834-3849`); "Say hi" and "Message" both open a DM — the difference (one prefills a greeting) is invisible. **Severity: low-medium.** *Fix:* one primary "Message" + a kebab for Say-hi/Meet.
4. **Opt-in model only surfaces on failure.** (UX-4) A DM to a non-opted-in person fails to an inline notice after you try (`:923-939`); nothing signals it beforehand. **Severity: low.** *Fix:* show a quiet "not reachable" state on the card.

**Does well:** last-name sort + letter grouping; interest chips double as filters; expand/collapse bios (progressive disclosure); responsive action placement (under vs. side); skeleton.

---

## Meet tab (`MatchmakerPanel`)

**Purpose:** AI interest-based "people you should meet." All attendees; requires directory opt-in.

**Content-first verdict:** MIXED — content-shaped card, but cold-starts empty.

**Top issues**
1. **Empty by default, manual trigger.** (UX-2) The screen leads with "No suggestions yet… refresh during the event window" (`MatchmakerPanel.tsx:201`) and a manual "Refresh suggestions" button (`:186`). No early aha. **Severity: medium.** *Fix:* pre-populate suggestions on load when opted in; make refresh secondary.
2. **Redundant AI labels.** (UI-6) The label prints next to the button (`:189-191`) *and* under every suggestion (`:233-237`). **Severity: low.** *Fix:* label once at panel level.
3. **Token drift / inline styles.** (UI-5) Hardcoded fallback `var(--danger-700, #C22F2F)` (`:195`) and inline `borderTop`/radius throughout. **Severity: low.** *Fix:* token classes.

**Does well:** honest AI labeling ("AI suggestion — nothing sends until you do"); explicit guard that nothing auto-sends (`:126-129`); opt-in respected; per-person rationale (`whyLine`).

---

## Community tab (`CommunityBoard`)

**Purpose:** event-wide social spaces (meet-ups, moments, local tips, icebreakers, general). All attendees.

**Content-first verdict:** **FORM-FIRST — the flagship offender.** This is the screen DESIGN_PHASE_F named ("the community content-first mockup", F3).

**Top issues**
1. **Persistent empty compose card.** (UX-1, F-principle-1) A permanent "New post" `<form>` with empty title/message/channel fields sits between the channel nav and the threads (`:4246-4434`). The user is greeted by empty boxes, not the conversation. **Severity: high.** *Fix:* collapse to one "Start a post" affordance that expands inline or in a slide-over; lead with the thread feed (the F mockup).
2. **`window.alert()` validation.** (UI-8, calm anti-goal) Meet-up/moment validation uses `window.alert` (`:4121, 4139, 4153`). Jarring, un-calm. **Severity: medium.** *Fix:* inline field errors.
3. **Decorative hero art.** (UI-5) The icebreaker channel renders a polar-bear PNG hero strip (`:4204-4219`), against DESIGN_PHASE_D's "text is never pure decoration" / restrained-palette stance. **Severity: low-medium.** *Fix:* a real empty state ("Break the ice — introduce yourself"), no illustration.
4. **Three stacked control cards.** (UI-6) Channel-nav card + compose card + thread-list card = the "boxy / table being filled out" feel. **Severity: medium.** *Fix:* one feed surface with pills inline and compose collapsed.

**Does well:** rich channel model; relative timestamps; moment galleries; `ListEmpty` real empty states; directory-backed tagging (`SearchableMultiSelect`).

---

## Maps tab (`VenueMapsAttendee`)

**Purpose:** floor plans with tappable room pins + today's sessions. All attendees (feature-gated).

**Content-first verdict:** CONTENT-FIRST (renders the plan).

**Top issues**
1. **Generic card wrapper.** (UI-6) Rendered inside a bare `.card` (`dashboard.tsx:1478-1489`) with no wayfinding header (map name / "you are here"). **Severity: low.** *Fix:* a page header + map switcher above the canvas.
2. **Touch-gesture conflict (inference).** (UI-7) `FloorPlanCanvas` supports pinch/scroll zoom inside a scrolling page; on a phone, pan/zoom vs. page-scroll gestures commonly collide. **Flagged as inference — not verified on device.** *Fix:* verify on a 375px device; consider a dedicated fullscreen map view on mobile.

**Does well:** room→map deep links work from both the agenda ("Map" chip) and the session page ("View on map", `session/[sessionId].tsx:705-711`); focus-pin support; today's sessions surfaced on the map.

---

## Messages tab (`MessagesPanel`)

**Purpose:** 1:1 and small-group correspondence. All attendees (feature-gated).

**Content-first verdict:** CONTENT-FIRST. Master–detail (list + thread); compose-on-demand ("New message" toggles the picker, `:373-379`). A model the other tabs should copy.

**Top issues**
1. **Two-pane on mobile (inference).** (UI-7) `messages-layout` is a CSS grid of list + thread (`:368`); if it does not collapse to a single pane under 768px, both panes squeeze a 375px screen. **Flagged as inference — CSS not inspected here.** *Fix:* verify the grid collapses to list→thread navigation on mobile.
2. **No thread-level empty guidance for first-timers beyond text.** (UX-2, minor) Empty inbox is handled well (`:444-456`); the thread placeholder is plain text. **Severity: low.**

**Does well:** optimistic send with retry/failed states (`:631-642`); per-conversation drafts persisted (`:272-294`); offline strip; unread tracked by conversation not message (calm); day dividers; strong a11y (`aria-live`, `role="log"`, sr-only); auto-select most-recent. Deliberately no read receipts / typing indicators — correct for the positioning.

---

## Notifications tab

**Purpose:** one per-event inbox. All attendees.

**Content-first verdict:** CONTENT-FIRST (day-grouped list).

**Top issues**
1. **Auto-marks-everything-read on open.** (UX-observation) Opening the tab fires `read-all` immediately (`:598-617`), so the "X unread" header (`:1718-1726`) instantly flips to "All caught up" and the attendee loses any triage of what's new. **Severity: medium.** *Fix:* mark read on item click/scroll, not on tab mount.
2. **Entirely inline-styled.** (UI-5/6) The whole panel is inline styles rather than token classes (`:1713-1823`). **Severity: low-medium.** *Fix:* extract to token classes for consistency.

**Does well:** day grouping; each row routes to the right destination (session/thread/conversation/tab, `:1768-1786`); kind icons; quiet activity rolls into a digest (anti-engagement-theatre — good); visibility-gated 45s polling.

---

## Profile tab (`ProfileEditor`)

**Purpose:** identity, directory/matching opt-in, check-in QR, admin-access request, (further down) event creation. All attendees.

**Content-first verdict:** **FORM-FIRST.** The tab opens as one long single-column form in permanent edit mode (`:3013-3137`) — no "here is your profile, edit it" summary.

**Top issues**
1. **Always-edit form, never a profile.** (F-principle-1, UX-1) The person never sees their own card; they see empty/filled inputs to change. **Severity: medium.** *Fix:* lead with a profile summary card (photo, name, title, interests) + "Edit" that expands the form (compose-on-demand).
2. **Overloaded with unrelated tasks.** (UX-1) One tab mixes profile edit + directory opt-in + match-me + a check-in QR block *at the top of the form* (`:3018-3048`) + admin-access request + event creation. Very long scroll, many unrelated jobs. **Severity: medium.** *Fix:* split — QR into a "My check-in" spot, admin request into Account, event creation into the organizer console.
3. **Placeholder-only labels.** (UX-3, a11y) Name/title/affiliation/bio use placeholders as labels (`:3065-3110`); the label vanishes once typed. **Severity: medium.** *Fix:* visible `<label>`s above inputs (the DESIGN_PHASE_D form pattern).
4. **Hardcoded status colors.** (UI-5) Error `#b42318`, success `#0f7b3d` (`:3133-3134`) instead of `--danger`/`--success`. **Severity: low.** *Fix:* semantic tokens.

**Does well:** opt-in gating explained inline; academic participant-type vocabulary; client-side image resize before upload; links to account/data export.

---

## Account settings (`account.tsx`)

**Purpose:** GDPR data export + account deletion (7-day grace). All users.

**Content-first verdict:** ACCEPTABLE — leads with identity + two task cards.

**Top issues**
1. **Lives outside the app shell.** (UX-3, consistency) Rendered in a centered `.container` at `maxWidth: 640` (`:139`) — the narrow centered stack DESIGN_PHASE_D retired — with only a text back-link, no sidebar. An orphan relative to every other authed page. **Severity: medium.** *Fix:* render inside `AppShell` like the dashboard/session pages.
2. **Mixed token usage.** (UI-5) `var(--danger-700)` (`:173`) alongside `button-danger`. **Severity: low.**

**Does well:** clear export + grace-period deletion; sole-owner guard messaging (`:103-106`); honest, calm copy.

---

## Session detail (`session/[sessionId].tsx`)

**Purpose:** the deep view — join, papers, speakers, resources, Q&A, polls, feedback. All attendees.

**Content-first verdict:** MOSTLY CONTENT-FIRST — but Q&A regresses to form-first.

**Top issues**
1. **Q&A leads with an empty form.** (F-principle-1, UX-1) The "Start conversation" form (title + textarea) renders *above* the thread list (`:1047-1063`), before any content. The resources section on the *same page* got this right — its add-form is collapsed behind "+ Add a resource" (`:913-922`). Inconsistent within one screen. **Severity: high.** *Fix:* collapse Q&A to an "Ask a question" affordance; lead with the thread list.
2. **Card soup.** (UI-6) Seven stacked equal-weight white cards (header, papers, speakers, resources, Q&A, polls, feedback). No hierarchy — everything shouts equally. **Severity: medium.** *Fix:* differentiate primary (papers/join) from secondary (feedback) via surface layering, per DESIGN_PHASE_F.
3. **Redundant calendar buttons.** (UX-4) "Add to Google Calendar" and "Add to calendar" (ICS) sit side by side (`:761-792`). **Severity: low.** *Fix:* one "Add to calendar" with a small menu.
4. **Speaker links dead-end.** (UX-4) Speaker names link to `/dashboard?tab=Attendees` (`:840`) — the whole directory, not that person. **Severity: low.** *Fix:* deep-link to the attendee anchor.
5. **Inline-styled poll bars.** (UI-5) Poll result bars use inline hex/`--border`/`--primary` styling (`:1229-1246`). **Severity: low.**

**Does well:** **papers as a first-class section** with authors + discussant (`:799-818`) — the academic differentiator, done well; timezone toggle; back-link preserves agenda scroll; resources content-first; Q&A upvote / mark-answered / hide; skeleton loading.

---

## Event assistant — `ConciergeChat` (dedicated section)

**Purpose:** an in-event wayfinder grounded strictly in this event's published schedule, rooms, maps, and FAQ (`packages/shared/src/assistants.ts:25-35`). Rendered on the dashboard (`dashboard.tsx:1979-1989`) and the session page (`session/[sessionId].tsx:1370`), feature-gated (`concierge`, default on).

The founder considers this weak. Agreed — it is the highest-leverage attendee surface and currently the least realized.

**Observations & issues**
1. **Buried behind a floating bubble.** (UX-2, F5) The only entry point is a bottom-right FAB (`ConciergeChat.tsx:177-189`) that opens a modal sheet. The single most useful thing — "what's on this morning?" — is hidden behind a chat bubble on the very screen (Agenda) that already has the schedule. DESIGN_PHASE_F F5 explicitly says the assistant should "fold in … as a content-first panel." **Severity: high.** *Fix:* surface it as a dockable/inline panel on the agenda, not a floating widget.
2. **Opens empty; no proactive value.** (UX-2) The sheet opens to a blank message area — "Ask what's on this morning, or pick a starter above" (`:249`) — plus a text input. It is form-first by construction and gives zero content until the attendee types. The app already holds the schedule needed to pre-answer "what's on now." **Severity: high.** *Fix:* greet with a live, grounded "Happening now / next" answer before any input.
3. **Attendee-facing pricing upsell.** (Anti-goal: dark-pattern upgrade / wrong audience) On an allowance/402 the chat injects a "Free teaser" block with a "See plans" button to `/pricing` (`:237-244, 119-129`). Attendees don't buy — the plan is the organizer's — so this is an upsell shown to the wrong audience and reads as manufactured. **Severity: medium-high (positioning risk).** *Fix:* attendees should see a neutral "the assistant is unavailable for this event"; keep plan nudges on organizer surfaces only.
4. **Inconsistent starter chips.** (UX-3) "Build me a schedule around a topic" only prefills the input (`:221-224`), while "Who should I meet?" is tagged "Soon" (`:230-232`) yet still fires a real turn. Two chips, three behaviors. **Severity: medium.** *Fix:* make chip behavior uniform; if "meet" is not ready, disable it.
5. **No loading/typing feedback.** (UI-8) Between send and reply the input is disabled but the message area shows nothing — no skeleton or typing indicator (`:247-298`). **Severity: medium.** *Fix:* a pending assistant-bubble placeholder.
6. **Modal blocks the content it references.** (UX-1) On desktop the sheet dims the whole app (`:192`), hiding the schedule the attendee is asking about. **Severity: medium.** *Fix:* a side panel that sits beside the agenda.
7. **Thin failed-turn recovery.** (UI-8) Errors render as plain red text with no retry (`:300`). **Severity: low-medium.**

**Does well:** strictly grounded scope; honest AI labeling on every message (`AiAnswerChip`, `answerChipLabel`); human-confirms actions — the action-card "Confirm" step never auto-executes (`:271-294`); starter chips; history load; refusal handling.

---

## Note on the admin-only tab

**Participants & Invites** (`dashboard.tsx:1546-1681`) is organizer-facing (roster, invites, moderation) and out of the attendee-app scope; covered by the organizer-console audit. It is flagged here only because it shares the attendee dashboard shell — and it is the densest example of the inline-styled, table-in-a-card pattern that Phase F targets.

---

## Top 5 highest-impact fixes across the attendee app (ranked)

1. **Kill form-first: make Community and session Q&A compose-on-demand.** Collapse both persistent empty forms (`CommunityBoard` compose card `dashboard.tsx:4246-4434`; session Q&A form `session/[sessionId].tsx:1047-1063`) into a single "Start a post" / "Ask a question" affordance that expands, and lead with the feed. This is the founder's own flagship Phase F example, hits the two heaviest offenders, and is presentation-only.
2. **Re-home and warm up the Event assistant.** Move `ConciergeChat` from a modal FAB to a content-first side/inline panel that *proactively* answers "what's on now" from the schedule already loaded, and remove the attendee-facing `/pricing` teaser. Turns the weakest surface into the fastest aha (UX-2), and resolves an anti-goal (wrong-audience upsell).
3. **Collapse the agenda join flow and fix the copy.** One-step save (default in-person + inline mode switch already on the card) instead of the mode-modal→calendar-modal chain (`dashboard.tsx:2340-2429`); rewrite "Asynchronous- Time Zone Issues!" to calm voice (UX-4, UI voice).
4. **Restructure the Profile tab content-first.** Lead with a profile summary card + edit-on-demand; split out the check-in QR, admin-access request, and event creation; add real field labels; swap hardcoded status hex for `--danger`/`--success` (F-principle-1, UX-3, a11y).
5. **Systematize tokens and defeat card-soup.** Replace inline-styled panels (Notifications `:1713-1823`, session-detail cards, matchmaker) with token classes, and introduce surface layering so primary content outweighs secondary — restoring the visual hierarchy Phase F asks for (UI-5/6).

*(Mobile responsiveness for Maps and Messages is flagged as inference only and should be verified on a real 375px device before any fix is scoped — per the brief, behavior is not claimed from code.)*
