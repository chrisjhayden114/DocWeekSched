# UX Audit 03 — The Veteran Organizer

Reviewer persona: runs academic conferences; 5+ events shipped on Whova and Sched.
Written 2026-08-02 against the Phase A / Phase B-C-D captures of production `ukedl.com`,
plus live web verification of current Whova and Sched.

Ground rules I held myself to:
- Competitor claims are **verified today** unless marked `[recall]`.
- Anything already named in `PARITY_AUDIT.md` is marked **KNOWN**.
- Mobile/responsive rendering was not captured, so I say nothing about it. I do
  take a position on the *strategic* web-vs-native question, which is different.

---

## 1. Would I switch?

**Yes — for a 50–400 attendee, one-to-three-track conference, the moment I can
actually pay you. No — not for an 800-person, five-track event, until six things
close.**

That split is the honest answer and I want to be precise about it, because
"it depends" is what people say when they haven't decided.

**What I would move today.** My department's annual doctoral conference: ~180
attendees, three parallel tracks, 60 sessions, ~90 papers with ordered authors and
discussants, a programme that exists as a PDF the programme chair exported from
Word. That event is currently on Sched and costs me a full working day of
spreadsheet surgery every February. Your ingest plus your papers model would take
that day back. I would pay $790/yr for that without a meeting.

**What I would not move.** Our society's biennial: 800 attendees, five parallel
tracks, three days, a 40-page programme, a ballroom with wifi that dies at 200
concurrent devices, and a procurement office that will not sign anything without a
HECVAT. Six specific blockers, all in §3: the ingest refuses programmes above some
length; the grid view is decorative; there is no verified path for an urgent
room-change alert to reach an attendee's phone; the procurement PDFs are
placeholders; the schedule does not cache offline; and the timezone field is a text
box.

**Conditions to switch the big one** — in the order I'd want them:
1. Ingest survives a full multi-track programme (or chunks it itself, invisibly).
2. Grid view is navigable, not a rendering.
3. A named, organizer-initiated **urgent broadcast** channel with a verified
   delivery path to an iPhone that has *not* installed the PWA.
4. Real DPA + HECVAT-Lite.
5. Service-worker caching of the agenda.
6. Billing that works, and pricing copy that survives a procurement lawyer.

None of those six requires a team. That is why my answer is yes-with-conditions
rather than no.

---

## 2. Competitive check — what is actually true right now

I checked rather than remembered, because a two-year-old memory of Whova would be
worse than nothing.

### Whova

- **Pricing is still quote-gated.** Whova's own pricing page does not publish
  amounts; you submit event size, format and duration and get a custom figure. G2
  lists "No pricing available" for entry-level. ([Whova pricing](https://whova.com/pricing/),
  [G2 Whova](https://www.g2.com/products/whova/reviews))
- **Layered costs.** Third-party pricing teardowns describe four layers: a custom
  per-event platform fee, a **3.0% + $0.99 registration fee on every paid ticket**,
  paid add-ons (organizers report unlimited document uploads quoted at ~$2,000),
  and multi-event package discounts. Multiple organizers report **price increases
  at each renewal with no published rate**.
  ([Eventify teardown](https://eventify.io/blog/whova-pricing),
  [LineUpr teardown](https://lineupr.com/en/blog/whova-event-app-pricing-review),
  [flat.social review](https://flat.social/guides/whova-review))
- **Agenda import exists and is decent.** Whova ships an Excel "Agenda Template"
  and an Import Session List flow that auto-fills session details from an uploaded
  list. ([Whova import](https://whova.com/blog/import-session-list/))
- **Academic review integrations are real and are Whova's strongest academic
  play.** Direct import of accepted submissions from **HotCRP** and **OpenReview**
  into the agenda, explicitly to kill copy-paste and spreadsheet cleanup.
  ([HotCRP](https://whova.com/blog/hotcrp-import/),
  [OpenReview](https://whova.com/blog/openreview-integration/)). ConfTool publishes
  its own Whova export. ([ConfTool docs](https://www.conftool.net/en/configuration-documentation/whova.html))
- **Abstract management is a full module**: submission, peer review with
  double-blind and conflict-of-interest handling, automated status tracking, and
  push of accepted sessions into the schedule with tracks and tags.
  ([Whova abstract management](https://whova.com/abstract-management/))
- **Gamification is not a legacy feature — it is actively marketed in 2026.**
  Leaderboards award points for public actions; organizers are coached to push-notify
  that the top 3 win prizes; surveys and polls are gamified specifically to lift
  response rates.
  ([Leaderboard](https://whova.com/blog/leaderboard-gamification-audience-participation/),
  [Leaderboard customization](https://whova.com/blog/leaderboard-customization/),
  [Survey response](https://whova.com/blog/double-your-event-survey-response-rate/))
- **Recent organizer-side change (Feb 2026):** bulk-assign a room, track or tag to
  multiple sessions at once. ([Whova](https://whova.com/blog/conference-agenda-template/))
  Worth noting what that tells you about the state of the art: their headline agenda
  improvement this year was multi-select.
- **Attendee model:** native iOS/Android apps **plus a free web browser version** —
  download is not strictly required. App-store ratings are genuinely strong (4.9 on
  Google Play, 31,000+ ratings as of July 2026). Reviewers' named limitations:
  notification volume, **no print in the web version**, learning curve.
  ([flat.social](https://flat.social/guides/whova-review),
  [Capterra reviews](https://www.capterra.com/p/149712/Whova/reviews/))

### Sched

- **Pricing is public** — this is the thing to correct in your head if you last
  looked years ago. Sched publishes a three-tier catalogue with an attendee-count
  selector (defaults to 250 seats; checkout links carry
  `Launch-2025-USD-Yearly`, `Boost-Dec-2025-USD-Yearly`, `Ultra-Dec-2025-USD-Yearly`
  with `quantity=250`). The page carries a "Best Price. Guaranteed." claim.
  ([Sched pricing](https://sched.com/pricing/))
- **Indicative annual figures at 250 attendees:** Launch ≈ **$600/yr**, Boost ≈
  **$1,500/yr**, Ultra ≈ **$3,900/yr**. Amounts are injected client-side, so I am
  citing the figures as reported rather than as scraped.
  ([GetApp](https://www.getapp.com/customer-management-software/a/sched-org/),
  [Capterra](https://www.capterra.com/p/125306/Sched-org/pricing/))
- **Attendees are sold in buckets of 250.** Every plan includes unlimited "small
  events" under 50 attendees; there is no true free tier for a real event. Ultra
  includes free events up to 100 attendees.
  ([Sched plans guide](https://sched.com/guide/plans-pricing/))
- **Launch already includes registration and ticketing.** Boost adds attendance
  tracking/check-in, attendee networking, sponsor profiles and **lead retrieval**.
  ([Sched pricing](https://sched.com/pricing/), [Sched ticketing](https://sched.com/guide/sched-ticketing/))
- **Attendee model:** native iOS/Android app, and the schedule is fully usable by
  visiting the event URL in a mobile browser — **download not required**.
  ([Sched mobile](https://sched.com/features/mobile-event-app-software/),
  [Comic-Con mobile web](https://comiccon2026.sched.com/mobile-site))
- **Bulk import is a spreadsheet, and it is as fiddly as I remember.** Verified from
  Sched's own docs: one row per session; **you must assign your own unique ID in
  Column A**; do not delete rows 1–5 or any column or the import fails; speakers are
  a **semicolon-delimited string** and **must already exist in the Speakers tab**
  before you can assign them.
  ([Adding and importing sessions](https://sched.com/guide/add-sessions/),
  [Add speakers](https://sched.com/guide/add-speakers/),
  [Data](https://sched.com/guide/data/))

### The academic-structure question, answered from their own docs

I could not find any Sched entity for a *paper with an ordered author list nested
under a session*. Sched's data model, per its import documentation, is: session
(one row) → participants (a semicolon-joined string). Author order is whatever
order you typed, in a free-text field, with no first-author/discussant distinction
and no per-paper time. In practice, on Sched, I have always faked papers either by
cramming them into the session description — which kills search and filtering — or
by creating each paper as its own 20-minute session, which destroys the parent/child
relationship and makes the grid unreadable.

Whova is better here but in a different place: its **abstract module** models
submissions properly for review, and HotCRP/OpenReview import brings canonical
structured data in. What happens to that structure once it lands in the *agenda* is
where I'd want a live demo before believing it holds ordered authors and
discussants as first-class attendee-facing objects `[recall — I have only seen this
render as tagged sessions]`.

**So the honest read:** for a CS or ML conference already on HotCRP or OpenReview,
Whova's import path is superior to parsing a PDF and I would say so out loud. For
education, humanities, social science and every departmental doctoral conference I
have ever run — where the programme is a Word document that became a PDF, and
review happened in EasyChair or a shared Drive folder or someone's inbox — **UKEDL's
model is the only one that matches how the data actually exists.** That is a real
and defensible niche, not a marketing line.

---

## 3. GAPS — ranked

Ranked by whether they stop me, not by effort.

### G1. I cannot buy it — and the payment copy will not survive procurement. **BLOCKS.**
`HANDOFF_BRIEF.md` §3 says Lemon Squeezy keys are unset and the billing path has
never executed in production. Meanwhile the live pricing page (Phase A, A2) states
*"Checkout is handled by **Stripe** (merchant of record) — they collect payment and
applicable sales tax/VAT."*

Two problems, and the second is the serious one:
1. **The docs disagree with the shipped page** (Lemon Squeezy vs Stripe). One of
   them is wrong and it is the one a customer reads.
2. **"Merchant of record" is a term of art.** It is precisely the sentence a
   university's finance and tax office will read closely, because it determines who
   is the seller and who remits VAT. Lemon Squeezy and Paddle sell themselves as
   merchant of record; a plain Stripe integration ordinarily does not make Stripe
   the seller. If that sentence is inaccurate, it is the single most expensive
   sentence on the site — it is the one that gets you disqualified in a procurement
   review, and it is also the one that undermines an otherwise excellent
   trust-forward pricing page. Resolve which processor you use and have someone
   confirm the exact MoR wording.

Everything else in this report is moot until someone can pay.

### G2. The ingest refuses large programmes. **BLOCKS my big event.**
Phase B/C/D §E records the failure copy: *"The programme was too long to process in
one pass. Split it into smaller sections and ingest each one separately, or use the
CSV import instead."*

This is the gap that most directly contradicts the pitch. "Paste your programme,
your event is live" is aimed at people with programmes. A 40-page, five-track,
three-day programme is *the* document. Telling that organizer to cut their PDF into
pieces and re-upload is asking them to do exactly the manual labour they came to
avoid — worse, it fragments the changeset, so the create/update/delete diff that is
your best feature no longer sees the whole programme and will propose deletions for
sessions that are simply in another chunk.

Fix shape, one person, no new infrastructure: chunk by page range or day heading
server-side, run passes sequentially, merge into a single changeset, and show
"processing section 2 of 4." The organizer should never learn that a context window
exists.

### G3. Grid / by-room views are decorative. **BLOCKS at five tracks.**
`CUSTOMER_TEST_FINDINGS.md` #24: grid and by-room blocks *"carry button semantics
but do nothing on the public page."* #23: the flagship demo has no rooms, so
by-room buckets everything under "No room."

Five parallel tracks is a grid problem and nothing else. The list view is fine for
one or two tracks; at five it becomes a wall. Both Sched (Grid, By-Venue) and
EventPilot (Visual Schedule) ship this and it is the view my attendees live in on
day two. Announcing a control that does nothing is also an accessibility failure —
it is worse than not shipping the view.

**KNOWN** as G1 in `PARITY_AUDIT.md`, marked built in D6. It is built and broken,
which is a different problem from missing, and should be re-opened as a defect
rather than sitting closed as a shipped feature.

### G4. No verified path for an urgent room change to reach a phone. **BLOCKS.**
This is the gap I want you to read twice, because it is easy to misfile as a
deliberate anti-goal. **It is not.** Your anti-goal is *platform-initiated,
unsolicited* push. An organizer telling 800 people that the 2pm keynote moved to
Hall B is **organizer-initiated and solicited** — attendees consented to it by
attending. Suppressing that is not calm, it is negligent, and it is the thing that
gets me shouted at in a corridor.

Two mechanisms need checking:
- **Quiet hours and digest batching must have an explicit override.** If an
  organizer marks a broadcast urgent, it must pierce the digest immediately and be
  visibly labelled as having done so. If quiet hours can swallow a room change,
  that is a bug with a safety dimension.
- **Delivery on iOS is the harder half.** On iPhone, web push requires the site to
  have been added to the Home Screen; a user who merely opened your URL in Safari
  cannot receive a push at all `[recall — platform behaviour, verify against current
  iOS]`. Whova and Sched both sidestep this with native apps. If that constraint
  holds, then for a meaningful share of your attendees your urgent channel is
  "hope they refresh," and you need a fallback: SMS opt-in at check-in, an
  organizer-triggered email blast, or an aggressive install prompt at join time
  with an honest explanation of why.

Anything else in this report can wait. This one is a promise you are implicitly
making by selling to conferences.

### G5. Procurement artifacts are placeholders. **BLOCKS at any university.**
`CUSTOMER_TEST_FINDINGS.md` #26: `/legal/dpa.pdf` and `/legal/hecvat-lite.pdf` are
placeholders possibly still carrying the old "Colloquium" name, and the security
page publicly states that account-deletion rules are not approved.

I want to be encouraging about the underlying instinct here, because the security
page that refuses to claim uncompleted certifications is genuinely rare and
genuinely good. But a placeholder PDF with a stale product name attached to a real
download link is worse than no link — it reads as abandoned. **Remove the links
until the documents are real.** A HECVAT-Lite is a self-assessment questionnaire,
not an audit; it is a weekend of honest writing, not a budget line. SOC 2 can wait
for revenue (agreed with `PARITY_AUDIT.md`); HECVAT-Lite cannot, because it is the
gate my IT office actually uses.

### G6. The schedule does not work offline. **BLOCKS at a bad venue.**
**KNOWN** — `PARITY_AUDIT.md` B9: offline fallback page only, no service-worker
caching of agenda data.

This is the strongest argument the native-app vendors have against you, and unlike
most of their arguments it is true. Eight hundred people in a hotel ballroom on
conference wifi is a genuinely hostile network. Sched's and Whova's apps have the
schedule on the device. Your PWA, today, has a fallback page.

Good news: this is the highest value-per-hour item in the entire report. Caching
the agenda JSON and session detail in a service worker is a contained piece of work
for one person, and it converts your biggest structural weakness into a
non-issue — at which point "no app-store download" becomes an unambiguous win
instead of a trade.

### G7. Timezone is a free-text box. **Cheap to fix, enormous blast radius.**
Phase B/C/D §B2 shows the event settings Timezone field as a free-text-looking input
containing `America/Los_Angeles`. **KNOWN** — `CUSTOMER_TEST_FINDINGS.md` #7.

A typo here silently shifts every session time for every attendee, and no one finds
out until someone misses a keynote. Make it a searchable IANA select. This is an
afternoon and it removes an entire class of catastrophic failure. The fact that it
survived from the 21 July findings into the 2 August capture is the thing I would
flag, not the field itself.

### G8. The organizer Program tab does not scale past ~50 sessions. **Costs me, doesn't block.**
Phase B/C/D §B3: sessions render as a single day-grouped scroll of cards, each with
inline Edit/Delete. No search, no filter by track or room, no multi-select, no bulk
operations.

At 150 sessions across five tracks that is a very long page and a lot of scrolling
to find the one session whose room changed. Note that Whova's *headline agenda
release of 2026* was bulk-assign room/track/tag to multiple sessions — they shipped
it because organizers demanded it. You need at minimum a track/room/day filter on
the organizer side, reusing the filter component the public page already has.

### G9. No import path from where academic programme data actually lives. **High ROI, doesn't block.**
Whova imports from HotCRP and OpenReview; ConfTool ships a Whova export. You have
PDF/DOCX/XLSX/CSV/image and a URL fetch — which covers the "it's a document" case
well, and nothing else.

EasyChair, ConfTool, Oxford Abstracts and OpenReview all export CSV. You already
have a CSV importer with a documented column set. A small set of named mapping
presets ("Import from EasyChair export") is largely configuration over code you
have shipped, and it lets you say "we import from your review system" in the same
breath as the AI ingest. For a solo founder this is one of the best
effort-to-credibility ratios available.

### G10. Abstract review depth is unverified against Whova. **Verify, then decide.**
`PARITY_AUDIT.md` claims CFP with review and decisions is "stronger than Sched's" —
believable, since Sched barely has one. But the comparison that matters is Whova,
whose abstract module advertises **double-blind review and conflict-of-interest
handling**. Those two are not nice-to-haves for a scholarly society; they are
the reason a programme committee chooses a tool. The CFP tab was not opened in this
capture pass. If blind review and COI are absent, that is a real gap for society
customers — though not for me personally, since our review happens elsewhere.

### G11. Per-session private notes. **KNOWN (B2). Doesn't block. Genuinely used.**
Both Whova and EventPilot have them with export. This is the one Whova personal-layer
feature my attendees actually use and mention afterwards — people take notes in
sessions and want them exported. Rank it above the rest of the personal-layer backlog.

### G12. Registration forms with custom fields. **KNOWN (B6). Doesn't block me.**
I collect dietary requirements, accessibility needs, affiliation and badge name in
the university's own registration store, for tax and PO reasons, and I suspect most
of your target buyers do too. What I need instead is the ability to **import that
list with its custom fields intact** and have them appear on attendee profiles and
badges. That is a narrower feature than a form builder and serves the same need.

### G13. Navigation is duplicated in ways that will confuse my volunteer co-chair. **Polish, but it compounds.**
From the captures: "Overview" appears in both the left sidebar and the horizontal
tab row (§B2); day filtering exists in both the pill row and the right rail, on both
the public page (§A4) and the attendee dashboard (§D1); nine horizontal tabs plus
six sidebar items are visible simultaneously; the org switcher truncates to
"Orga…"; the auth-state header flashes signed-out then swaps on every page (§A0);
the ingest "Will create" list renders `0.` and `1.` for items 10 and 11 (truncated
tens digit) — which at 22 rows is already wrong and at 150 rows is unreadable.

Individually trivial. Collectively they matter because I do not administer these
events alone — I hand the console to a graduate student for two weeks and every
ambiguity becomes a message to me.

---

## 4. DELIBERATE departures — and whether each wins or costs

| Departure | My read | Wins or costs |
|---|---|---|
| **No leaderboard / gamification** | Whova is actively selling this in 2026, including gamifying survey responses. In five conferences no one has ever asked me for a leaderboard; several faculty have asked me to turn it off. Manufacturing engagement is a tell that a product has nothing else to measure. | **Wins.** Say it louder. |
| **No platform-initiated push** | Correct as stated. But see G4 — the *organizer's* urgent channel is a separate thing and must be loud, reliable and provably delivered. | **Wins, conditional on G4.** Costs deals if the distinction isn't visible in the product. |
| **No auto-generated activity feed** | "X viewed your profile" belongs to a different industry. Nobody will notice its absence. | **Wins silently.** |
| **No dark-pattern upgrade prompts** | The Free tier's "Powered by" badge is the honest version of monetising free. | **Wins.** |
| **No ads / no CTR-tracked session banners** | Important nuance: you do have **sponsor recognition** — the Sponsors tab and the "Gold: Campus Press / Silver: Scholar Tools Co." panel on the attendee dashboard (§D1). So you are skipping *ads*, not *sponsors*. That is exactly the right line and my sponsors would not notice the difference. | **Wins**, provided the pitch says "sponsor recognition, not ad inventory" rather than just "no ads," which reads to a sponsorship chair like "no sponsor visibility." |
| **No attendee-data monetisation** | For education buyers this is a procurement asset, not just an ethic. Pair it with the written FERPA-alignment statement `PARITY_AUDIT.md` already recommends. | **Wins**, and is under-marketed. |
| **No lead retrieval** | **Costs deals**, narrowly. Sched sells it at Boost ($1,500/yr tier). For a 180-person departmental conference with two sponsors: irrelevant. For a society whose exhibitor hall funds the whole event: disqualifying. The consent-first framing in `PARITY_AUDIT.md` is right, and the minimum viable version is small — the *attendee* taps to share their card at a booth, rather than the booth scanning the attendee. That inverts the consent model and is defensible, buildable by one person, and a better story than the incumbents'. | **Costs, recoverable.** |
| **No attendee ticketing** | Sched includes ticketing at its entry tier and Whova takes 3.0% + $0.99 per paid ticket — so this is a genuine feature deficit on paper. In practice almost every academic conference I have run bills through the university store or Eventbrite because of PO, tax and institutional-account requirements. Being told "we never touch your attendees' money" is a *relief* in a finance conversation. | **Costs less than it looks.** Hold the line; say why in one sentence on the pricing page. |
| **No sales-call-gated pricing** | This is your best strategic decision. My finance office needs a number before I can raise a PO. Whova cannot give me one without a call, and organizers report renewal increases with no published rate. Your **recurring-event price lock** is the direct counter to exactly that complaint. | **Wins, unambiguously.** See §7 — I would promote it. |
| **No native app-store container** | Split verdict, treated properly in §6. | **Net win once G6 (offline) lands. Net loss until then.** |

---

## 5. BETTER than the incumbents — specifically

1. **Papers as first-class objects.** Sessions nest papers; papers carry **ordered**
   authors, discussants and individual times; the public page renders the hierarchy
   with a "2 papers" pill and nested author rows (§A4), and
   `CUSTOMER_TEST_FINDINGS.md` confirms author order survived first try.
   Against Sched — whose import docs show one row per session and participants as a
   semicolon-delimited string that must pre-exist — this is not an incremental
   improvement. It is the difference between modelling my programme and faking it.
   **This is the feature I would lead with, ahead of the AI.**
2. **The Assumptions list.** More on this in §6. Nothing in either competitor does
   anything comparable.
3. **The re-import changeset.** Create / update / delete, itemised, individually
   checkable, deletions unchecked by default (§B4). Programme churn between draft 1
   and draft 6 is the single worst part of my job. On Sched, re-importing means
   maintaining my own unique-ID column and praying. Whova's 2026 agenda headline was
   multi-select. A reviewable diff against a re-uploaded PDF is meaningfully ahead
   of both — and I do not think you know how far ahead it is, because it is buried
   under the AI framing.
4. **Published pricing with a recurring-event price lock.** Sched publishes too, so
   the win is specifically against Whova — but the *price lock* beats both, and it
   answers a documented, repeated organizer complaint about Whova renewals.
5. **The economics at my size are genuinely good.** Sched sells attendees in
   250-buckets from a ~$600/yr base. Pro at **$790/yr covers 2,000 attendees**. For
   an 800-person conference that is a large, checkable, publishable difference —
   and you are currently not publishing it. Put a comparison table on the pricing
   page with dated, sourced competitor figures. It is the most credible thing you
   could add.
6. **Per-event Feature toggles** with honest "Attendees see:" labels. The customer
   test called this better than anything the three competitors ship and I agree.
   Turning off community features for a formal society meeting, and *seeing exactly
   what the attendee will see*, is something I have wanted from Whova for years.
7. **The CSV importer sitting next to the AI ingest, labelled "No AI involved."**
   (§B4.) That sentence will single-handedly win over the senior colleague on my
   committee who is prepared to veto an AI purchase. Do not bury it, do not soften
   it, do not move it below the fold.
8. **Print and ICS on the public page** (§A4: Download program .ics, Print).
   Whova's web version reportedly has no print. My attendees print the programme.
   Some of them are 65 and will print the programme regardless of what I build.

---

## 6. The ingest verdict

**It is a real advantage, not a novelty — but you are selling the wrong half of it.**

**What the actual competing job looks like.** My programme is a PDF. To get it into
Sched I must produce a spreadsheet with a self-assigned unique ID per row,
semicolon-joined participant strings, speakers pre-created in a separate tab, and
rows 1–5 left untouched (verified from Sched's docs). For 60 sessions and 90 papers
that is most of a working day, plus a second pass for the inevitable corrections.
Whova's Excel template is nicer but the shape of the labour is identical — unless I
am on HotCRP or OpenReview, in which case Whova's direct import beats you and you
should concede that gracefully.

**So: two minutes against six hours.** The wait is not the problem. A two-minute
wait for a day's work is an obviously good trade, and any organizer will make it.

**But the two minutes is presented terribly.** Phase B/C/D §B4: a 7-page, 184 KB PDF
took over two minutes with **no progress indicator, no percentage, no elapsed
timer**. Two minutes of a dead screen does not read as "working," it reads as
"hung," and the person watching it is a prospect deciding whether your central
claim is true. An elapsed timer plus stage labels ("reading page 4 of 7 → resolving
speakers → building changeset") costs you a day and changes the emotional register
of the entire product. Do this before the next demo.

**The Assumptions list is the actual product.** The examples in the capture are not
parsing — they are editorial judgment:

- Catching that page 1 says "Potterton" and page 5 says "Potterson," and asking
  which is right.
- Reading a **strikethrough** on page 2 across a presenter's name *and* their email
  and inferring a withdrawal — then asking rather than assuming.
- Noticing that a 9am–12pm workshop is split into concurrent PhD and EdD tracks and
  choosing to model it as two simultaneous sessions rather than two sequential ones.
- Flagging that the source never stated a timezone and that the university's actual
  zone may not be the hint it was given.

No spreadsheet import catches any of those. A careful human proofreader catches
maybe three of four on a good day, and I have shipped programmes with exactly that
"Potterson" error in them. **This is the demo.** Not "AI reads your PDF" — every
vendor will claim that within a year and most claims will be false. "It found the
two spellings of your keynote's name on pages 1 and 5 and asked you which one was
right" is a specific, checkable, unbluffable claim, and it is the one that would
make me sit up in a sales call.

**Three things stop it being trustworthy at my scale:**

1. **It gives up on long programmes** (G2). Fatal for the flagship use case.
2. **Row-level confidence is not actionable.** An orange row reading
   "(confidence 0.70)" tells me to re-read the row — which means re-reading every
   field in it, which is most of the work I was trying to avoid. Confidence needs to
   point at the *field*: highlight the uncertain room, or the uncertain end time.
   The Assumptions list already proves you can localise ambiguity; the confidence
   display throws that precision away.
3. **The delete proposals are a live-event data-loss trap.** Unchecked-by-default is
   the right call and I am glad it is there. But "Not found in new import — propose
   delete" against a session that 40 attendees have already starred is a
   catastrophe waiting for a tired organizer at 11pm. Annotate delete rows with
   **"12 attendees have this in My Schedule"** and suppress bulk-check on them.
   That single line converts the changeset from clever to trustworthy, and it is a
   query you already have the data for.

**Net:** yes, it genuinely beats CSV import — for documents. It does not beat a
HotCRP/OpenReview export, and you should not pretend otherwise; you should instead
build G9 so you win that case too.

---

## 7. What breaks at 800 attendees across 5 parallel tracks

Ordered by when the pain arrives.

**Before the event, building the programme:**
- **Ingest refuses the programme** (G2). The whole pitch fails at exactly the size
  where it matters most.
- **The changeset UI stops being readable.** 150 create rows in a numbered checklist
  that already renders `0.` and `1.` for items 10 and 11. There is no grouping by
  day or track, no collapse, no "check all in track X." Reviewing 150 pre-checked
  rows in one scroll means nobody reviews them — which quietly defeats the
  agents-draft-humans-publish principle the whole product is built on.
- **Ingest history is 14 unpaginated bullets today** (§B4). Across a season of
  programme revisions that becomes hundreds.
- **The Program tab has no filter** (G8). Finding one session among 150 is scrolling.
- **No date validation against the event window** (`CUSTOMER_TEST_FINDINGS.md` #11),
  and **an empty event is publishable** (#12). At small scale you notice. At 150
  sessions ingested in one pass, a mistyped year hides.
- **Day pills grow unbounded.** The attendee dashboard already shows seven day pills
  spanning two separate months (§D1). Add a multi-day event and this row wraps into
  a navigation problem.

**During the event:**
- **Grid view is decorative** (G3). Five tracks is a grid problem. This is when
  attendees stop using the app.
- **Concurrency rendering is only proven at 2.** The capture shows two concurrent
  sessions side by side under a "2 concurrent sessions" label (§D1). Five side by
  side at desktop width is untested and, given that mobile was not captured at all,
  entirely unknown.
- **Offline** (G6). This is the one that produces visible failure in a room full of
  people.
- **Urgent broadcast** (G4). At 800 people a room change is not a nicety.
- **Native browser validation tooltips** ("Please fill out this field", §E) on the
  Q&A and poll forms. Fine in a demo. During a live plenary with a queue of
  questions it is the wrong feedback in the wrong place.

**The one I would worry about most that nobody has tested:** what does Publish do
when there are 150 draft sessions and the event is already live? Ingest creates
DRAFT sessions and the Overview panel offers a single event-level Publish (§B2, §B4).
If publishing is all-or-nothing at the event level, then mid-conference programme
corrections either cannot be published individually, or publishing one correction
exposes every other in-flight draft. Neither is acceptable at 800 people. This
needs an explicit answer and, most likely, per-session publish.

---

## 8. Deal-breakers for me personally

**I need these to switch anything at all:**
1. Working checkout, and payment/MoR copy that is accurate and internally
   consistent (G1).
2. An IANA timezone picker (G7). I will not put 800 people's session times behind a
   text box.
3. Real DPA and HECVAT-Lite, or those download links removed (G5).

**I need these to move the 800-person event:**
4. Ingest that handles a full multi-track programme without asking me to cut it up
   (G2).
5. A grid view that works (G3).
6. A verified urgent-broadcast path to a phone, with an honest answer for iPhone
   users who have not installed the PWA (G4).
7. Offline caching of the agenda (G6).
8. A clear answer on per-session publish for a live event (§7).

**Nice to have — I would ask for these, and buy without them:**
- Per-session private notes with export (G11, KNOWN B2).
- Organizer-side filter/bulk edit on Program (G8).
- EasyChair / ConfTool / OpenReview CSV mapping presets (G9).
- Attendee-initiated, consent-first contact exchange in place of lead retrieval.
- Custom attendee fields imported from my registration system (G12).
- Delete-row annotation showing how many attendees have starred the session (§6).

**Not deal-breakers, and I want to be clear about it so you do not build them:**
ticketing, exhibitor tooling, a leaderboard, a native app-store container, an
activity feed, or a generic form builder. If a prospect insists on all of those,
they are a Whova customer and you should let them go.

---

## 9. Two closing observations you did not ask for

**Your pricing is too cheap to be reassuring, and the fix is not the price.** Pro at
$790/yr for 2,000 attendees, next to a Sched Ultra at ~$3,900, invites the question
my procurement officer will actually ask: *what happens to our conference if this
one person stops?* The price is not the risk — the bus factor is. What answers it,
cheaply: a published continuity and data-export commitment (format named, not just
"you can export"), honest support hours already promised on `/help`, and a stated
policy for what happens to a published event if a subscription lapses — which
`CUSTOMER_TEST_FINDINGS.md` #25 correctly flags as currently undefined. Also kill
the $149 per-event tier: your own pricing page has to explain in fine print that Pro
is a better buy at that band (§A2), which means the tier is a trap you have
documented rather than removed.

**Lead with the papers, not the AI.** Every event platform will claim AI ingest
within twelve months and most claims will be hollow, at which point your
differentiator evaporates into a crowded, disbelieved category. What will not
evaporate is that you are the only one of the three with a data model that knows a
paper has ordered authors and a discussant and sits inside a session. That is
boring, verifiable, and permanent. The AI ingest is how I get my programme in; the
papers model is why the result is correct. Sell the second one.
