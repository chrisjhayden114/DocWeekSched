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
