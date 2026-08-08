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
   - `RESEND_FROM_EMAIL` = `UKEDL <noreply@mail.ukedl.com>` (var name is `RESEND_FROM_EMAIL`, NOT `EMAIL_FROM` — verified in code, `lib/mail.ts`/routes read `RESEND_FROM_EMAIL`; address must be on the verified sending domain, which is `mail.ukedl.com`, already DKIM+SPF verified in Resend)
   - `EMAIL_PROVIDER` = `resend`
   Save → service redeploys.
7. Verify end-to-end: register a brand-new account with a real inbox → confirm the verification email arrives → click through → sign in. **This is the acceptance test for P0.**

### A2. Anthropic key — makes the AI claims true (P1 #4)
1. console.anthropic.com → API keys → create key.
2. Render env: `ANTHROPIC_API_KEY` = key, `AI_PROVIDER` = `anthropic`. Save.
3. Test: organizer → Agenda ingest → paste a real program → confirm a review changeset appears with sessions/papers.
4. Watch cost via the existing AI usage page; per-plan caps/metering are already implemented.

### A3. Billing — NOW STRIPE MANAGED PAYMENTS (decided 2026-08-02; supersedes Lemon Squeezy)
Lemon Squeezy is in wind-down after the Stripe acquisition (LS's own Jan-2026 update: slower support, migration paths prioritized). Building a new integration there = signing up for a forced migration. Decision: **Stripe Managed Payments** (Stripe as merchant of record — tax in 80+ countries, disputes, fraud; publicly available in preview; enabled per Checkout Session via `managed_payments.enabled`). Chris already has the Stripe account (sandbox created 2026-08-02 — rename the auto-named "Fundly" account to UKEDL in Settings → Business details).
Steps: (1) Cursor implements chunk E5 below; (2) in the Stripe TEST dashboard create 5 products/prices matching the catalog in `packages/shared/src/plans.ts` — Per-event 250 $149 one-time, Per-event 500 $249 one-time, Per-event 1000 $399 one-time, Pro Monthly $79/mo recurring, Pro Annual $790/yr recurring — and record each `price_...` ID; (3) register a TEST webhook endpoint → `https://api.ukedl.com/billing/webhooks/stripe` (events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded, invoice.payment_failed), record the `whsec_...`; (4) Render env: `BILLING_PROVIDER=stripe`, `STRIPE_SECRET_KEY` (sk_test_... for now), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PER_EVENT_250/500/1000`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`; (5) acceptance test: buy Pro Monthly with card 4242 4242 4242 4242 on production → webhook fires → org entitlements flip to Pro → portal opens → then swap to live keys + live webhook after Stripe business activation (EIN/SSN + bank).

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
10. AI MODEL FALLBACK + FRIENDLY ERROR (apps/api lib/ai/providers/anthropic.ts + ingest UI): the hardcoded default model "claude-sonnet-4-20250514" is retired — production 404'd until AI_MODEL=claude-sonnet-5 was set in env (2026-07-31). Update the fallback to "claude-sonnet-5" and add a boot-time preflight warning when the configured model 404s. In the ingest UI, never render a raw provider-error JSON blob ({"type":"not_found_error"...}) to the organizer — map provider failures to a plain-English message ("The AI provider rejected the request — the team has been notified. Try again shortly.") while logging the raw error server-side.
11. CONFIDENCE LABEL (ingest changeset UI): every row currently shows a uniform "(confidence 0.50)" placeholder, which reads as the AI being unsure of everything. Either surface the real per-item confidence if the extraction payload provides one, or remove the label entirely. Do not display a constant.

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
7. PROGRAM TAB LAYOUT + GROUPING: the current tab is undifferentiated bullet lists with add-forms jammed inline between content (founder feedback 2026-07-31: "text and stuff all over the place"). Restructure: tracks/rooms as compact tables or chip rows; sessions grouped by day with clear day headers; add-forms collapsed behind an "+ Add" affordance per section instead of always-open forms mid-page.
8. ORGANIZER TIMES IN EVENT TIMEZONE: organizer Program lists currently render session times in the browser's local timezone (a 9:00 AM PDT session showed as 11:00 AM CDT for the founder). On organizer surfaces, display times in the EVENT's timezone with the zone labeled; optionally offer a local-time toggle. Verified during the 2026-07-31 AI acceptance test.
9. INGEST ZERO-CREATE PRESENTATION (ingest review): when a run creates 0 sessions but existing sessions generate delete proposals, the review currently leads with "13 delete proposed", which reads as data loss to a nervous organizer. When creates == 0, lead with the empty-state explanation and collapse the propose-delete list behind a disclosure ("13 existing sessions not found in this import — review deletions").

Acceptance: an organizer can fix a typo in a track, move a session to another room, correct the event's dates and timezone, and delete a mistaken paper — all without re-running the wizard or touching the database; the Program tab reads as organized sections, not interleaved lists and forms; organizer times match the event timezone. Run npm test + npm run build in both apps, report, STOP for review.
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


### Chunk E5 — Stripe Managed Payments provider (replaces Lemon Squeezy; decided 2026-08-02)

```
Chunk E5 — implement a Stripe billing provider behind the existing BillingProvider interface. Read apps/api/src/lib/billing/types.ts, index.ts, lemonSqueezy.ts, webhooks.ts, entitlements.ts and apps/api/src/routes/billing.ts FIRST — the abstraction was built for exactly this ("Stripe/Paddle can implement the same surface later"). Scope: apps/api only; apps/web should need no changes (it consumes /billing/config and /billing/summary). Prefer NO new npm dependency: use fetch against the Stripe API and node:crypto for webhook signature verification, mirroring how the Lemon Squeezy provider works; if you conclude the official `stripe` package is genuinely necessary, STOP and say why before adding it.

1. StripeBillingProvider (new file lib/billing/stripe.ts) implementing BillingProvider:
   - isConfigured(): STRIPE_SECRET_KEY + all five STRIPE_PRICE_* env vars present.
   - createCheckout(): POST /v1/checkout/sessions with the price for input.planKey (map per_event_250/500/1000 → mode=payment, pro_monthly/pro_annual → mode=subscription), managed_payments[enabled]=true, success/cancel URLs from input, customer_email, and metadata orgId/planKey/eventId (also into subscription_data.metadata / payment_intent_data.metadata so webhooks can recover them). Return session url + id.
   - createCustomerPortal(): POST /v1/billing_portal/sessions.
   - verifyWebhook(): implement Stripe-Signature verification manually (parse t= and v1=, HMAC-SHA256 of `${t}.${rawBody}` with STRIPE_WEBHOOK_SECRET, constant-time compare, reject stale timestamps >5min). Return VerifiedWebhook with provider "STRIPE".
   - listInvoices(): GET /v1/invoices?customer=... mapped to the interface shape (best effort).
2. Provider selection (lib/billing/index.ts): BILLING_PROVIDER=stripe → StripeBillingProvider (unconfigured → UnconfiguredBillingProvider in production, mock in dev, same pattern as LS).
3. Webhook route + mapping: add POST /billing/webhooks/stripe (raw-body route, same middleware approach as the LS webhook). In webhooks.ts, map checkout.session.completed / customer.subscription.updated / customer.subscription.deleted / invoice.payment_succeeded / invoice.payment_failed onto the SAME entitlement transitions the LS events drive today (purchase recorded, org plan set, cancellation → revert to Free per existing behavior). Reuse the existing idempotency store (BillingWebhookEvent) keyed on Stripe's event id.
4. Types: extend VerifiedWebhook.provider union with "STRIPE". If the Prisma BillingWebhookEvent.provider column is an enum requiring a new value, that is an ADDITIVE migration — create it (ALTER TYPE ... ADD VALUE), flag it clearly in your report, and follow expand-then-deploy discipline. If it's a string column, no migration.
5. Env documentation: add the six new vars to .env.example with the same comment style; preflight (lib/env.ts) warning for production-with-BILLING_PROVIDER=stripe-but-missing-keys, mirroring existing billing warnings.
6. Tests: unit-test the signature verifier (valid, tampered body, stale timestamp), the planKey→price/mode mapping, and the webhook→entitlement mapping for checkout.session.completed and customer.subscription.deleted, mirroring the existing LS webhook tests. Do NOT set ALLOW_DESTRUCTIVE_DB (per .cursor/rules).

Acceptance: with BILLING_PROVIDER=stripe and test keys set, /billing/config reports checkoutEnabled true; createCheckout returns a session URL for every SKU; a simulated signed webhook flips org entitlements exactly as the LS path did; all existing LS tests still pass (the LS provider remains intact and selectable). Run npm test + npm run build in both apps, report, STOP for review.
```


### Chunk E5.1 — persist the purchased SKU (label bug found in live billing test, 2026-08-02)

```
Chunk E5.1 — small, surgical. Bug found during the production test-mode billing test: buying Pro Monthly ($79, correct charge, correct entitlements) renders as "Pro · Annual" on /organizer/billing. Root cause (verified): applyPlanSkuToOrg (lib/billing/entitlements.ts) stores only def.tier on the Organization; the billing snapshot then reconstructs planSku via defaultSkuForTier(plan), which returns pro_annual for PRO. The purchased SKU is never persisted.

Fix:
1. ADDITIVE migration: add nullable `planSku String?` to the Organization model (expand-then-deploy; no backfill required — null falls back to the old derivation).
2. applyPlanSkuToOrg: persist the sku it was called with.
3. Entitlements snapshot: use the stored planSku when present; fall back to defaultSkuForTier(plan) when null (grandfathers all existing orgs).
4. Tests: applySubscriptionActive with pro_monthly → snapshot.planSku === "pro_monthly"; same for pro_annual and per_event_500 via applyOrderPaid; null-column fallback still returns defaultSkuForTier.
5. Do NOT touch checkout, webhooks' event handling, or the LS path beyond what applyPlanSkuToOrg already shares. Do NOT set ALLOW_DESTRUCTIVE_DB.

Acceptance: after deploy, a fresh Pro Monthly test purchase renders "Pro · Monthly · $79/mo" on the billing page; existing orgs' labels unchanged. npm test + builds green in both apps, report, STOP.
```


### Chunk E6 — post-provider polish sweep (unlocked by the 2026-08-02 config work)

```
Chunk E6 — small web-side sweep now that Stripe, the status page, and monitoring are live. Scope: apps/web + packages/config ONLY (remember both packages compile to dist; the api build script already rebuilds them — do not point main at src). No API routes, no schema. Tests + builds green in both apps.

1. LEMON SQUEEZY COPY SWEEP: replace every remaining customer-facing "Lemon Squeezy" mention with provider-neutral or Stripe wording. Known locations: pricing.tsx FAQ ("Checkout and refunds are handled by Lemon Squeezy (merchant of record)…" → "Checkout, tax, and refunds are handled by Stripe (merchant of record)…"), organizer/billing.tsx Invoices box ("Invoices appear here from Lemon Squeezy after purchases." → "Invoices appear here after purchases."), and terms.tsx / any legal or help copy naming the payment processor. Grep the whole of apps/web for "Lemon" and fix every hit; report the list.
2. STATUS PAGE RETURNS: in packages/config, set statusPageUrl to "https://ukedl.betteruptime.com" (it currently points at the dead status.ukedl.com). Restore the footer Status link in SiteFooter.tsx (E1 removed it with an explanatory comment — the real page now exists). Re-add the status-page reference in the security page's incident section and the help Contact article where E1 removed them.
3. SIGNED-IN PRICING CTAs (customer-test finding #17): on /pricing, when the visitor is signed in (the page already knows checkout state via /billing/config; detect auth via the existing session/user hook used elsewhere in the app — inspect how the header decides logged-in state and reuse it), paid-tier CTAs should read "Upgrade" and link to /organizer/billing (org context chooser lives there) instead of "Sign in to upgrade" → /login. Signed-out behavior unchanged.
4. SUBPROCESSOR LIST: anywhere legal/security copy lists subprocessors (security.tsx, privacy/terms if present), ensure the list reflects reality: Neon, Render, Netlify, Resend, Stripe, Anthropic, Sentry, Better Stack. Remove Lemon Squeezy.

Acceptance: `grep -ri "lemon" apps/web/pages apps/web/components` returns zero customer-facing hits; footer Status link opens ukedl.betteruptime.com; a signed-in owner on /pricing sees Upgrade → /organizer/billing; subprocessor lists are accurate. Run npm test + npm run build in both apps, report, STOP for review.
```


### Chunk E7 — npm audit triage (8 findings incl. 1 critical, printing on every deploy)

```
Chunk E7 — dependency vulnerability triage. Scope: package.json/package-lock.json changes only; no application-code changes unless a dependency bump forces a trivial API adjustment (flag it if so). Tests + builds green in both apps.

1. Run `npm audit` at the repo root and produce a table: package, severity, advisory, and — the important column — WHERE it sits: runtime dependency of apps/api or apps/web (reachable in production), vs devDependency/build tooling (not shipped). Trace the dependency path for each (npm ls <pkg>).
2. Fix what is safely fixable: `npm audit fix` (NEVER --force), targeted version bumps within semver ranges, or `overrides` in the root package.json for transitive pins. No major-version bumps of direct dependencies without stopping to flag the breaking-change risk.
3. For anything unfixable-today (no patched version, or fix requires a major bump), document it in a new SECURITY_NOTES.md section: what it is, why it's acceptable for now (e.g., dev-only, unreachable code path), and the trigger for revisiting.
4. Acceptance: `npm audit` output after your changes shows the critical resolved or documented-as-not-reachable; all 231+ unit tests pass in apps/api, 56+ in apps/web; both builds green. Do NOT set ALLOW_DESTRUCTIVE_DB. Report the before/after audit summary and STOP.
```


### Chunk E8 — fix detached-event crash in dashboard upload handlers (found by Sentry, 2026-08-02)

```
Chunk E8 — small bug fix. Sentry caught a real production error while the founder used /dashboard: "TypeError: Cannot read properties of null (reading 'form')" at onChange, unhandled, ukedl-web, production.

Root cause (verified): apps/web/pages/dashboard.tsx has three handlers that read `ev.currentTarget.form?.elements.namedItem(...)` — around lines 2942 (invitePhotoUrl), 3612 (eventLogoUrl), 3631 (eventBannerUrl). These onChange handlers are ASYNC. React pools/detaches the synthetic event, so by the time the async continuation runs, `currentTarget` is null and `.form` throws BEFORE the optional chain on `.form` can help. The `?.` is on the wrong link of the chain.

Fix:
1. In each of the three handlers, capture what you need from the event SYNCHRONOUSLY on the first line, before any await: e.g. `const formEl = ev.currentTarget.form; const fileInput = ev.currentTarget;` then use `formEl?.elements.namedItem(...)` afterwards. Do not rely on ev.currentTarget after an await.
2. Audit the whole file for the same pattern — any async onChange/onSubmit/onClick that touches ev.currentTarget or ev.target after an await — and apply the same capture-first fix. Report every location you change.
3. Guard the element lookups: if the captured form or named element is missing, fail quietly (no throw) and surface the existing user-facing error state if one exists.
4. Add a regression test if the surrounding code is testable; if these handlers aren't reachable from the existing web test setup, say so rather than inventing scaffolding.

Scope: apps/web only. No API, no schema. Run npm test + npm run build in both apps, report the list of fixed locations, and STOP.
```

---

# Chunk E9 — ingest regression + dead resources feature

Found 2026-08-02 during the CSP console walkthrough. Two independent defects,
both silent failures — nothing crashed, features just quietly did nothing.

## E9.1 — PDF/DOCX/XLSX ingest returns nothing (P0 regression)

**Symptom:** uploading a real PDF yields `0 create · 5 delete proposed` and the
assumption *"The source provided only references a stored file name … with no
extractable text content."*

**Cause:** two call sites branch on the storage URL's *scheme*, which used to be
`data:` under the Postgres fallback and is now `https://…r2.dev/…`:

- `apps/api/src/routes/agendaIngest.ts` (~L210–230) — only extracts text when
  `stored.url.startsWith("data:")`; else falls through to the stub
  `` `[Stored file ${sourceFileName}]` ``.
- `apps/api/src/lib/ai/ingest/job.ts` (L36–47) — only builds the multimodal
  `attachment` when `run.sourceUrl?.startsWith("data:")`.

`StorageProvider` (`apps/api/src/lib/storage/types.ts`) has `put` and
`acceptUpload` but **no read method**, so bytes cannot be fetched back after
upload. Do not add one for this fix.

**Fix — derive from the inbound payload, not the stored URL.** The browser posts
the file as a `data:` URL in `parsed.data.fileUrl`, so the bytes are already in
hand before `acceptUpload` runs:

1. In `agendaIngest.ts`, decode `parsed.data.fileUrl` (not `stored.url`) for
   `sourceText`, `sourceMime` and `sourceBytes`. Keep storing to R2 for the
   audit trail / re-runs — just stop depending on what comes back.
2. Persist enough for the job to rebuild the attachment without re-reading
   storage. Simplest: pass the base64 + mime on the job payload alongside
   `runId`/`sourceText`. If that makes the payload too large for the jobs table,
   say so and propose an alternative rather than silently truncating.
3. In `job.ts`, build `attachment` from that payload, falling back to the
   existing `data:`-URL branch so the local/dev data-URL path still works.
4. Both paths must keep honouring `AGENDA_INGEST_MAX_BYTES`.

**Acceptance:** upload a real multi-session PDF on a dev event → sessions are
proposed with real titles and times. Re-run the same PDF → near-zero diff, not a
wall of deletes.

## E9.2 — an empty extract must not propose deleting everything (P1)

The same run reported `0 create · 5 delete proposed`. If an extract yields zero
sessions, propose **no** deletions and end the run in a visible failed/empty
state. A zero-result parse is evidence the parse failed, never evidence the
organiser deleted their programme. Add a unit test for it.

## E9.3 — session resources are invisible to everyone (P1)

`apps/web/pages/session/[sessionId].tsx` L179–193 `fetchSessionResources` uses a
raw `fetch` with `Authorization: Bearer ${token}` and **no
`credentials: "include"`**, so the httpOnly cookie is never sent cross-origin to
`api.ukedl.com`. `requireAuth` returns 401 before the route's own 403 "Join this
session" guard is reached. The client swallows it (`if (!res.ok) return []`), so
the panel reads "No resources yet" — for everyone, always. The 8-second poll at
L389–396 re-fires it, producing 10–20 console errors per page visit.

**Fix:** route the call through `apiFetch` (`apps/web/lib/api.ts`) like every
other request on the page — it already sets `credentials: "include"` and ignores
the token argument. Then **audit for other raw `fetch(` calls to `API_URL`** in
`apps/web` with the same missing-credentials bug; the E8 pattern says where
there is one there are several.

**Acceptance:** as a joined attendee, add a link resource and see it listed after
reload. Console clean on the session page.

## E9.4 — `GET /attendees?take=500` → 404 (P2)

Fires on the dashboard Messages tab via `apiFetchAll`. No `/attendees` route is
mounted at the API root. Find the caller, point it at the real path (or delete
the call if the data is unused). Not yet root-caused — investigate, don't assume.

## Standing rules for this chunk
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** If a suite refuses to run, report and stop.
- Stop the web dev server before starting; run the reset ritual after.
- Migrations: none expected. If you think one is needed, stop and explain why.

---

# Chunk E10 — output-token ceiling truncates every large programme (P0)

Found 2026-08-02 immediately after E9. **E9.1 is confirmed working** — the PDF
bytes now reach the model. The failure moved one layer down.

**Symptom:** uploading a 7-page programme PDF returns
`Model did not return valid JSON`.

**Cause:** `apps/api/src/lib/ai/providers/anthropic.ts` L79 hardcodes
`max_tokens: 4096` and the code never inspects `stop_reason`. A real conference
programme serialised to JSON (title, start, end, room, track, speakers,
description per session) exceeds 4096 output tokens well before it exceeds the
input limit. The model is cut off mid-object, `parseJsonObject` throws, the
gateway (`lib/ai/gateway.ts` L232–256) retries once, that reply is truncated too,
and the user sees a message blaming the model's JSON formatting.

The error is not just unhelpful, it is **wrong** — it points at output format
when the real cause is length. This is very likely the same root cause behind the
`PASTE · FAILED` runs on 2026-07-31 and the long-standing "ingest demo truncates
at 8 rows" symptom.

## Fixes

1. **Raise the ceiling.** Make `max_tokens` a named constant, default **16384**,
   overridable by `AI_MAX_OUTPUT_TOKENS`. Do not silently cap below the model's
   real limit. Claude Sonnet supports far more than 4096 output tokens.
2. **Detect truncation explicitly.** Read `response.stop_reason`. When it is
   `"max_tokens"`, surface a distinct failure code (e.g. `TRUNCATED`) with an
   honest message — *"The programme was too long to process in one pass."* Never
   report a truncated response as invalid JSON.
3. **Do not retry a truncated call.** The current PARSE_ERROR retry re-sends the
   entire truncated assistant message and will fail identically while doubling
   cost and latency. Skip the retry when `stop_reason === "max_tokens"`.
4. **Surface it in the UI** through the existing `friendlyIngestError` path, with
   guidance the organiser can act on (split the programme, or use CSV import).

## Explicitly out of scope

Chunking a long programme across multiple model calls is the real answer for very
large events and is a **separate chunk** — do not attempt it here. Fixes 1–3 make
normal programmes work and make the failure honest when they don't.

## Acceptance

- The 7-page `2026 DocWeek Schedule and Session Overview.pdf` extracts real
  sessions with real titles and times.
- An artificially huge programme fails with the truncation message, not the JSON
  message, and consumes one model call rather than two.
- Unit test: a mocked provider response with `stop_reason: "max_tokens"` produces
  `TRUNCATED` and triggers no retry.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** If a suite refuses to run, report and stop.
- Stop the web dev server first; reset ritual after. No migrations expected.

---

# Chunk E11 — make the ingest review screen legible (UX)

Written 2026-08-02 after the first fully successful PDF ingest (22 sessions from
a 7-page programme). The extraction is now correct; the **review screen does not
communicate what happened.**

## E11.1 — the "Source" panel shows a debug stub, not the file (P1)

`apps/web/pages/organizer/events/[eventId]/ingest.tsx` L434 renders
`run.sourceTextPreview`. For a PDF that value is
`[Binary application/pdf upload, 188181 bytes — extract from stored bytes / OCR stub]`
— an internal artifact from `textFromDataUrl`, shown to the customer as the
provenance of their entire programme.

This violates the "errors and status must name the real cause" rule in
`.cursor/rules/product.mdc`: the UI is displaying an implementation detail where
the user needs a fact.

**Fix:** for file-sourced runs, the Source panel shows the real metadata already
stored on `AgendaIngestRun` — `sourceFileName`, `sourceMime`, `sourceBytes`
(human-readable), the run timestamp, and for PASTE/URL runs the existing text
preview (which is genuinely useful there). Never render the binary stub. If a
text preview is unavailable for a binary format, say "No text preview — the file
was read directly by the model", which is true.

## E11.2 — the result is invisible below the fold (P2)

After a multi-minute extraction the page still shows the upload widgets at the
top; the changeset is far below. Users do not know it finished.

**Fix:** when a run reaches READY_FOR_REVIEW, scroll the review panel into view
and give it a heading that states the outcome plainly, e.g. **"Review 22 sessions
found in 2026 DocWeek Schedule and Session Overview.pdf"**. The counts line
(`22 create · 5 delete proposed · 0 errors`) stays, but the filename must appear
in the heading so the connection to the upload is unmistakable.

## E11.3 — one welcoming "+ Add" entry point per session (P2)

Two problems, one fix.

**(a)** The organizer console Program tab offers only **+ Add paper**. Session
*resources* (links/files) can currently be added only from the public session
page, so an organizer has no console path to attach a programme PDF, slide deck
or reading list to a session.

**(b)** "+ Add paper" is the wrong single prompt for this market. In the 22
sessions extracted from the real DocWeek programme — Welcome, Program Updates,
Hot Topics, Technology Toolkit, Lunch, Masterclass, Wrap-Up, Program Dinner,
Research Design Workshop — **almost none will ever have a paper.** Doctoral
programme weeks, education programmes and society meetings are mostly sessions
with slides and readings, not paper tracks. Offering "+ Add paper" as the only
action under every session mislabels what a session usually contains.

**Fix — a single combined entry point, two preserved models.** Replace
"+ Add paper" with **"+ Add paper or resource"**. Clicking it reveals a small
choice with one line of explanation each:

- **Paper** — a submission with authors and an abstract (appears in the programme
  under the session)
- **Resource** — a link or file, e.g. slides, a reading list, a Drive folder

`Paper` and `SessionResource` remain **separate models with separate endpoints** —
this changes the entry point and the wording, not the schema. Resources reuse the
endpoints fixed in E9.3. Wording comes from the config/copy layer, not hardcoded.

Rationale for the record: an earlier draft of this plan said not to broaden the
label, on the grounds that "paper" is a precise academic term. That reasoning was
sound about the data model and wrong about the UI — precision in the schema does
not require the button to name only one of the two things a session can hold.
Founder overruled it with evidence from a real programme.

## Acceptance
- Upload a PDF → Source panel names the file, type and size; no `[Binary …]` text
  anywhere in the UI.
- On completion the review panel is in view and its heading names the file.
- An organizer can add a link resource to a session from the Program tab via
  "+ Add paper or resource", and it appears on the public session page.
- The paper flow is unchanged in behaviour — same fields, same authors ordering.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** If a suite refuses to run, report and stop.
- Stop the web dev server first; reset ritual after (see README). No migrations
  expected — all fields in E11.1 already exist on `AgendaIngestRun`.

---

# Chunk E12 — after the action, show the result (UX)

Found 2026-08-02 walking the full ingest → confirm → add-resource → attendee path
on production, immediately after E11 shipped. E11 fixed what the review screen
*says*; E12 fixes what happens *after you act*. Common theme: the app confirms an
action in green text and then leaves the user to find the consequence themselves.

## E12.1 — "Confirm drafts" is a dead end (P1)

Confirming 22 sessions leaves you on the ingest page with
"Created 18 draft session(s), updated 4, deleted 0." There is no link to the
program. The founder had to navigate Overview → Program manually to see what he
had just created — after a two-minute wait.

**Fix:** the success message gets a primary action, **"View program"**, linking to
the Program tab of that event (and a secondary "Import another"). Keep the
counts. Drafts-stay-hidden wording stays — it is genuinely useful.

## E12.2 — the organizer cannot see the resource they just added (P1)

Adding a resource from the Program tab shows "Resource added — attendees who join
this session can open it from the session page." and then **nothing**. The Program
tab does not list existing resources, so there is no way to confirm what was
attached, spot a duplicate, or remove a mistake without leaving for the public
session page.

A confirmation that cannot be verified in place is barely a confirmation.

**Fix:** list existing resources inline under each session in the Program tab —
title, type (link/file), who added it, and a Remove action — reusing the
endpoints from E9.3. Papers already list this way; resources should match.

## E12.3 — resources are buried on the attendee session page (P2)

On `/session/:id` the *add-resource form* renders above the resource list, and an
attached file appears as small plain text ("Test") below it. For an attendee whose
only goal is opening the slides, the page leads with a form they mostly do not
need.

**Fix:** invert the panel — existing resources first, as a legible list with a
clear affordance to open; the add form below, secondary (collapsed behind
"+ Add a resource" is acceptable). Empty state keeps the current hint.

## E12.4 — resource upload copy leaks implementation detail (P2)

`apps/web/pages/session/[sessionId].tsx` L868: *"Uploads are sent as data URLs and
must stay under about 4.5 MB so the server can accept them."*

"Data URLs" is meaningless to an academic organizer, and it is the same class of
defect as the `[Binary application/pdf …]` stub fixed in E11.1 — an internal
mechanism shown where a fact belongs. It is also confusingly inconsistent with the
ingest page's "≤20 MB".

**Fix:** plain English — e.g. *"Add a link, or upload a file up to 4.5 MB.
Anyone who joins this session can open it."* Do not explain the transport. Keep
the real limit. Wording via the config/copy layer. Note for whoever does this: the
4.5 MB ceiling is a browser request-encoding limit
(`RESOURCE_DATA_URL_MAX_CHARS`), not an R2 limit — if it is ever worth raising,
that is a separate change to how the browser uploads, not a copy edit.

## Acceptance
- After Confirm drafts, one click reaches the created sessions.
- A resource added from the Program tab is visible in the Program tab.
- An attendee opening a session sees attached resources before any form.
- No user-facing string contains "data URL".

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** If a suite refuses to run, report and stop.
- Stop the web dev server first; reset ritual after (see README). No migrations.

---

# Chunk E13 — the ingest publish path (three P0s)

Found 2026-08-02 by the three-persona UX audit; all three **verified against
source** before being written here. See `ux-audit-capture/UX_AUDIT_MERGED.md` §1.

These are one chunk because they are one workflow: ingest → review → confirm →
publish. Today that workflow produces an empty public page, silently discards the
organiser's corrections, and destroys hand-entered data on re-import.

## E13.1 — Ingested sessions can never become attendee-visible (P0)

- `prisma/schema.prisma:800` — `publishStatus @default(PUBLISHED)`
- `lib/ai/ingest/confirm.ts:213` — ingest **overrides** it to `DRAFT`
- `lib/ai/ingest/visibility.ts` — non-managers see only `PUBLISHED` on an
  `ACTIVE` event
- **No route in `src/routes/` ever writes `PUBLISHED`.** Only the demo seed
  (`lib/demoEvent/reset.ts`) and test fixtures do. `apps/web` has **zero**
  references to `publishStatus` — there is no control anywhere.

So: paste programme → confirm 22 sessions → Publish → public page shows the event
with **no sessions**. Invisible to the organiser because managers see drafts, and
invisible in the demo because the seed writes `PUBLISHED` directly.

**Decision taken by the founder:** keep DRAFT-on-ingest (the review gate stays),
and make **publishing the event publish its sessions too.**

**Fix:**
1. `POST /event/publish` also promotes that event's `DRAFT` sessions to
   `PUBLISHED`, in the same transaction as the event status change.
2. The Program tab shows a visible **Draft** badge on any session that is not
   PUBLISHED, so the state is never invisible again.
3. Publishing an event reports what it did: "Published event and 22 sessions."
4. If an event is already ACTIVE and later gains draft sessions (a second
   ingest), the organiser needs a way to publish those too — surface a
   **"Publish N draft sessions"** action on the Program tab when any exist. This
   is the minimum; do not build per-session toggles.

## E13.2 — Edited assumptions are stored and then discarded (P0)

- `routes/agendaIngest.ts:345` — `PATCH /ai/ingest/:id` persists `assumptions`
  onto the run row.
- `lib/ai/ingest/confirm.ts:164` — `confirmAgendaChangeset({ prisma,
  organizationId, eventId, timezone, actorUserId, runId, rows })`. **No
  `assumptions` parameter**; nothing downstream reads them.

The Assumptions panel is the clearest expression of "agents draft, humans
publish" in the whole product — and editing it does nothing.

**Fix:** thread the edited assumptions through to confirm and apply them to the
rows they affect (name spellings, timezone, inclusion/exclusion decisions).
**If applying an assumption to the changeset is genuinely not tractable, say so
and make the field read-only instead** — an editable control that silently does
nothing is worse than no control. Do not leave it as-is.

## E13.3 — Update rows destroy hand-entered speakers and papers (P0)

`lib/ai/ingest/confirm.ts:233–234`, on the update branch:
```ts
await prisma.sessionSpeaker.deleteMany({ where: { sessionId: row.sessionId } });
await prisma.sessionItem.deleteMany({ where: { sessionId: row.sessionId } });
```
then rewrites both from the AI extraction. Any paper, speaker link, author
ordering or discussant the organiser added by hand — and that the source document
does not contain — is **hard-deleted with no undo**.

Re-import is the product's core workflow (tonight's own run: `18 create ·
4 update · 5 delete proposed`). This turns "re-upload the revised programme" into
silent data loss.

**Fix:** stop blind-replacing. Reconcile instead — match existing items, update
what the source covers, leave what it does not mention alone. Where an update
genuinely would remove something the organiser added, **surface it in the
changeset as an explicit, unchecked-by-default removal**, exactly like the
existing delete rows. Nothing the organiser typed disappears without them
ticking a box.

## Acceptance
- Ingest 3+ sessions on a draft event → Publish → sign out (or use a private
  window) → the public `/e/{slug}` page lists those sessions.
- Program tab shows a Draft badge before publishing and none after.
- Ingest into an already-published event → a "Publish N draft sessions" action
  appears and works.
- Edit an assumption answer (e.g. a name spelling) → confirm → the created
  session reflects the edit. Or the field is read-only with an explanation.
- Add a paper by hand to an ingested session → re-import the same source → the
  hand-added paper still exists, or its removal appears as an unchecked row.
- Unit tests for all three; the E13.3 test must assert that a hand-added item
  survives a re-import.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** If a suite refuses to run, report and stop.
- Follow the "errors must name the real cause" rule in `.cursor/rules/product.mdc` —
  all three of these are that rule violated in data form.
- Stop the web dev server first; reset ritual after (see README).
- A migration is not expected. If you think one is needed, stop and explain why.

---

# Chunk E14 — create-event wizard: explain what blocks progress

Source: an independent AI review of `/organizer/events/new` (2026-08-02), plus
verification against the code. The wizard was the one surface the three-persona
audit could not capture, so this is genuinely new ground.

## First: what was reported and is NOT true

The review's headline P0 was that date values cleared when other fields changed,
leaving **Next: branding** permanently disabled. **Disproved by manual test on
production**: dates entered by hand survived edits to Venue name and Venue
address, and the Next button was enabled. Screenshots on file.

The review itself flagged that it observed this through browser automation and
that `datetime-local` behaves differently under automation — that caveat was
correct. Two supporting hypotheses are also ruled out by the code:

- *"Form state is replaced rather than merged."* The wizard uses **18 separate
  `useState` calls**, one per field (`new.tsx:61–90`). Independent state cannot
  clobber siblings. The review's suggested fix — consolidate into one
  `EventDraft` object — would move toward the failure mode it warns about.
- *"Dates round-trip through `toISOString()` into the input."* They do not.
  `value={startDate}` holds the raw local string (`new.tsx:603`); `startIso` is
  derived separately at line 227 for submission only. This is already the
  recommended pattern.

The E4 sessionStorage restore also looks sound: it runs once on mount and never
writes empty drafts.

**Do not "fix" the date state. There is nothing wrong with it.**

## What IS true and worth fixing

### E14.1 — A disabled button with no explanation (P1)

`new.tsx` — `disabled={!startDate || !endDate}` on **Next: branding**, with no
message anywhere saying why. A user who has not filled the dates sees a dead
control and no recovery path.

**Fix:** prefer keeping the button enabled and validating on click, so the user
gets a reason. If it stays disabled, show the blocking reason continuously next
to it ("Enter a start and end time to continue"). Apply the same rule to any
other disabled control in the wizard.

### E14.2 — No end-after-start validation (P1)

The only check is presence. An event can be created that ends before it starts,
which will then render nonsensically in every schedule view.

**Fix:** validate end > start, with an inline message. Do not clear either field
on failure — show the error and keep the input.

### E14.3 — No field-level validation or required marking (P2)

No inline errors, no visual/semantic required marking, no `aria-describedby`
linking errors to fields, no live region. Keyboard and screen-reader users get no
feedback about what is wrong.

**Fix:** inline error text per field; mark required fields; associate errors with
`aria-describedby`; announce via a polite live region. Validation must return an
error map and never mutate the entered values.

### E14.4 — No wizard orientation (P2)

The user cannot see how many steps remain or what comes after. Show the sequence
(Basics → Dates & place → Branding → Review) with the current step marked, and
state that everything is editable after creation.

### Explicitly NOT in scope

- The slug/publication confusion the review raised is largely already handled:
  "New events start as Draft — only your org can see them until you publish"
  renders directly under the H1 on every step. Optionally move it nearer the slug
  field; do not rebuild anything.
- The review's P2 "expectations for experienced organizers" (templates,
  registration, integrations, attendee import) is product strategy, not a wizard
  defect. Not a chunk.

## Acceptance
- With dates empty, the user can see — without guessing — why they cannot advance.
- End-before-start produces a clear inline error and clears neither field.
- Editing any Step 2 field leaves the dates untouched (regression guard for the
  behaviour verified today).
- Keyboard-only completion of Step 2 is possible, with errors announced.
- Component tests: validation returns messages without mutating the draft; dates
  persist across sibling-field updates.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** If a suite refuses to run, report and stop.
- Stop the web dev server first; reset ritual after (see README).
- No migration expected.

---

**Note on numbering:** the remaining chunks proposed in
`ux-audit-capture/UX_AUDIT_MERGED.md` §6 (ingest review screen; console
truthfulness and chrome; copy and help) become **E15, E16, E17** and should be
written up here when they are picked up.

---

# Chunk E15 — Agenda ingest: make the wait honest and the page legible

Raised by the founder after using the page on production, 2026-08-02. Confirms
consensus findings C1 and C3 from `ux-audit-capture/UX_AUDIT_MERGED.md` §2.
Founder's words: *"the agenda ingest takes forever… a user may think it is just
not working and leave before it is done"* and *"boxes on the left at the top and
boxes off to the right on the bottom — it's super ugly."*

## E15.1 — The poll gives up before the job finishes (P1, verified)

`pages/organizer/events/[eventId]/ingest.tsx:233` —
`for (let i = 0; i < 100 && ...) { await sleep(400); await fetch(...) }`.
The comment says "~40s max"; the real ceiling is 100 × (400ms + a network
round-trip) ≈ **60–80 seconds**. A 7-page PDF has been observed taking **over two
minutes**. So a normal-sized programme can outlive the page's willingness to
watch it, at which point the user is told extraction "may still be running" and
sent to Ingest history to find their own run.

**Fix:**
1. Raise the ceiling well past real-world runs (target ~5 minutes) and back off
   the interval as time passes (e.g. 400ms → 1s → 2s) so it is not hammering the
   API for five minutes.
2. Correct the stale comment. It has been wrong since it was written.
3. If the ceiling is genuinely hit, keep the run visible and keep polling in the
   background rather than dumping the user into history.

## E15.2 — Nothing happens on screen for two minutes (P1)

No progress indicator, no elapsed timer, no stage label. The user cannot
distinguish "working" from "broken", and the honest expectation is never set.

**Fix:**
1. **Set the expectation before the wait**, next to the upload control: e.g.
   "Large programmes can take 2–3 minutes. You can leave this page — the run
   keeps going and appears in Ingest history."
2. **During the run**, replace the input area with a live status block showing a
   spinner, the stage the run reports (`PENDING` → "Queued", `EXTRACTING` →
   "Reading your programme"), and a **counting elapsed timer** ("1:12"). A
   moving number is what tells a person the thing is alive.
3. Never show a fake progress bar with invented percentages — the job does not
   report percent complete. An honest timer beats a lying bar.

## E15.3 — The page is two different layouts stacked (P2)

Four input cards sit in a single narrow column
(`ingest.tsx:439`, `display: grid`), then the review area below is a **two-column**
grid (`ReviewChangeset.tsx:444–445`,
`gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)"`) at a different width.
Nothing aligns vertically, and the eye has to jump from a narrow left stack to a
wide right block.

Compounding it: **all four inputs are shown at once, but an organiser only ever
uses one.**

**Fix:**
1. Replace the four stacked cards with **one panel and a chooser** — a segmented
   control or tab row: **Paste text · Upload file · Fetch URL · Import CSV** —
   showing only the selected input. Default to Upload file. This removes three
   quarters of the page's visual noise before any styling work.
2. Keep the CSV panel's "You review every row before anything is created. No AI
   involved." — a persona audit named it the single most trust-building line in
   the product. Show it when CSV is selected.
3. Give the input panel and the review area **the same content width and the same
   left edge**, so the page reads as one column of work.
4. When a run completes, the review **replaces** the input panel rather than
   appearing beneath it; "Import another" brings the input panel back. (The
   success panel and scroll-into-view from E12 stay.)

## E15.4 — Brand colour renders as a full-width strip (P3)

`pages/organizer/events/new.tsx:645` — `<input className="input" type="color">`.
`.input` sets `width: 100%` (`styles/globals.css:143`), so a native colour swatch
is stretched into a long thin bar that does not look clickable. Same pattern in
the event settings panel.

**Fix:** a fixed-size swatch (about 44×44, meets target-size guidance) paired with
a hex text field showing the value, so the colour is both visible and editable.
Do not apply `.input` to `type="color"` anywhere.

## Acceptance
- A 7-page PDF completes with the review shown inline, without ever routing the
  user to Ingest history.
- Throughout the wait, the screen shows a stage and an elapsed timer that visibly
  counts.
- The expected duration is stated before the user commits to waiting.
- One input is visible at a time; the page has a single consistent content width.
- Brand colour is a square swatch with a hex field, in both the wizard and event
  settings.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** If a suite refuses to run, report and stop.
- Design values come from the token module — no hardcoded hex or px in components.
- Stop the web dev server first; reset ritual after (see README).
- No migration expected.

---

# Chunk E16 — organizer efficiency and clarity

Raised by the founder after walking the console on production, 2026-08-03.
Five separate items, grouped because they are all "the organiser can see the
thing but cannot work with it efficiently."

## E16.1 — Ingest review: stack Source above the changeset (P3)

`components/ReviewChangeset.tsx:444–445` uses
`gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)"`. For a file-sourced run
the Source column holds four short lines (filename, mime · size · timestamp, and
"No text preview…") and then several hundred pixels of dead white space beside a
long scrolling changeset.

**Fix:** for **file** sources, render Source as a compact horizontal band
**above** the review — filename, type, size, time on one or two lines, full
width. Keep the side-by-side two-column layout only for **paste/URL** runs, where
the source preview is genuinely long enough to be worth a column. The review
column then gets the full content width, which also relieves the density problem
(C3 in the UX audit).

## E16.2 — Assigning sessions to tracks is one-at-a-time (P1)

Founder: *"each session has to be edited to be added to a track — in a big
conference, there could be 50 or even more manual clicks."* Correct: the Program
tab's only path is Edit → Track dropdown → Save, per session. For the DocWeek
programme that is 21 sessions; for a real 5-track conference it is hundreds of
interactions.

This is the single biggest time cost in the console.

**Fix — bulk assignment on the Program tab:**
1. A checkbox on each session row, plus "select all" per day heading.
2. When ≥1 session is selected, show a compact action bar: **Assign track ▾** ·
   **Assign room ▾** · **Clear selection**, with a count ("6 selected").
3. Applying issues one batched request, not N requests, and reports what it did
   ("6 sessions assigned to PhD").
4. Selection survives filtering/scrolling within the tab; it does not survive a
   tab change (do not over-engineer persistence).

Do **not** build drag-and-drop. It is expensive, fiddly for large lists, and
inaccessible by default.

## E16.3 — Sent announcements have no record (P1)

Founder: *"if I sent 10 announcements, I don't see a record of what was sent."*

**The data already exists.** `schema.prisma:931` — the `Announcement` model
stores `title`, `body`, `createdAt`, `createdById`, `audience`, `audienceRole`,
`sessionId`, `attendanceMode`, `sendEmail`, `isEmergency`, `isPreview`,
`publishedAt`. There is also an `AnnouncementAuditLog` model (`schema.prisma:1348`).
Nothing renders any of it. This is a UI gap, not a feature build.

**Fix:** below the composer, a **"Sent announcements"** list, newest first: title,
a body excerpt, when it was sent, who sent it, the audience it went to, and chips
for "Email" / "Emergency" where those applied. Previews (`isPreview: true`) are
excluded or clearly marked. If a `GET` route does not exist yet, add one, scoped
to the event and manage access.

## E16.4 — Ops Inbox is unexplained (P2)

Founder: *"it's unclear to me what the Ops Inbox does."* The panel opens straight
into "Review-and-send only — nothing is delivered until you click Send/Apply",
a community blocklist field, and a `DAILY_DIGEST · DIGEST_NOTE` card. The label
`DAILY_DIGEST · DIGEST_NOTE` is an internal enum shown to the user.

**Fix:** a short plain-English intro at the top of the tab — what the Ops Inbox
is (AI-drafted operational suggestions during your event: digests, stale
questions, sessions at capacity), that nothing ever goes out without the
organiser clicking, and what "Run detectors" does. Replace the raw enum pair with
a human label ("Daily digest") and keep the type as a small chip if it is useful.
Also move the community blocklist out of the card flow — it is settings, not an
inbox item.

## E16.5 — Features tab reads as a raw checkbox list (P2)

Founder: *"the Features tab with all the click boxes looks very basic."* It is a
long vertical list of native checkboxes, each with a description and the line
"Attendees see: this feature in the app" repeated on every row.

**Fix:**
- Group features under existing headings with the group's purpose stated once.
- Replace the native checkbox with the same toggle/switch treatment used
  elsewhere, right-aligned, so the row reads name → description → state.
- Delete the repeated "Attendees see: this feature in the app" line where it says
  nothing; keep it only where a feature has a non-obvious attendee-side effect.
- Keep the presets row (Everything on / Focused / Academic program) — it is good
  and should stay at the top.

Design values come from the token module. No hardcoded hex or px.

## Acceptance
- A file-sourced ingest review has no large empty column.
- Six sessions can be assigned to a track in one action, and the UI says so.
- Every announcement previously sent for an event is listed with audience and time.
- A first-time organiser can read the Ops Inbox intro and say what it is for.
- The Features tab groups related toggles and does not repeat the same line 20×.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** If a suite refuses to run, report and stop.
- Multi-tenancy: any new route is scoped to the event/org, never a bare client id.
- Stop the web dev server first; reset ritual after (see README).
- A migration is not expected. If you think one is needed, stop and explain why.

---

# Chunk E17 — one Select control, used everywhere

Founder: *"I'm just not a fan of the drop-down selections — is there a way to
review all aspects of the site and think about a more professional way for users
to select things?"*

**Measured:** 26 native `<select>` elements across 15 files — `EventSettingsModal`,
`VenueMapEditor`, `AnnouncementComposer`, `ProgramTab`, `AgendaFilterPanel`,
`ReviewChangeset`, `login`, `dashboard`, `organizer/index`, `ai-usage`, `billing`,
`events/new`, both CFP pages, `styleguide`.

Native `<select>` renders as the OS control, so it ignores the design system
entirely — that grey macOS popup in the founder's screenshot is the browser, not
the product. It is the single loudest "unfinished" signal in the console.

**You already have the answer:** `components/SearchableMultiSelect.tsx` and
`components/TimezoneSelect.tsx` exist and are styled. The pattern is present and
applied in 2 places out of 15.

**Fix:**
1. Build one shared **`Select`** component (single-select sibling of the existing
   multi-select): trigger styled from design tokens, listbox popup, keyboard
   support (arrows, Home/End, type-ahead, Esc, Enter), correct ARIA
   (`role="combobox"`/`listbox`, `aria-expanded`, `aria-activedescendant`),
   focus returned to the trigger on close, and a disabled state.
2. Replace all 26 native selects with it, **except** where a native control is
   genuinely better — keep native on inputs inside the public attendee agenda if
   testing shows the OS picker is faster on touch. State which you kept and why.
3. Add it to `pages/styleguide.tsx` so the pattern is discoverable.
4. Do not build a combobox that allows free text unless the field already allows
   it (timezone already has its own control — leave it alone).

**Do this as its own chunk.** It touches 15 files and should not be mixed with
behavioural changes.

## Acceptance
- No native `<select>` remains in the organizer console.
- Every replaced control is operable by keyboard alone and announces correctly.
- The styleguide page shows the new control.

## Standing rules
- Design tokens only — no hardcoded hex or px in the component.
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.**
- Stop the web dev server first; reset ritual after.

---

# Chunk E18 — Messages, phase 1

Founder: *"the messages page looks super basic — review how other high quality
event platforms manage messages and model this after that; I want it to be really
good and high quality, indicating the professionalism of the site."*

Research, with sources: `ux-audit-capture/RESEARCH_MESSAGING.md`. Read it before
starting — the reasoning matters more than the checklist below.

## The thesis

**Messages is not a chat app.** The audience uses this three days a year. The
right model is low-volume private correspondence, not Slack. Density, read
receipts and typing indicators are wrong here; clarity, provenance and calm are
right.

**Founder decisions taken 2026-08-03:**
- **"Everyone — event chat" is removed.** It duplicated Community (event-wide
  posting) and Announcements (organizer broadcast), was the source of the
  notification volume competitors are criticised for, and left the tab looking
  like a stub with one row. Messages now owns exactly one job: **1:1 and small
  named group conversations.**
- **Scope is phase 1 only.** The message-request/consent gate, block, mute,
  report-to-organizers, and digest email are documented in the research file and
  are a **later chunk** — do not build them now.

## In scope for this chunk (frontend-first)

### E18.1 — Remove event chat
Delete "Everyone — event chat" from the Messages surface and from `+ New`.
Community and Announcements keep their existing roles. If existing event-chat
data exists, do **not** hard-delete it — hide the entry point and leave the rows.
Report what you find.

### E18.2 — Real conversation rows
Each row: avatar (initial fallback), display name, `Affiliation · Role` as a
secondary line, a one-line preview of the last message, a relative timestamp, and
an unread indicator.

**Unread counts by conversation, never by message.** (Research: counting messages
is the specific, documented complaint about Whova — a badge reading "47" is
useless and stressful.)

### E18.3 — Message thread
Group consecutive messages from the same sender; show the sender once per group.
Day dividers ("Today", "Yesterday", then the date). Timestamps per group, not per
message. The thread scrolls to the newest message on open.

### E18.4 — Composer
Pinned to the bottom of the thread. **Enter sends, Shift+Enter newlines** (state
this in placeholder or helper text). Optimistic send with explicit
**sending → sent → failed** states and a **Retry** on failure — a message that
silently fails to send is the "errors must name the real cause" rule violated in
the most damaging place. Persist an unsent draft per conversation.

### E18.5 — States and copy
- Empty inbox: say what Messages is for and how to start one — not "No messages yet".
- Empty thread, sending, failed, and offline all get honest copy.
- Rename `+ New` → **New message**; `Filter chats` → **Search names or messages**.
- Delete both current explainer paragraphs — the interface should not need them.

### E18.6 — Accessibility
Conversation list is a keyboard-navigable list; the thread is a labelled region;
new incoming messages announce via a polite live region (not per keystroke);
focus moves sensibly between list, thread and composer; visible focus rings.

### E18.7 — Polling, not sockets
Reuse the existing Q&A polling approach. Poll on a slow interval, **pause when
the tab is hidden**, resume on focus. Do not introduce websockets.

## Explicitly NOT in this chunk
Request/consent gate · block · mute · report-to-organizers · digest email ·
cross-conversation search · attachments · read receipts · typing indicators ·
AI-drafted replies · sponsor bulk messaging. Several of these are permanently
rejected on anti-goal grounds — see the research file's rejected-patterns
section before proposing any of them.

## Acceptance
- The Messages tab with two real conversations looks like a product, not a stub.
- Unread shows a conversation count, not a message count.
- A failed send is visible and retryable; a draft survives switching conversations.
- Keyboard-only: reach the list, open a conversation, type, send.
- Nothing polls while the tab is hidden.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** If a suite refuses to run, report and stop.
- Multi-tenancy: every query scoped to event/org, never a bare client id.
- Design tokens only. Stop the web dev server first; reset ritual after.
- If a migration seems necessary, stop and explain why before writing one.

---

# Chunk E19 — concurrent sessions at scale, and the two assistants

Raised by the founder, 2026-08-03.

## E19.1 — Three or more concurrent sessions will not fit (P1)

`pages/dashboard.tsx:2434` renders "{n} concurrent sessions" and then lays the
sessions out side by side. With two, each card is already narrow enough that
titles truncate ("Research Design Workshop - PhD…"). A five-track conference —
squarely inside the stated 50–2,000 target band — puts five cards in that row.

This is the "what breaks at scale" risk the veteran persona raised
(`UX_AUDIT_MERGED.md` §3).

**Fix:**
1. Set a minimum readable card width. Above the count that fits, **stop adding
   columns** — wrap to a second line, or switch that time slot to a compact
   stacked list with the track colour and name carried on each row.
2. Never truncate a session title to fewer than roughly 40 characters; wrap to two
   lines instead. Titles are how people choose.
3. Test with **five** concurrent sessions, not two. Add a fixture.
4. The Grid and By-room views already handle parallelism with columns — check
   they degrade sensibly at five tracks too, and say what you found.

## E19.2 — The attendee Concierge wears organizer language (P1)

`components/ConciergeChat.tsx:247` renders `<AiGeneratedChip />`, whose text is
**"AI-generated — review before publishing."** The Concierge is an
**attendee-facing** assistant. An attendee publishes nothing. The founder read
the chip and reasonably concluded the Concierge was an organizer setup tool.

**Fix:** the attendee surface gets an honest label — e.g. **"AI answer — based on
this event's schedule"** — conveying that it is AI and what it is grounded in,
without implying a publishing workflow. Keep `AiGeneratedChip` as-is wherever an
organizer really is reviewing before publishing. Audit for any other
attendee-facing use of the publish-language chip.

Also observed: asked "What's on this morning?" for an event whose sessions are in
June, it replied **"No matching sessions in this event's schedule."** True but
misleading — it sounds like the schedule is empty. It should say there is nothing
today and name when the event actually runs. Same rule as everywhere else: the
message must name the real reason.

## E19.3 — Two assistants, both real, both findable (P2)

**Both already exist:**
- `components/SetupCopilotChat.tsx` (256 lines) — organizer-side, mounted at
  `pages/organizer/events/new.tsx:399` ("Set up with AI") and
  `pages/organizer/events/[eventId]/index.tsx:526` (Features tab, "Ask the
  assistant").
- `components/ConciergeChat.tsx` (306 lines) — attendee-side, a floating button on
  attendee pages.

The founder — who built this product — did not know the organizer one existed and
thought the attendee one was it. That is a discoverability failure, not a missing
feature. (The novice persona independently found the help article referencing
"Setup Copilot" with no such control visible on screen.)

**Fix — make the split explicit and each one actually useful:**

1. **Name them distinctly and consistently** everywhere, including help articles.
   Suggested: **Setup assistant** (organizer) and **Event assistant** (attendee).
   Names come from the config/copy layer, not hardcoded.
2. **Organizer — make it a real setup companion, not a chat box.** It should know
   the state of the event and drive it forward: what is still missing (no rooms,
   no speakers, sessions still draft, event unpublished, no venue), what to do
   next, and a link that navigates straight to the tab and control that fixes it.
   A checklist that reads live event state and deep-links is worth more than
   conversational ability.
3. **Attendee — make it a real wayfinder.** Grounded strictly in this event's
   published schedule, rooms, maps and FAQ: answer "when is X", "where is room
   201", "what's on after lunch", "who is presenting Y", and offer a link that
   navigates to the session, map or page. When it cannot answer, say why
   specifically ("this event runs 8–10 June; there is nothing scheduled today")
   rather than a flat no-match.
4. **Both keep the existing gateway guarantees** — all calls through
   `apps/api/src/lib/ai`, grounded per event, metered, labelled, audited. No
   agent output reaches an attendee without an organizer approving it; the
   attendee assistant answers *from published data* and never publishes.
5. Surface the organizer assistant somewhere persistent in the console, not only
   inside the create-event flow and one Features-tab button.

**Do not** build a general-purpose chatbot. Both must refuse questions outside
their event's data rather than improvising — an assistant that invents a room
number is worse than none.

## Acceptance
- Five concurrent sessions render readably; no title truncated below ~40 chars.
- No attendee-facing surface says "review before publishing".
- The attendee assistant, asked about a day with no sessions, states when the
  event actually runs.
- A new organizer can find the setup assistant without being told it exists, and
  it names the next incomplete step and links to it.
- Both assistants decline out-of-scope questions rather than guessing.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** If a suite refuses to run, report and stop.
- All AI calls via the gateway. Agents draft, humans publish.
- Design tokens only. Stop the web dev server first; reset ritual after.


---

# Chunk E20 — de-flake the recap certificate drain (small)

Found 2026-08-03 during the first-ever full run of the database suites
(373/374 passed — see RUNBOOK §12).

**Symptom:** `src/__tests__/recap.db.test.ts` → "4–7) generate drafts only; regen
replaces drafts; SENT stable; certs stable" fails with
`expected 0 to be greater than or equal to 1` at line 528 — no `issuedCertificate`
rows exist after the recap run.

**Not a product defect.** Re-running that file alone passes. `certificates.db.test.ts`
passes fully, including a 500-attendee batch job. The certificate machinery works.

**Cause:** lines ~488–492 drain background jobs with

```ts
for (let i = 0; i < 20; i++) {
  const n = await processDueJobs(5);
  if (n === 0) break;
}
```

`generateEventRecap` enqueues the certificate batch job; if that job's `runAt` is
even fractionally in the future when the first `processDueJobs` call happens, it
returns 0, the loop **breaks immediately**, and no certificates are ever issued.
Under parallel load (58 files against one Neon branch) this is easy to hit —
the failing run took 2.1s, the passing solo re-run 8.2s.

**Fix:** the drain must wait for work rather than give up at the first empty poll.
Poll until either the expected rows exist or a generous timeout elapses — e.g.
retry with a short sleep between attempts, and only then assert. Apply the same
pattern anywhere else a test drains `processDueJobs` and immediately asserts on
its side effects; audit for that shape.

**Why bother:** a suite that fails at random teaches its only reader to ignore red
output. That is worse than having no test, and this is a one-person team.

## Acceptance
- The full suite passes repeatedly (run it three times) with no intermittent failures.
- No test breaks out of a job-drain loop on a single empty poll.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** Run DB suites per RUNBOOK §12.
- No product code should need to change for this. If you think it does, stop and
  explain why.

---

# Chunk E21 — DOCX and XLSX ingest (advertised, currently silent)

The upload control says **"PDF / DOCX / XLSX / CSV / image"** and
`INGEST_ALLOWED_MIME` (`lib/ai/ingest/constants.ts`) accepts `.docx`, `.doc`,
`.xlsx`, `.xls`. None of them work.

A `.docx` is a ZIP archive. `textFromDataUrl` (`lib/ai/ingest/sourceText.ts`)
detects the binary and returns
`[Binary application/vnd… upload, N bytes — extract from stored bytes / OCR stub]`.
The model receives that string. Anthropic's API natively understands **PDF and
images only** — Office formats are not document blocks, so the multimodal path
added in E9.1 does not cover them either.

This has never worked. It is the same silent-failure class as the P0s fixed on
2026-08-02, and a Word programme is the format many academic organisers will
reach for first.

## Design decision — do NOT send spreadsheets to the model

A spreadsheet already has rows and columns. Running it through an LLM is slower,
costs tokens, adds a confidence score to data that has none, and is less
reliable than reading the cells.

- **XLSX → the existing CSV importer.** Convert the first sheet (or a
  user-chosen sheet) to rows and hand it to the CSV path that already exists,
  with its column auto-mapping, per-row validation and review screen. Its line
  *"You review every row before anything is created. No AI involved."* was named
  by the novice persona as the most trust-building copy in the product — this
  extends it rather than diluting it.
- **DOCX → text → the existing paste/AI path.** Prose has no reliable structure;
  the model is the right tool. Extract the text and run the normal extraction.

## Libraries — new dependencies, flagged per `.cursor/rules`

The repo has **no** Office parser today. Two additions are needed:

- **DOCX:** `mammoth` — maps DOCX to plain text/HTML, no native build step,
  widely used, actively maintained.
- **XLSX:** `exceljs` — actively maintained on npm, MIT.
  **Do not use the npm `xlsx` package.** SheetJS moved its community builds off
  the npm registry; the npm copy is stale and has carried prototype-pollution
  advisories. If you believe SheetJS is materially better, stop and make the
  case rather than installing it silently.

Both must run **server-side only**, inside the existing size cap
(`AGENDA_INGEST_MAX_BYTES`), and must never be trusted to be well-formed — a
malformed or hostile file must produce a clean, honest error, not a crash.

## Legacy `.doc` and `.xls` — remove them

`mammoth` does not read legacy binary `.doc`; `exceljs` does not read legacy
`.xls`. Rather than continue advertising formats that silently fail:

- Remove `application/msword` and `application/vnd.ms-excel` from
  `INGEST_ALLOWED_MIME`.
- Reject them with copy that says what to do: *"Legacy .doc/.xls files aren't
  supported. Save as .docx or .xlsx and upload again."*

## Fixes
1. `sourceText.ts`: branch on mime — DOCX → `mammoth` text; XLSX → `exceljs`
   rows. Neither may reach the `[Binary …]` stub.
2. Route XLSX into the CSV review path; route DOCX into the AI extraction path.
3. If an XLSX has multiple sheets, let the organiser pick which one before
   review; do not silently take the first.
4. Every failure names its cause: password-protected file, corrupt archive,
   empty document, no readable rows. Never a generic "could not process".
5. Update the upload caption and the help article to match what is actually
   supported.

## Acceptance
- A real Word programme document uploads and produces sessions.
- A real Excel programme uploads and lands in the **CSV review screen** with
  columns mapped and every row reviewable — no AI, no confidence scores.
- A multi-sheet workbook asks which sheet.
- A password-protected DOCX produces a message saying exactly that.
- Uploading a `.doc` explains how to convert it.
- No user-facing string mentions a format that does not work.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** DB suites per RUNBOOK §12 — they run now,
  so verify with them.
- New dependencies are flagged above; do not add others without saying why.
- Errors must name the real cause (`.cursor/rules/product.mdc`).
- Stop the web dev server first; reset ritual after.

---

# Chunk E22 — a skipped DB suite must not report success (P1)

Disclosed honestly by Cursor during E21 and then verified: **every**
`*.db.test.ts` file contains a skip-on-unreachable path —

```ts
console.warn("[billing.db.test] DB unreachable or Phase 3 tables missing — skipping");
```

— after which the suite reports **green**.

## Why this matters

Run the suite with a mistyped host, a deleted Neon branch, a dropped network, or
simply no `DATABASE_URL`, and the output reads **"374 passed"** while not a
single query executed. The warning is one grey line among hundreds of
`DeprecationWarning` lines; nobody will see it.

This is the failure shape this project has spent two days eliminating — a system
that knows it did not do the work and reports success anyway
(`.cursor/rules/product.mdc`, "Error messages must name the real cause"). It is
worse here than in product code, because the whole point of these suites is to
be the thing that tells the truth when something else lies.

Concretely: on 2026-08-03 it produced a false positive. Cursor reported "391
tests, all pass" for E21 while its sandbox had no network route to Neon — its
new `spreadsheetImport.db.test.ts` never ran.

## The rule to implement

**Skipping is only legitimate when the developer never asked for DB tests.**

- `DATABASE_URL` **unset** → skipping is correct. A contributor running unit
  tests should not need a database. Print a clear one-line notice.
- `DATABASE_URL` **set** → the developer asked for DB tests. If the database is
  unreachable, or expected tables are missing, **FAIL LOUDLY**. Do not skip. The
  message must name the real cause: unreachable host, auth rejected, migrations
  not applied.

Implement this once in `src/__tests__/setup/destructiveGuard.setup.ts` (or a
sibling setup file) rather than 24 times. A single connectivity probe in
`beforeAll` for `*.db.test.ts` files can decide skip-vs-fail for all of them;
then delete the per-file skip branches so no file can opt itself out.

Distinguishing "cannot connect" from "tables missing" is worth the small extra
effort — the second means *run the migrations*, which is a different action.

## Also worth doing while in here

The suite's output is drowning in `DEP0169 url.parse()` DeprecationWarning noise
— dozens of lines per run, from a transitive dependency. It is why a real warning
is invisible. Silence it at the runner level (e.g. a `NODE_OPTIONS` or vitest
setup filter) **without** silencing warnings the project itself emits. If that
cannot be done cleanly, say so rather than suppressing everything.

## Acceptance
- With `DATABASE_URL` **unset**: DB suites skip, and say so in one clear line.
- With `DATABASE_URL` set to an unreachable host: the run **fails**, naming the
  host and the reason. It must not be possible to read that output as a pass.
- With `DATABASE_URL` set to a valid database missing migrations: the run fails
  and says migrations are missing.
- With the real `ukedl_test` database (RUNBOOK §12): 374+ pass as today.
- A reader scanning the last ten lines of output can tell which of these happened.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** Verify per RUNBOOK §12.
- No product code should change. If you think it must, stop and explain why.

---

# Chunk E23 — invoice.subscription is stale under Basil (P3, cosmetic)

Found 2026-08-06 while configuring the live Stripe webhook.

`apps/api/src/lib/billing/webhooks.ts` reads `asString(object.subscription)` for
`invoice.payment_succeeded`. **That field no longer exists at the invoice top
level** in API version `2025-03-31.basil` and later — Stripe moved it to
`invoice.parent.subscription_details.subscription`
(https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects).
The app is pinned to exactly that version via `STRIPE_API_VERSION`.

**Severity is low, and here is why.** The metadata reader (`webhooks.ts:245–250`)
is already Basil-aware — it falls back to `parent.subscription_details.metadata`
and then to line-item metadata. So on a renewal the handler still resolves
`orgId` and `planKey`, and entitlements apply correctly. Only the subscription
**ID** passed to `applySubscriptionActive` is `undefined`, and that value was
already stored during `checkout.session.completed`.

**Fix:** read the subscription id the same way the metadata reader does — try
`object.subscription`, then `object.parent.subscription_details.subscription`.
Keep both paths so a pre-Basil payload still works.

**Do not treat this as blocking go-live.** First purchases go through
`checkout.session.completed`, where `object.subscription` is a Checkout Session
field and remains valid.

## Acceptance
- A renewal `invoice.payment_succeeded` under `2025-03-31.basil` resolves a
  non-empty subscription id.
- Unit test with a Basil-shaped invoice payload (nested) and a legacy one (flat).

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** Verify per RUNBOOK §12.

---

# Chunk E24 — billing status shows a raw database enum (P2)

Found 2026-08-06 during live billing verification.

`apps/web/pages/organizer/billing.tsx:188` renders
`Status: {summary.subscriptionStatus}` — the raw `SubscriptionStatus` enum from
`schema.prisma:71`. Customers see:

| Enum shown | When | How it reads |
|---|---|---|
| `NONE` | brand-new free account | "Status: NONE" — meaningless |
| `CANCELED` | after downgrading to Free | **"Free · Status: CANCELED"** — looks like the Free plan is cancelled |
| `PAST_DUE` | payment failed | jargon, and gives no instruction at the exact moment one is needed |
| `ACTIVE` | paying | shouty, and redundant next to the plan name |
| `TRIALING` | on trial | acceptable but unstyled |

## Fix

**Show a status line only when it tells the customer something.**

- `NONE` and `ACTIVE` → **omit the status line entirely.** The plan name and price
  already say what's true. A paying customer does not need to be told "ACTIVE".
- `TRIALING` → "Free trial — ends {date}" if the date is available, else "Free trial".
- `CANCELED` **while on Free** → omit, or "Your Pro plan was cancelled." Never
  print "CANCELED" beside the word "Free".
- `CANCELED` **while still inside a paid period** → "Cancelled — Pro access ends
  {date}". This one matters: the customer needs to know they still have access.
- `PAST_DUE` → the only genuinely important one. Say what happened and what to
  do: **"Payment failed — update your card to keep Pro."** with the Customer
  portal button adjacent. This is the state where clear copy earns money.

Wording lives in the config/copy layer, not hardcoded in the page. Keep the raw
enum available in an audit/debug context if useful — just never on a customer
surface.

Also review the rest of the billing page for other raw enum or internal-value
leakage while in there.

## Acceptance
- A brand-new free organisation shows no status line.
- A downgraded organisation never shows "CANCELED" next to "Free".
- A past-due organisation is told what failed and what to do about it.
- No customer-facing string equals a `SubscriptionStatus` enum value.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** Verify per RUNBOOK §12.
- Design tokens only. Stop the web dev server first; reset ritual after.

---

# Chunk E25 — search-facing titles and category copy (marketing pages only)

Context: the launch channel is inbound search. Buyers type category problems
("conference schedule software", "publish conference program online",
"Sched alternative"), not brand names. Today every page title leads with the
brand and contains zero category words — the homepage is
`UKEDL — Paste your program. Your event is live.` Google ranks pages on what
their titles and content say they are.

## Scope — marketing surfaces ONLY

`/` (index), `/pricing`, `/help` + articles, `/security`, and the public event
page template. **Do not touch signed-in app pages** — their `Brand — Page`
titles are correct for an app and irrelevant to SEO.

## E25.1 — category strings in the config layer

Add to `packages/config` (all copy from config, per the standing rule):

- `categoryLine`: **"Event software for academic conferences"** — the plain
  category descriptor.
- `seoTitle`: **"Conference schedule software for academic events — UKEDL"** —
  category first, brand last. This is the pattern for every marketing title.

## E25.2 — retitle the marketing pages

| Page | New `<title>` |
|---|---|
| `/` | `Conference schedule software for academic events — UKEDL` |
| `/pricing` | `Pricing — open, no sales calls — UKEDL conference software` |
| `/help` | `Help — UKEDL conference software` |
| `/security` | `Security & data practices — UKEDL conference software` |

Meta descriptions get the same treatment: lead with what a searcher asked.
Homepage description becomes approximately: *"Turn a conference program — PDF,
Word, Excel or paste — into a published event site in minutes. Built for
academic conferences: papers with ordered authors, CFP, calm notifications,
open pricing."* (Mechanism + category + differentiators, ~155 chars max.)

Keep the hero H1 as the tagline ("Paste your program. Your event is live.") —
it converts humans; the title tag converts searchers. Both jobs, both lines.

## E25.3 — the category line under the wordmark

Footer (all pages) and homepage hero: render `categoryLine` in muted text near
the UKEDL wordmark so no visitor ever wonders what the product is. One line,
design tokens, no layout rework.

## E25.4 — crawlability basics

- Add `apps/web/public/robots.txt` if missing: allow all, point at sitemap.
- Add a sitemap for the marketing pages + published public event pages (static
  file or generated route — pick whatever fits Pages Router conventions; say
  which and why).
- Add `SoftwareApplication` JSON-LD to the homepage (name, category, offers
  from the plan catalog, url). The event pages already ship Event JSON-LD from
  E3 — do not duplicate that work.
- Canonical link tags on the four marketing pages.

## Acceptance
- `curl -s https://ukedl.com | grep '<title>'` shows the category-first title.
- Every marketing page has a unique title and description, category words first,
  brand last.
- robots.txt and sitemap resolve on production.
- Signed-in pages are untouched (diff shows no changes under organizer/dashboard).
- No hardcoded copy — everything through the config layer.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.**
- Stop the web dev server first; reset ritual after (see README).
- No migrations, no API changes.

---

# FUTURE STUB — consent-based support access (build when self-serve customers hit problems, not before)

Context (2026-08-07): the owner asked how support can see a customer's event.
Verified answer: it cannot. `requireEventAccess` has no owner bypass; the global
`ADMIN` role is event-scoped. This is the multi-tenancy rule working as designed.

**Interim policy — no code:**
- **Pilot customers:** adding `support@ukedl.com` as an org member is part of
  concierge onboarding, stated in the pilot agreement, removed at engagement end.
- **Diagnostics:** read-only SQL via the Neon console, for debugging only.
- **NEVER a hardcoded owner bypass.** It would be the first thing a university
  security review flags and a standing violation of the tenancy rule.

**The eventual feature (Stripe/Intercom pattern):**
1. Customer-side button in org settings: **"Grant UKEDL support access for
   7 days"** — creates a time-boxed org membership for a designated support
   account.
2. Expires automatically; revocable at any time by the customer.
3. Visibly badged while active ("UKEDL support has access — revoke") and every
   support action lands in `AuditLog` attributed to the support identity, never
   impersonating the customer.
4. Support account uses the existing membership path — no new authorization
   branch, so the tenancy tests keep protecting it.
5. Grant/expiry/revocation events emailed to the org owner.

Trigger to build: first time a self-serve (non-pilot) customer has a problem
that SQL diagnostics can't resolve respectfully. Not scheduled until then.

---

# Chunk E26 — "papers" copy broadened to "papers and presentations"

Founder decision 2026-08-07. Evidence from his own event: the real DocWeek
programme UKEDL ingested contained **zero paper sessions** — masterclasses,
workshops, panels. Practitioner and education conferences are core customers,
and copy that says only "papers" tells them the product is not for them.

## The terminology rule (this is the whole chunk)

**Broaden the copy. Never touch the data model.**

- `SessionItem`, the `Paper` concept, routes, schema, tests: **unchanged.**
  The paper-with-ordered-authors model is the competitive moat; this chunk is
  about who feels invited, not what the software is.
- User-facing copy widens: where "papers" appears as *the* content type, it
  becomes **"papers and presentations"** (or "papers, presentations" with a
  third item where rhythm needs it). Where author-order is cited, prefer
  "author or presenter order" when it reads naturally.
- Do NOT mechanically replace every instance — some are correct as-is
  (e.g. CFP review copy where a paper genuinely is a paper). Judge each.

## Known sites (sweep for more with grep -ri "paper" on user-facing layers)

1. **Homepage** (`apps/web/pages/index.tsx`): eyebrow "Papers & authors" →
   "Papers & presentations"; card body → "Sessions nest papers and
   presentations with author or presenter order preserved, discussants, and
   individual times…"; step 2 "Edit tracks, rooms, and papers" → "…rooms,
   papers, and presentations"; TRUST sub-line "Papers, authors, CFP…" →
   "Papers, presentations, CFP…".
2. **`packages/config`** `programCopy`: chooser description for Paper becomes
   "A paper or presentation — authors or presenters in order, with an optional
   abstract. Appears in the program under the session." Entry label
   `Add paper or resource` **stays** (three-item labels get unwieldy; the
   chooser copy does the work). Help meta description at index.ts:110 →
   "…organizing papers, presentations and speakers…".
3. **`packages/shared/plans.ts`** plainDescriptions — check each for
   paper-only phrasing.
4. **`marketingSeo`** descriptions (E25) — homepage description currently says
   "papers with ordered authors"; widen within the 170-char test budget.
5. **Help articles** (`content/help/*.md` + the byte-identical
   `helpContent.ts` mirror) and the Program tab explainer line in
   `ProgramTab.tsx` ("A session can hold papers…").
6. **Public event page**: the "N papers" pill on sessions — leave as-is (it
   counts actual SessionItems and is correct), but flag if any empty-state
   copy says papers-only.

## Acceptance
- A workshop-only organizer reading the homepage, pricing and help never
  encounters copy implying the product is for paper-track conferences only.
- `grep -ri "paper" apps/web/pages/index.tsx` shows no instance without
  "presentation" nearby, unless individually justified in the summary.
- Zero schema/API/test-fixture changes; web tests updated only where copy
  assertions exist (marketingSeo test).
- Help markdown and helpContent.ts stay byte-identical (existing test).

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** DB suites per RUNBOOK §12.
- All copy through the config layer where it already lives there.
- Stop the web dev server first; reset ritual after.

---

# Chunk E27 — publish the two comparison pages

The founder-approved drafts in `docs/marketing-drafts/` (ukedl-vs-sched.md,
ukedl-vs-whova.md) become live marketing pages. These target the
highest-intent queries in the market ("Sched alternative", "Whova alternative
academic") — a searcher there has budget and a deadline.

## Build

1. Routes: **`/compare/sched`** and **`/compare/whova`** (Pages Router, static).
   Follow the help-article pattern for prose layout; marketing chrome (header,
   footer with categoryLine) like the other marketing pages.
2. Copy comes from the drafts **verbatim** — founder-approved text. Convert the
   markdown faithfully; strip the draft-header block (the italic note and
   "Target queries" line are internal, not for publication).
3. SEO per E25 conventions, all through `marketingSeo` in the config layer:
   - `/compare/sched` title: `Sched alternative for academic conferences — UKEDL vs Sched`
   - `/compare/whova` title: `Whova alternative for academic conferences — UKEDL vs Whova`
   - Unique meta descriptions ≤170 chars, category-first; canonical tags; add
     both to the sitemap.
4. Cross-link: each page links to the other, to `/pricing`, and to the homepage
   demo ("paste your real programme"). Footer gains a small "Compare" group
   with both links (muted, not primary nav).
5. Add a visible "Competitor details verified August 2026" line near the top of
   each page — honest dating protects the claims as competitors change.
6. Extend `marketingSeo.test.ts` to cover the two new pages (unique titles,
   budget, brand-last).

## Acceptance
- Both pages render the approved copy, pass the SEO tests, appear in the
  sitemap, and are reachable from the footer.
- No signed-in surfaces touched. No API changes.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** Copy through config where it lives there.
- Stop the web dev server first; reset ritual after.

---

# Chunk E28 — motion foundation (first step of DESIGN_PHASE_E "Quietly excellent")

Direction chosen 2026-08-07: Option A in `DESIGN_PHASE_E.md`. This is the first
and lowest-risk chunk. Motion is the single biggest "static and cheap" signal in
the current UI (the tokens define one transition and zero keyframes). Add a
disciplined motion layer that communicates rather than decorates.

## The rule
Motion tells the eye *what changed* and *where to look*. Subtle, fast, felt more
than seen. **Every animation must be gated behind `prefers-reduced-motion:
reduce` — no exceptions.** This is an academic/accessibility audience.

## E28.1 — motion tokens
Add to `tokens.css` (the single source; no hardcoded durations in components):
- Durations: `--motion-fast: 120ms`, `--motion: 200ms`, `--motion-slow: 320ms`.
- Eases: `--ease-out: cubic-bezier(0.16,1,0.3,1)` (enter),
  `--ease-in-out: cubic-bezier(0.4,0,0.2,1)` (moves). Keep the existing
  `--transition` for hovers.
- A global `@media (prefers-reduced-motion: reduce)` block that sets all the
  above to `0ms`/`none` and disables the keyframes below, so honoring it is
  automatic wherever the tokens are used.

## E28.2 — enter animations
- **Page/section enter:** a subtle fade + 8px rise over `--motion`, on primary
  content regions (dashboard panels, organizer tabs, marketing sections). Use
  `--ease-out`.
- **List-row stagger:** repeating lists (agenda rows, program sessions, messages,
  ingest "will create" rows) fade+rise with a ~40ms per-row delay, capped so a
  200-row programme doesn't take 8 seconds — cap total stagger at ~10 items, rest
  appear together. State the cap mechanism.
- Runs once on mount, not on every re-render (guard against the React double-fire).

## E28.3 — control motion
- Segmented controls (List/Grid/By room; My/Event timezone; Event/My Schedule):
  the active-segment background *slides* to the selected option over
  `--motion-fast` rather than jumping.
- Tab changes in the organizer console: quick cross-fade of panel content.
- Modal/panel open (incl. the Event assistant, ConfirmDialog): fade + subtle
  scale-from-98% over `--motion`, backdrop fades in. Close reverses.

## E28.4 — loading shimmer
Replace static skeleton bars with a gentle shimmer (animated gradient sweep,
~1.5s loop, `--ease-in-out`). One reusable `.skeleton` treatment; apply where
skeletons already exist (organizer events list, etc.). Reduced-motion → static
skeleton, no sweep.

## Out of scope for E28
No count-ups (E30), no new elevation/shadows (E29), no color/gradient changes,
no glass. Motion only.

## Acceptance
- With motion ON: sections fade+rise in, lists stagger (capped), segmented
  controls slide, modals scale-fade, skeletons shimmer.
- With `prefers-reduced-motion: reduce` set (macOS: System Settings →
  Accessibility → Display → Reduce motion): **everything appears instantly, no
  movement, no shimmer.** Verify this explicitly — it's the acceptance that
  matters most.
- No layout shift from the animations (transform/opacity only, never animating
  width/height/top).
- No contrast or behavior changes; all existing tests green.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** DB suites per RUNBOOK §12 if touched
  (this chunk shouldn't touch them).
- Motion values in the token layer only.
- Stop the web dev server first; reset ritual after (README).

---

# Chunk E29 — depth + spacing audit (the visible "less clunky" chunk)

DESIGN_PHASE_E Option A, phase 2. This is where the change becomes visible.
Start with the two screens the founder named clunky — the **attendee/organizer
agenda** and the **Program tab** — because they're the worst offenders and the
most-used surfaces.

## The core problem (seen in the 2026-08-07 agenda screenshot)
Repeating sessions render as oversized boxed cards (~140px) with a large empty
middle, and the per-session action row (Q&A/Like/Star/Edit) is stranded at the
card bottom, far from its title. This contradicts the project's OWN design
principle (DESIGN_PHASE_D Part 1, point 6: "rows, not floating cards, ~70–85px
per row"). The screen looks unfinished because of dead space and weak anchoring,
not missing content.

## E29.1 — agenda/session row density (highest-impact)
Rebuild the session item as a **tight row**, not a tall card:
- Target ~72–88px per row at rest; no large empty vertical band.
- Title + meta line (time · room · track · speakers) grouped at top-left with
  consistent 4px-scale spacing; **the action affordances (Q&A/Like/Star/Edit and
  the join toggle) sit on the same baseline as the title, right-aligned** — not
  stranded below. On hover the row can reveal secondary actions; primary state
  stays quiet.
- Keep the track-color left bar (already present, correct).
- Concurrency: side-by-side per Phase D, unchanged behavior.
- Applies to both the attendee agenda (`dashboard.tsx`) and the organizer
  Program tab session list (`ProgramTab.tsx`).
- Rows use the E28 stagger on load (already wired) — now they'll look right doing it.

## E29.2 — elevation step + focus
- Add one elevation token above `--shadow-2` — `--shadow-3` for genuinely
  floating surfaces (modals, the assistant panel, dropdowns/popovers). Not glass,
  not everywhere; depth as punctuation.
- Add a consistent `--focus-ring` treatment (visible, accessible) and apply it to
  interactive controls that currently rely on the browser default.
- Modals/assistant adopt `--shadow-3` so they lift off the page.

## E29.3 — spacing rhythm audit
Screen-by-screen pass on the named offenders first, then the rest of the console:
- Every gap/padding pulled onto the 4px scale (`--space-*`); remove one-off pixel
  values.
- Consistent page gutter and max content width across organizer pages.
- The right-hand filter rail on the agenda: tighten row height to the Phase D
  ~31px quiet-gray spec; it currently reads loose.
- Section headers get consistent spacing above/below (the audit's C3
  "text all over the place" is largely this).

## Out of scope
No color/gradient/texture changes (that's the optional E32 marketing polish).
No new motion (E28 done). No empty-state/number work (E30). No behavior changes.

## Acceptance
- The agenda no longer shows large empty bands inside session cards; a laptop
  screen shows meaningfully more sessions at once (density up).
- Action controls sit with their titles, not stranded below.
- Modals and the assistant visibly lift off the page (new elevation).
- Spacing is consistent (no eyeballed one-off gaps) on agenda + Program tab.
- Contrast unchanged/better; keyboard focus visible everywhere; all tests green.
- Before/after screenshots of the agenda and Program tab show an obvious
  density/tidiness improvement.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** DB suites per RUNBOOK §12 if touched.
- Design values in the token layer only; no hardcoded hex/px in components.
- Stop the web dev server first; reset ritual after (README).

---

# Chunk E30 — surface polish: the edit drawer, form rhythm, states

DESIGN_PHASE_E Option A, phase 3. E29 tightened the agenda behind the drawer;
now the drawer itself is the weakest surface (founder flagged it 2026-08-07).
Lead with it, then the general form/state craft.

## E30.1 — the Edit session drawer (lead item; `pages/dashboard.tsx`)
Seen in the 2026-08-07 screenshots. Problems:
- **Two stacked "Drop a file here" dropzones** (Presentation link + Materials
  upload) — redundant and cluttering. Collapse to ONE clear materials area: a
  single dropzone plus the "Presentation or resource link" text field, grouped
  under one "Materials" subheading. (Verify the two currently map to different
  fields before merging; if they genuinely target different data, keep both but
  give them one shared, labelled group with a single dropzone affordance and a
  clear caption for each — do not show two identical empty dropzones.)
- **Loose, inconsistent field spacing** — pull every gap onto `--space-*`;
  consistent label→field→next-field rhythm.
- **Header and Save/Cancel/Delete scroll away.** Make the drawer a proper
  three-part layout: sticky header ("Edit session" + a close ✕), scrolling body,
  sticky footer with the actions. Save primary, Cancel quiet, **Delete visually
  separated** from Save/Cancel (it currently sits right beside Save — move it to
  the left or behind a small gap so a mis-click can't destroy a session).
- Section headers (Basics / Schedule / Materials / Roster & waitlist) get
  consistent weight and spacing; the drawer already has `--shadow-3` from E29.
- Constrain form field line-length inside the wide drawer (max ~520px content
  column) so inputs don't stretch the full panel width.
- Same treatment applies to the **+ New session** drawer (same component).

## E30.2 — form & modal rhythm (general)
Apply the drawer's spacing rules to the other forms/modals (EventSettingsModal,
CFP forms, the ingest panels): consistent label/field spacing, one field-group
pattern, sticky action footers where the form scrolls.

## E30.3 — empty states that teach
Rewrite bare empty states ("No messages yet", "No conversations yet",
"No one on the waitlist", empty agenda day) to orient + quietly guide: a short
line of what this area is for + the primary action. Calm, not cute — no
illustrations-for-illustration's-sake. Copy through the config layer.

## E30.4 — loading shimmer + confident numbers
- Ensure the E28 shimmer is applied wherever a spinner or static skeleton still
  shows (audit for leftovers).
- Where a real figure is shown (attendee counts, "22 sessions found" on ingest,
  analytics headline numbers), give it confident type weight/size. **One** earned
  count-up on the ingest result only; nowhere else.

## Out of scope
Assistant elevation (E31). Marketing texture/color (E32). No behavior/schema
changes — the drawer's save/delete logic is unchanged; this is layout + the
one dropzone consolidation.

## Acceptance
- The Edit/New session drawer shows ONE materials area, consistent field
  spacing, a sticky header with close ✕, and a sticky footer with Delete clearly
  separated from Save/Cancel.
- No form field stretches the full width of the wide drawer.
- Every named empty state teaches rather than just stating absence.
- No spinner/static-skeleton leftovers; ingest result number is confident with a
  single tasteful count-up.
- Contrast unchanged/better; reduced-motion still suppresses the count-up and
  shimmer; all tests green.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** DB suites per RUNBOOK §12 if touched.
- Copy + design values through the config/token layers.
- Stop the web dev server first; reset ritual after (README).

---

# Chunk E31 — AI-understand real spreadsheets (fixes a wrong E21 decision)

Found 2026-08-07 when the founder uploaded a real conference file,
`IB Dunia 2025 - Rooming.xlsx`. It exposed a genuine miss in E21.

## What's wrong
E21 routed all XLSX to the **non-AI CSV column-mapper** ("No AI involved"),
on the assumption spreadsheets are already clean/structured. Real ones are not.
The founder's file:
- **3 sheets**, one per timeslot ("Breakout Session 1 (10.00–11.00)", etc.)
- columns `Sessions / No / Topic / Room / Facilitator`
- **no start/end time columns at all** — the times are embedded in the SHEET NAMES
- multi-line cells (a Facilitator cell contains name + role on separate lines)

The column-mapper requires columns that map to title/start/end. This file has no
time column, so it fails with "Map a column to title, start, end" and can create
nothing — even though a human (or the AI PDF path) can clearly read it. The
product's whole promise is "bring your messy program, AI makes sense of it"; the
spreadsheet path broke that promise for exactly the messy case.

## Fix — give spreadsheets the AI path, keep the clean path as an option
1. When an XLSX/CSV is uploaded, offer two routes:
   - **"Let AI read it"** (default for messy files): send the sheet(s) — including
     **sheet names**, which carry timeslot info — to the existing AI extractor
     used for PDFs (`lib/ai/ingest`). It already produces a reviewable changeset
     with assumptions and per-row confidence; reuse it wholesale. The model can
     infer start/end from a tab name like "(10.00–11.00)", map Topic→title,
     Facilitator→speakers, Room→room, and flag what it guessed.
   - **"Map columns myself"** (the current E21 flow): keep for users with a clean
     sheet who want zero AI and exact control. It's good; it just shouldn't be the
     only option.
2. **Multi-sheet:** don't force picking one sheet. Let the AI read all sheets (or
   let the user select several), since a real program spans tabs. Sheet name
   becomes context, not a thing to discard.
3. Serialize each sheet to a compact text/CSV representation (sheet name as a
   heading) and feed it through the extractor — this reuses the E10 token-ceiling
   and E9.2 empty-extract-guard work for free.
4. Honest errors per the standing rule: password-protected, empty, unreadable.

## Acceptance
- `IB Dunia 2025 - Rooming.xlsx` uploaded → "Let AI read it" → a reviewable
  changeset with real session titles (from Topic), rooms, facilitators as
  speakers, and start/end inferred from the sheet-name timeslots, with the
  timeslot inference surfaced as an assumption.
- The "map columns myself" path still works unchanged for a clean template CSV.
- Multi-sheet workbooks no longer force a single-sheet choice for the AI path.
- Unit test: sheet-name-with-timeslot → inferred start/end reaches the changeset.

## Standing rules
- **NEVER set `ALLOW_DESTRUCTIVE_DB`.** DB suites per RUNBOOK §12.
- All AI via the gateway; agents draft, humans confirm (the review screen already
  enforces this).
- Stop the web dev server first; reset ritual after.

---

# Chunk F0 — pre-design quick wins (from the full UX audit synthesis)

Small, near-zero-risk fixes the audit surfaced that should not wait for the
design phase. See docs/ux-audit-full/00-SYNTHESIS.md.

## F0.1 — remove the attendee pricing upsell (anti-goal breach)
`components/ConciergeChat.tsx:237-244` shows a "See plans" pricing upsell to
ATTENDEES, who cannot buy anything. This violates the no-dark-pattern
positioning (HANDOFF_BRIEF §1). Remove the upsell from the attendee-facing
assistant entirely. (Organizer-facing upgrade prompts elsewhere are fine; this
is specifically the attendee surface.)

## F0.2 — console navigation truth
`pages/organizer/events/[eventId]/index.tsx`:
- Put the active tab in the URL (`?tab=program` etc. — a deep-link path already
  exists from E12; make Back/refresh preserve the tab instead of resetting to
  Overview and instead of Back exiting the whole console).
- Fix the sidebar highlight: it's hardcoded to "Overview"; it should reflect the
  actual active section.

## F0.3 — the dead global search
The top-bar search is a `readOnly` control on every authed page — it looks like a
feature that doesn't exist. Real search is a later feature, not F0. For now,
**remove/hide the dead control** so the UI doesn't promise something it can't do.
(A real search lands in a future chunk.)

## NOT in F0 — founder decision, not a code change
The live Terms and Privacy pages show a "DRAFT — requires legal review" banner.
**Do NOT remove the banner** — that would hide, not fix, the fact the docs are
unreviewed. The honest path is: get the docs a legal pass, then drop the banner
truthfully. Left as a founder to-do, not code.

## Acceptance
- Attendees never see a pricing upsell in the Event assistant.
- Console tab survives Back/refresh and deep-links; sidebar highlight is correct.
- No dead readOnly search control remains on authed pages.
- Terms/Privacy DRAFT banner unchanged (deliberately).
- All tests green.

## Standing rules
- **NEVER set ALLOW_DESTRUCTIVE_DB.** DB suites per RUNBOOK §12 if touched.
- Presentation/nav only; no schema/API changes. Reset ritual after.

---

# Chunk F1 — the pattern kit (foundation for DESIGN_PHASE_F)

Build the reusable content-first components + warmer tokens ONCE, prove them on
the styleguide page. **No existing page is rewritten in F1** — F2–F6 adopt the
kit. This is what keeps every screen consistent instead of drifting.

Reference: DESIGN_PHASE_F.md, the two chat mockups (community content-first;
organizer overview), and docs/ux-audit-full/00-SYNTHESIS.md.

## F1.1 — warmer tokens (extend, don't replace)
Add to `tokens.css` alongside the existing scale (keep everything E28–E30):
- `--radius-card: 14px`, `--radius-pill: 999px` (softer than the current 10px max;
  data rows keep their tight radii).
- Surface layering already exists (`--surface-*`); confirm a page→card→inner
  progression is expressible. Add tinted section-icon backgrounds using existing
  role tints (`--primary-50` etc.) — no new colors.
- Reuse E28 motion + E29 `--shadow-3`. No gradients, no glass.

## F1.2 — the components (in apps/web/components/kit/)
Each: token-driven, reduced-motion-safe, keyboard-accessible, copy via config
where user-facing. Build as presentational React components with clear props.
1. **PageHeader** — title + one-line state/subtitle + optional primary action
   (right-aligned). The wayfinding pattern for every page. Optional tinted icon
   tile. (Audit Theme B: no consistent header exists today.)
2. **Composer** — collapsed affordance ("New post" / "Ask…") that expands inline
   to the full input on click; Esc/cancel collapses; supports a primary submit.
   This is the content-first heart (kills form-first Community/Q&A).
3. **FeedCard** — avatar/initials + name + meta + optional status pill + body +
   inline action row. The rich scannable card from the mockup.
4. **StatCard** — muted label + big confident number; opt-in count-up (reuses the
   E30 CountUp; reduced-motion → static). For the overview stat row.
5. **FilterPills** — pill row, one active (accent-filled), icon-led, keyboard
   navigable. Replaces the boxy filter rows.
6. **EmptyState** — soft icon tile + headline (an invitation, not "Nothing here
   yet") + one-line body + optional CTA. Per CDS content guidance.
7. **SlideOver** — right-anchored panel with sticky header (title + close ✕),
   scrolling body, sticky footer; supports progressive disclosure ("More
   options" section). Adopts `--shadow-3`. This is the E30 drawer pattern,
   generalized, for F4.

## F1.3 — styleguide
Extend `pages/styleguide.tsx` with a section demoing every kit component in its
states (default/hover/active/empty/loading), so the pattern is discoverable and
review-able. This is the F1 deliverable the founder reviews.

## Out of scope for F1
No real page adopts the kit yet (that's F2+). No behavior/schema/API changes.

## Acceptance
- All seven components exist in components/kit/, token-driven, reduced-motion-safe,
  keyboard-accessible, each shown on /styleguide in its states.
- Zero changes to real app pages (diff touches only kit/, styleguide.tsx,
  tokens.css, globals.css, config copy).
- Contrast holds; all tests green; a component test covers Composer collapse/
  expand and StatCard reduced-motion.

## Standing rules
- **NEVER set ALLOW_DESTRUCTIVE_DB.** DB suites per RUNBOOK §12 if touched.
- Tokens/config only for values/copy. Stop the web dev server first; reset after.

---

# Chunk F1.5 — color architecture: neutral chrome + event-driven accent

Implements the 2026-08-07 color decision in DESIGN_PHASE_F. Small, token-level;
no new components, no page rebuilds. Do this BEFORE F2 so the overview is built
in the final color model, not repainted.

## F1.5.1 — neutralize the app chrome
- Primary buttons / primary actions in the APP (not marketing) become
  near-neutral (a dark neutral from the gray ramp, ~`--gray-800/900`), not blue —
  the Sched/Linear/Stripe approach. Update the shared button treatment in
  globals.css so this flows everywhere.
- Reduce blue used decoratively (selected rows, chips, links) to the *accent*
  variable defined below, so blue is scarce and intentional, not wallpaper.
- Do NOT touch marketing pages (index, pricing, compare, help, security) — UKEDL's
  own site keeps its brand blue as identity.

## F1.5.2 — make the accent a runtime variable
- Introduce `--event-accent` (+ `-hover`, `-tint` for selected/tint states,
  `-on` for text-on-accent). Default `--event-accent: var(--primary)` so nothing
  breaks where no event context exists.
- Point the in-app accent usages (selected states, links, focus ring, filled
  accent buttons like the kit's) at `--event-accent` rather than raw `--primary`.
- The kit (FilterPills active, Composer submit, StatCard, PageHeader action)
  reads `--event-accent`.

## F1.5.3 — feed the event's brand color in
- Where an event context exists (organizer console for an event; public
  `/e/[slug]`), set `--event-accent` from the event's stored `brandColor` on a
  wrapping element (inline style var on the shell, or a small injected style).
- **Contrast safety (required):** if `brandColor` is too light for white text,
  derive a darker shade for `--event-accent`/`-on`, or fall back to the neutral
  default. Never render an unreadable CTA. Add a helper (e.g.
  `accentFromBrand(hex)` returning accessible accent + on-color) and unit-test it
  with a light color (e.g. #FFD400) → readable result.
- No brand color set → neutral default (a restrained blue-gray), not bright blue.

## Out of scope
Marketing-site colors; track colors (stay categorical); dark mode (later);
per-event *theme presets* beyond the single accent (later attendee work).

## Acceptance
- App primary buttons are neutral, not blue; the styleguide reflects it.
- Setting an event's brand color changes that event's accent (console + public
  page) — demonstrable by changing brandColor in event settings.
- A very light brand color still yields a readable button (contrast helper +
  test).
- Marketing pages unchanged. Contrast holds app-wide. All tests green.

## Standing rules
- **NEVER set ALLOW_DESTRUCTIVE_DB.** DB suites per RUNBOOK §12 if touched.
- Tokens/CSS only; no schema/API changes (brandColor already exists). Reset after.

---

# Chunk F2 — organizer Overview: the content-first home

DESIGN_PHASE_F rollout, step 2. The audit's #1 fix. Build the orienting overview
from the F1 kit, in the F1.5 color model. This replaces the current Overview tab,
which leads with the entire settings form.

Reference: the organizer-overview mockup shown in chat 2026-08-07;
docs/ux-audit-full/03-organizer-console.md; DESIGN_PHASE_F.

## What the new Overview shows (top to bottom)
1. **PageHeader** (kit): event name + state line ("Draft · Jun 8–10 · N steps
   from publishing") + primary action (Publish, or Preview when published).
2. **StatCard row** (kit): Sessions · Speakers · Registered · Rooms — real counts
   from existing data, with the opt-in count-up (reduced-motion safe). These are
   an *earned* count-up home.
3. **"Before you publish" checklist** — reuse the existing SetupAssistantPanel /
   setupChecklist logic (it already reads live event state: sessions, rooms,
   speakers, venue, draft sessions, publish status). Render as a clean checklist
   with done/attention/todo states and a deep link to the tab that fixes each.
4. **Quick actions** (kit cards): Import program · Edit program · Preview public
   page — deep-linking to the existing screens.

## What moves OFF the Overview
- **Event settings** (name/description/timezone/venue/brand color/dates) moves
  into a **SlideOver** (kit) opened from a "Settings" action in the header —
  progressive disclosure. It is no longer the first thing you see. Same fields,
  same save logic (unchanged) — just relocated and grouped (essential fields
  shown; advanced behind "More options").

## Rules
- Content-first: state and next-actions are the hero; the settings FORM is on
  demand, not on arrival.
- Reuse existing data/logic; this is presentation + relocation. No schema/API/
  behavior changes to settings save, publish, or the checklist computation.
- Uses `--event-accent` (F1.5) so the overview wears the event's color.

## Acceptance
- Landing on an event opens to state + checklist + stats + quick actions — NOT a
  settings form.
- The "before you publish" items reflect real event state and deep-link correctly.
- Settings open in a SlideOver and save exactly as before.
- Stat count-ups respect reduced-motion. Contrast holds. All tests green.
- Before/after: the Overview no longer greets the user with a form.

## Standing rules
- **NEVER set ALLOW_DESTRUCTIVE_DB.** DB suites per RUNBOOK §12.
- Kit + tokens + config only. Stop the web dev server first; reset after.
