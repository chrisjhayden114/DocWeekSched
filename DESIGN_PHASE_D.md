# Phase D — Design System & Visual Overhaul

**Status:** ready to execute. **Scope:** CSS, layout, component structure only. **Hard rule for every chunk: no schema, no migrations, no API/auth/route-logic changes. All existing tests stay green.**

This document contains (1) the distilled reference study of Sched, Whova, and EventPilot (ATIV), (2) the UKEDL design-language decision derived from it, (3) the screen-by-screen plan, and (4) paste-ready Cursor prompts D1–D5. Review loop per chunk: Cursor implements → founder screenshots every changed surface → external review against the acceptance criteria → iterate before the next chunk.

---

## Part 1 — Reference study (measured from live sites & product CSS, July 2026)

### What all three converge on (the "professional" invariants)

1. **One workhorse typeface, few weights.** Sched: Inter 400/500/600/700 on BOTH marketing and product. Whova: Open Sans 500/700. EventPilot: Roboto (headings) + PT Sans, product app in plain Helvetica. Nobody uses a serif display face in-product.
2. **Text is never pure black, never pure decoration.** Titles `#141414`–`#171717`, body `#424242`–`#666`, meta `#737373`. Two-to-three-tone text hierarchy does the work.
3. **A disciplined neutral gray ramp does ~90% of the UI**; the brand color is scarce. Sched: 9-step ramp `#FAFAFA→#141414` as CSS variables, yellow only on CTAs. EventPilot: one blue `#1679c2` + five grays, nothing else. Restraint reads as maturity.
4. **Borders over shadows.** Sched's strongest common shadow is `0 1px 2px rgba(16,24,40,.05)`; separation comes from 1px `#e5e5e5` borders and background tint steps (`#fff/#fafafa/#f5f5f5`). EventPilot: near-invisible borders, section tint bands.
5. **Small radii, split by role, never pill.** Sched: 4px content cards/chips, 6px interactive controls, 8–12px marketing cards. Whova: 3px. EventPilot: 4px buttons, 6px forms.
6. **Rows, not floating cards, for repeating data.** Agendas are dense time-grouped row lists (~10 sessions per screen at ~70–85px/row), scannable via color-coding — not stacks of boxed cards centered in a void.
7. **A real app shell.** Web: persistent left sidebar with grouped, labeled nav (Whova web portal: "Main Navigation" / "Resources"; EventPilot planner: Planner Tools / My Meeting Resources). Mobile: bottom tab bar (Home / Agenda / Attendees / Community / Messages). Master–detail on desktop where content is deep.
8. **Color encodes meaning, never decorates.** Track/type colors on sessions (Sched: full-row light tint bounded by 1px border; EventPilot: 15px left color bar from a muted 10-color categorical palette), role colors, green "live" indicators.
9. **Marketing shows the real product** (device-framed screenshots of actual schedules), leads with institutional logos, quantifies everything, and repeats one rigid section template per page: eyebrow → sentence-case H2 → standfirst → content → proof → CTA.
10. **Sentence case everywhere.** Headlines 6–10 words, benefit-led; UPPERCASE reserved for tiny meta labels (Sched's 12px venue lines).

### Sched — key measured values (adopt-list)

- Inter; session title **16px/600/1.25**; time-rail labels 14px/400, letter-spacing −0.14px; body 18px/160% (marketing); h1 46px/700 → 36px tablet.
- Grays as variables: `--gray-50:#FAFAFA … --gray-900:#141414`; `--text-color: var(--gray-700)`; `--title-color: var(--gray-900)`.
- Agenda anatomy: ~100px time rail (time + TZ stacked, hairline divider) | session rows `radius 4px; border 1px #e5e5e5;` background = light track tint; row = save-toggle circle + title + UPPERCASE 12px gray venue line, nothing else; concurrency = side-by-side half-width blocks; day headers = **bold weekday** + regular date.
- Sticky on scroll: segmented **Event Schedule / My Schedule (count pill)** control (active segment `#e5e5e5`, radius 6, 14px/600, 40px tall) + View dropdown (Simple/Expanded/Grid/By Venue).
- Filter sidebar doubles as legend: Filter by Date / Venue / Type, one row per track with **10px color dot**, 31px quiet gray rows.
- Buttons: 14px/500, `padding .875rem 1.125rem`, radius 6, hover = 80%-alpha fade, `transition all .2s`.
- Weaknesses to beat: `user-scalable=no` (a11y violation — we will NOT do this), no per-day tabs in list view, aggressive join-gating of browsing.

### Whova — key patterns (adopt-list)

- Agenda: horizontal **date strip at top** → search bar → time-grouped rows with track tags + location + green live-camera indicator → per-row "Add to My Agenda" → separate My Agenda with reminders → filters date/track/location → ICS export → print-PDF fallback.
- Web portal: left sidebar with **grouped labeled sections**; in-session 3-zone layout (content center, right rail tabs: Q&A / Chat / Community).
- Mobile: bottom tab bar + event-home **launcher grid** of feature tiles for the long tail.
- Marketing: one rigid template per page; testimonial after EVERY feature block (headshot + name + title + org, bolded metric inside the quote); hyper-specific non-round numbers ("7,671 comments") as credibility; every CTA source-tagged.
- Their academic seams (retrofitted "Authors field", bolt-on abstract management) are exactly where UKEDL's first-class papers/authors can out-design them.

### EventPilot (ATIV) — key patterns (adopt-list; closest to our academic buyer)

- One hue + gray ramp: blue `#1679c2`/`#1a80b6`; grays `#141617/#212326/#434549/#606060/#f2f3f5/#fff`; page bg `#f2f3f5`, cards white, borders near-invisible.
- Product rows: **15px left category bar**, muted categorical palette (`#990f0f #c55113 #892264 #07662b #3964c0 #473bbd #673ab7 #50210b #505158`…), title 15.4px/400 `rgba(0,0,0,.87)`, meta 11.9px `#666`; detail opens in a right pane (master–detail) preserving list scroll.
- Facet bar for density: Now · Future · My Schedule · My Credits + Day/Type/Topic dropdowns, all combinable with global search; day chips.
- **Parent session → child presentation hierarchy surfaced in UI** (poster session opens into individually timed, schedulable presentations) — our sessions→papers model must be surfaced the same way.
- AI labeled honestly: small gray "AI Generated" badge + privacy framing. We already have `AiGeneratedChip` — keep and standardize.
- Domain-fluent voice: posters, abstracts, orals, embargoes, credits used unglossed. Quiet flat CTAs, thin large headings (Roboto 300), testimonial + ~18 society logos as trust.

---

## Part 2 — UKEDL design language (the decision)

**Positioning anchor: "calm, credible, academic."** Closest reference: EventPilot's restraint + Sched's agenda craft + Whova's shell architecture. We are NOT copying any one of them; we are adopting the invariants.

### Typography
- **Single family: Inter** (Google Fonts; already permitted by CSP: `style-src fonts.googleapis.com`, `font-src fonts.gstatic.com`). Weights loaded: 400, 500, 600, 700 only. `-webkit-font-smoothing: antialiased`.
- **Merriweather is retired from the app.** It may survive ONLY as an optional marketing-hero display face; default is Inter everywhere.
- Scale (px/line-height):
  - `--text-h1: 600 28px/34px` (app page titles) · marketing hero `700 44px/1.15` → 34px mobile
  - `--text-h2: 600 20px/28px` · `--text-h3: 600 16px/24px`
  - `--text-body: 400 14px/21px` (app default) · marketing body `400 17px/1.6`
  - `--text-meta: 400 12px/16px` · `--text-label: 500 13px/18px` · UPPERCASE only at meta size with `+0.04em` tracking
- Titles `var(--gray-900)`, body `var(--gray-700)`, meta `var(--gray-500)`. Never pure #000.

### Color
- **One accent: `--primary: #0033a0`** (UK blue — kept; it is a credible academic blue) with `--primary-600: #1a4fc4` (hover/links on white) and `--primary-50: #eef2fb` (selected/tint). Accent appears ONLY on: primary buttons, links, active nav item, focus rings, selection states.
- **Neutral gray ramp replaces all blue-tinted grays** (`#f3f6fb`/`#d9e1ee` are retired):
  `--gray-25:#fcfcfd --gray-50:#fafafa --gray-100:#f5f5f5 --gray-200:#e5e5e5 --gray-300:#d6d6d6 --gray-400:#a3a3a3 --gray-500:#737373 --gray-600:#525252 --gray-700:#424242 --gray-800:#292929 --gray-900:#161616`
- **Gold `#e8c547` is quarantined** to at most one decorative use on navy marketing surfaces. Never in-app, never as text on white.
- Semantic: `--success:#1e7a34 --danger:#c22f2f --warning:#b45309 --live:#34c46b`, each with a `-50` tint for backgrounds.
- **Track/category palette (10, muted, organizer-assignable):** `#0960ab #07662b #892264 #c55113 #473bbd #990f0f #0f766e #673ab7 #a16207 #505158` — used as 3px left bars on session rows and 10px legend dots. AA-checked against white.
- Surfaces: app page bg `--gray-50`, cards/panels `#fff` with `1px solid --gray-200`; marketing alternates `#fff` / `--gray-25`–`50` bands.

### Shape, depth, motion
- Radii: `--radius-sm: 4px` (cards, chips, rows) · `--radius-md: 6px` (buttons, inputs, segmented controls) · `--radius-lg: 10px` (marketing cards, modals). **No pills except count badges.**
- Shadows: `--shadow-1: 0 1px 2px rgba(16,24,40,.05)` (default card = usually none, border only) · `--shadow-2: 0 4px 6px -2px rgba(16,24,40,.03), 0 12px 16px -4px rgba(16,24,40,.08)` (modals/popovers only).
- Motion: `--transition: all .15s ease`; hover = background tint step or 80%-alpha fade; no bouncy/scale animations in-app.

### Layout architecture
- **Authed app shell (desktop ≥1024px): persistent left sidebar, 240px**, white on `--gray-50` canvas, grouped labeled nav (uppercase 11px `--gray-400` group labels): **Event** (Agenda, Attendees, Community, Maps, Messages) · **Organize** (shown by role: Overview, Sessions, CFP, Check-in, Sponsors, Analytics, AI tools) · **Account** (Profile, Notifications, Settings). Active item: `--primary-50` bg + `--primary` text + 2px left accent bar. Top bar: event switcher (name + chevron), global search, avatar menu. Content column max-width 1040px, left-aligned — **the centered-stack-of-cards layout dies in D1.**
- **Mobile (<768px): bottom tab bar** (Agenda · Attendees · Community · More) + sheet for the long tail; top bar collapses to event name + search icon.
- Master–detail where deep (agenda → session detail on desktop can be a right panel later; v1 = fast dedicated page, back preserves scroll).

### The agenda (signature surface — must reach Sched quality)
- Sticky context bar: segmented **Event Schedule / My Schedule (count pill)** (radius 6, active `--gray-200`, 14px/600, 40px) + day chips (per-day tabs — beating Sched) + view/timezone controls.
- Day headers: **bold weekday** + regular date, 15px, `--gray-600`.
- Time rail: 88px left column, 13px/400 `--gray-600`, time + TZ stacked, hairline right divider; times only at slot boundaries.
- Session rows: white, `1px solid --gray-200`, radius 4, **3px track color bar left edge**, padding 10–12px; anatomy = save-toggle circle (fills `--gray-900` with check when saved) · title 15px/600/1.3 `--gray-900` · meta line 12px `--gray-500` (time · room · track name) · paper count chip when session has papers ("3 papers"). Target ~72–84px/row, ~9–10 rows visible.
- Concurrent sessions side-by-side ≥768px. Filters (Day / Track / Room / Type + search) in a right sidebar ≥1280px with 10px color-dot legend rows; collapses to a Filters sheet below.
- **Session → papers hierarchy surfaced**: papers listed inside the session row's expanded/detail state with authors + individual times where present (the EventPilot parent/child pattern; our differentiator).

### Voice
Sentence case everywhere. Benefit-led, quantified, calm. Academic vocabulary unglossed (papers, posters, tracks, CFP, proceedings). AI outputs always carry the small gray "AI generated" chip. No exclamation marks in UI copy.

---

## Part 3 — Screen plan & chunk map

| Chunk | Surfaces | Outcome |
|---|---|---|
| **D1** | tokens.css, globals.css, _app, styleguide, app shell (dashboard + organizer layouts) | New design language live; sidebar shell; centered-card layout gone |
| **D2** | Dashboard agenda, /e/[slug] public schedule, session/[sessionId] | Signature agenda at Sched quality; session detail with papers/speakers |
| **D3** | Organizer surfaces (organizer/*, event dashboard tabs, panels), empty states, onboarding checklist | Dense, professional organizer console |
| **D4** | Marketing: index, pricing, login, help, legal, demo polish | Credible marketing site with real screenshots + trust section |
| **D5** | Mobile + PWA pass (bottom tabs, touch targets, manifest/icons, scanner) | Phone-quality experience; closes task #31 |

---

## Part 4 — Paste-ready Cursor prompts

> Paste ONE chunk at a time. After each: `npm test` in apps/api and apps/web must stay green, `npm run build` in both must pass, then STOP for screenshot review before the next chunk.

### Chunk D1 — Tokens, typography, app shell

```
Phase D Chunk 1 — design tokens + app shell. Read DESIGN_PHASE_D.md Parts 2–3 first; it is the spec and overrides any conflicting instinct.

SCOPE (hard limits): apps/web only. CSS, layout components, and page-level JSX structure. NO changes to: apps/api, prisma/, packages/*, any fetch/API call, any route path, any auth logic, next.config.js headers/CSP, lib/securityHeaders.js. All existing tests must pass unchanged except pure style assertions, which you may update to match the new tokens.

1. Rewrite apps/web/styles/tokens.css to implement Part 2 exactly: Inter (load weights 400/500/600/700 via Google Fonts <link> in _document or _app — CSP already allows fonts.googleapis.com/fonts.gstatic.com), the neutral gray ramp, --primary #0033a0 system, radii 4/6/10, shadow tokens, type scale, spacing scale (keep 4/8/12/16/24/32/48), track palette as --track-1..10. Keep the legacy alias variables working (map them onto the new values) so nothing breaks unstyle; delete Merriweather from the app (--font-display becomes Inter 600). Keep the slate theme block functional by mapping it onto the new ramp.
2. Update globals.css: body bg --gray-50, text colors per spec, antialiasing, focus-visible rings (2px --primary at 2px offset), button/input/chip base classes per Part 2 (buttons: 14px/500, radius 6, primary = --primary bg white text hover 85% alpha; secondary = white bg 1px --gray-300 border; ghost = text-only). Purge blue-tinted grays (#f3f6fb, #d9e1ee) and gold usage in-app.
3. Build the app shell per Part 2 "Layout architecture": create components/AppShell.tsx (left sidebar 240px with grouped labeled nav + top bar with event name, search placeholder, avatar menu) and apply it to pages/dashboard.tsx and pages/organizer/** so authed pages render inside it. Nav groups/items per spec; show Organize group only for organizer/admin roles (reuse whatever role info the pages already have — do not add API calls). Active item styling per spec. Below 768px render a bottom tab bar (Agenda/Attendees/Community/More) instead of the sidebar; More opens a simple sheet listing the remaining items. Content area: max-width 1040px, left-aligned, 24px padding — remove the centered narrow-column card stack.
4. Restyle the shared primitives to the new tokens: buttons, inputs, selects, tabs/segmented controls, chips (Chip/AiGeneratedChip), cards, tables, modals (ConfirmDialog), KebabMenu, ListState (empty states: icon + one sentence + one action, no giant boxes).
5. Rebuild pages/styleguide.tsx as the living reference: type scale, gray ramp swatches, buttons in all states, inputs, chips, a sample session row, sidebar nav item states.
6. Do NOT restyle the agenda internals, marketing pages, or organizer data tables yet (D2/D3/D4). It is fine for them to look transitional inside the new shell.

Acceptance criteria (I will screenshot-review against these):
- Inter renders everywhere in-app; zero serif text in the app; titles #161616, body #424242.
- Dashboard and organizer pages sit in the sidebar shell, left-aligned, on a #fafafa canvas with white bordered panels; no floating centered cards.
- Exactly one accent color visible (UK blue) plus grays; no gold, no yellow, no blue-tinted gray surfaces.
- Radii: nothing rounder than 10px anywhere in-app; buttons/inputs 6px; cards/chips 4px.
- Shadows near-invisible; separation is 1px #e5e5e5 borders and bg tint steps.
- styleguide page reflects all of the above.
Run: npm test (api + web), npm run build (api + web). Report what you changed; STOP for screenshot review.
```

### Chunk D2 — The agenda + session detail (signature surfaces)

```
Phase D Chunk 2 — agenda + session detail. Read DESIGN_PHASE_D.md Part 2 ("The agenda") — implement it exactly. Same hard scope limits as D1 (apps/web only; no API/data/route changes; use the data each page already fetches).

1. Rebuild the schedule views — the dashboard Agenda tab and the public event page (pages/e/[slug].tsx) — to the specified anatomy: sticky context bar (Event Schedule / My Schedule segmented control with count pill + day chips + timezone/view controls), bold-weekday day headers, 88px time rail with hairline divider and slot-boundary-only times, session rows (white, 1px --gray-200 border, radius 4, 3px track color bar, save-toggle circle, 15px/600 title, 12px --gray-500 meta line: time · room · track, paper-count chip when papers exist). Track colors: assign from --track-1..10 deterministically (hash track id) unless the event defines colors. Concurrent sessions side-by-side ≥768px; single column below. Density target ~9-10 rows per 800px viewport.
2. Filters: right sidebar ≥1280px (search, day, track rows with 10px color dots doubling as legend, room, type), collapsing to a "Filters" button + sheet below 1280px. Wire to the existing client-side filter logic (lib/agendaFilters.ts) — do not change its API.
3. Session detail (pages/session/[sessionId].tsx): back link preserving scroll, title 20px/600, meta block (time with timezone, room, track chip in its track color), description, then PAPERS as a first-class section — each paper: title 15px/600, authors 13px --gray-600, individual time if present, resources/links — then speakers (avatar + name 14px/500 + affiliation 12px), then Q&A/feedback modules restyled to tokens. This parent-session → child-paper presentation is our academic differentiator; make it feel deliberate (EventPilot pattern).
4. The public /e/demo page must look excellent with the seeded demo data — it is the sales surface. Check it renders beautifully at 375px, 768px, 1440px.
5. Empty states per ListState pattern; loading states as subtle skeleton rows (no spinners in content areas).

Acceptance criteria:
- A stranger comparing our /e/demo schedule to a *.sched.com event should judge ours at least as professional.
- ~9-10 session rows visible per screen; every row shows track color bar + title + meta in under 84px height.
- My Schedule count pill updates when toggling the save circle (existing logic — do not change it, just style it).
- Papers render inside sessions with authors, on both public page and session detail.
- No layout shift when the sticky bar pins; time rail aligns across day groups.
Run tests + builds; STOP for screenshot review at 375/768/1440px.
```

### Chunk D3 — Organizer console + empty states

```
Phase D Chunk 3 — organizer surfaces. Same hard scope limits (apps/web only, no data-layer changes). Read DESIGN_PHASE_D.md Parts 1-2; the model is a calm enterprise console (EventPilot restraint, Whova grouping).

1. Organizer home (pages/organizer/index.tsx): events as a proper table/list (name, dates, status chip, attendee count from existing data) with one primary "New event" button — not card tiles.
2. Event organizer dashboard (pages/organizer/events/[eventId]/index.tsx) and its tabs/panels (sessions, cfp, sponsors, scanner, analytics, ingest, ai panels: OpsInboxPanel, RecapPanel, MatchmakerPanel, OnboardingPanel, FeatureConfigPanel, etc.): apply the shell content patterns — page title row (28px/600 + primary action right-aligned), section panels (white, 1px border, radius 4, 16-20px padding, 13px/600 uppercase-meta section labels), dense data tables (13-14px rows, 40-44px row height, --gray-100 header band, right-aligned numerics), forms in single-column 560px max with 13px/500 labels above inputs.
3. The dashboard "Getting started" checklist: restyle as a compact dismissible panel with progress (thin bar, --primary), not a hero block.
4. Every empty state in organizer surfaces: icon (Material Symbols outline or existing), one sentence, one action button. Every AI-generated output keeps/gains the small gray "AI generated" chip (AiGeneratedChip) consistently placed top-right of its panel.
5. Status/system colors: use semantic tokens only (success/danger/warning/live + -50 tints) for chips like PUBLISHED/DRAFT/PENDING; never the track palette.

Acceptance criteria:
- Organizer screens read as one product: same panel anatomy, same table density, same label style everywhere.
- Zero centered narrow layouts; content fills the 1040px column with purposeful hierarchy.
- All AI surfaces visibly labeled; all empty states follow the one-sentence + one-action pattern.
Run tests + builds; STOP for screenshot review.
```

### Chunk D4 — Marketing site

```
Phase D Chunk 4 — marketing surfaces: pages/index.tsx, pricing.tsx, login.tsx, help/*, terms/privacy/security, 404/500. Same hard scope limits. Read DESIGN_PHASE_D.md Part 1 (marketing patterns) + Part 2. Brand voice: calm, credible, academic; sentence case; quantified; no hype.

1. Homepage: rebuild on the proven section template — nav (logo, Product, Pricing, Help, Sign in, primary "Create your event" button) → hero (44px/700 Inter headline: benefit-led, e.g. "Paste your program. Your event is live." kept/refined; 17px standfirst; primary + ghost CTA pair; RIGHT SIDE: a real screenshot of the /e/demo schedule in a browser frame — build the frame in CSS, screenshot supplied later, use a styled placeholder that renders the actual agenda component with demo-like static data if a screenshot asset is absent) → alternating white/--gray-25 sections each with eyebrow (13px/600 --primary uppercase) + sentence-case H2 (32px/600) + standfirst + content → feature trio for academic events (papers & authors first-class, AI program ingest with "AI generated, always reviewable" framing, calm attendee experience) → how-it-works in 3 steps → honest trust section (security page link, no fabricated logos/testimonials/numbers — use real facts only: open pricing, data export, no ads/no attendee-data monetization from brand.productPrinciples) → dual CTA band → footer (grouped links: Product/Resources/Legal + support email).
2. Pricing: clean 3-tier cards (radius 10, 1px border, popular tier with --primary border + small chip), feature rows with checkmarks, FAQ accordion beneath, honest copy from existing plans data in packages/shared (display only — no logic changes).
3. Login page: single centered 400px card on --gray-25, logo, Inter, tokens; kill any remaining legacy styling; error/success states per semantic tokens.
4. Help/legal pages: readable 720px prose column, 17px/1.6, styled headings, TOC where long.
5. SEO/polish: consistent <title>/<meta description> per page from brand config; og tags for homepage + demo.
CRITICAL: absolutely no fabricated testimonials, logos, review counts, or user numbers. Credibility through specificity of what is TRUE.

Acceptance criteria:
- Homepage at 1440px and 375px reads as a credible SaaS peer of sched.com; hero shows real product UI.
- Every section follows eyebrow/H2/standfirst rhythm; exactly one accent color; sentence case throughout.
- No invented social proof anywhere.
Run tests + builds; STOP for screenshot review.
```

### Chunk D5 — Mobile + PWA pass

```
Phase D Chunk 5 — mobile + PWA. Same hard scope limits. Goal: phone-quality experience; this closes the manual PWA pass.

1. Audit every app surface at 375px and 390px: bottom tab bar correctness, 44px minimum touch targets, no horizontal scroll, sticky bars behave under iOS safe-area (env(safe-area-inset-*)), inputs ≥16px font-size to prevent iOS zoom. Keep pinch-zoom ENABLED (no user-scalable=no — accessibility).
2. Agenda on mobile: day chips scroll horizontally; filter sheet slides from bottom; session rows full-width; save toggle thumb-reachable.
3. PWA: verify manifest (name/short_name from brand config, theme_color --primary, bg #fafafa), icons render (192/512/apple-touch), service worker offline fallback page styled to tokens; add-to-home-screen meta correct.
4. QR scanner page (organizer/events/[eventId]/scanner.tsx): full-bleed camera, high-contrast status states (success green flash / danger red), large result text — usable in a conference hallway.
5. Dark-ish surfaces check: event banner/header areas keep AA contrast.

Acceptance criteria: I will test on a real phone: install to home screen, browse demo agenda, save sessions, run the scanner. No horizontal scroll anywhere; all taps land; keyboard never covers active input.
Run tests + builds; STOP for founder phone test.
```

---

## Part 5 — Review protocol (every chunk)

1. Cursor finishes → run `npm test` + `npm run build` in apps/api and apps/web.
2. Founder screenshots every changed surface at 375px and 1440px (agenda surfaces also 768px).
3. External review against the chunk's acceptance criteria + Part 1 invariants (the 10-point lists are the rubric).
4. Iterate within the chunk until passed; only then commit (`design: D<N> — <summary>`) and proceed.
5. Ship to production only after D2 (shell alone looks transitional); D1+D2 deploy together.
