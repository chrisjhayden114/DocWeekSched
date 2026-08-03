# UX_AUDIT_02_NOVICE.md — the department administrator

**Persona:** departmental administrator at a university. My head of department has
asked me to "put the doctoral programme week online this year." I am good with
email, Word and Excel. I have never used Whova, Sched, Eventbrite or Cvent. I
have never run a conference app. I read labels literally and I believe what the
screen tells me.

**Evidence read:** `PHASE_A_PUBLIC.md`, `PHASE_BCD_APP.md`,
`CUSTOMER_TEST_FINDINGS.md`. Findings already in `CUSTOMER_TEST_FINDINGS.md` are
marked **KNOWN**.

**Where I checked code:** only to verify a factual claim before asserting it —
never to work out what a feature "really" does. Those checks are labelled
`[verified]` with the file and line. A real me could not have done this; the
point is that the *screen* did not tell me, and in three cases the screen told me
something that is not true.

**Mobile:** not captured, not evaluated. I say nothing about phones.

---

## Would I have got there?

**No.**

Not because the product is hard — most of it is calmer and plainer than I
expected — but because of one thing at the very end that I could not have
diagnosed, and would not even have known to describe.

Assume the two known P0s (no verification email, invite-code signup form) are
fixed and I get an account. Assume I muddle through the review screen by
trusting it. Here is where I actually end up:

> I upload the DocWeek PDF. I wait two minutes with nothing on screen. It works.
> I approve 22 sessions. I get a green box. I click **Publish**. I send the link
> to my head of department.
>
> **The page has no sessions on it.** Just the title, the dates and the venue.
>
> I open the link myself and it looks fine, because I am signed in as the
> organiser. So I cannot reproduce the thing my boss is telling me is broken.

That is where I stop, and that is the email I send. I would not be able to say
"the sessions have publishStatus DRAFT" — I would say *"I published it and it's
empty and it looks fine on my screen."* Which is close to unanswerable from the
outside.

Everything else in this report is friction. That one is the trial ending.

---

## Stop-and-email moments

Ranked by how likely each is to end the trial. Severity uses the plan's scale
(blocker / major / minor / polish); effort is my untrained guess and should be
discounted accordingly.

---

### S1. I published my event and the schedule was empty — and there is no button anywhere to fix it
**Blocker · effort M · NEW (not in CUSTOMER_TEST_FINDINGS)**

**What I expected.** The Overview page has one **Publish** button and one
sentence explaining it: *"Draft events 404 for outsiders. Published events are
reachable via slug/join link."* I read that as: there is one door, this is the
door, click it and everyone can see my programme.

**What actually happens.** Publishing the event does not publish the sessions
that Agenda ingest created. The public page shows sessions only, and the ingest
success panel's own promise — *"Drafts stay hidden from attendees until
published"* — points at a "published" step that does not exist anywhere in the
organiser console.

`[verified]`
- `apps/api/src/lib/ai/ingest/confirm.ts:213` — ingest creates every session with
  `publishStatus: DRAFT`.
- `apps/api/src/routes/event.ts:334–352` — `POST /event/publish` sets the *event*
  to `ACTIVE` and touches no sessions.
- `apps/api/src/lib/publicEvent.ts:118` — the public page queries only
  `publishStatus: PUBLISHED` sessions.
- Nothing in `apps/api/src` or `apps/web` ever writes `publishStatus: PUBLISHED`
  for a real event (only `lib/demoEvent/reset.ts`). Grep across both apps returns
  no such write and no `publishStatus` reference in the web app at all.
- Same for the other two creation paths: Setup Copilot
  (`lib/ai/setupCopilot/complete.ts:177`) and CFP conversion
  (`lib/cfp/convert.ts:139`) also create `DRAFT`.
- Manually created sessions are fine — the schema default is `PUBLISHED`
  (`prisma/schema.prisma:800`).

**So the shape of it is:** build your programme by hand → it works. Build it the
way the homepage tells you to ("Paste your program. Your event is live.") → the
programme never becomes visible, and the Program tab gives no hint which
sessions are hidden. Every session row looks identical whether it is draft or
live.

**Why I could not have diagnosed it.** Organisers see all sessions including
drafts (`lib/ai/ingest/visibility.ts:8–17`). So the person testing always sees a
full schedule. This is the same shape as the email-verification bug in
`CUSTOMER_TEST_FINDINGS.md` #1 — invisible to anyone who already has the
privileged state.

**What I needed instead (held loosely — I am not a designer).** Either Publish
should publish the drafts it created, or the Program tab needs to say *"22
sessions are drafts and are not visible to attendees"* with one button to change
that. What I definitely needed was for the word "published" in the green success
panel to point at something I could click.

---

### S2. The Assumptions boxes look like they will fix my data. They do not.
**Blocker (trust) · effort S · NEW**

**What I expected.** The review screen asks me:

> *"Page 1 lists 'Drs. Hains and Potterton' for the PhD Research Design Workshop,
> but page 5 spells it 'Potterson'. Which spelling is correct?"* → `Potterton`

This is the single most impressive thing in the product. It read my PDF more
carefully than I have. It found a spelling conflict across two pages. It is
asking me, politely, in English, and there is a box with the answer in it that I
can edit. Of course I believe that typing the right answer means the right answer
gets used. That is what an editable box next to a question means.

**What actually happens.** The answers are saved onto the ingest run record and
sent along at confirm time, and then nothing consumes them. The sessions are
created from `rows` (the changeset), which the assumption answers do not touch.

`[verified]` `apps/api/src/routes/agendaIngest.ts:336–349` stores `assumptions`
on the run; `:388–395` calls `confirmAgendaChangeset({ ...rows })` with no
assumptions argument, and `lib/ai/ingest/confirm.ts` never reads them.

**Why this is worse than a normal bug.** Four of the four assumptions captured
are ones I would have acted on:

| The question | What I would have typed | What I would have believed |
|---|---|---|
| Potterton vs Potterson | `Potterton` | the speaker's name is now spelled right |
| Robert Appino struck through — exclude? | `Excluded` | he is off the programme |
| Two concurrent tracks or sequential? | `Concurrent sessions` | two sessions were created, not one |
| Timezone not stated in the document — may not be Pacific | I would have typed `America/New_York` | **my entire programme is now in the right timezone** |

That last one is the dangerous one. The product tells me, unprompted, that it
guessed my timezone and the guess is probably wrong ("event appears to be at a
university, possibly not in Pacific time"). It puts the guess in an editable box.
I fix it. Every session time is still three hours out, and I now trust the times
*more* than I did before I read the warning. (Compounds with KNOWN #7, the
free-text timezone field.)

**What I needed instead.** Either the answers change the changeset — in which
case the rows below should visibly update when I type — or the section should be
titled something like "What the AI assumed (for your records)" and the boxes
should not be boxes. A read-only list I can act on manually would have been more
honest and just as useful.

---

### S3. "22 create · 4 update · 5 delete proposed" — I do not know what any of that means, and I especially do not know what is about to be deleted
**Blocker (fear) · effort S–M · NEW**

**What I expected.** I uploaded a PDF. I expected a list of my sessions and a
button saying "yes, these are right."

**What the screen offers.** *"Review the changeset, then confirm to create DRAFT
sessions only."* Then a heading, then `18 create · 4 update · 5 delete proposed ·
0 errors`, then three separate checklists.

Things I do not know, in the order I would panic about them:

1. **What is being deleted?** The rows say *"Test — Not found in new import —
   propose delete."* Delete from where? From my event? From the PDF? Is this
   deleting something I typed in earlier, or something the AI invented and is now
   cleaning up? The rows are unchecked by default, which reassures me — but I do
   not know whether unchecked means "won't happen" or "not recommended."
2. **Is delete reversible?** It is not. `[verified]`
   `lib/ai/ingest/confirm.ts:191` — `prisma.session.delete(...)`, a hard delete;
   `Session` has no soft-delete or archive column. There is no undo, no trash,
   and nothing on screen says so.
3. **What does "update" do to work I have already done?** This is the one nobody
   would guess. An update row ("Program Dinner — update fields") first deletes
   every speaker link and every paper attached to that session, then rewrites
   them from the AI's reading of the PDF. `[verified]`
   `lib/ai/ingest/confirm.ts:233–234` —
   `sessionSpeaker.deleteMany` + `sessionItem.deleteMany` before the update.
   (Resources survive — they are a different table.) So if I spent an evening
   fixing author order on a paper session and then re-import a corrected PDF, my
   evening is gone, silently, and the row that did it said "update fields."
4. **What is a "changeset"?** I guessed "a list of changes," which turns out to be
   right, but I only guessed it because the counts were next to it.

**What I needed instead.** For the delete section: the event name and what will
be lost, in words — *"These 5 sessions are currently in your event but were not
in this file. Deleting them is permanent."* For update: name the collateral —
*"replaces the speakers and papers on this session with the ones in this file."*

---

### S4. Two minutes of nothing after I upload
**Major · effort S · partially KNOWN (#5 covers silent failures and recommends a spinner; the 2+ minute duration is new)**

**What I expected.** A progress bar, or "this usually takes about two minutes."
Word and Excel both give me one.

**What happened.** A 184 KB, 7-page PDF took over two minutes with no spinner, no
percentage, no elapsed timer, no changed text on the page.

**What I would have done.** At about 40 seconds I would have clicked **Choose
File** again. At 90 seconds I would have refreshed the page. Both of those are
plausibly worse than waiting — I have no idea whether refreshing cancels the run,
double-charges the "AI usage" thing in the sidebar, or creates two copies of my
programme. Then I would have emailed to ask *"did my upload go through?"*

The cruel detail: the thing *does* work, and it works well. The product's best
feature is hidden behind the interaction most likely to make me abandon it.

**What I needed instead.** Anything that moves. Even a static line — *"Large
programmes can take 2–3 minutes. You can leave this page open."* — would have
held me.

---

### S5. "Draft" means two different things and I only find out at the end
**Major · effort S · NEW**

I meet the word "Draft" in four places and assume each time it is the same thing:

| Where | What it says | What I thought it meant |
|---|---|---|
| Event header | grey **Draft** chip | my whole event is not live yet |
| Overview PUBLISH panel | "Draft events 404 for outsiders" | same thing, confirmed |
| Agenda ingest intro | "confirm to create **DRAFT** sessions only" | same thing — everything is draft until I publish |
| Ingest success | "Drafts stay hidden from attendees until published" | same thing — Publish will handle it |

They are not the same thing. There is an event-level draft and a session-level
draft, and only one of them has a button. The capitalised **DRAFT** in the ingest
intro reads to me as emphasis ("only drafts, don't worry"), not as the name of a
second, separate state.

This is the comprehension failure that produces S1. Fixing the wording without
fixing S1 would not help me; fixing S1 might make the wording harmless.

---

### S6. I cannot get an account
**Blocker · KNOWN (#1 email verification never sent; NEW P0 organizer invite-code dropdown)**

Chronologically this is my *first* wall, and if it is still live nothing else in
this report matters. Recording only what my persona adds:

- The register screen tells me to check my email. I would check spam. I would
  wait a day. I would ask IT whether the university mail filter had eaten it —
  our filter does eat things, so I have a plausible wrong explanation ready, and
  I would spend a week on it before emailing UKEDL.
- The "Organizer (invite code)" option with a required **Admin invite code** and
  no way to request one reads unambiguously as *this product is not for people
  like me*. I would not email. I would just go back to the Word document. A
  no-email failure is worse than an email failure, because you never learn about
  it.

---

### S7. "(confidence 0.70)" in orange
**Major · effort S · NEW**

Some rows in "Will create" are orange on yellow with `(confidence 0.70)` after
them. Orange-on-yellow means warning; I understand that much. I do not know:

- whether 0.70 is out of 1 or out of 100 (I assume 1, because it has a decimal
  point);
- whether 0.70 is bad. Seventy percent sounds like a decent exam mark. Is it a
  C? Is it a fail?
- **what I am supposed to do about it.** The row is still ticked. There is no
  "check this one" link, no indication of *which part* of the row is uncertain —
  the time? the title? the room? The row reads
  `2026-06-08 · Welcome, Navigating DocWeek & Networking · 09:00` and all three
  of those look right to me, so I have no way to act on the warning.

I would tick Confirm anyway and feel bad about it. If something later turned out
wrong I would blame myself for ignoring an orange row.

**What I needed instead.** Words, not a number, and a pointer at the doubtful
field: "Time uncertain — check against your programme."

---

### S8. Nothing tells me what a "track" is, and it is everywhere
**Major · effort S · NEW**

"Track" appears on the homepage, on the demo event's filter rail, on the Program
tab as a whole panel with colours, in the ingest review as
*"Masterclass 3 — move track"*, and on every session card. It is clearly
important and clearly required.

`[verified]` The word is never defined in `apps/web/content/help/*.md` or in any
on-screen explainer; a grep for a definition returns nothing.

My guess, assembled from the demo: it is a colour-coded category, and the demo
uses Plenary / Research / Practice — so, a *type* of session. But my event's
tracks in the console include both `PhD` / `EdD` (who the session is *for*) and
`Building Community & Framing the Journey` (a *theme*). Those are two completely
different ideas sharing one field, and I have no basis for choosing. I would
email to ask *"what should I put in tracks?"* — a question that has no support
answer, only a design opinion.

The Program tab's one explainer sentence is good, but it explains sessions,
papers, resources and speakers — and skips the one word I do not know.

---

### S9. The Help article describes a product I am not looking at
**Major · effort S · NEW (KNOWN #3 was "Help is empty"; it now renders, and the content is the new problem)**

I click Help because I am stuck at ingest. The Getting started guide tells me to
use **Setup Copilot** and mentions an **onboarding checklist** with steps that
get "checked off." The organiser home offers **Set up with AI**. I do not know
whether those are the same thing. I never see a checklist.

More importantly: the guide has four steps — account, create event, invite, publish
— and **no section on Agenda ingest at all.** The hardest screen in the product,
the one that implements the homepage's headline promise, has no documentation.
Publishing gets one sentence: *"When the agenda looks right, publish the event so
/e/your-slug is public"* — which is exactly the belief that produces S1.

---

### S10. Choosing a plan
**Minor · KNOWN (#25)**

We expect about 120 doctoral students. Free caps at 50, so I am buying. Then:

- "Which plan?" says *one event this year → per-event plan* — that is me, so
  $149.
- The fine print immediately below says for 51–250 attendees Pro at $79/mo is
  usually the better buy.

The page contradicts itself within one panel, and I am the person who has to
justify the number on a purchase order. The recurring-event price lock is the
thing I would actually quote to my head of department — we run this every year —
so I would want a straight answer.

The FAQ rows I would have clicked (*"What counts as an attendee?"*,
*"What happens when I archive an event?"*) render as bold text with rules and no
chevron or plus sign. I did not know they were clickable and would have assumed
the answers were missing. **Polish, effort S, NEW.**

---

### S11. I do not know where my programme lives
**Minor · effort S/M · NEW**

Once inside an event I face nine horizontal tabs and six sidebar items at once,
and **Overview** appears in both lists meaning two different things. My
programme is under the horizontal tab **Program**; the tool for importing it is
under the sidebar item **Agenda ingest**. "Programme" and "agenda" are the same
word to me, so I have two doors with the same label in two different navigation
systems.

Of the nine tabs I could not have told you what four of them do before clicking:
**Ops Inbox**, **Recap**, **Features**, **CFP**. I would have clicked all of them
looking for my programme.

The org switcher rendering as **"Orga…"** — four characters — is not something I
would report as a bug; I would assume my browser zoom was wrong.

---

### S12. Small things I would not email about but did notice

- **"0 in-person · 0 virtual · 0 async"** on every attendee session row. I know
  the first two. "Async" I would guess means "recorded" or "watch later," and I
  would not be confident enough to explain it to a student who asked.
- The **Concierge** button floating on every attendee page, unlabelled as to what
  it does. I would not click it in case it messaged someone.
- The review heading says *"22 sessions found"*, the counts line says *"18
  create"*, and the success panel says *"Created 22 draft session(s), updated 0."*
  Those may well be two different runs in the capture — but I could not have told
  either, and nothing on screen connects a review to its outcome. **Observation
  only; effort S to add "Confirmed 8/2 7:13 PM" to the success panel.**
- **Ingest history** listed fourteen runs as grey chips reading
  `READY_FOR_REVIEW`, `CONFIRMED · +22 / ~0 / −0`, `FAILED`, `· audit linked`.
  Every token there is machine language. `~0` and `−0` I could not read at all. I
  would not have known that a `READY_FOR_REVIEW` run sitting in the list is one I
  abandoned and could still confirm by accident — **open question**, I do not
  know if it is clickable.
- **Native browser tooltips** ("Please fill out this field.") appearing instead
  of in-page validation. This is fine, actually. It looks like the rest of the
  internet. KNOWN-adjacent; no action from me.

---

## Jargon glossary

Every term the product put in front of me without explaining, and what I guessed.
Marked ✅ where my guess was right, ❌ where it was wrong or I had no guess.

| Term | Where I met it | What I guessed |
|---|---|---|
| **track** | everywhere | ❌ a colour category — but for *what*? topic, audience, or day? Never resolved. |
| **ingest** / **Agenda ingest** | sidebar, tab | ✅ "importing" — but it is a word from a hospital, not an office. "Import" would have cost nothing. |
| **changeset** | ingest intro | ✅ a list of changes. Guessed from the counts beside it. |
| **create / update / delete proposed** | review screen | ❌ "delete *proposed*" — proposed by whom, and to what? |
| **confidence 0.70** | review rows | ❌ no idea of scale or of what action it demands. |
| **Assumptions** | review screen | ❌ read as "questions I am answering," which is wrong — they are a log. |
| **DRAFT** (session) vs **Draft** (event) | ingest / event header | ❌ assumed one concept. This cost me the event. |
| **Publish / Archive** | Overview panel | ✅ "make live" / "hide but keep." The panel copy is genuinely good. |
| **404** | "Draft events 404 for outsiders" | ✅ I know it means a broken page, from the web. Many of my colleagues would not. |
| **slug** | `/e/sample-mrtwok16` | ❌ guessed "the bit at the end of the address"; the word itself is an animal. |
| **CFP** | sidebar | ❌ Call For Papers, but only because I work in a university. Not from the product. |
| **Ops Inbox** | tab | ❌ nothing. "Operations"? Whose inbox? |
| **Recap** | tab | ❌ a summary — before, during, or after the event? |
| **Features** | tab | ❌ features of what? |
| **async** | "0 in-person · 0 virtual · 0 async" | ❌ guessed "recorded." |
| **resource** | "+ Add paper or resource" | ✅ **the product explained this one.** See below. |
| **discussants** | homepage | ✅ I know this one from my job, not from the product. |
| **digest-first notifications**, **quiet hours** | homepage | ✅ guessed "batched emails, not at night" — and liked it. |
| **.ics** | "Download program (.ics)" | ✅ a calendar file. Would have preferred "(adds to your calendar)". |
| **America/Los_Angeles**, **PDT** | timezone field | ✅ but I would not know what to type for the UK, and it is a free-text box (KNOWN #7). |
| **merchant of record** | pricing | ❌ something legal about Stripe. Did not worry me. |
| **entitlement**, **CFP series**, **caps** | pricing / sidebar | ❌ "caps" = limits, guessed. |
| **AI usage** | sidebar | ❌ a bill? a quota? something I might run out of mid-import? |
| **READY_FOR_REVIEW / CONFIRMED / FAILED / audit linked / +22 ~0 −0** | ingest history | ❌ database language on a user-facing page. |
| **Powered by badge**, **white-label**, **SSO** | pricing | ❌ SSO I actually need (we use university sign-in) and it sits under "Contact us," which reads as "too expensive for you." |

---

## Step-by-step walkthrough

### 1. Homepage
**Expected:** to work out in ten seconds whether this is for universities.
**Got:** "Paste your program. Your event is live." plus BUILT FOR ACADEMIC EVENTS
and "Papers, authors, CFP, and series." Within one screen I knew this was for me
and not for weddings. The demo mock-up showing a real academic day sealed it.
**Would I know what to do next?** Yes. This is the strongest page in the product.

One caution: "your event is live" set the expectation that publishing is one
click and automatic. That expectation is what breaks at S1.

### 2. The paste demo
**Expected:** to try it with my own programme.
**Got:** a prefilled sample and **Extract draft sessions**. I would have pasted my
real thing. KNOWN: it silently truncates at 8 rows, so I would have seen my
afternoon disappear on the very page that is meant to prove the product works.
The caption *"Local demo only — nothing is uploaded or metered"* is reassuring
and I appreciated it, though "metered" is a word from a taxi.

### 3. Pricing
**Expected:** a price I can put on a purchase order.
**Got:** actual numbers with no "book a demo." Genuinely rare and I noticed.
Then the contradiction in S10, and five FAQ questions I could not open.

### 4. Signup → S6. Dead end.

### 5. Create an event
Not captured, so I cannot report on it. From the Overview panel afterwards I can
see that name, dates, venue, timezone and brand colour are all editable later,
which is the reassurance I would have wanted at the time (this addresses KNOWN
#8 — it appears to have landed).

### 6. Getting the programme in
**Expected:** to upload the PDF our department already publishes.
**Got:** four stacked panels — paste, URL, upload, CSV — with no guidance on
which to use. I would have scrolled all four before choosing, and I would very
likely have chosen the **fourth**, because of this sentence:

> *"You review every row before anything is created. No AI involved."*

That is the most reassuring line on the page and it sells the *non*-AI path.
Worth knowing, given the homepage sells the AI one. (KNOWN #14 asked for CSV
import; it exists now and is good.)

Then S4 — two silent minutes.

### 7. Reviewing what the AI produced
S2, S3, S7. This screen is simultaneously the most impressive and the most
frightening thing in the product. It demonstrably read my document better than a
person would, and then asks me to take responsibility for decisions whose
consequences it does not describe.

I would click **Confirm drafts** because there is no other way forward, and I
would not feel that I had approved anything — I would feel that I had given up.

### 8. Program tab
**Expected:** a list I can tidy.
**Got:** exactly that, and it works — tracks, rooms, sessions, Edit and Delete on
every row (KNOWN #9 fixed). The explainer sentence about sessions / papers /
resources / speakers is well written.

**+ Add paper or resource** — the brief asks whether I would know which one I
want. **Yes, immediately**, and only because the chooser tells me:

> **Paper** — "A submission with authors and an abstract — appears in the program
> under the session."
> **Resource** — "A link or file, e.g. slides, a reading list, a Drive folder."

That is the best piece of writing in the whole product. It names the thing, says
what it is made of, and says where it shows up. If the review screen and the
Publish panel were written by whoever wrote this, I would not have needed to
email anyone.

What is *not* on this screen: any indication that 22 of these sessions are
invisible to attendees. See S1.

### 9. Publish
One panel, three sentences, two buttons. I understood Draft / Published /
Archived from the copy and felt confident. That confidence was misplaced (S1),
which is the sharpest way I can put this report: **the clearest explanation in the
product is the one that is not true.**

### 10. What attendees see
I could only look at the organiser's view of the attendee app, which shows
everything. From the capture: the schedule, filters, three view modes, My
Schedule, session resources, Q&A, calendar buttons. It looks calm and I would be
happy to send students there. No notification bait, no points, nothing flashing —
that matches what the homepage promised and it is the reason I would have chosen
this over whatever the students' union uses.

I could not verify what a real attendee sees, which is the whole of S1.

---

## What reassured me

Worth protecting, in rough order of how much they mattered:

1. **The "+ Add paper or resource" chooser.** Plain English, names the
   consequence. The model for every other explanation in the product.
2. **"You review every row before anything is created. No AI involved."** on the
   CSV panel. This is the sentence that would have made me trust the product with
   a real programme.
3. **The Remove-resource modal.** It names the session by title and says
   *"Attendees will no longer see it on the session page."* I would click Remove
   without hesitation, which is exactly right.
4. **"Resource added — attendees who join this session can open it from the
   session page."** Confirms not just success but *what changed for other
   people*. Rare.
5. **"Nothing publishes until you confirm"** on the homepage, and the whole
   review-before-anything-happens posture. It is why I would have tried the AI
   import at all.
6. **The Publish panel's three sentences.** The most complete explanation of
   visibility I have ever read in software. (See S1 for the catch.)
7. **Open pricing and the recurring-event price lock.** We run this every year;
   "no surprise annual reprice" is a sentence I would forward to my head of
   department verbatim.
8. **The demo event.** Seeing a finished academic programme — papers nested under
   sessions with author names — told me what "good" looks like before I started.
   I would have used it as my target.
9. **No badges, no points, no push.** Our students would find that patronising
   and I would have had to justify it. Its absence is a selling point; the
   homepage is right to say so out loud.

---

## Open questions

Things the capture does not answer and I refuse to guess at:

1. **Is there a per-session draft/published control anywhere I did not see?** The
   Program tab capture shows only Edit and Delete. I found no `publishStatus`
   reference in the web app at all — but the Speakers, Features and other tabs
   were not opened. If it exists somewhere unexpected, S1 becomes a labelling
   problem rather than a dead end. Either way I could not find it.
2. **Does the Features tab control session visibility?** Not captured. If
   "Features" is where visibility lives, the name gave me no reason to look.
3. **What happens if I refresh or navigate away during the two-minute wait?** Is
   the run cancelled, duplicated, or does it continue? This determines whether my
   panic at 90 seconds is harmless or destructive.
4. **Are `READY_FOR_REVIEW` runs in Ingest history clickable?** If I can re-open
   and confirm an abandoned run weeks later, that is a duplicate-programme
   hazard. Not captured.
5. **Does the signup flow route me to create-organisation → create-event?** The
   help article implies it. Not captured.
6. **Is there an onboarding checklist?** The help article says steps get checked
   off. I never saw one in the console capture.
7. **What does the Concierge button do?** Not captured.
8. **What is on the create-event wizard's final screen now?** KNOWN #8 says QR
   code and public link, which sounds good, but it was not re-captured.
9. **Does the public event page show my department's name?** KNOWN #6 says it did
   not; the demo page now reads "Hosted by UKEDL", so it may be fixed. For an
   academic event, "Hosted by the School of Education" is the thing that makes it
   look real to students.

---

## If I could ask for three things

Not a design proposal — just the three changes that would have got me from "I
have a programme" to "my event is live" without emailing anyone.

1. **Make the Program tab tell me which sessions attendees cannot see**, and give
   me one way to change that (S1). Everything else is recoverable; this is not.
2. **Say what Confirm will do in words, especially to deletes and updates**
   (S3) — and either make the Assumptions boxes work or stop making them look
   like they do (S2).
3. **Put something on screen during the two-minute wait** (S4). One static
   sentence would do.

All three are small. None requires a designer. The product is much closer to
being usable by someone like me than this report's length suggests — it is one
invisible state, one misleading input, and one missing spinner away.
