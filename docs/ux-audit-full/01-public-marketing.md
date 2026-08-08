# Public / Marketing / Auth audit — 01

Code-grounded audit of the logged-out surface, read against the founder's UX/UI
framework and DESIGN_PHASE_F (content-first). Scope: marketing, legal, compare,
help, auth/recovery, and the public event page + CFP. No code was changed.

## Overall read of the public surface (≈150 words)

The public surface splits sharply into two tiers. The **marketing family**
(`index`, `pricing`, `security`, `terms`, `privacy`, `compare/*`, `help/*`) is
mature: it shares one chrome (`SiteHeader`/`SiteFooter`), follows the
eyebrow → H2 → standfirst rhythm, uses the Phase D tokens, and — importantly for
the calm/academic positioning — carries no fabricated logos, testimonials, or
user counts. The public **event page** (`e/[slug]`) is the best-realized screen
in scope: a genuine Sched-quality agenda with papers nested under sessions.

The **second tier drags**: the CFP flow and every token/recovery page
(`verify-email`, `reset-password`, `invite`, `cfp/*`) are off-system — bare
`.container`/`.page` shells, hardcoded hex colors, no brand chrome — and the CFP
submission page is the exact "wall of empty fields" Phase F was written to kill.
The single biggest structural miss: the CFP is invisible from the event page,
and the event page renders no banner, logo, or people cards.

---

## `pages/index.tsx` — Homepage

**For:** primary marketing landing and conversion to "Create your event."
**Seen by:** logged-out prospects (mostly prospective organizers).

**Does well (don't break):** on-system section rhythm; a real product-proof
frame (`DemoScheduleFrame` mirrors the actual agenda anatomy — track bars, paper
chips); an honest trust section that publishes only true facts; a working
in-browser ingest demo; solid SEO + `SoftwareApplication` JSON-LD; dual CTA.

**Issues:**
1. **Overpromise vs. the demo (honesty/anti-goal — major).** `HeroIngestDemo`
   is explicitly a mock ("Local demo only — nothing is uploaded or metered";
   regex over a fixed `SAMPLE_PROGRAM`). But `/compare/sched` and
   `/compare/whova` tell readers to "paste your **real** programme into the demo
   … the extraction runs in your browser against your **actual** document." The
   copy promises more than the widget does. *Fix:* reconcile — either reframe the
   compare copy as "a sample program," or, since AI ingest is now real
   (HANDOFF_BRIEF §3 update), route "try it on your program" into the authed
   ingest and keep the homepage widget honestly labeled "sample."
2. **Hero proof is `aria-hidden` (a11y/hierarchy — minor).**
   `DemoScheduleFrame.tsx` sets `aria-hidden` on the whole frame, so the single
   strongest credibility element is invisible to screen readers and is purely
   decorative (static rows, not the live `/e/demo`). *Fix:* give it an accessible
   caption ("Sample schedule preview") or embed/point to the real demo.
3. **Trust list is thin (content-first — minor).** The two hand-written trust
   items have `<strong>` + explanation; the `brand.productPrinciples` items
   below render as bare `<strong>{p}.</strong>` — terminal phrases with periods,
   no gloss (index.tsx 208–212). *Fix:* one explanatory line per principle.
4. **Duplicate demo CTA labels (polish).** Hero "Try the demo" and the closing
   band "Open /e/demo" point to the same place with different labels.

*Mobile (inferred):* `mkt-hero-grid` has responsive collapse rules
(globals.css ~4463, ~5074); intent looks sound, unverified.

---

## `pages/pricing.tsx` — Pricing

**For:** plan comparison and conversion. **Seen by:** logged-out and signed-in.

**Does well:** prices pulled from the catalog (no fabrication); honest "Which
plan?" guidance; the recurring price-lock explained; native `<details>` FAQ;
and — notably honest — when `billing/config` reports checkout disabled, the CTA
degrades to a support mailto instead of a dead "Buy" button.

**Issues:**
1. **Type scale overridden inline (design-system discipline — minor).** The h1
   is `className="mkt-h2" style={{fontSize:36}}`; more inline `fontSize` at
   lines 240, 162. *Fix:* use the h1/h2 tokens, not inline px.
2. **Pricing overload (cognitive load — minor).** Three-tier grid + a second
   three-card per-event grid + price-lock + which-plan + FAQ, all stacked.
   Phase F favors progressive disclosure. *Fix:* tuck the per-event cards behind
   a "single event / one-time" disclosure.
3. **CTA flicker before config resolves (polish).** While `checkoutEnabled` is
   `null`, the card advertises "Upgrade"/"Sign in to upgrade"; if checkout is
   actually off, that momentarily contradicts the mailto fallback. *Fix:* hold a
   neutral CTA until config resolves.

---

## `pages/security.tsx` — Security

**For:** procurement/credibility for academic buyers. **Seen by:** logged-out.

**Does well:** specific and honest; TOC via `ProseToc`; no invented
certifications (HECVAT Lite/DPA "on request"); links subprocessors to Privacy;
readable prose column.

**Issues:**
1. **Roadmap stated on a trust page (honesty — minor).** "We schedule restore
   drills … (documented in RUNBOOK when Phase S2 lands)" reads to a buyer as a
   present commitment to an unshipped phase. *Fix:* state only current-state
   controls; move future work to a clearly-labeled "planned."
2. **Vague at-rest phrasing (content polish).** "Neon / Render / Netlify class
   controls" invites a procurement follow-up; tighten to what is contractually
   true.

---

## `pages/terms.tsx` and `pages/privacy.tsx` — Legal

**For:** legal terms. **Seen by:** logged-out.

**Does well:** the "DRAFT — requires legal review" banner is internally honest;
TOC; subprocessors from config; readable; sensible structure. Merchant-of-record
copy (Stripe) is consistent with `packages/config` (`subprocessors`).

**Issues:**
1. **"DRAFT" on live legal pages (credibility — major).** Both pages ship a
   visible `mkt-draft-banner` in production (terms 48–50, privacy 51–53). A
   prospect reading "DRAFT" on your Terms at the trust moment undercuts the
   whole calm/credible positioning. *Fix:* complete legal review and remove the
   banner (or, at minimum, replace with a quiet "last updated" line — do not
   present customer-facing legal as a draft on a site that takes money).
2. **SEO strings inline here (consistency — polish).** Unlike siblings, title/
   description are literals, not from `marketingSeo`.

> Note for the founder (verify, not a page defect): HANDOFF_BRIEF §2 lists
> billing as **Lemon Squeezy**, but `packages/config` and every customer-facing
> page say **Stripe (merchant of record)**. The pages are self-consistent;
> reconcile the source of truth so support/legal don't contradict the handoff.

---

## `pages/compare/sched.tsx` and `pages/compare/whova.tsx` — Comparison

**For:** SEO capture and honest positioning. **Seen by:** logged-out.

**Does well:** genuinely honest — each page lists real reasons to pick the
competitor (ticketing, HotCRP/OpenReview, engagement mechanics); specific;
on-system prose; cross-linked.

**Issues:**
1. **The demo overpromise (honesty/anti-goal — major).** Both invite "paste your
   real programme into the demo"; the homepage demo is a mock (see index #1).
   *Fix:* reconcile the two.
2. **Stale competitor figures (credibility — minor).** Prices are hardcoded with
   a "verified August 2026" date (sched "$600–$3,900/year"; whova "3% + $0.99
   per paid ticket"). sched hedges with "verify current figures"; whova states
   its numbers assertively. *Fix:* add the same hedge to whova and keep the
   verified-date discipline.
3. **Scannability (minor).** Long single-column runs of `<p><strong>n.</strong>`
   points; no subheads/anchors.

---

## `pages/help/index.tsx` and `pages/help/[slug].tsx` — Help

**For:** support content. **Seen by:** logged-out, attendees, organizers.

**Does well:** SSR article list; readable prose column; brand-token templating
(`{{product}}` etc.); breadcrumbs; per-article SEO and canonical.

**Issues:**
1. **Flat, ungrouped index (proven patterns/cognitive load — minor).**
   `help/index` is one bulleted `<ul>` of every article, no grouping or search;
   it won't scale and mixes organizer vs. attendee guides. *Fix:* group by
   audience (Organizers / Attendees), or add a filter.
2. **`dangerouslySetInnerHTML` for article bodies (note).** Depends on the
   trusted content pipeline; styling relies on `.help-article-body` (present).
   Not a defect — flagged for awareness.

---

## `pages/login.tsx` — Sign in / register / recovery / event entry

**For:** the front door — sign in, register, forgot-password, and the
"Create your event" path. **Seen by:** everyone converting or returning.

**Does well:** the old invite-code wall is gone from the public flow (admin
registration only via `?admin=1`); honest email-delivery-unavailable fallback
(`verifyFallbackUrl`) so a new signup is never silently locked out; event-context
linking; 44px button targets; on-token `mkt-login-card`; `noindex`.

**Issues:**
1. **Wrong framing for the organizer path (cognitive load / time-to-value —
   major).** Arriving via "Create your event" (`?intent=create-event`) flips to
   register mode, but the card still leads with the attendee-framed brand block
   ("Sign in to your event") and "Have an event link from your organizer?…" — the
   wrong story for someone trying to *become* an organizer. *Fix:* when
   `intent=create-event`, show an organizer header ("Create your event · start
   free, no invite code") and drop the event-link line.
2. **Register is appropriately minimal (keep).** Three fields (email, name,
   password) — matches "fewer fields."
3. **Heavy inline styling (maintainability — polish).** Fonts/colors set inline
   throughout rather than via token classes; drifts from the system over time.

---

## `pages/verify-email/[token].tsx` — Email verification

**For:** confirm email after registration. **Seen by:** new users.

**Does well:** clear verifying/ok/expired states; shows "Sign in" on success;
has `<Head>`.

**Issues:**
1. **Off the auth-surface family (consistency — minor).** Uses legacy
   `.container`/`.card`, not the `mkt-login-card` that `login` and 404/500 share.
2. **Dead-ends on failure (minor).** "Try again later" with no logo and no
   action. *Fix:* adopt the login-card look; add a Home/Help action.

---

## `pages/reset-password/[token].tsx` — Set new password

**For:** set a new password from an emailed link. **Seen by:** returning users.

**Does well:** min-length guard; redirect on success; `autoComplete`.

**Issues:**
1. **No `<Head>`/title, no brand chrome (consistency — minor).** Tab shows the
   default title; no logo/header.
2. **Hardcoded hex for status (off-system — minor).** `#b42318`/`#0f7b3d`
   (lines 56–57) instead of `--danger`/`--success` (and inconsistent with the
   `--danger-700`/`mkt-form-status` used elsewhere). *Fix:* semantic tokens +
   `mkt-form-status`.
3. Legacy `.container`/`.card` again — orphaned from the auth family.

---

## `pages/invite/[token].tsx` — Invited-profile setup

**For:** an organizer-started attendee/speaker sets a password and confirms
their profile. **Seen by:** invited users on first run (a first impression).

**Does well:** previews the organizer-started profile (name, email, photo,
interests) — good reassurance; handles used/expired invites with auto-redirect;
min-length guard.

**Issues:**
1. **Plainest surface in the set, off-system (consistency — minor→major for a
   first impression).** No `<Head>`/title; hardcoded `borderRadius:12` on the
   photo (should be a `--radius` token); hardcoded error hex (`#b42318`, ×2);
   legacy container/card. *Fix:* login-card treatment with logo + wayfinding +
   tokens.

---

## `pages/e/join/[token].tsx` — Join-link resolver

**For:** resolve an opaque join link → `login?event=`. **Seen by:** attendees.

**Does well:** has logo, brand, `noindex`; clear error copy; redirect helper is
unit-tested (`joinTokenLoginDestination`).

**Issues:**
1. **Error dead-end (minor).** On failure there's no Home/retry action.
2. **Relies on `.muted` (polish).** If that class is unstyled the "Opening your
   event…" line just falls back to body color; low risk.

---

## `pages/e/[slug].tsx` — Public event / schedule page (the flagship)

**For:** the public event home and schedule; `/e/demo` is the primary sales
surface. **Seen by:** logged-out prospects, browsing attendees, and authors.

**Does well (protect this):** a real D2-quality agenda — sticky context bar, day
chips, 88px time rail, track color bars, side-by-side concurrent sessions,
paper-count chips, and **papers nested under sessions with authors** (the
academic differentiator, actually rendered); list/grid/by-room views; ICS +
print program; client-side filters with a legend rail; rich SEO + `Event`
JSON-LD; honest `noindex` for non-demo events; viewer-aware header.

**Issues:**
1. **No CFP entry point (time-to-value / wayfinding — major, effectively a
   discoverability blocker).** `e/[slug]/cfp` is a first-class flow, but nothing
   on the public event page links to it — an author cannot find the call for
   proposals from the event's own public home. *Fix:* when a public CFP is open,
   surface a header action/banner ("Call for proposals — open until <date>"),
   which also delivers the Phase F "title + state + primary action" header.
2. **Banner and logo fetched but never rendered (visual hierarchy / content-first
   — major).** `PublicEventView` carries `bannerUrl` and `logoUrl`, but they're
   used only for `og:image`; the page shows zero event branding. The
   `.hero-banner` primitive already exists in globals. On the #1 sales surface
   this is a weak first impression. *Fix:* render the banner as a hero and the
   logo beside the title.
3. **Speakers/Sponsors are bare bullet lists (Phase F principle 5 — minor→major
   for the sales surface).** `mkt-speaker-list`/`mkt-sponsor-list` are plain
   `<ul>`s; the payload has no speaker photo. *Fix:* people/sponsor cards (avatar,
   name, affiliation); adding `photoUrl` to the public speaker shape needs an API
   field, but the card layout is presentation-only.
4. **Bare empty state (minor).** "Sessions will appear here when published." is a
   help-text line, not the Phase F EmptyState (icon + sentence + action).
5. **No one-line event state (wayfinding — minor).** Header shows date/name/venue
   but no "Upcoming / Day 1 of 3 / happening now."
6. **Three differently-labeled join CTAs (cognitive load — minor).** Header
   "Join / Sign in," body "Join this event," and "Join to build your schedule"
   all go to login. *Fix:* one primary join in the header + one contextual below
   the schedule.

*Mobile (inferred):* the schedule CSS has extensive mobile handling (day-chip
strip, bottom filter sheet, 44px save-dot targets). Intent is strong; unverified.

---

## `pages/e/[slug]/cfp/index.tsx` — CFP submission

**For:** public abstract/proposal submission. **Seen by:** authors, often with
no account.

**Does well:** no-account submission; **auto-saving draft to localStorage** (real
friction reduction); custom fields; attachment with a size guard; honest
"check your email to confirm"; open/close window shown.

**Issues:**
1. **The archetypal form-first page (content-first — major).** This is precisely
   the anti-pattern Phase F names: it opens as a long single-column stack of
   empty inputs (name, email, title, abstract, N custom fields, file) with no
   content framing, no grouping, no progressive disclosure. *Fix:* lead with a
   short "what we're asking / deadline / how review works" panel; group into
   fieldsets (About you → Your proposal → Attachments); tuck optional/custom
   fields behind "More options."
2. **Off the design system on a brand-facing page (consistency — major).** Bare
   `<main className="page">` (`.page` has no styles in globals.css), no
   `SiteHeader`/`SiteFooter`, native `<select>` instead of the shared `Select`,
   errors as raw `<p style=danger>`. Authors judge the host org by this page.
   *Fix:* wrap in `mkt-page` chrome; use `Select` and `mkt-form-status`.
3. **No loading skeleton (minor).** A blank fallback title flashes while the CFP
   loads.
4. **`className="input"` on the abstract `<textarea>` (polish).**

---

## `pages/e/[slug]/cfp/submission.tsx` — Tokenized submission view

**For:** an author views their own submission via an emailed token.

**Does well:** scoped to the owner's submission; shows status and attachments.

**Issues:**
1. **Bare/off-brand (minor).** Unstyled `.page`, no chrome/logo; the abstract is
   rendered in a `<pre>`. *Fix:* mkt chrome + prose styling.
2. **No onward action (minor).** No back-to-event link, no edit/withdraw.

---

## `pages/e/[slug]/cfp/verify.tsx` — Submission email confirmation

**For:** confirm a submission via an emailed token.

**Does well:** clear working/ok/err states; offers an access link.

**Issues:**
1. **Bare `.page`, no chrome/logo (minor).**
2. **Fragile access-link rendering (minor).** Manual `new URL(...).pathname`
   parsing with two overlapping conditionals can render two links. *Fix:* a
   single clear primary action inside mkt chrome.

---

## Top 5 highest-impact fixes across all public pages (ranked)

1. **Surface the CFP on `e/[slug]`.** When a public CFP is open, show a header
   action/banner linking to it. Today a first-class academic feature is
   undiscoverable from the event's own public page — the highest-leverage,
   lowest-cost fix. (`e/[slug].tsx`)
2. **Bring the CFP flow and every token/recovery page onto the design system and
   make CFP content-first.** `cfp/index` is the "wall of empty fields" Phase F
   targets; `cfp/*`, `verify-email`, `reset-password`, and `invite` are
   off-system bare shells with hardcoded colors. These are public, brand-facing
   surfaces authors and new attendees judge you by — the biggest quality gap.
3. **Give `e/[slug]` real branding and people cards.** Render the already-fetched
   banner and logo, and turn the bullet-list speakers/sponsors into scannable
   cards. It's the #1 sales surface and currently shows no event identity.
4. **Reconcile the "paste your real programme into the demo" overpromise.** The
   compare pages promise more than the mock homepage widget delivers; align the
   copy (or route to the now-real ingest). Honesty is core positioning.
5. **Fix credibility at the two decision moments:** make `login` reflect the
   "Create your event" intent (organizer framing, not attendee), and remove the
   visible "DRAFT" banner from the live Terms and Privacy pages.
