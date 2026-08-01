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
- [ ] **Lemon Squeezy store + products** — live store; products/variants for all six catalog SKUs (Pro monthly, Pro annual, per-event 250/500/1000; Enterprise stays contact-us). Merchant-of-record onboarding asks for tax details (SSN/EIN) and a payout bank account. No monthly fee; 5% + 50¢ per transaction. *Owner: Chris · Status: todo · **P1***
- [ ] **Lemon Squeezy keys** — `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, all `LEMONSQUEEZY_VARIANT_*`, `BILLING_PROVIDER=lemonsqueezy`. *Owner: Chris · Status: todo*
- [ ] **Lemon Squeezy webhook registered** — `https://api.ukedl.com/billing/webhooks/lemonsqueezy` with `LEMONSQUEEZY_WEBHOOK_SECRET`; events: order_created, subscription_created/updated/cancelled, subscription_payment_failed/success. *Owner: Chris · Status: todo*
- [ ] **Billing validated in TEST MODE first** — test purchase with a test card → webhook fires → entitlement updates on the org → plan caps change → receipt arrives. **This code path has never run in production**; validate before going live. *Owner: Chris · Status: todo · **P1***
- [ ] **VAPID keypair generated** — `npx web-push generate-vapid-keys`; set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`. Keys are permanent — rotating invalidates all push subscriptions. *Owner: Chris · Status: todo*
- [ ] **Storage decision** — configure S3/R2 (`STORAGE_*`) or explicitly accept the data-URL-in-Postgres fallback and record the decision here. *Owner: Chris · Status: todo*
- [ ] **Sentry DSNs** — `SENTRY_DSN` (API) + `NEXT_PUBLIC_SENTRY_DSN` (web); trigger one test error per side and confirm arrival. *Owner: Chris · Status: todo*
- [ ] **Status page** — stand one up (Better Stack / Instatus free tier) and point `brand.statusPageUrl` at it, or leave the footer link removed (E1 removes it by default). *Owner: Chris · Status: todo*

## 3. Data safety & first boot

- [x] **Demo seeded before public boot** — `npm run seed:demo` run against production; internal org owns the `demo` slug. *done (2026-07-20)*
- [ ] **Neon retention window confirmed** — record the PITR window in RUNBOOK §2. *Owner: Chris · Status: todo*
- [ ] **Restore drill performed + dated** — full RUNBOOK §3 procedure against a PITR branch. *Owner: Chris · Status: todo*
- [x] **`ALLOW_DESTRUCTIVE_DB` absent from production env** — verified in Render. *done (2026-07-20)*

## 4. Hardening verification

- [ ] **CSP report-only → enforce** — walk the full demo event with devtools open, zero violations, then `CSP_ENFORCE=1` in the Netlify build env. Never `unsafe-inline` in `script-src`. After enforcing, verify Sentry events still arrive. *Owner: Chris · Status: todo*
- [ ] **Rate-limit smoke test from a cold IP** — expect 429s at documented thresholds; normal browsing unaffected. *Owner: Chris · Status: todo*
- [ ] **Triage `npm audit` (8 findings incl. 1 critical printing on every build)** — identify which are in runtime deps vs dev tooling; patch what's real. Do before taking customer data at scale. *Owner: Chris + Cursor · Status: todo*
- [ ] **Uptime monitor → `/health/ready`** — external monitor expecting HTTP 200, alerting to email/phone. `/health` alone is insufficient (doesn't cover DB/poller). *Owner: Chris · Status: todo*
- [x] **Boot-log preflight review** — API logs read after cutover; warnings are the expected optional-integration set. *done (2026-07-20)*

## 5. Product fixes from the customer test (see FIX_PLAN.md)

- [x] **E1 — honesty & unblocking** *(done 2026-07-31, commit 8955444, 11 items; verified on production: billing-honesty CTAs live on /pricing, /help article index renders on Netlify (root cause was __dirname in the compiled bundle), ingest always ends in a visible outcome, hosted-by on public pages, status link removed, stale-branded placeholder PDFs deleted, AI model fallback now claude-sonnet-5 + friendly provider-error copy, placeholder confidence label suppressed)*
- [ ] **E2 — organizer editing** — edit/delete for tracks, rooms, sessions, papers; event settings panel; timezone picker; slug preview; date warnings; publish guard. Web-only (the API already exposes PUT/DELETE). *Owner: Cursor · Status: todo · **P1***
- [ ] **E3 — CSV import + clarity** — CSV session import, speakers/papers explainer, signup-first CTA, last-updated dates, OG tags for event pages. *Owner: Cursor · Status: todo*
- [ ] **E4 — wizard robustness** — form state survives remount; Back preserves input; edit-details link after draft creation. *Owner: Cursor · Status: todo*

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
