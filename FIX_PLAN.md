# Fix plan — customer-test findings (Phase E)

Source: CUSTOMER_TEST_FINDINGS.md. Two parallel tracks.
**Track A = configuration only Chris can do** (accounts, keys, DNS — no code).
**Track B = code chunks E1–E4 for Cursor** (each apps/web or narrow API; tests + builds green; screenshot review between chunks).

Key discovery that de-risks everything: the API **already exposes** `PUT`/`DELETE` for tracks, rooms, sessions, speakers and `PATCH`/`PUT` for events. Every organizer-editing fix below is **web-only** — wiring existing endpoints, no schema, no migrations.

---

## Track A — configuration (do first; DNS takes time to propagate)

### A1. Resend — unblocks P0 #1 (signup verification), plus invites, password resets, digests
1. Create an account at resend.com (free tier: 3,000 emails/month, 100/day — ample to start).
2. **Domains → Add Domain → `ukedl.com`.** Resend shows 3–4 DNS records (DKIM `resend._domainkey`, SPF/MX on `send`, and a DMARC suggestion).
3. Add those records in your DNS panel (same place you added the CNAME for `api.ukedl.com`). Keep the exact host/value strings; don't append the domain twice.
4. Back in Resend, click **Verify** (propagation is usually minutes, occasionally an hour).
5. **API Keys → Create API Key** (name: `ukedl-prod`, permission: Sending access). Copy it once.
6. **Render → docweeksched-api → Environment** → add:
   - `RESEND_API_KEY` = the key
   - `EMAIL_FROM` = `UKEDL <noreply@ukedl.com>` (must be on the verified domain)
   - `EMAIL_PROVIDER` = `resend`
   Save → service redeploys.
7. Verify end-to-end: register a brand-new account with a real inbox → confirm the verification email arrives → click through → sign in. **This is the acceptance test for P0.**

### A2. Anthropic key — makes the AI claims true (P1 #4)
1. console.anthropic.com → API keys → create key.
2. Render env: `ANTHROPIC_API_KEY` = key, `AI_PROVIDER` = `anthropic`. Save.
3. Test: organizer → Agenda ingest → paste a real program → confirm a review changeset appears with sessions/papers.
4. Watch cost via the existing AI usage page; per-plan caps/metering are already implemented.

### A3. Lemon Squeezy (P0 #2) — only when you're ready to accept money
Store + products matching the six catalog SKUs, live keys, webhook → `https://api.ukedl.com/billing/webhook`, then env: `LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_STORE_ID`, `LEMON_SQUEEZY_WEBHOOK_SECRET`. Until then E1 ships the honest interim copy.

### A4. Status page (P3 #18)
Either stand up a real status page (Better Stack / Instatus free tiers) and point `statusPageUrl` at it, or remove the footer link until it exists. E1 removes it by default.

---

## Track B — code chunks for Cursor

### Chunk E0 — THE ACQUISITION BLOCKERS (do before E1)

Both items were found by the independent logged-out audit (CUSTOMER_TEST_FINDINGS.md Part 2) and verified in code. Together with the email lockout they are the reason a motivated buyer cannot currently become a customer.

```
Chunk E0 — acquisition blockers. Read CUSTOMER_TEST_FINDINGS.md Part 2 first. Scope: apps/web only (no API changes needed — verified: POST /organizations requires only requireAuth and makes the creator OWNER; POST /event requires org STAFF, which OWNER satisfies). No schema changes. Tests + builds green.

1. SIGNUP FORM NO LONGER TURNS AWAY ORGANIZERS (pages/login.tsx). Today the register form's account-type select offers only "Participant" and "Organizer (invite code)", and choosing the latter demands a required Admin invite code with no way to obtain one — so every prospective organizer hits a dead end. That invite code belongs to /auth/register-admin, which mints the LEGACY GLOBAL PLATFORM-ADMIN role and must never be offered to customers. Fix:
   - Remove the "Organizer (invite code)" option and the Admin invite-code field from the public register form entirely. Everyone registers via /auth/register.
   - Keep /auth/register-admin reachable ONLY via an explicit private query flag (e.g. /login?admin=1) that is not linked from anywhere in the UI, so the founder can still create a platform admin.
   - Explain the model in one line under the account-type control: "Anyone can create events — after you sign in, choose Create your event."
2. ORGANIZER ONBOARDING PATH AFTER SIGNUP. When a signed-out visitor clicks any "Create your event" / "Start free" CTA, carry that intent through: send them to registration (see E3 item 3 signup-first), and after successful sign-in route them to /organizer/org/new (or straight to /organizer/events/new if they already belong to an org) rather than the attendee dashboard. Use a query param or stored intent — do not change auth logic.
3. HOMEPAGE INGEST DEMO MUST NOT SILENTLY TRUNCATE (components/marketing/HeroIngestDemo.tsx). Line ~32 hard-caps extraction at `out.slice(0, 8)` with no indication, so a pasted 14-line program visibly loses 6 items — in the public proof of our central claim. Fix: raise the display cap to at least 20 rows; if the input still exceeds the cap, render an explicit note ("Showing 20 of 34 lines — the full importer handles the rest"); and preserve concurrent/parallel sessions as separate rows instead of collapsing them into one. Keep it browser-local and keep the existing "Local demo only" disclosure.
4. DEMO EVENT DATE DISPLAY (pages/e/[slug].tsx and anywhere else an event's date range is rendered): a multi-day event currently renders as a single date plus a time range ("Mon, Jul 20, 2026 · 7:00 AM–2:00 PM") even though the event spans three days. When startDate and endDate fall on different calendar days in the event timezone, render the full range ("Mon, Jul 20 – Wed, Jul 22, 2026"); keep the single-day + time format only for genuinely single-day events.
5. GRID / BY-ROOM BLOCKS MUST NOT LIE ABOUT INTERACTIVITY: on surfaces where a session block cannot be opened (the public event page), render it as a non-interactive element — no button role, no pointer cursor, no focus ring. Where it can be opened (the dashboard), keep it a real control that navigates. Never present a button that does nothing.

Acceptance: a signed-out stranger can click "Create your event", register, and land on organization/event creation without ever seeing an invite-code field; pasting a 14-line program into the homepage demo shows all of it (or an honest truncation note) with parallel sessions preserved; /e/demo shows its true three-day range; no dead buttons in grid/by-room. Run npm test + npm run build in both apps, report, STOP for screenshot review.
```

### Chunk E1 — Honesty & unblocking (P0/P1 that are code-side)

```
Chunk E1 — customer-test fixes: honesty and unblocking. Read CUSTOMER_TEST_FINDINGS.md for context. Scope: apps/web + narrow apps/api changes as specified. No schema changes, no migrations. Tests + builds green in both apps.

1. EMAIL FALLBACK FOR REGISTRATION (apps/api routes/auth.ts + apps/web): today register() sets emailVerifiedAt=null and login 403s EMAIL_NOT_VERIFIED, but when the email provider is unconfigured the verification mail is never sent — new users are permanently locked out. Fix: in the register handler, capture the result of sendEmailVerificationEmail. If the provider reports delivered=false (unconfigured), return the verify URL in the response as `verifyUrl` plus `emailDeliveryUnavailable: true` (mirror the existing invite copyUrl/EMAIL_COPY_FALLBACK pattern). Never return verifyUrl when delivery succeeded. On the web signup screen, when emailDeliveryUnavailable is true, show a clear panel: "Email delivery isn't configured yet — use this link to verify your account" with the link. Add a test asserting: unconfigured provider → response includes verifyUrl; configured provider → it does not.
2. ENV PREFLIGHT WARNING (apps/api lib/env.ts): add a startup warning when NODE_ENV=production and RESEND_API_KEY is missing: "RESEND_API_KEY missing — self-serve registration cannot complete without the verify-link fallback." Same existing degraded-warning style as the other optional integrations.
3. HELP INDEX (apps/web pages/help/index.tsx): it currently renders only a heading and a sentence about future search. Render the actual article list from lib/help/articles.ts (title + one-line description + link per article), grouped if the data supports it. Delete the "Full-text search arrives in a later release" sentence.
4. BILLING HONESTY (apps/web pages/pricing.tsx + organizer/billing.tsx): when checkout is not configured (no Lemon Squeezy env), replace "Sign in to upgrade" CTAs with "Contact support@ukedl.com to purchase" mailto links and a single quiet line: "Self-serve checkout is opening soon — email us and we'll set you up." Detect via an existing billing-config flag if one is exposed; if not, add a public GET /billing/config returning { checkoutEnabled: boolean } (no secrets) and use it.
5. INGEST ERROR STATES (apps/web pages/organizer/events/[eventId]/ingest.tsx): the paste/URL/file flows can currently finish silently with no visible result. Fix: (a) show a progress indicator while polling; (b) if the run ends with an empty changeset, render an explicit empty state — "No sessions found in that text. Include times like '9:00–10:15' and one session per line, then try again."; (c) if polling exhausts its retries, say so and offer Retry rather than leaving the page unchanged; (d) surface run.error text whenever present.
6. ORGANIZER ON PUBLIC PAGES (apps/web pages/e/[slug].tsx): show "Hosted by {organization name}" under the event title. Use the organization name if the public event payload already includes it; if it does not, add it to the public event serializer in apps/api (name only — no other org fields).
7. FOOTER STATUS LINK (apps/web marketing footer): remove the Status link until a real status page exists — status.ukedl.com currently returns 502 Bad Gateway, which reads to a visitor as "the product is down". Also remove/adjust any reference to it in the security page's incident guidance.
8. PROCUREMENT DOWNLOADS (apps/web/public/legal/*): /legal/dpa.pdf and /legal/hecvat-lite.pdf are placeholders and may still carry the old "Colloquium" name. Until real documents exist, remove the download links from /security (keep the section heading with "available on request — email support@ukedl.com"). Check both PDFs for stale naming and report what you find.
9. PRICING CLARITY (pages/pricing.tsx): for the 51–250 attendee band, Pro at $79/mo is both cheaper and more capable than the $149 per-event tier, so the per-event option is currently irrational. Add a short "Which plan?" guidance block (e.g. "Under 50 attendees: Free. One event this year: per-event. Two or more events, or you want the full AI suite: Pro.") and one FAQ line answering what happens to a published event when a Pro subscription is cancelled (it stays published/read-only vs. reverts to Free caps — state whatever the entitlement code actually does; check billing/entitlements.ts and describe it accurately).

Acceptance: registering with email unconfigured yields a usable verify link; /help lists real articles; pricing/billing never promise a checkout that cannot complete; a failed or empty ingest always ends in a visible message; public event pages name the host. Run npm test + npm run build in both apps, report, STOP for review.
```

### Chunk E2 — Organizer editing (the daily-reality gap)

```
Chunk E2 — organizer editing. Scope: apps/web ONLY (the API already exposes PUT/DELETE for tracks, rooms, sessions, speakers and PATCH/PUT for events — wire the existing endpoints; do not add or change API routes). No schema changes. Tests + builds green.

1. PROGRAM TAB EDIT/DELETE (organizer/events/[eventId] Program panel): tracks, rooms, sessions, and papers currently render as read-only bullet lists. Give each row inline Edit and Delete:
   - Track: rename + change color (PUT /tracks/:id), delete (DELETE) with confirm; if the track is in use, explain what happens to those sessions.
   - Room: rename (PUT /rooms/:id), delete (DELETE) with confirm.
   - Session: edit title, start, end, track, room (PUT /sessions/:id); delete with a ConfirmDialog naming the session and warning that papers/attendance under it are affected.
   - Paper: edit title + authors (preserving author order), delete, using the existing paper endpoints.
   Use ConfirmDialog for every destructive action; show inline errors per row; optimistic update or refetch — never leave stale rows.
2. EVENT SETTINGS PANEL (organizer Overview): add a "Event settings" panel that edits name, description, dates (start/end), timezone, venue name, venue address, online URL, and brand color via the existing event PATCH/PUT endpoint — the wizard's inputs are currently unreachable after creation. Single-column form, max 560px, one primary Save, inline validation errors, success confirmation.
3. TIMEZONE PICKER (event settings + create wizard): replace the free-text timezone input with a searchable select of IANA timezones (Intl.supportedValuesOf('timeZone') when available, with a curated fallback list), defaulting to the browser zone. A typo here silently shifts every session time for every attendee.
4. SLUG PREVIEW (create wizard): as the user types the event name, live-preview the slug that will be generated ("Link will be ukedl.com/e/my-conference-2026") and keep it in sync until the user edits the slug field manually.
5. DATE SANITY WARNINGS (session create/edit): if a session's start/end falls outside the event's start/end window, show a non-blocking warning ("This is outside your event dates — is that right?"). Do not block saving.
6. PUBLISH GUARD (organizer Overview): if the event has zero sessions, the Publish button opens a confirm: "This event has no sessions yet. Attendees will see an empty schedule. Publish anyway?"

Acceptance: an organizer can fix a typo in a track, move a session to another room, correct the event's dates and timezone, and delete a mistaken paper — all without re-running the wizard or touching the database. Run npm test + npm run build in both apps, report, STOP for review.
```

### Chunk E3 — Import fallback + attendee/organizer clarity

```
Chunk E3 — CSV import and clarity fixes. Scope: apps/web + additive API endpoint if needed. No schema changes. Tests + builds green.

1. CSV SESSION IMPORT (organizer Program tab + ingest page): a non-AI import path for organizers who already have a spreadsheet. Provide a downloadable CSV template (title,start,end,track,room,speakers,description) and an upload that parses client-side, shows a preview table with per-row validation errors, and creates sessions via the existing POST /sessions endpoint on confirm. Reuse the ReviewChangeset component's look so it matches AI ingest. Never create anything without an explicit confirm step.
2. SPEAKERS VS PAPERS EXPLANATION: add one line of helper text on both panels clarifying the model — speakers present sessions; paper authors are listed under papers inside a session; a person can be both.
3. SIGNUP-FIRST CTA (apps/web marketing): "Create your event" for a signed-out visitor should land on a signup screen (or /login?mode=register with the register form shown first), not the sign-in form.
4. LAST-UPDATED DATES: add "Last updated {date}" to /terms, /privacy, /security, sourced from a constant, not the render date.
5. DEMO FIXTURE ROOMS (apps/api/src/lib/demoEvent/fixture.ts): the demo event defines no rooms, so the By-room view groups every session under "No room" on our flagship demo. Add 3–4 realistic rooms (e.g. Hall A, Room 214, Room 108, Gallery) and assign sessions to them so the By-room view demonstrates itself. Re-run the demo seed afterwards.
6. EVENT STRUCTURED DATA: add schema.org JSON-LD (type Event) to public event pages — name, startDate, endDate, location, organizer, url — so shared links and search results render richly.
7. OG/SOCIAL PREVIEW for public event pages (pages/e/[slug].tsx): og:title = event name, og:description = short description, og:image = event banner if set, else the UKEDL default; twitter:card summary_large_image. Event links shared in email/Slack should preview properly.

Acceptance: an organizer with a spreadsheet can populate a program without AI; shared event links preview correctly; legal pages carry dates. Run npm test + npm run build in both apps, report, STOP for review.
```

### Chunk E4 — Wizard robustness (small, after E1–E3 land)

```
Chunk E4 — wizard robustness. apps/web only. Tests + builds green.
1. The create-event wizard loses typed input if the page re-renders mid-entry (observed: name/description/slug cleared once during testing). Investigate the loading/auth remount on pages/organizer/events/new.tsx and make form state resilient — hold values in state that survives the remount, and don't render the form until the org list has resolved.
2. Make the wizard's Back button preserve everything already entered on later steps.
3. After "Draft created", add a "Edit event details" link alongside Build the program / Back to dashboard, pointing at the new Event settings panel from E2.
Acceptance: filling the wizard while the page is still settling never loses input; Back/Next preserves values. Report, STOP.
```

---

## Order of operations
0. **E0 first** — the acquisition blockers (signup form + homepage demo truncation). Cheapest, highest-impact code in the whole plan.
1. **A1 Resend now** (DNS propagates while you do other things) → then the P0 acceptance test.
2. **E1 into Cursor** in parallel with A1 — it makes the app honest even before Resend is verified.
3. **A2 Anthropic key** → re-test ingest → confirms the marketing claim.
4. **E2** — the biggest organizer quality-of-life win.
5. **E3**, then **E4**.
6. **A3 Lemon Squeezy** whenever you're ready to charge; **A4** status page anytime.
