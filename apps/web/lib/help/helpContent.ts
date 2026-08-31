/**
 * Help article markdown, bundled into the server build.
 *
 * WHY: `content/help/*.md` is not traced into the serverless bundle on
 * Netlify, so runtime `fs` reads silently returned nothing and /help rendered
 * empty in production. The markdown files remain the human-editable source;
 * a test asserts this module matches them byte-for-byte (body content).
 *
 * To update an article: edit the .md file, then run `npm run gen:help`.
 */

export const HELP_SOURCE: Record<string, string> = {
  "getting-started": `---
title: Getting started
description: Create an organization, build your first event, invite attendees, and publish.
order: 1
---

# Getting started

Welcome to **{{product}}**. This guide covers the first hour for organizers.

## 1. Create an account and organization

1. Open [Sign in](/login) and create an account.
2. Create an organization when prompted — this is your billing and event workspace.

## 2. Create an event (Setup assistant)

The fastest path is the **Setup assistant** on [New event](/organizer/events/new?mode=ai):

1. Answer a few questions (name, dates, venue, what kind of event).
2. Confirm the draft sessions and features.
3. The assistant checks off **Create event** and **Add sessions** on your onboarding checklist.

One of those questions is what kind of event this is — **Conference**, **Academic program**, **Meetup**, **Internal**, **PD day / Training**, or **Talk showcase**. Your answer presets sensible features (a PD day, for example, turns on pick-one breakouts and certificates; a talk showcase turns on registration fees), and you can change any of them on the **Features** tab afterwards. See the [Feature Guide](/help/feature-guide) for what each toggle does.

After creation, the Setup assistant lives on the event's **Overview** tab: it reads the event's current state, names the next incomplete step (rooms, speakers, venue, draft sessions, publish), and links straight to it. Attendees have their own **Event assistant** on event pages — a wayfinder that answers only from that event's own schedule, rooms, maps, and FAQ.

You can also create an event manually or start from an optional sample draft on first login.

Importing an existing program: on the event's **Agenda ingest** page, upload a PDF or Word (.docx) file, paste text, or fetch a URL — AI extracts the sessions into a changeset you review before anything is created. Excel (.xlsx) and CSV files import directly with **no AI**: they open in the spreadsheet importer, where you review every row (a multi-sheet workbook asks which sheet to use). Legacy .doc/.xls files aren't supported — save as .docx or .xlsx first.

No program yet? The **Describe it** tab on the same page is the third way in: give it your day start and end, your rooms, how many sessions run in parallel, how long they are, and where lunch and breaks go, and it drafts timeslots, placeholder sessions per room, and the breaks — a skeleton you review before anything is created. See [Draft an agenda from a description](/help/agenda-generator).

Organizing the program: on the event's **Program** tab, tick several sessions (or **Select all** under a day heading) and use **Assign track** / **Assign room** to update them all in one step — no per-session editing needed.

## 3. Invite attendees

From the dashboard, use **Invite** to send links (email when configured). Inviting marks the checklist’s **Invite attendees** step. To invite a group from a spreadsheet, manage the roster, or set up participant labels, see [Invite participants and manage the roster](/help/participants-and-invites). If you charge a fee, [Registration fees](/help/registration-fees) publishes how to pay and records who has paid — {{product}} never processes the money.

## 4. Publish

When the agenda looks right, publish the event so \`/e/your-slug\` is public. Publishing the event also publishes any **draft sessions** (for example, sessions created by Agenda ingest), so attendees see the full program. Draft sessions are labelled **Draft** on the Program tab; if you import more sessions after the event is live, use **Publish draft sessions** there to make them visible. Publishing marks **Publish** on the checklist.

## Where next

- [Brand your event](/help/event-branding) — banner, logo, and accent colour.
- [Let attendees pick one session per block](/help/breakout-pick-one) — for PD days and workshop programmes.
- [Collect materials from presenters](/help/speaker-readiness) — stop chasing bios and slides by hand.
- [Send sponsor outreach](/help/send-sponsor-outreach) — write the ask; you send it from your own address.
- [Feature Guide](/help/feature-guide) — what each event feature does, where people see it, and what stays when you turn it off.
- [Use the AI assistants](/help/ai-assistants) — what the Event and Setup assistants do.

## Try the public demo

Explore a read-only sample conference at [/e/demo](/e/demo) — no account required.

## Need help?

Email [{{support}}](mailto:{{support}}). Support hours: {{hours}}.
`,
  "agenda-generator": `---
title: Draft an agenda from a description
description: No program file yet? Describe your days, rooms, and parallel blocks and review a drafted agenda.
order: 2
---

# Draft an agenda from a description

If you know the shape of your event but haven't written the program yet, you don't have to type sessions one at a time. Describe the days, rooms, and parallel blocks, and **{{product}}** drafts a skeleton agenda for you to review.

## 1. Open Agenda ingest

Create the event first — the generator reads its dates. Then open **Agenda ingest** from the event's **Organize** menu (or **Import program** on the Overview tab) and choose the **Describe it** tab.

## 2. Describe the shape of the day

The form asks for structure, not prose:

- **Day start** and **Day end** — the window each day is filled.
- **Include a lunch window**, plus **Lunch start** / **Lunch end**.
- **Breaks** — add up to two, each with a start and end.
- **Rooms (one name per line)**, or just a count of rooms.
- **Parallel sessions per slot** — how many things run at once.
- **Session length (minutes)** and **Gap between sessions (minutes)**.
- **Include a welcome block**.
- **Attendees pick one session per timeslot (breakout style)**.
- **Anything else the draft should honor? (optional)** — free text, for notes like keeping the first slot plenary.

**Days** is read-only: it lists the dates from your event, so change the event dates if the day count is wrong.

Choose **Draft my agenda**.

## 3. Review before anything is created

Nothing is written until you confirm. The review panel lists every drafted session with a tickbox, plus the assumptions the draft made — untick any row you don't want, then choose **Confirm drafts**.

## What it drafts

- **Timeslots** across each day, from your day start to your day end, at the session length and gap you gave.
- **Placeholder sessions** — one per room in each slot, titled like "Session A1 — title TBC", on a **Programme** track.
- **Lunch** and **Break** sessions on a **Breaks** track, and an optional **Welcome** block.
- **Rooms and tracks** it referenced, if they don't exist yet.

It never invents speakers, and it never invents real session titles — placeholders say "title TBC" so you can see what still needs a name.

## It's a skeleton, not a finished program

The draft is a starting point: the grid is right, the content isn't written. Expect to rename sessions, add speakers, and delete slots you don't need.

Other things worth knowing:

- Sessions are created as **drafts** and stay hidden from attendees until you publish the event, or use **Publish draft sessions** on the **Program** tab.
- The generator covers events up to 31 days, up to 40 rooms, and up to 40 parallel sessions per slot.
- Session length accepts 15–240 minutes; the gap accepts 0–60.
- It uses AI, so it counts against your plan's agenda-import allowance — the free plan includes one import per event.
- The breakout-style tickbox shapes the draft and is recorded as an assumption. It does not switch on the **Pick-one breakouts** feature; see [Let attendees pick one session per block](/help/breakout-pick-one).

Already have a program in a file? Use the **Upload file**, **Paste text**, **Fetch URL**, or **Import spreadsheet** tabs instead — see [Getting started](/help/getting-started).
`,
  "breakout-pick-one": `---
title: Let attendees pick one session per block
description: Turn the agenda into a slot-by-slot chooser so attendees select one workshop per parallel block.
order: 3
---

# Let attendees pick one session per block

On a PD day or a workshop programme, attendees don't browse a card wall — they pick one workshop per block. **Pick-one breakouts** turns the agenda into a slot-by-slot chooser that matches how those days actually run.

## What counts as a block

A block is every session that starts **at the same time on the same day**, in the event's timezone. It isn't a track and it isn't a room — if three workshops all start at 11:00 on Tuesday, they're one block, and attendees choose between them.

A slot with only one session (a welcome, lunch, a keynote) isn't presented as a choice. It appears as a single row that attendees can still join.

## Organizer: turn it on

1. Open the event's **Features** tab.
2. Switch on **Pick-one breakouts** — "Attendees choose one session per timeslot — the agenda becomes a slot-by-slot chooser instead of a card wall."
3. Choose **Save features**.

The **PD day / Training** preset switches it on for you, so if you set the event up that way in the Setup assistant, it may already be on.

If you drafted your agenda with the **Describe it** generator and ticked **Attendees pick one session per timeslot (breakout style)**, that shaped the draft — parallel sessions were written as alternatives rather than plenaries, and it's recorded in the review assumptions. It does **not** switch the feature on. Enable it on the **Features** tab as above.

Existing data is preserved when you turn the feature off again, so it's safe to try.

## Attendee: choose a session

On the **Agenda** tab, each block appears as a chooser:

1. Open the block — the header reads **Choose your session (N options)**.
2. Choose **Join** on the workshop you want.
3. The block collapses to show your pick, labelled **Your choice ✓**.

Blocks with more than eight options get a filter box so attendees can search by title, speaker, or room.

## Changing a choice

Attendees can change their mind at any time — there's no deadline built into the feature.

1. Choose **Change** on the collapsed block (or **Change your session (N options)**).
2. Choose **Join** on a different workshop.
3. A confirmation appears — "Replace your 11:00 AM session?" — showing which session they're joined to and which they'd move to. Choosing **Replace** leaves the first and joins the second; **Cancel** changes nothing.

If the new workshop is full, they'll be offered the waitlist instead, and the swap doesn't complete — worth telling attendees, because a session with a capacity limit can fill.

## Honest limits

- The chooser is the **list** view of the event schedule. On a wide screen, attendees who switch to **Grid** or **By room** see the ordinary agenda, where nothing stops them joining two sessions in the same block.
- Nothing on the server enforces one-per-block. Treat this as a much clearer way to present a breakout programme, not as a hard constraint you can rely on for catering numbers.
- Session capacity and waitlists work exactly as they do elsewhere; see [Attendee FAQ](/help/attendee-faq).
`,
  "participants-and-invites": `---
title: Invite participants and manage the roster
description: Invite people one at a time or from a spreadsheet, manage the roster, and define participant labels.
order: 4
---

# Invite participants and manage the roster

Everything about who's coming lives on the event's **Participants** tab: invitations, the roster, and the labels attendees can pick.

## Invite one person

1. Under **Invite one person**, enter their **Name** and **Email**.
2. Choose **Send invite**.

They get a setup email with a personal link, and a starter profile is created for them — they choose a password to finish, then land on the event. Setup links expire after 7 days by default; sending a fresh invite to the same person issues a new one.

If email delivery isn't configured for your installation, you'll get **Copy invite link** instead and can share it yourself.

## Add a group from a spreadsheet

Importing a spreadsheet does **not** email anyone until you say so. You see the whole list first, choose who's included, and then pick one of two actions.

1. Under **Add participants from a spreadsheet**, choose your CSV file.
2. Check **Column mapping**. Headers like \`email\`, \`name\`, \`description\`, \`bio\`, and \`photo_url\` are detected automatically — common variants (\`e-mail\`, \`full name\`, \`role\`, \`about\`, \`avatar\`) are recognised too. A \`label\` column is picked up when your event defines participant labels. Anything else you can map yourself, or set to **Skip**.
3. Read the review. Every row is checked before anything happens, and problems are listed per row: **Missing email**, **Invalid email**, **Duplicate in file**, **Already on roster**, and any label your event doesn't define.
4. Untick anyone you don't want (**Select all** / **Select none** does the whole list), and set each person's label from the **Label** dropdown if you use labels.
5. Choose either:
   - **Add N to the roster** — creates everyone's place at the event and sends nothing. They show as **Not invited** until you invite them.
   - **Add and send N invites** — does the same, then emails each person their setup link.

Either way you get a summary that says exactly what happened, including anyone who was skipped and any invite that couldn't be sent.

Only an email column is genuinely required — a row without a name still works. You can review up to 500 rows at a time and add up to 200 people per upload, so split very large rosters into batches.

## Send invites later

Because adding people and inviting them are separate steps, you can build the roster weeks early and invite when you're ready — all at once or a few people at a time.

1. On the **Roster**, tick the people you want to invite (the box in the header ticks everyone shown).
2. Choose **Send invites**.

Each person gets an email that names your event, asks them to choose a password, and carries their check-in code. Anyone who has already finished setting up is reported instead of emailed, and any invite that fails is listed individually — the summary never claims an email that didn't go out. If email delivery isn't configured, each invite link is shown for you to copy and share.

## Manage the roster

The **Roster** below shows everyone with their invite status, and — when you use them — a **Label** column and a **Payment** column:

- **Not invited** — on the roster (usually from a spreadsheet), never emailed. Tick them and choose **Send invites** whenever you're ready.
- **Invite sent** — invited, hasn't finished setting up.
- **Active** — finished setup and can open the event.
- **Invite expired** — their setup link lapsed. Send invites again for a fresh one.

Each row has a menu. Owners can **Make admin** or **Remove admin**; any organizer can **Remove participant**. There's no separate resend button — sending invites again (or inviting the same email again) refreshes their link.

When **Registration fees** is on, the **Payment** column records unpaid, PO on file, paid, waived, or refunded, plus an optional PO / check reference. See [Track registration fees](/help/registration-fees). When the event defines participant labels, the **Label** column lets you set each person's label from the roster.

## Removing someone, and the 30 days

Removing a participant takes them off the roster and ends their access to the event immediately. Their roster record is kept for 30 days and then permanently deleted, which means an accidental removal is recoverable: invite the same email again inside that window and they're back on the roster.

To be precise about what that promise covers: the 30 days applies to their membership of **this event**. Their user account and anything they posted are governed by our general retention terms, not by this sweep — see [Privacy](/privacy).

## Participant labels

Labels let attendees say which department, cohort, or role they belong to, in words that fit your event.

1. In **Participant labels**, type a label and choose **Add**. Add up to 20, each 1–40 characters.
2. Choose **Save labels**.

Attendees then pick one — **Your label at this event (optional)** when they join, or **Participant label** on their profile afterwards. It's one label each, and it's optional.

You can also set labels yourself: per row while reviewing a spreadsheet import, or from the **Label** column on the roster afterwards. Labels appear beside people in the attendee directory, for attendees who've chosen to appear there.

Removing a label from the list clears it from everyone who had picked it, so retire labels deliberately.
`,
  "speaker-readiness": `---
title: Collect materials from presenters
description: Build a template of requirements, assign it to speakers, and let automatic reminders do the chasing.
order: 5
---

# Collect materials from presenters

**Speaker Readiness** replaces the tracker spreadsheet and the mail merge. You define what every presenter owes you once, assign it, and the reminders go out on a cadence without you doing anything. Your job shrinks to approving what lands.

Readiness is included in every plan, Free included. Turn it on yourself: open your event, go to the **Features** tab, and enable **Speaker & Session Readiness**. The event then grows a **Readiness** tab.

On the Free plan you can track up to 10 presenters in one event; every paid plan tracks as many as your programme has. Assigning a template to more presenters than your plan covers is refused with an upgrade prompt rather than half-applied.

If you'd rather not run it yourself, there's a concierge service — we map your data, build the templates, send the invites, and stay hands-on through your event. Rates by scale are on the [Speaker Readiness](/speaker-readiness) page; the software is in your plan either way.

## 1. Build a template of requirements

1. Choose **New template** and give it a name — "Workshop presenters", say.
2. Choose **Add requirement** for each thing you need.
3. For each one, set a **Label** (the presenter reads this), a **Kind**, optional **Help text**, whether it's **Required**, and an optional **Due date**.

Kinds cover the shapes an ask can take: **Short text**, **Long text**, **Yes/no confirmation**, **Single select**, **Multiple select**, **Date**, **URL**, **File upload**, and **Agreement**. Label them however your event talks — a **File upload** labelled "Slides", a **Short text** labelled "Short bio".

One kind behaves differently. **Internal task (organizer-only)** is tracked by you and never shown to the presenter or included in their reminders — use it for "AV booked" or "contract signed", the items that belong on your list rather than theirs.

## 2. Assign it

Choose **Assign…** on the template, then pick who it applies to. Both **Speakers** and **Sessions** have a **Select all speakers (N)** control, so a template can land on your whole roster in one action.

Assigning creates one tracked item per requirement per person. Re-assigning later is safe — anything already assigned is skipped, so you can add a requirement to the template and push it out to everyone who already has it.

## 3. Set the deadlines you actually want

The due date on the template is the default. Open **Details** on any person to set a **Due date override** for them alone, then **Apply due date** — useful for the keynote you asked early, or the presenter you added late.

When someone genuinely doesn't owe you an item, **Waive** it. A waived item stops counting as outstanding, drops out of the reminder cadence, and is recorded in the activity log with who waived it. **Un-waive** puts it back.

## 4. Invite the presenters

Open **Details** on a speaker, enter their **Presenter email** under **Presenter portal**, and choose **Send portal invite**.

They get a personal link that works for 30 days. No account, no password, no app — see [Submit your materials as a presenter](/help/presenter-portal) for what they see, which you're welcome to forward.

That email address lives on the portal invite, not on the speaker's public record, so adding a presenter to your programme and collecting from them are separate decisions.

**Resend portal invite** issues a fresh link and the link in their last email keeps working until its own expiry, so a resend never breaks a link someone already clicked. **Revoke** kills every link for that presenter at once.

## 5. Review what arrives

Open **Details** and you'll see each submission with **Preview** or a download link.

- **Approve** marks the item ready and locks it on the presenter's side.
- **Reject…** asks for a reason, which is required. The presenter sees that reason on their portal and can resubmit.

Rejecting doesn't send an email. If the deadline is close, tell them directly — the reminder cadence may already be spent.

## The reminders, and what they cost you

Nothing. Each dated item is chased automatically:

1. Seven days before it's due.
2. Two days before it's due.
3. Once after the due date has passed.

Three moments per item, then it stops — nobody gets nagged forever, and nobody is locked out for being late. Presenters get one email per round listing everything outstanding, not one per item.

Reminders need a due date and a live portal invite, and they stop as soon as you approve or waive the item. An item with no due date is never chased, which is the usual reason a presenter hears nothing.

## Finding the problems

The overview leads with **Needs attention** rather than a wall of green: items that are late, or that you've flagged as needing review, sorted by deadline. Chips above it count subjects, complete, open, and late. When there's nothing wrong it says so — "All caught up — nothing needs your attention."

One caveat: a submission sitting in **Submitted**, waiting on your approval, isn't in **Needs attention** unless it's also late. Filter the table to **Open** to find what's waiting on you.

**Activity** at the foot of the tab is the audit trail — invites, reissued and revoked links, approvals, rejections, waivers, and every automatic reminder, attributed to whoever did it (or to "Automatic").
`,
  "event-branding": `---
title: Brand your event
description: Add a banner, logo, and accent colour, and see exactly where each one appears.
order: 6
---

# Brand your event

Three settings make an event look like yours: a **banner**, a **logo**, and a **brand colour**. All three are optional, and skipping them is a real choice — the neutral default is deliberately plain rather than unfinished.

## Where to set them

Either place:

- **When you create the event** — the **Branding (optional)** step of the create wizard.
- **Afterwards** — open **Event settings** from the event's Overview, then expand **More options**.

The fields are **Brand color**, **Logo URL** with a **Logo upload**, and **Banner URL** with a **Banner upload**. Paste a hosted URL or upload the file; either works.

## Where each one appears

**Logo** — the attendee app's top bar on every tab, the Agenda hero, your public event page, the presenter portal your speakers open, and issued [certificates](/help/certificates).

**Banner** — two places only: the hero on the attendee **Agenda** tab, and the top of your public event page. It's deliberately not on every attendee tab; a banner above every screen stops being branding and becomes furniture. The presenter portal doesn't show it either.

**Brand color** — accents buttons, links, and selected states across the attendee app, your public event page, session pages, the presenter portal, issued [certificates](/help/certificates), and your own organizer console while you're inside that event. If a colour would leave button text unreadable, it's darkened automatically for the button only, so your colour survives without costing legibility.

There's one more place branding surfaces: when someone shares a link to your public event page, the preview image is your banner, or your logo if there's no banner.

## Sizes and formats

- **Logo** — up to 2 MB, scaled to fit 512 × 512.
- **Banner** — up to 4.5 MB, scaled to fit 1920 × 720.

Any image format your browser can read is accepted, and files are resized and converted on upload, so you don't need to prepare exact dimensions. A banner around 1920 × 720 will look sharpest, since anything smaller gets stretched across the hero.

**Brand color** takes a hex value — \`#0f766e\` or the short form \`#0a7\`. Choosing **Use the neutral default** clears it.

## What attendees see with nothing set

Not a gap. The hero shows your event name and dates as text, with no image band; the accent falls back to a neutral slate grey; and link previews use the platform icon. A plain event page reads as calm rather than broken, which is why the create wizard is happy for you to skip the step: "Skip this and your event wears the neutral platform look. You can add or change any of it later in Event settings."

## Honest limits

- There's no per-event favicon, and no separate image field for social previews — the preview falls back to your banner or logo.
- Emails aren't branded per event. Reminders and invitations go out in the platform's own styling.
- Changing branding takes effect immediately for anyone who reloads; there's no scheduled or preview mode.
`,
  "ai-assistants": `---
title: Use the AI assistants
description: What the attendee Event assistant and the organizer Setup assistant do, and what they won't do.
order: 7
---

# Use the AI assistants

There are two, and they serve different people. The **Event assistant** helps attendees find their way around your event. The **Setup assistant** helps you get the event built. Both label their output as AI, and neither changes anything without you confirming it.

## Event assistant (for attendees)

A button labelled **Event assistant** sits on the attendee dashboard and session pages. It's a wayfinder for one event: "when is the keynote", "where is room 201", "what's on after lunch".

It answers from that event's own data — the schedule, the attendee's saved agenda, rooms and venue maps, speakers, published announcements, and the FAQ you write — plus how-to guidance about using the app itself. Every reply carries the chip **AI answer — based on this event's schedule**.

Asked something outside that, it declines rather than guessing: "I can only help with this event's schedule, your agenda, rooms/maps, announcements, and the organizer FAQ." It won't invent a session, a time, a room, or a person that isn't in your event.

It also can't act on its own. When an attendee asks to join a session, take a waitlist place, or export their agenda, a **Confirm** button appears and the attendee presses it.

**To set it up:** it's the **Event assistant** toggle on your event's **Features** tab, on by default. The same tab has two editors worth five minutes of your time — an **FAQ** the assistant will answer from, and up to three **starter** questions shown in the panel. Answers are only as good as the programme and FAQ behind them.

**Limits:** messages are capped in length and rate, and each plan includes a per-event allowance of assistant replies. If an event runs through its allowance, attendees are told so in the chat and the conversation history stays.

## Setup assistant (for organizers)

Same technology, different job: it knows how this console works and what your event still needs.

**Creating an event.** Choose **Use the Setup assistant** on the new-event page. It asks short questions — name, dates, timezone, what kind of event, which features — and fills a preview card as you answer. When you're ready, **Create draft event** creates it as a draft. You can switch to manual entry at any point without losing what you've typed.

You can also attach a programme document — PDF, Word, spreadsheet, or an image, up to 20 MB — and it will read it to answer the setup questions for you. It doesn't build your agenda from that file at this stage: upload the same file to **Agenda ingest** after the event exists, and the full programme gets extracted there for review.

**After the event exists.** The Setup assistant is a **dock** available on every organizer console page for that event — not only Overview or Features. On **Overview** it reads your event's actual state, names the next incomplete step — rooms, speakers, venue, draft sessions, publish — and links straight to it. **Ask the setup assistant** opens the dock for questions about running the event. On the **Features** tab you can ask for feature changes in plain words; it responds with a **Review feature changes** card listing exactly what would change, and nothing is applied until you choose **Confirm changes**.

Drafts it produces are chipped **AI-generated — review before publishing**. Sessions it creates are drafts, hidden from attendees until you publish.

## What you should tell people

Conversations with both assistants are processed by AI. Questions attendees ask the Event assistant, and the answers generated for them, are stored and processed by our AI subprocessor, Anthropic, so the answer can come back. That's stated on our [Privacy](/privacy) page — the page to point an attendee or a data-protection officer at.

AI drafts content for your review, and you remain responsible for what you publish or send. The Event assistant is constrained to your event's data, which makes it much harder for it to invent things, but constrained is not infallible. Read a draft agenda before you publish it.

**AI usage** in the organizer sidebar shows the last 30 days of metered AI calls, tokens, and estimated cost for your organization, broken down by feature — that's where to check what you're actually consuming. Open [AI usage](/organizer/ai-usage) when you're signed in.
`,
  "attendee-faq": `---
title: Attendee FAQ
description: How attendees open the schedule, save sessions, and join without an app download.
order: 8
---

# Attendee FAQ

## How do I join an event?

Open the link your organizer shared — usually \`/e/event-slug\` or an invite URL. Sign in (or create an account), then use **Agenda** and **My Schedule**.

## Do I need a mobile app?

No. {{product}} works in the browser on phone and desktop.

## Where is the schedule?

After you join, open the dashboard. **Agenda** shows the full program; save sessions to build **My Schedule**.

## What is the Event assistant?

If your organizer enabled it, a chat button on event pages opens the **Event assistant** — a wayfinder for that event only. Ask "when is X", "where is room 201", or "what's on after lunch"; it answers from that event's schedule, rooms, maps, and organizer FAQ, and links you to the session or map. It declines questions outside the event's data rather than guessing.

## Where is my check-in QR?

If your organizer enabled check-in, your personal QR sits at the top of **Profile**, labelled **Event check-in QR**. Show it at registration. Staff can also type the same code by hand.

## How do certificates arrive?

If your organizer issues certificates, you get an email with a **download link** — not a PDF attached to the message. Anyone can confirm a certificate on the public \`/verify\` page. You can also download from your event profile after the event.

## What does a registration fee notice mean?

If the organizer published a fee, the notice is informational: pay via their link or instructions (card, purchase order, or check). {{product}} never takes the money. Your status — unpaid, PO on file, paid, waived, or refunded — is recorded only by the organizer.

## Can I message other attendees?

Only if your organizer enabled messaging or community features for that event. Disabled features do not appear in the navigation. See [Use Community](/help/community) for the five Community channels.

## Who do I contact for event questions?

Ask your event organizer first (they control the program and invites). For product issues, email [{{support}}](mailto:{{support}}).
`,
  "presenter-portal": `---
title: Submit your materials as a presenter
description: For speakers — how your personal link works, what to upload, and what each status means.
order: 9
---

# Submit your materials as a presenter

You're presenting at an event and the organizer sent you a link to send them your bio, your slides, or a form. This page explains what you're looking at. It's written for presenters, not organizers.

## Your personal link

The link in your email opens straight onto your own page. There's no account to create, no password to choose, and no app to install — the link itself is what lets you in, which is why it's personal to you and worth not forwarding.

Your page lists only the items that organizer needs from you. You won't see other speakers, and it isn't the event programme.

## The link expires after 30 days

If the organizer sends you a new link — say, along with a reminder — the older one keeps working until its own 30 days are up. You don't have to hunt for the newest email.

If a link has expired you'll see **This link isn't available**. Nothing is lost; email the event organizer and ask for a fresh one.

## What you'll be asked for

Each item is labelled by the organizer, so you'll see their words — "Short bio", "Signed agreement", "Slides". Underneath, the item gives you whatever it needs: a text box for a bio, a date, a link field, a yes/no choice, a list to pick from, or a file picker. Anything the organizer added as guidance appears under the label.

Fill it in and choose **Submit**.

## Uploading a file

Accepted formats are **PDF**, **PowerPoint**, **Word**, and images (**PNG** or **JPEG**), up to **250 MB**.

If your deck lives somewhere online — Canva, Google Slides, anything with a shareable URL — you don't have to export it. Use **…or paste a link instead** on the same item and paste the URL. That's also the answer when a file is too big: the page will tell you the size and suggest pasting a link to it.

After you submit, PDFs and images preview in place. PowerPoint and Word files download instead, because browsers can't display them.

## What the statuses mean

- **Not started** — nothing sent yet.
- **In progress** — started, or sent back to you for another go.
- **Submitted ✓** — we have it, and the organizer hasn't reviewed it yet. Nothing more is needed from you.
- **Ready**, shown with **Approved ✓** — the organizer accepted it. It locks at that point, so if you need to change something after approval, ask them.
- **Waived** or **N/A** — the organizer decided you don't owe this one.

If they'd like something different, you'll see **The organizer asked you to resubmit**, followed by their reason. The item reopens and the button becomes **Resubmit** — you can send a new version as many times as you need.

## The reminder emails

If an item has a due date, you'll get an email seven days before, two days before, and once if it passes. That's three at most per item, and one email per round listing everything outstanding rather than one per item.

To stop them: submit what's outstanding. An item stops being chased once the organizer approves it or waives it — so if you've already sent everything and another reminder arrives, it means your submission is sitting with the organizer, and the email says as much: "Already sent these? Your organizer may still be reviewing — no action needed."

If a deadline is wrong, or an item doesn't apply to you, contact the event organizer. They can change the date or waive the item, and they're the only ones who can — the "manage notification settings" link in the email footer is for people with accounts on the platform and won't help you here.

Nobody is locked out for being late. The reminders are a nudge, not enforcement.
`,
  "send-sponsor-outreach": `---
title: Send sponsor outreach from your own email address
description: Write a sponsor ask in {{product}}, open it in your own mail app, and send it yourself. We never send these emails.
order: 10
category: organizer
---

# Send sponsor outreach from your own email address

Sponsor outreach lives on the event's **Sponsors** page. You write the ask; you send it. **{{product}}** never sends these emails for you.

## Why we don't send them

Sponsors hear from you, not from us. A mail that arrives from your address is a conversation you started. A mail that arrives from ours is a product email. We keep those separate on purpose.

There is no bulk send, no open tracking, and no sequence. The composer is draft-and-copy only:

- **Open in your email app** and **Copy email** put the text in your hands.
- **Draft with AI** lands in the same panel for review. It is not sent and is not saved as a template.
- **Mark contacted** updates your pipeline. It does not send anything.

## Templates and merge fields

Write the ask once under **Email templates**. When you open **Write email** on a prospect, pick a template and the \`{merge fields}\` fill in that prospect's details:

- \`{orgName}\` — the organization you're asking
- \`{contactName}\` — the person, if you have one
- \`{eventName}\`, \`{eventDates}\`, \`{eventUrl}\` — this event

A known field you haven't filled becomes empty text, not a leftover token. An unknown \`{token}\` stays as you typed it.

We do not seed a template. A **Starter ask** appears the first time you write an email; save it yourself if you want it to persist.

## What "Open in your email app" does

That control is a \`mailto:\` link. It asks your computer to open whatever app or site handles email, with the To, subject, body, and optional CC already filled in. Nothing is sent until you press send in that app.

If nothing opens, your computer does not have a default email app — or the browser is not allowed to hand the address off. Set one up, or use **Copy email**.

## Set a default email app

**Mac.** Open Apple Mail once and it becomes the default, or open **System Settings** and search "default email app". Gmail users can instead allow \`mail.google.com\` as the email handler in Chrome or Edge: the handler icon in the address bar on gmail.com, or the browser's site-settings handlers page.

**Windows.** Settings > Apps > Default apps > Email.

## Copy email always works

**Copy email** puts the subject and body on the clipboard. Paste them into a new message in Gmail, Outlook, or any other mail service. Use this whenever \`mailto:\` does nothing, or whenever you prefer to stay in the browser.
`,
  "registration-fees": `---
title: Track registration fees without taking the money
description: Publish how to pay, record who has paid, and keep purchase orders and checks first-class. {{product}} never processes attendee money.
order: 11
category: organizer
---

# Track registration fees without taking the money

**Registration fees** lets you tell attendees how to pay and record who has paid. {{product}} never processes, holds, or guarantees the money — attendees pay you on your own link or process. Purchase orders and checks are first-class, not a footnote.

Nothing here blocks registration. People can join whether or not they have paid.

## Turn it on

1. Open the event's **Features** tab.
2. Switch on **Registration fees**.
3. Choose **Save features**.

The **Talk showcase** preset switches it on for you. It is granted on every plan, including Free.

## Publish how to pay

On the **Participants** tab, the **Registration fee** section is where you publish the notice attendees see:

- **Price** — free text, so tiers and member rates read the way you say them.
- **Payment link** — your own checkout or invoice page. Attendees get a button that opens it.
- **How to pay** — purchase-order and check instructions belong here.

Save writes those three fields onto the event. Attendees see the notice on your public event page and in welcome when any of the three is filled. Clearing all three removes the notice.

## The five payment statuses

The roster **Payment** column records one status per person. You set it; {{product}} does not infer it from a card charge.

- **Unpaid** — you have recorded that they have not paid.
- **PO on file** — a purchase order is in hand. Put the PO number in the reference field that appears once a status is set.
- **Paid** — marked paid.
- **Waived** — you decided they do not owe this.
- **Refunded** — you recorded a refund.

A blank status is an em dash, not unpaid — nothing has been recorded yet. The reference field (PO / check #) only appears after a status is set, because a reference with no status describes nothing.

## Mark paid from a spreadsheet

Under the roster, upload the paid list your finance office or payment provider gives you. You see exactly who matched on the roster — and every email that did not — then confirm to set those people to **Paid**.

Nothing is written before you confirm. An unmatched email never creates a roster seat; it is reported and left alone.

## Honest limits

- {{product}} is never the merchant of record. Questions about a missing payment go to you, not to us.
- Turning the feature off hides the fee notice and the Payment column. Recorded statuses stay in the database and return if you turn it back on.
`,
  certificates: `---
title: Issue certificates after the event
description: Use our built-in layout or upload your own finished design, set an eligibility rule, batch-issue with progress, and let anyone confirm a certificate on the public verify page.
order: 12
category: organizer
---

# Issue certificates after the event

Certificates are a download you issue after the event ends — not a live editor attendees fill in. You define a template and a rule for who is eligible, then batch-issue. A template either uses our built-in layout or wraps a design you upload yourself. Eligible people get an email with a **link**, not a PDF attachment. Anyone can confirm a certificate on the public verify page.

Certificates are included on Per-event plans and above. The **PD day / Training** and **Academic program** presets leave them on; **Focused** turns them off.

## Templates

On the **Certificates** tab of your event, create a template: a name for your own reference, who is eligible, optional hours — and one of two designs.

**The built-in layout** needs no design work. You give it the title text, optional body text, and an optional signature image, and issued PDFs use this event's **accent colour** and **logo**. If neither is set, the certificate uses the platform layout — see [Brand your event](/help/event-branding).

**Your own design** is described in the next section.

## Use your own design

Most organizers already have a certificate: they made it in Canva, or a colleague did, and it is finished. You can upload that file instead of using our layout, and we place each attendee's name on it.

Switch **Design** to *Your own design*, pick landscape or portrait, and upload the PNG or JPG. A preview appears immediately with a sample name on it, and three controls change how that name is drawn:

- **Name position** — a slider that moves the name up and down. The name is always centred left-to-right; there is no draggable box in this version.
- **Name size** — a stepper, in points.
- **Name colour** — dark or light, for pale and dark designs respectively.

What you see in the preview is what renders: the preview and the PDF share the same placement code, so they cannot drift apart.

Practical limits, stated plainly:

- **Export at about 2000px wide**, in the same shape as the page you chose (landscape is 11 × 8.5in, portrait 8.5 × 11in). A file up to 10MB is accepted. A design in a different shape is scaled to *cover* the page, so its edges may be cropped.
- **The attendee's name is the only thing we overlay.** The event name, dates, hours and signatures need to be part of the design itself — that is where you already control exactly how they look. Hours you enter on the template are still recorded and still show on the verify page.
- **PNG and JPG only.** We upload your file as-is rather than re-compressing it, so crisp type and logos stay crisp.
- If an uploaded design is ever unreadable, the certificate falls back to the built-in layout rather than issuing a blank page.

The built-in layout remains the no-design-needed path, and switching between the two kinds never affects eligibility, issuing, the ready email, or the verify page.

## Eligibility — registration, not the door

A template has one rule. Session rules count **joins** (the person registered for the session), not a staff scan at the door:

- **Any check-in** — they were checked in at the event.
- **Minimum sessions** — they joined at least N sessions.
- **Required sessions** — they joined every session on a list you pick.

That distinction matters for a PD day with a door scan: someone can be eligible on a session rule without ever being scanned, and someone scanned at the door can fail a session rule if they never joined.

## Batch issue, with progress

Batch issue runs in the background, and it works the same way for both kinds of design. You start it from Recap; progress updates as certificates are generated. Re-issuing the same person on the same template keeps their original issue date and public id.

The ready email carries a link to the public verify page (and a note that they can also download from their event profile). It does not attach the PDF.

## Public verify

Anyone with the certificate id can open \`/verify/<id>\` and see whether it matches a certificate we can confirm — name, event, date, optional hours. No account is required.

## Honest limits

- There is no separate attendee Certificates tab. Eligible people download via the link or their profile after the event.
- Turning the feature off blocks new downloads. Certificates you already issued stay, and the verify page still works.
- Generate on Recap is blocked until the event has ended.
`,
  "check-in": `---
title: Check attendees in with a QR code
description: Each attendee has a personal QR on their profile. Staff scan it, type the code, or queue scans offline and sync when the connection returns.
order: 13
category: organizer
---

# Check attendees in with a QR code

**QR check-in** gives each attendee a personal code on their membership. Staff scan it at the door, or type the same code by hand. A person can be checked in once per event; a second read of the same code is ignored.

Check-in is included on Per-event plans and above. Turn it on from the event's **Features** tab if it is off.

## Where the attendee QR lives

Each attendee's check-in QR sits at the top of **Profile**, labelled **Event check-in QR**. It encodes that person's per-event check-in code — the same value you can type or paste on the scanner. Invite emails also carry the code.

## The scanner page

Open **Check-in** from the organizer console (\`/organizer/events/<id>/scanner\`). Staff need organizer access.

1. Open the page on a phone with a camera.
2. Point the camera at the attendee's QR.
3. A flash confirms **Checked in** (or that they were not).

The status bar shows online/offline, how many of the roster are checked in, and how many scans are queued.

## Manual entry

If the camera is blocked, or this browser cannot detect QR codes, type or paste the code in the field on the same page. It is the same payload as the QR.

## Offline queue and sync

Scanning works offline. The device queues scans and syncs them when it is back online. The same code is ignored for a few seconds so a second read of the same QR does not double-submit.

## Browser support

The live camera uses the browser's **Barcode Detector** API. Chrome and Edge on a phone usually have it. Safari and Firefox often do not — the page then shows **Scanning isn't supported in this browser — use manual entry**, and the typed-code field is the path.

## Honest limits

- Turning check-in off hides the Profile QR and the scanner. Existing check-in records stay.
- Repeats are idempotent: checking someone in twice does not create a second record.
`,
  "call-for-presentations": `---
title: Open a call for presentations
description: Rename the call, publish a form, set review criteria, assign reviewers, and convert an accept into a draft session.
order: 14
category: organizer
---

# Open a call for presentations

The **CFP** page is where you open a public call, collect submissions, run a review, and turn accepted work into draft sessions. Creating a form turns the **Call for proposals** feature on.

The **Academic program** preset turns the feature on. Organizer CFP tools stay available so you can build the call; the public form follows the Features toggle.

## What you call it

The default label is **Call for Presentations**. Rename it in **Event settings → More options → What do you call it?** — Call for Papers, Call for Workshops, whatever the programme actually is. That name is used in the organizer sidebar and console headings. Public pages still show each form's own title.

## The public form

The public page lives at \`/e/<slug>/cfp\`. Submitters do not need an account — they confirm by email.

A form collects name, email, title, and abstract, and can include **custom fields** (short text, long text, or a choice list) that appear on that page and are stored with the submission. It can cap how many submissions one person may send, and accept attachments (PDF or Word, up to 10 MB).

## Review criteria

When you create a form, the **Review criteria** editor is where you name each criterion and give it a weight. Reviewers score each submission on those criteria; weight is how much each one counts. Add or remove rows before you open the call. The defaults are Novelty, Clarity, and Rigor, each weighted equally — change them to match how you actually decide.

## Reviewer flow

Assign reviewers on the CFP page (by user id). Each reviewer opens the **Reviewer** page: assigned submissions, the rubric, a score per criterion, and an optional comment. Blind review hides the submitter's name and email from reviewers when that option is on.

The dashboard shows counts by status and each reviewer's completed / assigned progress.

## Accept → draft session

Select submissions and **Bulk accept** or **Bulk reject**. Accept queues the decision email; it does not put the work on the public programme.

**Convert accepted → draft program** turns selected accepts into draft sessions you then schedule on **Program** — a standalone draft session, or an item inside an existing session. You review the changeset before anything is created. Draft sessions stay hidden from attendees until you publish them.

## Honest limits

- Turning the feature off hides the public page. Submissions and reviews stay.
- Creating a form turns the override on, even if you had left the Features toggle off.
`,
  community: `---
title: Use Community
description: The five Community channels — meet-ups, moments, local tips, break-the-ice, and general — and how to post in each.
order: 15
category: attendee
---

# Use Community

**Community** is the shared event board. Anyone on the roster can post; organizers can edit or delete threads and replies. It is not private chat — that is **Messages**.

Open the **Community** tab. Channel pills filter the feed. A composer sits above the posts. If your organizer turned a channel off, that pill is not there.

## Meet-ups

Propose an in-person or virtual gathering.

A post needs a **title**, a **description**, or a **photo** (at least one), plus a format and either a named guest list or an invite to everyone. Virtual meet-ups also need a meeting URL. Notifications go to the people you invited, or to the whole roster when you invite everyone.

Pick the **Meet-ups** pill, then fill in format, optional start time, and who to invite.

## Moments

Photo posts from the event.

A post can be photos only, a title only, or a description only — **at least one of the three**. You can attach up to twelve images and optionally **tag people** who are on the roster. Images open in a lightbox from the feed.

Pick the **Moments** pill, add a caption if you want one, tag people, and upload photos or paste image URLs.

## Local tips

Nearby places to eat, walk, or explore.

A post needs a title, a description, or a photo (at least one). This is the only channel that stores an optional Maps URL. There is no guest-list targeting — local tips are always event-wide.

Pick the **Local tips** pill. A helper can open Google Maps search in a new tab. Posts with a link show **Open in Google Maps** on the feed.

## Break the ice

Intros and conversation starters.

Posts use a normal title and body — no extra fields. When this channel is in view, a people strip above the feed can open a prefilled direct message (that still requires **Direct messages** to be on).

Pick the **Break the ice** pill. The empty state is an invitation to introduce yourself.

## General

The open board for posts that do not fit a special channel.

This is the only channel with audience targeting: everyone, a session, a track, or named people. Targeted posts are hidden from people outside that audience; you and event managers still see them.

Pick the **General** pill and use **Post to** if the post should not go to everyone.

## Honest limits

- Community is on by default. Your organizer can turn the whole board or a single channel off; existing posts stay and return if they turn it back on.
- There is no in-thread Report control on Community posts. Organizers moderate by editing or deleting.
`,
  contact: `---
title: Contact
description: How to reach support — email and honest support hours.
order: 16
---

# Contact

## Email

Write to [{{support}}](mailto:{{support}}).

## Support hours

{{hours}}

We do **not** promise 24/7 live human support. On event days we provide **best-effort** assistance during support hours. For platform status, see the [status page]({{status}}); for urgent incident updates, email [{{support}}](mailto:{{support}}).

## What to include

- Your organization or event name (if relevant)
- Whether the event is live today
- Steps to reproduce and screenshots when useful

## Before you email

Two assistants may answer faster than we can:

- The **Event assistant** answers attendee questions about a specific event — when a session is, where a room is, what's on after lunch — from that event's own schedule, maps, and FAQ.
- The **Setup assistant** answers organizer questions about building an event and names the next step you haven't finished.

See [Use the AI assistants](/help/ai-assistants). For anything they decline, or anything about billing, your account, or a bug, email us — that's what the address above is for.
`,
};
