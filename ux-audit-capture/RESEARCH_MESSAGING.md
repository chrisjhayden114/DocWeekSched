# RESEARCH_MESSAGING.md

**Attendee messaging for UKEDL — landscape research and design recommendation.**
Written 2026-08-03. Research conducted 2026-08-03 via web search; every external
claim is sourced in §8. Read alongside `HANDOFF_BRIEF.md` §1 (anti-goals) and
`DESIGN_PHASE_D.md` Part 2 (tokens, layout architecture, voice).

---

## 0. The one-sentence thesis

**Messages is not a chat app. It is a low-volume correspondence surface with
consent at the front door and email as the transport of record.**

Everything below follows from that. The audience uses this product for three
days a year; a design borrowed from Slack (presence, typing indicators, unread
badges everywhere, real-time everything) will be both wrong and expensive. A
design borrowed from a well-run inbox — threads, read state, a request queue for
strangers, digest email — is right, is cheap, and is exactly what "calm by
design" means when applied to person-to-person contact.

The single highest-value decision in this document is **§5.4, the message
request gate**. It is the difference between "professional" and "the app where a
stranger sent me an unsolicited message at 11pm".

---

## 1. Landscape — what competitors actually do

### 1.1 Whova

Direct messaging is a core feature, sitting alongside community boards and
interest-based group discussions; reviewers consistently name messaging as one
of the reasons to pick Whova, and describe looking someone up in the attendee
list and messaging them as easy ([Research.com, 2026](https://research.com/software/reviews/whova);
[Capterra reviews, 2026](https://www.capterra.com/p/149712/Whova/reviews/)).

What it actually gets wrong, from 2025–2026 reviews:

- **Notification volume.** "Persistent notifications with no clear all option
  for community and messages make those sections overwhelming." "Too many
  notifications, that could never be taken off the screen." A March 2026
  reviewer: notifications "could become excessive, making it harder to focus on
  the most relevant updates."
- **Unread state is per-message, not per-conversation.** Reviewers report that
  opening the messaging icon does not clear the count — each message has to be
  opened individually, which is "time consuming".
- **Phantom unreads.** Users prompted that there were new messages when there
  were none.
- **Latency.** Lag between sending and receiving.
- **No consent gate.** A widely-quoted review complaint: you "receive unwanted
  messages like someone trying to flirt with you, seeing your picture and not
  showing theirs."
  (All: [Capterra Whova reviews, 2026](https://www.capterra.com/p/149712/Whova/reviews/);
  [Software Advice, 2026](https://www.softwareadvice.com/event-management/whova-profile/).)

Whova's own product response has been on the *broadcast* side, not the DM side:
a 2025 update lets organizers target announcements by category/ticket type and
exclude segments "to eliminate unnecessary spam"
([Whova blog](https://whova.com/blog/control-event-announcements/)). Its safety
story is organizer moderation of the **Community Board** — view an attendee's
post history, delete posts, suspend an attendee from posting
([Whova moderation blog](https://whova.com/blog/event-app-moderation/)). Note
what is absent: that is board moderation, not DM moderation.

**Read:** Whova is the feature-maximal incumbent and its messaging is a genuine
draw. Its failures are all failures of *volume control and consent*, which is
precisely the axis UKEDL has already chosen to compete on.

### 1.2 Sched

Chat is an **organizer-toggled** feature. When the organizer enables it in the
Control Panel, Sched auto-creates two group channels — *announcements* and
*event lobby* — plus 1:1 DMs and user-created group chats
([Sched: Event Chat](https://sched.com/guide/event-chat/);
[Attendee Networking](https://sched.com/guide/attendee-networking/)).

Two details matter:

- **Privacy is a hard gate, not a soft one.** "Attendees with private profiles
  will not show up in the chat list." Visibility in the directory *is* the
  messaging permission. Sched documents privacy controls as a first-class
  setup topic ([Privacy Controls](https://sched.com/guide/privacy-controls/)).
- **Sched's "Messaging" doc is about email, not chat.** The page titled
  *Messaging* (last modified 2025-01-24) is entirely about organizer→attendee
  **email**, segmented by role (attendee/speaker/sponsor) or by session
  attendance, with a Message Log of everything admins have sent
  ([Sched: Messaging](https://sched.com/guide/messaging/)). Sched treats email
  as the serious channel and in-app chat as the optional extra.

**Read:** Sched is the closest analogue to UKEDL's audience and its instinct —
opt-in chat, directory visibility as the permission, email as the real
transport — is the correct one.

### 1.3 Brella

Brella's model is **meeting-first, chat-second**. You find a person, click
*Suggest meeting*, pick a time, and write an intro. Chat and meeting state are
fused: meetings carry statuses (pending / accepted / declined / cancelled), you
get a filterable Meetings view of all requests and their status, and if a
meeting is declined the decliner explicitly chooses "Keep the chat open" or
"Close the chat"
([Understand 1:1 Brella Meetings](https://help-attendees.brella.io/en/articles/189148-understand-1-1-brella-meetings);
[1:1 Meeting Status](https://help-attendees.brella.io/en/articles/189147-1-1-meeting-status)).

The critical mechanic, and the best single idea in this whole landscape:
**"After your second message, the chat will close for you until the match reacts
to your request."**
([Network via Chat Message](https://help-attendees.brella.io/en/articles/189161-network-via-chat-message))

That is a hard cap on unreciprocated messaging, enforced in the product rather
than in a policy document. It makes spam structurally impossible.

### 1.4 Swapcard

**Connection-request-gated messaging.** You hit *Connect* on a profile, and you
may attach a message with the request; Swapcard's own help centre says requests
with messages are more likely to be answered and offers pre-written suggestions.
Requests can be listed, accepted or declined from inside the conversation. Only
after acceptance do you "chat directly with the attendee"
([How to connect with other event's participants](https://help-attendees.swapcard.com/en/articles/9121196-how-to-connect-with-other-event-s-participants);
[Meetings](https://help-attendees.swapcard.com/en/articles/8185472-streamlining-your-networking-with-meetings)).

### 1.5 Grip

Same shape as Swapcard: mutual interest via a *Connect* button; once confirmed
the person appears under *Connections* (web) / *Chat* (mobile). Grip shipped
"add an intro message when requesting to connect" as a headline announcement —
i.e. the intro-with-request was a *later* addition to a pure double-opt-in model
([Grip: intro message announcement](https://updates.grip.events/announcements/break-the-ice-ignite-connections-add-an-intro-message-when-requesting-to-connect);
[Grip: how to start a chat](https://support.grip.events/how-can-i-start-a-chat-with-someone-1)).

### 1.6 Bizzabo

Private 1:1 messaging plus enriched attendee profiles; customisable chat
channels, Q&A, polling, reactions on the virtual side; and — note the framing —
sponsors "proactively engage high-intent leads through 1:1 messaging"
([Bizzabo networking platform](https://www.bizzabo.com/event-management-software/event-networking-platform);
[Bizzabo virtual](https://www.bizzabo.com/solutions/virtual-event-software)).
Messaging here is partly a lead-gen surface sold to sponsors.

### 1.7 Hopin → RingCentral Events

Acquired by RingCentral in August 2023 and still operating in 2026 as
RingCentral Events; the company's stated direction is simplifying plans and
packaging rather than networking innovation
([RingCentral acquisition announcement, 2023-08-02](https://markets.financialcontent.com/clarkebroadcasting.mycentraloregon/article/bizwire-2023-8-2-ringcentral-expands-video-offerings-with-acquisition-of-events-and-session-product-lines-from-hopin);
[RingCentral Events pricing, 2026](https://www.ringcentral.com/pricing/events.html)).
Not a design reference for this audience.

### 1.8 Cvent Attendee Hub

Chat, Q&A, polls, surveys, discussions **and gamification**; AI matchmaking;
1:1 appointment scheduling that lands in the same unified agenda as sessions
([Cvent Attendee Hub](https://www.cvent.com/en/event-marketing-management/attendee-hub)).
Enterprise-scale, engagement-metric-driven — the explicit opposite of UKEDL's
positioning, and the gamification is a direct anti-goal.

### 1.9 The pattern across all eight

| Platform | Can a stranger DM you unprompted? | Gate | Chat tied to meetings? | Group chat |
|---|---|---|---|---|
| Whova | **Yes** | none (directory opt-out only) | separate | yes (interest groups) |
| Sched | Yes, if your profile is public | profile privacy | no | yes |
| Brella | Effectively no | 2-message cap until reciprocated | **fused** | no |
| Swapcard | No | connection request + note | linked | limited |
| Grip | No | connection request + intro | linked | limited |
| Bizzabo | Yes | none documented | linked | channels |
| RingCentral Events | Yes | none documented | no | channels |
| Cvent | Yes | none documented | appointments | yes |

**The platforms most respected for networking quality (Brella, Swapcard, Grip)
all gate first contact. The platform most complained about for unwanted
messages (Whova) does not.** UKEDL currently does not either.

---

## 2. What attendees and organizers complain about

Ranked by how often it surfaced and how badly it would hurt this product.

1. **Notification and unread overload.** The dominant Whova complaint across
   2025–2026 Capterra and Software Advice reviews: excessive notifications, no
   "clear all", counts that will not go away, unreads that mix community
   activity with actual person-to-person messages, no per-thread mute. One
   reviewer: "if I made one comment I kept getting notifications on meet ups I
   simply said hi in versus those I really wanted to track."
   ([Capterra](https://www.capterra.com/p/149712/Whova/reviews/),
   [Software Advice](https://www.softwareadvice.com/event-management/whova-profile/))
2. **Unwanted and inappropriate first contact.** Flirting from strangers; people
   who can see your photo while hiding their own. This is a safety issue, not a
   UX nit, and it is a compliance issue for any NSF-funded event — NSF requires
   conference codes of conduct addressing harassment "with clear and accessible
   means of reporting violations", disseminated before and at the event
   ([NSF code of conduct policy, UCI](https://research.uci.edu/sponsored-projects/proposal-submission/nsf-code-of-conduct-policy/)).
   A 2019 study of conference codes of conduct found most provide *some*
   reporting mechanism but quality varies widely
   ([Foxx et al., PMC6660776](https://pmc.ncbi.nlm.nih.gov/articles/PMC6660776/)).
3. **Findability inside messaging.** "Messaging system can be confusing, with
   delayed responses, hard-to-find replies, and limited options"; users
   "struggle to keep up with message volume, find relevant threads"
   ([Software Advice, 2026](https://www.softwareadvice.com/event-management/whova-profile/)).
4. **Perceived latency.** Messages lagging after send; phantom "new message"
   prompts. Both are *state* bugs, not infrastructure bugs — they are what
   happens when optimistic UI and polling are not reconciled properly.
5. **The channel is not where the person is.** Academic practice is that
   speakers put an email address on the poster or final slide, and follow-up
   after a conference happens by email or LinkedIn, not in a conference app
   ([The Savvy Scientist](https://www.thesavvyscientist.com/academic-networking/);
   [Conference Monkey](https://conferencemonkey.org/advice/how-to-network-during-and-after-a-conference-1191697)).
   A message that sits unread in a web app a professor opens twice is a message
   that was never delivered.
6. **Organizer-side blindness.** Organizers can moderate boards but generally
   cannot see, triage or act on DM reports; the tooling assumes a staffed trust
   & safety function that a 200-person departmental conference does not have.

---

## 3. General messaging-UI best practice — and what transfers

| Pattern | Where from | Transfers? | Why |
|---|---|---|---|
| Per-conversation read/unread with bold row + dot | Slack, Front, Mail | **Yes** | Directly fixes Whova's per-message unread complaint. Cheap. |
| Message grouping (consecutive messages from one sender collapse; day dividers) | everywhere | **Yes** | Pure CSS/JSX. Biggest single visual credibility win per line of code. |
| Command palette / ⌘K | Linear | **No** | Power-user muscle memory that a 3-days-a-year user will never build. A plain filter field is correct. |
| AI triage / auto-prioritised inbox | Superhuman, Front | **No** | Solves a 200-messages-a-day problem. Volume here is ~0–10 per attendee per event. |
| Typing indicators, presence dots, read receipts | Slack, WhatsApp | **No** | Requires real-time infrastructure, manufactures urgency, and read receipts are socially coercive between a doctoral student and a professor. Explicit anti-goal territory. |
| Threaded replies inside a conversation | Slack | **No** | Threading exists to manage many-participant channels. 1:1 and 4-person groups do not need it, and Session Q&A already owns the threaded-discussion job. |
| Reactions / emoji | Slack | **Weak yes, later** | One acknowledgement affordance (👍 equivalent) genuinely reduces "thanks!" noise. Not Phase 1; risks tone drift. |
| Optimistic send with sending/sent/failed + retry | Slack, iMessage | **Yes** | This is what makes a polled app feel instant. It is the fix for complaint #4. |
| Digest email for what you missed | Front, Basecamp | **Yes — essential here** | Matches the existing digest-first notification policy and is the only way a 3-days-a-year user actually receives anything. |
| Snooze / archive | Superhuman | **No** | Inbox-zero ritual for people living in the tool. |
| Search within conversation | Slack | **Later** | Real value only after multiple events accumulate history. |

**Rule of thumb applied throughout: adopt the patterns that reduce the cost of
*receiving*; reject the patterns that increase the reward for *checking*.**

---

## 4. Accessibility requirements

Non-negotiable for a product sold to universities (public-sector procurement in
the UK and EU will ask). Sources: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/),
[Sara Soueidan on live regions](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/),
[WCAG 2.2 chat widget checklist](https://threada.ai/blog/wcag-22-chat-widget-accessibility-checklist/),
[Craig Abbott, web chat accessibility](https://craigabbott.co.uk/blog/web-chat-accessibility-considerations/).

**Message thread**
- Container: `role="log"` (implicit `aria-live="polite"`, `aria-relevant="additions"`).
  `log` queues rather than interrupts — correct for arriving messages. Never
  `assertive`; reserve that for the send-failure alert only.
- Each message is a list item / section with an accessible name that reads
  **"Sender name, time, message text"** in that order, so a screen-reader user
  can arrow through the transcript and always know who is speaking. Do not rely
  on visual left/right alignment to convey authorship — put "You" or the
  sender's name in the accessible name even when it is visually suppressed by
  grouping.
- Timestamps: `<time datetime="...">` with a full absolute value in the
  `title`/accessible name and the relative value on screen.
- Day dividers are `<h3>`-level headings, so heading navigation works.

**Conversation list**
- A `<ul>` of links (real `<a href>` to `/dashboard/messages/[id]`), not
  click-handlers on `<div>`s. Selected item gets `aria-current="page"`.
- Unread must not be conveyed by weight or a colour dot alone — include visually
  hidden text "Unread" (or `aria-label="… , unread"`) in the row's accessible
  name.

**Composer**
- A real `<label>` (visually hidden is fine) on a real `<textarea>`; a real
  `<button type="submit">`. Send must be reachable and operable by keyboard
  regardless of the Enter shortcut.
- **Enter sends, Shift+Enter inserts a newline** — but this must be discoverable
  and it must not be the *only* way to send. Persist a small hint under the
  field: "Enter to send · Shift + Enter for a new line". Provide a preference
  toggle later if anyone complains; do not ship a hidden-shortcut-only send.
- Character counter (if used) must be `aria-live="polite"` and only announce at
  thresholds, not every keystroke.

**Focus management**
- Opening a conversation moves focus to the thread heading (`tabindex="-1"`,
  focus it programmatically), not to the composer — a screen-reader user needs
  to hear where they landed before they are dropped in a text field. On mobile
  full-page navigation the same rule applies, and the Back control must return
  focus to the originating row.
- After send: clear the textarea, keep focus in it, announce "Message sent" via
  a polite live region. On failure, move focus to the retry control and announce
  via `role="alert"`.
- Escape from the composer does not discard the draft. Ever.

**Other**
- Focus ring: 2px `--primary` at 2px offset (already the D1 global).
- Contrast: sent-message bubbles on `--primary` must hit 4.5:1 for the text;
  `#0033a0` with white text passes comfortably. Do not tint the received bubble
  below `--gray-100` with `--gray-700` text.
- Target size 24×24 minimum (WCAG 2.2 SC 2.5.8) for the kebab/overflow actions
  on message rows.
- Auto-scroll: only scroll to the newest message if the user is already at the
  bottom. If they have scrolled up, show a "3 new messages ↓" button instead of
  yanking the viewport.

---

## 5. The design recommendation

### 5.1 What Messages is, and what it is not

Draw the line hard, because the product already has four adjacent surfaces.

| Surface | Job | Audience shape | Owner |
|---|---|---|---|
| **Announcements** | organizer → everyone, budgeted | 1 → all | organizer |
| **Community** | public, persistent, topic-first posts and replies | all → all | attendees |
| **Session Q&A** | questions about *this session*, upvoted, answerable | all → speaker/room | attendees + organizer |
| **Meeting requests / Matchmaker** | "let's meet at 14:00 by the coffee" | 1 ↔ 1, calendared | attendees |
| **Messages** | **private correspondence between named people** | 1↔1 and small named groups | attendees |

**Therefore: kill "Everyone — event chat."** It is a many-to-many public room,
which is Community's job, and it is the thing that generates the notification
firehose everyone complains about. It also makes the Messages tab look empty and
purposeless, because the one row in the list is a room nobody wants. Replace it
in the list with nothing; put a single line in the empty state pointing at
Community. If the founder wants to keep it, it must at minimum be muted by
default, excluded from unread counts, and labelled a *board*, not a chat — but
the recommendation is removal.

That leaves Messages with exactly one job, which it can do well:
**1:1 and small-group private correspondence, with consent at the front door.**

### 5.2 Screen anatomy — desktop (≥1024px)

Two panes inside the existing 240px-sidebar app shell. Content column runs full
width here (this is the one screen that should override the 1040px max — a
master–detail needs the room); list pane fixed **320px**, thread pane flexes.
Both panes are white cards on `--gray-50` with `1px solid --gray-200`, radius 4,
and they scroll independently. Page height is `100vh` minus the top bar — the
composer must be pinned, not chased down the page.

```
┌─ 240px sidebar ─┬─ 320px list ──────────────┬─ thread ─────────────────────────┐
│ Event           │ Messages            [New] │ Dr Aisha Rahman                  │
│  Agenda         │ ┌───────────────────────┐ │ University of Leeds · Speaker    │
│  Attendees      │ │ Search names or text  │ │ ─────────────────────────────────│
│  Community      │ └───────────────────────┘ │                                  │
│  Maps           │ [All] [Unread 2]          │        Wednesday 3 September     │
│ ▸Messages   (2) │ ───────────────────────── │  ┌────────────────────────────┐  │
│ Organize        │ ● Aisha Rahman     11:04  │  │ Re: 4B — Assessment       │  │
│  …              │   Leeds · Speaker         │  │ literacy in ITE       [×]  │  │
│ Account         │   Happy to send the pre…  │  └────────────────────────────┘  │
│  Profile        │ ───────────────────────── │  ┌──────────────────────────┐    │
│  Notifications  │   Panel 4B co-authors  Tue│  │ Hello — I'm presenting…  │    │
│                 │   3 people                │  └──────────────────────────┘    │
│                 │   Tom: I've uploaded th…  │  Aisha Rahman · 11:04            │
│                 │ ───────────────────────── │                                  │
│                 │ REQUESTS (1)              │            ┌─────────────────┐   │
│                 │   J. Okafor        Mon    │            │ Thanks — yes,   │   │
│                 │   Wants to message you    │            │ that would be…  │   │
│                 │                           │            └─────────────────┘   │
│                 │                           │                You · 11:31 ✓     │
│                 │                           │ ─────────────────────────────────│
│                 │                           │ ┌─────────────────────────────┐  │
│                 │                           │ │ Write a message…            │  │
│                 │                           │ └─────────────────────────────┘  │
│                 │                           │ Enter to send · ⇧Enter new line  │
└─────────────────┴───────────────────────────┴──────────────────────────────────┘
```

Note what is gone: the explainer paragraph in the left pane, and the explainer
line under the conversation title. Both are scaffolding for a feature that does
not yet explain itself. A good messaging surface needs no instructions; the
instruction belongs in the empty state, once.

### 5.3 Component specs

**Left pane header.** Row: `Messages` at `--text-h2` (600 20/28) on the left;
`New message` as a secondary button (white, 1px `--gray-300`, radius 6, 14px/500)
on the right. Not "+ New" — spell it, this is an academic product and the plus
sign saves nothing.

**Filter field.** Full-width input, radius 6, 36px, placeholder
`Search names or messages`. It filters the list by participant name,
affiliation, and last-message text, client-side, on the already-loaded list.
"Filter chats" is the wrong label — nobody at a conference calls these chats.

**Segmented filter.** Two chips below the field: `All` · `Unread (2)`. Radius 6,
active state `--gray-200` background, 13px/500. Only render `Unread` when the
count is > 0. No "Archived" until archiving exists.

**Conversation row.** 72px tall, 12px vertical padding, `1px solid --gray-200`
hairline between rows (not around each row — this is a list, not a stack of
cards). Anatomy left to right:

- 32px avatar. Initials on a deterministic tint derived from the user id
  (`--gray-200` family only; no rainbow). Photo when present. For a group, a
  small overlapped pair.
- Line 1: **Name** 15px/600 `--gray-900` (truncate). For groups, the group name
  or, if unnamed, "Rahman, Okafor and 2 others". Right-aligned on the same line:
  relative timestamp 12px `--gray-500` — `11:04` today, `Tue` this week,
  `3 Sep` older.
- Line 2: `Affiliation · Role` 12px `--gray-500`, e.g. `University of Leeds ·
  Speaker`. Role chip only for Speaker / Organizer — everyone else gets nothing.
  This line is the single biggest professionalism signal in the whole feature
  and it costs one join.
- Line 3: last message preview, 13px `--gray-600`, one line, ellipsis. Prefix
  `You: ` when the last message is yours.
- **Unread:** name and preview go 600 and `--gray-900`; a 8px `--primary` dot
  sits at the far left of the row in a 16px gutter. Plus visually hidden text
  "Unread". Selected row: `--primary-50` background + 2px `--primary` left bar
  (matches the sidebar active treatment — one language, one product).

**Requests group.** A section header inside the same list:
`REQUESTS (1)` in 11px uppercase `--gray-400` with `+0.04em` tracking (the D2
group-label style). Sits **below** accepted conversations, always. Request rows
render the same but with the preview line replaced by
`Wants to message you` in `--gray-500` italic-free 13px. Requests never
contribute to the sidebar unread count and never trigger an email. That is the
whole point.

**Thread header.** Sticky. Name 16px/600; second line
`University of Leeds · Speaker` 12px `--gray-500`; for groups, the participant
list. Right side: a kebab (24×24) with `View profile` · `Mute this conversation`
· `Block` · `Report to organizers`. Nothing else. No call button, no video, no
"add to meeting" (that is the Meeting request surface's job — though a
`Request a meeting` ghost button here is a legitimate, cheap cross-link).

**Context chip.** When a conversation was started from a session, paper or CFP
submission, a dismissible chip pins to the top of the thread:
`Re: 4B — Assessment literacy in initial teacher education` with a link to the
session. This is the academic-specific feature nobody else has and it costs one
nullable foreign key. It answers the question every professor asks on opening a
message from a stranger: *why are you contacting me?*

**Message rows.** Not iMessage bubbles-with-tails. Use restrained blocks:

- Received: `--gray-100` background, `--gray-900` text, radius 6 (radius 2 on
  the top-left corner of a grouped run's second-and-later messages), max-width
  min(62ch, 78%), left aligned.
- Sent: `--primary` background, white text, same geometry, right aligned.
- 14px/21px body (the app default). Preserve line breaks. Linkify URLs and
  emails; nothing else — **no markdown, no rich text, no HTML.**
- Grouping: consecutive messages from the same sender within 5 minutes stack
  with 2px gaps and share one metadata line. New sender or >5 minutes starts a
  new group with 12px gap.
- Metadata line under each group: `Aisha Rahman · 11:04` / `You · 11:31`,
  12px `--gray-500`, aligned to the group's side.
- Day dividers: centred hairline with `Wednesday 3 September` in 12px
  `--gray-500` on the page background, rendered as an `<h3>`.

**Composer.** Pinned to the bottom of the thread pane, white, 1px top border
`--gray-200`, 12px padding. Auto-growing `<textarea>`, min 2 rows, max 8 then
scroll. Placeholder `Write a message…`. Primary Send button bottom-right,
disabled when the field is empty or whitespace. Hint line 12px `--gray-500`:
`Enter to send · Shift + Enter for a new line`. Draft persists to
`localStorage` keyed by conversation id — a professor who navigates to the
agenda mid-sentence and comes back must not lose the sentence.

### 5.4 The message request gate — the core mechanic

Adapted from Brella's two-message cap and Swapcard/Grip's connect-then-chat,
tuned for academics who will not tolerate a "connection request" ritual.

1. **Anyone visible in the attendee directory can be sent a first message.** No
   connection request, no accept/decline ceremony. Academics find that
   ritualistic and LinkedIn-flavoured.
2. **The first message from someone you have never corresponded with lands in
   REQUESTS, not your inbox.** It does not increment your unread badge and it
   does not generate an email.
3. **The sender may send exactly one message** and then sees, inline in their
   own thread, a muted note: `Waiting for a reply. You can send another message
   once {First name} responds.` The composer is disabled. This is Brella's cap,
   tightened from two to one.
4. **Any reply from the recipient promotes the conversation** out of Requests
   into the main list permanently, and unlocks the composer for both sides. No
   "accept" button needed — replying *is* accepting.
5. **Ignoring costs nothing.** No "declined" notice is ever sent. The sender
   simply never gets a reply, exactly as with email. Requests older than the
   event + 30 days are archived silently.
6. **Rate limit: 10 new conversations per person per day, 25 per event.**
   LinkedIn caps group/event message requests at 10 per week
   ([LinkedIn limits, 2026](https://evaboot.com/blog/linkedin-limits)); ours is
   more generous because a three-day conference is a legitimate burst. Exceeding
   it shows: `You've started 10 new conversations today. You can start more
   tomorrow — this limit keeps the event free of bulk messaging.`
7. **First messages have a 1,000-character ceiling.** Enough for a real academic
   introduction; short enough that nobody pastes a CFP advertisement.

Exemptions: organizers of the event, and anyone you have already messaged, skip
the request queue. Session speakers do **not** get an exemption in either
direction — being a speaker is exactly the condition under which you receive
unsolicited mail, and the gate is protecting them.

### 5.5 How a conversation gets started

Four entry points, in descending order of expected use. All four open the same
composer.

1. **Attendee directory row → `Message`.** Secondary button on the row or in the
   profile drawer.
2. **Session page → author/speaker name → `Message about this session`.**
   Pre-attaches the context chip and pre-fills nothing else. (`PARITY_AUDIT.md`
   G2 proposes a templated "Say Hi" pre-fill — **do not pre-fill message body
   text.** A templated opener in an academic context reads as automated and
   cheapens exactly the professionalism this feature is meant to signal. The
   context chip does the same job honestly. If a nudge is wanted, use the
   placeholder: `Introduce yourself and say what you'd like to discuss.`)
3. **Paper page → co-author names.** Same, with the paper as context.
4. **`New message` button → recipient picker.** A modal: search field, results
   as `Name — Affiliation — Role` rows, multi-select chips for a group, then
   straight into the composer. Group max 8 participants; groups get an optional
   name (`Panel 4B co-authors`), editable by any member.

### 5.6 States and copy

| State | Where | Copy |
|---|---|---|
| No conversations at all | list pane | **No messages yet.** / `Message someone from the Attendees list, or from a speaker's name on any session page. Looking for open discussion instead? That's in Community.` + `Browse attendees` button |
| No conversation selected | thread pane | Centred, `--gray-500`: `Select a conversation` |
| New empty thread | thread pane | `This is the start of your conversation with Aisha Rahman.` 13px `--gray-500`, above the composer |
| Search returns nothing | list pane | `No conversations match "rahman".` |
| Sending | message row | Row renders immediately at 60% opacity, metadata reads `Sending…` |
| Sent | message row | Full opacity, metadata reads `You · 11:31` with a 12px `--gray-400` check |
| Failed | message row | Row keeps the text, `--danger-50` background, 1px `--danger` border; below it `Not sent.` + `Retry` + `Delete` as inline text buttons; `role="alert"` fires once |
| Offline | composer | Thin `--warning-50` strip above the composer: `You're offline. Messages will send when you reconnect.` |
| Request pending (sender) | composer | Composer disabled; `Waiting for a reply. You can send another message once Aisha responds.` |
| Request pending (recipient) | thread | Above the composer: `Aisha Rahman hasn't messaged you before.` + `Reply` (focuses composer) · `Block` · `Report` |
| Blocked by you | thread | Read-only transcript; `You blocked this person. They can't send you messages.` + `Unblock` |
| Muted | list row | Bell-slash glyph 12px `--gray-400` in place of the unread dot |
| Event ended | thread | `This event ended on 5 September. You can still read this conversation; new messages are closed.` (see open question Q6) |

Voice throughout: sentence case, no exclamation marks, no "Oops", no
"Hooray, you're all caught up!", no illustrations of paper planes.

### 5.7 Privacy, blocking and reporting

**Contact details are never exposed by the platform.** No email address, phone
number or institutional address appears on a profile or in a message header,
ever, regardless of settings. This is the expectation a professor brings: they
publish their email on their own slide, at their own discretion. If they want to
hand it over, they type it. Consider one affordance in the composer overflow —
`Share my email address` — which inserts their address as plain text into the
draft, so the act is explicit, visible, and revocable-by-not-sending.

**Who can message me** — a three-option radio on the Profile/Notifications page,
default option 1:

- `Anyone attending this event` (default)
- `Only people I've already messaged, and organizers`
- `No one — hide me from the attendee directory`

Option 3 is the Sched model (invisible in the directory = unmessageable) and
must be reachable in two clicks from anywhere in Messages, including from the
kebab of a thread that has upset someone.

**Blocking.** Per-person, per-account, not per-event. Effects: the blocked
person cannot open a new conversation with you or send into an existing one;
their composer shows a neutral `You can't send messages to this person.` (do not
confirm the block — telling a harasser they have been blocked escalates); your
copy of the conversation goes read-only and drops out of the main list into a
`Blocked` section in Settings. Block is available from the request row, the
thread kebab, and the profile. It requires no confirmation dialog on the way in
and does require one on the way out.

**Reporting.** `Report to organizers` opens a small modal: a reason select
(`Harassment or abuse` · `Spam or bulk advertising` · `Impersonation` ·
`Other`), an optional free-text box, and a checkbox `Also block this person`
(checked by default). Submitting snapshots the full conversation transcript,
immutably, to a `Reports` queue in the organizer console with the reporter, the
reported user, reason, and timestamp. The organizer can: message the reporter,
suspend the reported user's messaging for the event, or remove them from the
event. Confirmation copy: `Report sent to the organizers of {event}. They'll see
this conversation.` — the last clause is important; people must know the
transcript travels.

This is not optional polish. NSF-funded conferences are *required* to have
accessible reporting mechanisms, and "we have a DM feature and no way to report
what happens in it" is a procurement objection waiting to happen.

**Retention.** Transcripts live as long as the event's data-retention window.
Report snapshots survive the deletion of the conversation by either party. State
this in the privacy policy.

### 5.8 Notification behaviour — the calm part

The rule: **Messages never pushes. Messages emails, on a delay, in a batch,
respecting quiet hours.**

- **In-app:** a count on the sidebar `Messages` item only. Counts accepted
  conversations with unread messages — **conversations, not messages** (this is
  Whova's exact bug). Opening a conversation clears it. A `Mark all as read`
  action lives in the list-pane kebab, because Whova's missing "clear all" is
  the single most repeated complaint in its reviews.
- **Email:** if a message is still unread after **15 minutes**, it joins the
  next digest. Digests send at most **twice a day** during the event window
  (suggest 12:00 and 18:00 local event time) and **once a day** outside it,
  suppressed entirely during the account's quiet hours. Subject:
  `2 new messages at DocWeek 2026`. Body: sender, affiliation, first ~200
  characters, and a deep link per conversation. Footer: `Change how often you
  hear from us` → notification settings, and a one-click
  `Turn off message emails`.
- **Never:** an email for a *request* (that is how spam becomes email spam), an
  email for a conversation you have muted, an email for your own message, or any
  browser/OS push notification of any kind.
- **Per-conversation mute**, from the thread kebab. This directly fixes the "I
  said hi once and now I get everything" complaint.

**Delivery mechanism: polling, not websockets.** Reuse the Session Q&A approach
already in the codebase. Poll the conversation list every **20s** and the open
thread every **8s**, only while `document.visibilityState === 'visible'`, with
backoff to 60s after 5 minutes of no user input on the page, and an immediate
refetch on window focus and on send. Include an `updatedSince` cursor so the
payload is usually empty. At 2,000 attendees with maybe 15% having Messages open
at once this is trivial load on Render, and it removes an entire class of
infrastructure from the roadmap.

### 5.9 Phone-width behaviour (intent, not current state)

Responsive behaviour is unevaluated in this product; this describes what it
should do.

- **<768px: the two panes become two pages, not two collapsed columns.**
  `/dashboard/messages` is the list, full width. Tapping a row navigates to
  `/dashboard/messages/[id]`, a full-screen thread. This must be a real route,
  so the OS back gesture works and a deep link from a digest email opens
  straight into the conversation.
- Thread page top bar: back chevron (44×44 target) + name + affiliation on the
  second line + kebab. It replaces the app top bar; the bottom tab bar
  (Agenda · Attendees · Community · More) is **hidden on the thread page** so
  the composer owns the bottom edge.
- Composer pinned above the keyboard using `100dvh` and
  `env(safe-area-inset-bottom)`. This is the single most commonly broken thing
  in mobile web chat and it is worth an explicit test on iOS Safari.
- Conversation rows go to 76px with a larger 40px avatar; the affiliation line
  truncates before the name does.
- The recipient picker becomes a full-screen page, not a modal.
- Back from a thread restores the list's scroll position and marks the row read.
- No swipe-to-delete, no swipe-to-archive. Discoverability is poor and the
  destructive-gesture-on-a-professional-message risk is not worth it.

---

## 6. Explicitly out of scope, and why

Rejected on anti-goal grounds (`HANDOFF_BRIEF.md` §1):

- **Browser / OS push notifications for messages.** Direct violation of
  "unsolicited push notifications". Digest email replaces it entirely. This is
  also what stops UKEDL becoming the thing every Whova review complains about.
- **Read receipts ("Seen 11:04").** Manufactures obligation, and creates a
  genuine status problem between a PhD student and a keynote speaker who read
  and did not reply. Sent-checks only.
- **Typing indicators.** Requires a persistent connection, adds urgency, adds
  nothing at this message frequency.
- **Presence / online-now dots.** Surveillance-flavoured, and misleading in a
  product people open twice a day. Also implies a real-time backend.
- **"Who viewed your profile" / "X is also attending 4B" activity feeds.**
  Named anti-goal. No exceptions, including the tempting
  "3 people you should meet" panel — that is the Matchmaker's job and it is
  opt-in there.
- **Response-rate badges, "quick replier" labels, streaks, connection counts,
  leaderboards.** Gamification. Named anti-goal. Also actively harmful in a
  hierarchy-sensitive academic setting.
- **Sponsor / exhibitor bulk messaging as a paid tier.** This is how Bizzabo and
  Cvent monetise messaging. It is attendee-data monetisation with extra steps and
  it is the fastest way to become the platform whose reviews say "spam".
- **AI-drafted replies / auto-suggested openers.** Two reasons: the standing rule
  is *agents draft, humans publish* and there is no organizer in the loop on a
  private message; and templated academic outreach reads as insincere, which
  inverts the goal of the feature. Swapcard ships message suggestions; do not
  copy it.
- **Message reactions in v1.** Defensible later as noise reduction; risks tone
  drift now. Revisit only if "thanks!" messages measurably dominate.

Rejected on solo-founder-cost grounds:

- **WebSockets / Server-Sent Events / a real-time service.** Polling gets ~95% of
  the perceived value at ~2% of the operational risk, and the codebase already
  does it for Q&A.
- **Attachments and file sharing.** Object storage, virus scanning, quota, abuse
  surface, and a legal question about hosting unpublished manuscripts. Papers
  already have a home in the session/paper model. Links are enough. Revisit if
  users actually ask.
- **End-to-end encryption.** Incompatible with organizer report transcripts,
  which matter more here.
- **A native mobile app / push via the dormant Expo shell.** The mobile story is
  the PWA (`HANDOFF_BRIEF.md` §2).
- **Threaded replies, channels, reactions-as-workflow, ⌘K palette.** Slack
  features for Slack-frequency use.
- **Full-text search across all conversations.** Client-side filter of the loaded
  list covers realistic volumes. Postgres FTS later if history accumulates.

Rejected on product-boundary grounds:

- **"Everyone — event chat".** Duplicates Community, produces the noise, and is
  the reason the current Messages tab looks like a stub. Remove it.
- **Session-scoped group chat.** Duplicates Session Q&A.
- **Organizer broadcast from within Messages.** Duplicates Announcements and
  would route around the notification budget. Organizers get one exemption only:
  they bypass the request gate for 1:1 replies.
- **Scheduling inside the thread.** Meeting requests own this. Cross-link with a
  `Request a meeting` button; do not rebuild it.

---

## 7. Phasing

**Phase 1 — "It looks like a real product." (S — one work session)**
Frontend-heavy, no schema migration, no new infrastructure.

1. Remove `Everyone — event chat` from the list; write the new empty state.
2. Conversation rows: avatar/initials, name, `Affiliation · Role`, last-message
   preview with `You: ` prefix, relative timestamp, unread bold + dot + hidden
   "Unread" text, selected-row treatment. Requires the list endpoint to return
   participant affiliation/role, last message, and an unread flag — one query
   change, no migration if a `lastReadAt` column already exists on the
   participant join (verify; if not, this one column is the only migration).
3. Thread: sender/day grouping, day dividers as headings, metadata lines,
   restrained sent/received blocks, 62ch max width, autoscroll-only-if-at-bottom.
4. Composer: auto-grow textarea, Enter/Shift+Enter with the visible hint,
   disabled-when-empty, optimistic send with sending/sent/failed + Retry/Delete,
   `localStorage` draft.
5. Accessibility pass per §4: `role="log"`, per-message accessible names,
   `<time>`, real links in the list, focus to thread heading on open, focus
   retained in composer after send, `role="alert"` on failure.
6. Rename `Filter chats` → `Search names or messages`; delete both explainer
   paragraphs; `+ New` → `New message`.
7. Polling: 20s list / 8s thread, visibility-gated, refetch on focus and send.

**Phase 2 — "It's safe." (M — two to three sessions)**
1. `lastReadAt` / read state persisted properly; sidebar unread count by
   conversation; `Mark all as read`.
2. Message requests: `status` on conversation (`REQUESTED` / `ACTIVE`), the
   Requests section, one-message cap, promote-on-reply, rate limits.
3. Block (per-account), mute (per-conversation), `Who can message me` setting.
4. Report modal → organizer `Reports` queue with immutable transcript snapshot,
   plus suspend-messaging and remove-from-event actions.
5. Mobile: real `/dashboard/messages/[id]` route, full-screen thread, safe-area
   composer.

**Phase 3 — "It reaches people." (M)**
1. Digest email for unread messages, honouring quiet hours and the existing
   notification budget; per-conversation and global opt-out; deep links.
2. Context chips: nullable `sessionId` / `paperId` on conversation; `Message
   about this session` entry points on session, paper and speaker surfaces.
3. Group conversations: recipient picker, naming, participant list, leave.
4. `Request a meeting` cross-link into the meeting-request flow.

**Phase 4 — "Nice to have." (L — only if asked for)**
Reply-by-email inbound (Resend inbound + threading tokens); export a conversation
as PDF/text for records; Postgres full-text search across conversations; one
acknowledgement reaction; post-event read-only archive policy.

---

## 8. Open questions for the founder

1. **Does "Everyone — event chat" die?** The recommendation is yes. If it lives,
   is it a Community board with a different name, and is it muted by default?
2. **Is Messages per-event or per-person?** If a professor attends three UKEDL
   events, do they have one inbox with event-labelled conversations, or three
   inboxes? This changes the data model and it is cheaper to decide now. (Lean:
   one inbox, conversations tagged with the event, because that is what makes
   the account worth keeping between conferences.)
3. **Should speakers be able to opt out of messaging entirely while remaining
   visible as speakers?** Right now visibility and messageability are the same
   switch. A keynote may want to be listed and unmessageable.
4. **Do organizers get a visible `Organizer` badge in threads, and can they read
   attendee DMs?** Recommendation: badge yes, reading no — only via a report.
   Confirm that is acceptable to institutional buyers, some of whom may ask for
   more.
5. **What is the rate limit?** §5.4 proposes 10 new conversations/day, 25/event,
   1,000 characters on a first message. All three are guesses that should be
   configurable per event.
6. **What happens to messaging when the event ends?** Options: (a) stays open
   indefinitely, (b) read-only after event end + 14 days, (c) read-only unless
   both parties have exchanged messages. This is a positioning decision — (a)
   makes UKEDL a year-round network, (c) keeps it firmly an event tool.
7. **Retention and deletion.** How long are transcripts kept, what happens on
   account deletion, and do report snapshots survive it? Needs a privacy-policy
   line before Phase 2 ships.
8. **Is `Share my email address` in the composer a good idea or a liability?**
   It makes an honest act easy; it also makes bulk address harvesting slightly
   easier. Leaning yes, because typing it is trivial anyway.

---

## 9. Sources

Competitor behaviour and reviews
- [Whova reviews, Capterra (2026)](https://www.capterra.com/p/149712/Whova/reviews/)
- [Whova profile, Software Advice (2026)](https://www.softwareadvice.com/event-management/whova-profile/)
- [Whova review, Research.com (2026)](https://research.com/software/reviews/whova)
- [Whova: More control over event announcements](https://whova.com/blog/control-event-announcements/)
- [Whova: Community moderation](https://whova.com/blog/event-app-moderation/)
- [Sched: Event Chat](https://sched.com/guide/event-chat/) · [Attendee Networking](https://sched.com/guide/attendee-networking/) · [Messaging (organizer email, mod. 2025-01-24)](https://sched.com/guide/messaging/) · [Privacy Controls](https://sched.com/guide/privacy-controls/)
- [Brella: Understand 1:1 meetings](https://help-attendees.brella.io/en/articles/189148-understand-1-1-brella-meetings) · [1:1 meeting status](https://help-attendees.brella.io/en/articles/189147-1-1-meeting-status) · [Network via chat message](https://help-attendees.brella.io/en/articles/189161-network-via-chat-message)
- [Swapcard: How to connect with participants](https://help-attendees.swapcard.com/en/articles/9121196-how-to-connect-with-other-event-s-participants) · [Meetings](https://help-attendees.swapcard.com/en/articles/8185472-streamlining-your-networking-with-meetings)
- [Grip: intro message on connection request](https://updates.grip.events/announcements/break-the-ice-ignite-connections-add-an-intro-message-when-requesting-to-connect) · [How to start a chat](https://support.grip.events/how-can-i-start-a-chat-with-someone-1)
- [Bizzabo: Event networking platform](https://www.bizzabo.com/event-management-software/event-networking-platform) · [Virtual events](https://www.bizzabo.com/solutions/virtual-event-software)
- [Cvent Attendee Hub](https://www.cvent.com/en/event-marketing-management/attendee-hub)
- [RingCentral acquires Hopin Events (2023-08-02)](https://markets.financialcontent.com/clarkebroadcasting.mycentraloregon/article/bizwire-2023-8-2-ringcentral-expands-video-offerings-with-acquisition-of-events-and-session-product-lines-from-hopin) · [RingCentral Events pricing (2026)](https://www.ringcentral.com/pricing/events.html)
- [Best conference networking & matchmaking software 2026, Perspective AI](https://getperspective.ai/blog/best-conference-networking-matchmaking-software-2026-compared)
- [LinkedIn limits 2026, Evaboot](https://evaboot.com/blog/linkedin-limits)

Accessibility
- [W3C, WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Sara Soueidan, Accessible notifications with ARIA live regions](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/)
- [WCAG 2.2 chat widget accessibility checklist](https://threada.ai/blog/wcag-22-chat-widget-accessibility-checklist/)
- [Craig Abbott, Web chat accessibility considerations](https://craigabbott.co.uk/blog/web-chat-accessibility-considerations/)
- [TestDevLab, Accessible live chats](https://www.testdevlab.com/blog/accessible-live-chats-tips-for-designing-creating-and-testing)

Academic context
- [NSF code of conduct policy for supported events, UC Irvine](https://research.uci.edu/sponsored-projects/proposal-submission/nsf-code-of-conduct-policy/)
- [Foxx et al., Evaluating the prevalence and quality of conference codes of conduct (PMC6660776)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6660776/)
- [Codes of conduct at political science conferences, PS: Political Science & Politics](https://www.cambridge.org/core/journals/ps-political-science-and-politics/article/codes-of-conduct-at-political-science-conferences-prevalence-and-content/A1D3FC106A8AF21C9935C9D6A6D94B02)
- [The Savvy Scientist, Academic networking 101](https://www.thesavvyscientist.com/academic-networking/)
- [Conference Monkey, How to network during and after a conference](https://conferencemonkey.org/advice/how-to-network-during-and-after-a-conference-1191697)
- [Ex Ordo, 23 networking tips](https://www.exordo.com/blog/networking-at-a-conference)
