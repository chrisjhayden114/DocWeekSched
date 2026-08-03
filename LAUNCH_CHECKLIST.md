# LAUNCH_CHECKLIST.md — cutover + full-operation checklist

Every item must be checked (or consciously waived, with a note) before opening the
product to paying customers. Default owner: Chris Hayden. References:
`RUNBOOK.md` §10 (env), `.env.example` (var docs), `GAP_REPORT.md` (deferred items),
`CUSTOMER_TEST_FINDINGS.md` + `FIX_PLAN.md` (July 2026 end-to-end product test).

Status legend: `todo` · `in-progress` · `blocked` · `done (YYYY-MM-DD)`.

> **Read this first.** The July 2026 customer test proved that **Resend is not a
> nice-to-have — it is a hard blocker.** Registration creates users with
> `emailVerifiedAt: null` and login returns 403 until verification, so with no email
> provider configured *every new signup is permanently locked out*. Nothing else in
> this list matters until §0 is green.

---

## 0. BLOCKERS — the product does not work for new users until these are done

- [x] **Resend key + Render env** *(done 2026-07-21)* — `RESEND_API_KEY`, `RESEND_FROM_EMAIL` on `mail.ukedl.com` (var is `RESEND_FROM_EMAIL`, not `EMAIL_FROM`), `EMAIL_PROVIDER=resend` in Render. **Sending domain `mail.ukedl.com` is ALREADY DKIM+SPF verified in Resend (set up 3mo ago); no new DNS needed.** The only "Failed" record is inbound-receiving MX, which UKEDL doesn't use — ignore it. Without the Render env vars, self-serve registration is a dead end (`CUSTOMER_TEST_FINDINGS.md` #1). *Owner: Chris · Status: todo · **P0***
- [x] **SPF / DKIM / DMARC published + verified** *(done 2026-07-21 — DKIM+SPF verified on mail.ukedl.com; real email landed in Gmail inbox)* — Resend dashboard shows Verified; a real invite lands in the inbox (not spam) for Gmail **and** Outlook. *Owner: Chris · Status: todo · **P0***
- [x] **P0 acceptance test** *(done 2026-07-21 — stranger registered on prod → verification email arrived → verified → signed in → landed on org creation)* — register a brand-new account with a real inbox → verification email arrives → click through → sign in successfully. *Owner: Chris · Status: todo · **P0***
- [x] **Verify-link fallback shipped** *(done 2026-07-31, commit 8955444 — verified locally: register with unconfigured provider shows verify-link panel; panel survives failed sign-in)* — an unconfigured or failing email provider can never silently lock users out again.

## 1. Domains, cookies, CORS

- [x] **API on `api.ukedl.com`** — custom domain on Render, TLS issued. *done (2026-07-20)*
- [x] **Cookie flags for same-site setup** — `COOKIE_DOMAIN=.ukedl.com`, `COOKIE_SAMESITE=lax`, `COOKIE_SECURE=true`; login verified on `ukedl.com`. *done (2026-07-20)*
- [x] **CORS origins** — `WEB_BASE_URL=https://ukedl.com`; no `*.onrender.com` or localhost origins remain. *done (2026-07-20)*
- [x] **`API_PUBLIC_URL=https://api.ukedl.com`** — ICS feed URLs; preflight fatal if missing. *done (2026-07-20)*
- [x] **HSTS verified on BOTH hosts** — confirmed via curl on web + API. *done (2026-07-20)*
- [ ] **HSTS preload (post-launch)** — only after HSTS has run clean for a while; effectively irreversible. *Owner: Chris · Status: todo*

## 2. Providers

- [x] **Resend** — see §0. *done (2026-07-21)***
- [x] **AI provider key** *(done 2026-07-31)* — `ANTHROPIC_API_KEY` + `AI_PROVIDER=anthropic` + `AI_MODEL=claude-sonnet-5` set in Render (the code's hardcoded fallback model was retired — AI_MODEL env var required; E1 updates the fallback). Acceptance test passed: 14-line program pasted on production → real changeset, 9 sessions incl. parallel 10:15 pair, 4 papers nested with ordered authors, rooms auto-created, assumptions surfaced, 0 errors. *Owner: Chris***
- [x] **Billing provider: STRIPE MANAGED PAYMENTS** *(decided + built + validated 2026-08-02; supersedes all Lemon Squeezy rows — LS is in wind-down post-Stripe-acquisition)* — chunk E5 (provider, signed webhooks, shared entitlement transitions) + E5.1 (persist planSku). Test store: 5 products w/ SaaS tax code txcd_10103001, webhook destination (5 events, API version 2026-07-29.dahlia, Snapshot payloads), env: BILLING_PROVIDER=stripe, STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_×5/API_VERSION=2025-03-31.basil (account default 2019-02-19 rejects Managed Payments).
- [x] **Billing validated in TEST MODE — full lifecycle on production** *(2026-08-02)*: Pro Monthly purchase with 4242 → checkout.session.completed + invoice.payment_succeeded delivered 200 → org → Pro, correct "Pro · Monthly" label after E5.1 → invoice listed → customer portal opens → cancel-at-period-end keeps plan active (correct) → immediate cancels via Workbench shell → customer.subscription.deleted → org reverts to Free → re-purchase works. Tax $0.00 for CA SaaS (MoR calculating correctly).
- [ ] **Billing GO-LIVE (the only step left before real revenue)** — Stripe "Verify your business" (EIN/SSN + payout bank), then swap Render env to live: STRIPE_SECRET_KEY=sk_live_..., new LIVE-mode webhook endpoint + its whsec_, five LIVE-mode products/prices (test-mode objects don't exist in live) → re-run one real-card $79 purchase + refund it. *Owner: Chris · Status: todo · **P1***
- [x] **E6 — post-provider polish** *(done 2026-08-02, commit ca40855; verified on production)* — zero "Lemon Squeezy" mentions remain (pricing FAQ/standfirst/tax note → Stripe MoR, billing Invoices box neutral, terms updated w/ new last-updated date); footer Status link restored → ukedl.betteruptime.com and statusPageUrl updated in config; signed-in /pricing shows "Upgrade" → /organizer/billing (finding #17 closed); subprocessor list now Neon/Render/Netlify/Resend/Stripe/Anthropic/Sentry/Better Stack.
- [x] **VAPID keypair** *(verified already configured, 2026-08-02)* — all three vars were set in Render from an earlier phase (public key verified real). DO NOT ROTATE — rotating invalidates every push subscription. Minor: VAPID_SUBJECT is mailto:cjhayden114@gmail.com; switch to mailto:support@ukedl.com opportunistically with a future env change (safe, non-breaking).
- [x] **Storage: Cloudflare R2 CONFIGURED** *(done 2026-08-02)* — chosen over the data-URL fallback because the Event Readiness roadmap means heavy uploads and a mid-flight migration was unacceptable. Bucket `ukedl-uploads` (Western North America), scoped Object-R&W API token, r2.dev public dev URL, all 8 STORAGE_* vars in Render, deployed. **Boot log now shows ZERO preflight warnings — every subsystem configured for the first time.** Later polish: replace r2.dev public URL with a custom domain when the Siap flip happens. Upload acceptance test: pending first real image upload.
- [x] **Sentry DSNs** *(done 2026-08-02)* — org `ukedl.sentry.io` (free tier; ignore Business-trial upsells — it downgrades automatically), projects `ukedl-api` + `ukedl-web`, `SENTRY_DSN` on Render + `NEXT_PUBLIC_SENTRY_DSN` on Netlify, both deployed. **Web side verified end-to-end**: test error thrown on production ukedl.com arrived in Issues within seconds. API side config-verified (clean boot with DSN; no throwing route exists to force a test 500 — it will prove itself on first real error).
- [x] **Status page** *(done 2026-08-02)* — https://ukedl.betteruptime.com live with "Website" + "API" resources. REMAINING (next web chunk): point brand.statusPageUrl at it and restore the footer Status link; optionally CNAME status.ukedl.com → statuspage.betteruptime.com later.

## 3. Data safety & first boot

- [x] **Demo seeded before public boot** — `npm run seed:demo` run against production; internal org owns the `demo` slug. *done (2026-07-20)*
- [x] **Neon retention window** *(done 2026-08-02)* — raised from 1 day to **7 days** and recorded in RUNBOOK §2.
- [x] **Restore drill performed + dated** *(done 2026-08-02)* — branch `restore-drill-2026-08-02` created from production via console, Event count = 5 verified in branch SQL Editor (matches prod), branch auto-deletes. Logged in RUNBOOK §3 table.
- [x] **`ALLOW_DESTRUCTIVE_DB` absent from production env** — verified in Render. *done (2026-07-20)*

## 4. Hardening verification

- [ ] **CSP report-only → enforce** — walk the full demo event with devtools open, zero violations, then `CSP_ENFORCE=1` in the Netlify build env. Never `unsafe-inline` in `script-src`. After enforcing, verify Sentry events still arrive. *Owner: Chris · Status: todo*
- [x] **Rate-limit smoke test** *(done 2026-08-02)* — two runs of 8 rapid bad-credential POSTs to /auth/login: run 1 = 401,401,401,429,401,401,429,429; run 2 (no deploy in flight, fresh fake email) = 401,401,429,401,401,401,429,429. **Security property holds: sustained brute force is blocked.** OPEN QUESTION (not a blocker): the stutter — 429s that release and re-trip — is not a simple 5/min window. Two mechanisms interact: the fixed-window counter in `authRateLimit` middleware AND `noteAuthFailure()` in the route handler, which sets short escalating blocks (5s × failures). Deploy-overlap and multi-instance theories were both tested and rejected. Worth a small investigation chunk to confirm the intended behaviour is what's happening (and that `noteAuthFailure`'s bucket key really matches the middleware's — the code comments warn about exactly that mismatch). RUNBOOK §7 already flags limits are per-process and must move to a shared store before scaling out.
- [x] **`npm audit` triage** *(done 2026-08-02, chunk E7)* — 9 findings → 1. Fixed: tar (critical, scoped override to 7.x under @mapbox/node-pre-gyp, bcrypt verified), postcss (override to 8.5.x), brace-expansion, body-parser/express, qs, esbuild via tsx. **Open + documented in SECURITY_NOTES.md:** next@14.2.35 — patched only in 15.5.21+/16.2.12+ (major bump). Accepted because apps/web is Pages Router with no middleware/i18n (App-Router advisories don't apply) and image optimization runs through Netlify's CDN, not the self-hosted optimizer. Revisit triggers documented: adding middleware/i18n, moving off Netlify, or a new Pages-Router advisory. **Deliberate future chunk: Next 15/16 upgrade (breaking — touches React 18→19 + Netlify runtime plugin).**
- [x] **Uptime monitor → `/health/ready`** *(done 2026-08-02)* — Better Stack free tier: monitors on api.ukedl.com/health/ready (covers DB) + ukedl.com (covers Netlify), 3-min checks, email alerts to cjhayden114@gmail.com.
- [x] **Boot-log preflight review** — API logs read after cutover; warnings are the expected optional-integration set. *done (2026-07-20)*

## 5. Product fixes from the customer test (see FIX_PLAN.md)

- [x] **E1 — honesty & unblocking** *(done 2026-07-31, commit 8955444, 11 items; verified on production: billing-honesty CTAs live on /pricing, /help article index renders on Netlify (root cause was __dirname in the compiled bundle), ingest always ends in a visible outcome, hosted-by on public pages, status link removed, stale-branded placeholder PDFs deleted, AI model fallback now claude-sonnet-5 + friendly provider-error copy, placeholder confidence label suppressed)*
- [x] **E2 — organizer editing** *(done 2026-07-31, commit 12d62ac, 9 items, web-only; verified on production Program tab with real data: inline edit/delete for tracks/rooms/sessions/papers, day-grouped layout, event-timezone display + local toggle, settings panel saves, timezone combobox, slug preview, publish guard, and the date-sanity warning correctly flagged the Oct-2024 ingest sessions inside a Jul-2026 event on first use. Cursor also caught and defended against the PUT-nulls-omitted-fields data-wipe hazard.)*
- [x] **E3 — CSV import + clarity** *(done 2026-07-31; verified on localhost: CSV round-trip with template download, column auto-mapping, per-row validation incl. unknown-track warnings, "Created 2 sessions" confirm, sessions appear in Program day groups. Also: speakers/papers explainer, /security last-updated, demo fixture rooms (appear after next demo reset), schema.org Event JSON-LD, twitter:image. Signup-first CTA was already shipped in E0.)*
- [x] **E4 — wizard robustness** *(done 2026-07-31; root cause found and fixed — org-fetch effect re-ran on router identity change and remounted the form; now fetch-once + router.isReady + per-tab sessionStorage draft persistence with tolerant parsing; edit-details anchor links from both created screens to the E2 settings panel)*

## 6. Rename & legal

- [ ] **Final product name decided** — replaces the interim UKEDL launch name; one-line change in `packages/config`. Blocked on trademark clearance for "Colloquium." *Owner: Chris + attorney · Status: blocked*
- [ ] **Post-rename domain purchased + redirects planned**. *Owner: Chris · Status: todo*
- [ ] **ToS + Privacy legal sign-off** — including the subprocessor list (Neon, Render, Netlify, Resend, Lemon Squeezy, Anthropic, Sentry, storage). The security page currently carries a visible DRAFT chip. *Owner: Chris + attorney · Status: todo*
- [ ] **FERPA alignment statement** on /security — cheap credibility with education buyers; pursue SOC 2 only when an enterprise deal demands it. *Owner: Chris · Status: todo*
- [ ] **Support commitment reviewed** — `supportHours` in `packages/config` matches what one person can actually deliver. *Owner: Chris · Status: todo*

## 7. CI / deploy gating

- [x] **CI green on the launch commit** — lint + typecheck + unit; DB suites gated behind the destructive guard by design. *done (2026-07-20)*
- [ ] **Render/Netlify deploy only on green** — verify a red build does not deploy. *Owner: Chris · Status: todo*

---

## Recommended order
1. **§0 Resend** — start now; DNS propagates while you do other things. Then run the P0 acceptance test.
2. **E1 in Cursor, in parallel** — makes the app honest immediately and removes the lock-out failure mode permanently.
3. **Anthropic key** → re-test Agenda ingest end-to-end with a real program.
4. **Lemon Squeezy in test mode** → validate purchase → webhook → entitlement → then flip live.
5. **E2** (organizer editing — the biggest daily-use win), then **E3**, **E4**.
6. Remaining hardening (§4), Sentry, storage decision, restore drill, status page.

---

## 8. Console walkthrough, 2026-08-02 (CSP audit + what it turned up)

**CSP: clean.** Full logged-in walkthrough of `/e/demo`, six session pages, the
dashboard Messages tab, and the organizer Agenda-ingest page with the Chrome
console open produced **zero Content Security Policy violation messages**. The
report-only header is emitting nothing. `CSP_ENFORCE=1` is safe to set.

The walkthrough did surface three unrelated defects:

### 8a. P0 REGRESSION — PDF/DOCX/XLSX upload ingest is broken by the R2 switch

Uploading `2026 DocWeek Schedule and Session Overview.pdf` produced
`0 create · 5 delete proposed` with the assumption *"The source provided only
references a stored file name … with no extractable text content."*

Root cause, confirmed by reading the code:

- `apps/api/src/routes/agendaIngest.ts` ~L210–230: for a file upload it calls
  `getStorageProvider().acceptUpload()`. It only extracts text when
  `stored.url.startsWith("data:")`; otherwise it falls through to the stub
  `` `[Stored file ${sourceFileName}]` ``.
- `apps/api/src/lib/ai/ingest/job.ts` L37–47: it only attaches the PDF as a
  multimodal document when `run.sourceUrl?.startsWith("data:")`.

Both branches keyed on the **Postgres data-URL fallback**. Now that
`STORAGE_PROVIDER=r2` returns an `https://…r2.dev/…` URL, both are false, so the
model receives the literal string `[Stored file …pdf]` and nothing else. Paste
and CSV ingest are unaffected; **URL and file upload of PDFs are the broken paths.**

This is a self-inflicted regression from configuring R2 — the storage change was
correct, but neither call site was updated to fetch bytes back from object
storage. Fix: after `acceptUpload`, fetch the stored object's bytes (or keep the
buffer in hand) and drive both `sourceText` and the multimodal `attachment` from
the bytes, not from the URL scheme.

### 8b. P1 — an empty extract proposes deleting the whole programme

The same run reported `0 create · 5 delete proposed`. An extract that yields zero
sessions must never propose deleting every existing session; that is a
data-loss-shaped default one mis-click away. Guard: if the extract returns no
sessions, propose **no** deletions and fail the run visibly.

### 8c. P1 (was P2) — `/resources` 401 loop: ROOT-CAUSED

Confirmed by reading both call sites. Two facts, both verified:

1. **It is a polling loop, not many bugs.** `apps/web/pages/session/[sessionId].tsx`
   L389–396 runs `reloadSessionAndMessages()` on a `setInterval(..., 8000)`. Every
   tick re-fires the failing request, so the red-line count grows with time spent
   on the page — 13, 11 and 22 occurrences were observed on single pages.
2. **The 401 is an auth-scheme leftover.** `fetchSessionResources` (L179–193) uses
   a **raw `fetch`** with only `Authorization: Bearer ${token}` and **no
   `credentials: "include"`**. Every other call on the page goes through
   `apiFetch` (`apps/web/lib/api.ts` L47–63), which sets `credentials: "include"`
   so the httpOnly cookie is sent cross-origin to `api.ukedl.com`. `apiFetch`
   ignores its token argument entirely (the parameter is literally named
   `_token`) — the app moved to cookie auth and this one call site was never
   migrated. So `requireAuth` sees no credential and returns 401 before the
   route's own 403 "Join this session" guard is ever reached.

Not user-visible: the client swallows the failure (`if (!res.ok) return []`), which
is why the panel just reads "No resources yet." But it means **session resources
are invisible to everyone, always** — a silently dead feature, plus ~8 needless
authenticated API calls per minute per open session page.

Fix: add `credentials: "include"` to `fetchSessionResources`, or better, route it
through `apiFetch` like everything else. Then re-test that a joined attendee can
actually see resources — that path has probably never worked in production.

### 8d. P2 — remaining console noise

Repeating red HTTP errors on every session page, logged in:

- `GET /event/maps/by-room/:roomId` → **404** when the room has no map
- `GET /attendees?take=500` → **404** on the dashboard Messages tab. Built by
  `apiFetchAll`, but no `/attendees` route is mounted at the API root — the caller
  is very likely pointing at a path that moved. **Not verified — find the caller.**

None of these break a visible feature, but they are the kind of noise that makes
a real error invisible during an incident, and 8c's third item suggests a caller
pointing at a path that no longer exists.

---

## 9. Chunks E9–E12 — shipped and verified on production, 2026-08-02

| Chunk | What it fixed | Verified |
|---|---|---|
| **E9** | PDF/file ingest regression from the R2 switch; empty-extract delete guard; session-resources 401 loop; `/attendees` 404 | ✅ prod |
| **E10** | `max_tokens: 4096` truncating every real programme; truncation now detected via `stop_reason` and reported honestly instead of as "invalid JSON" | ✅ prod |
| **E11** | Ingest Source panel showed a `[Binary …]` debug stub; result heading now names the file; combined "+ Add paper or resource" entry point | ✅ prod |
| **E12** | Confirm-drafts dead end (now "View program"); resources invisible in the Program tab; resource panel inverted on the session page; "data URLs" copy removed | ✅ prod |

**Headline result:** file ingest works end to end for the first time. A 7-page
DocWeek programme PDF produced 22 correct sessions with tracks and rooms, and a
re-run of the same file proposed `18 create · 4 update · 5 delete` — recognising
survivors and updating rather than duplicating them. Session resources also work
for the first time (they had returned 401 silently since the cookie-auth
migration).

**Also landed:** `.cursor/rules` now requires error messages to name the real
cause; README documents the reset ritual and pins **Node 20** (`.nvmrc` +
`engines`), which nothing enforced before.

### Verification gotcha worth remembering
The first E12 verification pass appeared to show *every* item failing. The deploy
was green and the code was correct — it was **browser cache**. A hard reload
(⌘⇧R) fixed it. Before debugging a deploy that "didn't take", confirm the
published commit in Netlify **and** hard-reload. Corollary worth considering
later: if stale HTML can fool the person who wrote the fix, it can fool an
organiser mid-conference.

### Still open after tonight
- **DOCX/XLSX ingest** — advertised in the upload UI, silently produces nothing.
  Same failure class as the PDF bug; a Word programme is common for this market.
- **Billing go-live** — Stripe business verification → live keys → live webhook →
  five live products → one real purchase, refunded. Last gate before revenue.
- Ingest takes 2+ minutes with no progress indication.
- Rate-limit stutter (open question, §8 above); HSTS preload (post-launch);
  Siap rename (awaiting attorney).
