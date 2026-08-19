# DESIGN_PHASE_MKT — Marketing site & help center rewrite

Date: 2026-08-19. Method: 3 parallel research agents (A: page-by-page reality audit vs
shipped code; B: Whova/Sched/RegFox competitive benchmark with fetched sources; C:
first-principles positioning synthesis) + founder decisions. Goal: marketing/help pages
on par with Whova/Sched in completeness while keeping the calm/honest house voice —
and finally selling what the product actually does (Speaker Readiness above all).

## Founder decisions (2026-08-19)

D1. Category line: calm-led with searchable nouns —
    **"Calm event software for conferences and PD days in education."**
    (Founder chose calm-led; nouns retained for SEO per marketingSeo doctrine.)
D2. Hero: input modes explicit + readiness elevated to the hero subhead.
    Direction (not final copy): H1 ≈ "Send, paste, or describe your program.
    Your event is live today." Sub ≈ "Excel, PDF, Word, pasted text, or just a
    description of the day — UKEDL drafts it, you review, attendees get personal
    agendas the same day. And every presenter gets ready without you chasing them."
D3. Customer-facing feature name: **"Speaker Readiness"** (drop "& Session").
    SEO titles still use category words ("speaker management", "content collection").
    Body copy uses "presenters" freely (PD audiences say presenters).

## Key findings (full agent reports summarized)

Reality audit (agent A):
- Readiness is mentioned NOWHERE public (site, help, privacy data inventory). The
  presenter portal /r/[token] has zero speaker-facing documentation.
- Two WRONG live claims: compare/whova.tsx:111 concedes "lead retrieval" (we ship
  sponsors + lead capture); packages/config/src/index.ts:62 says Anthropic processes
  "organizer-initiated" AI (the attendee Event assistant is user-initiated).
- Homepage/import copy stale (PDF/paste only; reality: Excel/CSV no-AI import, Word,
  images, URL, describe-it generator). Generator, branding, breakout view, assistants,
  participants, certificates, badges, check-in, sponsors, analytics, polls, maps,
  announcements, ops, recap: absent from marketing.
- Help center = 3 articles; contact article still says assistants are "planned".
- robots.txt does not Disallow /r/ (tokenized portal) — add.
- Must preserve: existing slugs (redirects otherwise), marketingSeo module shape,
  data-driven pricing (plans.ts), help dual-source invariant (content/help/*.md
  mirrored byte-for-byte into lib/help/helpContent.ts — a test asserts parity),
  brand-name indirection (rename pending), JSON-LD escape (HARDEN-1).

Competitive benchmark (agent B):
- Speaker-materials collection is an UNCLAIMED category: Whova has forms in its
  "Speaker Center" (no promised chasing); Sched REQUIRES speakers to create accounts
  and log in (password resets have their own help article), manual invites only.
  Nobody promises automated deadline chasing, no-login portals, or approve/reject
  review of materials. "Stop chasing speakers" is ownable.
- Terminology buyers search: speaker management software, abstract management / CFP
  software, event agenda builder, personalized schedules, event check-in app.
- Sched publishes prices ($600/$1,500/$2,250 per-event tiers) and puts compliance on
  the homepage; Whova price-gates everything behind quotes (use against them).
- Help-center credibility bar: role-split categories (organizer / speaker / attendee),
  task-verb titles ("Let speakers upload…"), even 30-40 short articles reads credible.
- Patterns to adopt: problem section before features; 3-step how-it-works; dual CTA
  (self-serve + demo). Patterns to refuse: logo walls, invented counts, urgency
  mechanics, quote gates, testimonial theater.

Positioning (agent C):
- Two products in one: the wedge (program → live site, same day) earns trust; the
  engine (Speaker Readiness, $750/$1,250 concierge) monetizes it. Sequence: hero
  wedge (with readiness in subhead per D2) → Readiness as first full section.
- One buyer persona: the organizer (attendees never shop the site — sell the attendee
  experience TO the organizer; the /e/demo event is the attendee path).
- Audience widening via recognition vignettes, not tabs: academic conference / school
  PD week / regional association secretariat — one sentence each.
- Solo-founder honesty is the brand: first person where true, real support hours,
  answer the continuity objection on-page (export anytime, real deletion, status page).
  Test for every trust signal: defensible in a reply-all to a listserv of program chairs.
- Readiness feature page spine: narrated before/after of the 8 weeks pre-event;
  SHOW the actual reminder email copy on the page; state limits plainly; price on the
  page (no quote gate); CTA = email with presenter count + event date.

## Chunk plan (sequenced)

MKT-1 (Grok-ok, large but well-specified): positioning strings in packages/config
  (category line D1, all page titles/descriptions widened, Anthropic role fix),
  homepage rewrite to the 11-section architecture, robots.txt Disallow /r/,
  fix the wrong Whova lead-retrieval concession (page + its source draft doc).
MKT-2: NEW Speaker Readiness feature page (/speaker-readiness) per agent-C outline,
  incl. the real reminder-email reproduction; nav/footer/sitemap links; homepage
  section links to it.
MKT-3: pricing page enrichment — entitlement bullets reflect real feature set
  (Readiness, CFP, certificates, check-in, sponsors, assistants), define "Full AI
  suite", add FAQ entries (presenter portal users don't count as attendees; speaker
  seats; program-change workflow), concierge pilot cross-link.
MKT-4: help center expansion (respect dual-source invariant): new articles —
  Speaker Readiness (organizer), Presenter portal guide (speaker-facing, no-login,
  formats/250MB limits, reminder cadence, approved/rejected meaning), Describe-your-
  event generator, Event branding, Breakout pick-one view, Participants & invites,
  AI assistants; update getting-started (add generator) and contact (remove "planned
  Phase S1" — assistants shipped).
MKT-5: compare pages refresh via the draft-first process (docs/marketing-drafts →
  approval → page): add Readiness/branding/check-in/analytics arguments, keep the
  "honest reasons to pick X" sections, remove/re-hedge unverifiable claims
  (Whova 3%+$0.99, renewal anecdotes, "2 minutes" perf claim), bump
  COMPETITOR_VERIFIED only for actually re-checked facts.
MKT-6: privacy/security touch-ups — privacy data inventory adds presenter-portal
  materials + retention line for uploads/tokens; security architecture adds R2 and an
  AI-posture paragraph; drop "Phase S2" jargon; decide the DRAFT banner's fate
  (founder + attorney call, per LAUNCH_CHECKLIST).

Voice rules for every chunk: no invented numbers, no logo walls, no urgency theater,
concede honestly, first person where true, mechanisms not adjectives for "calm",
price on the page. All strings via config/copy modules where the pattern exists.
