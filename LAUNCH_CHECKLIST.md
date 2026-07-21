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

- [ ] **Resend key + verified sending domain** — `RESEND_API_KEY`, `EMAIL_FROM` on `ukedl.com`, `EMAIL_PROVIDER=resend` in Render. Without this, self-serve registration is a dead end (`CUSTOMER_TEST_FINDINGS.md` #1). *Owner: Chris · Status: todo · **P0***
- [ ] **SPF / DKIM / DMARC published + verified** — Resend dashboard shows Verified; a real invite lands in the inbox (not spam) for Gmail **and** Outlook. *Owner: Chris · Status: todo · **P0***
- [ ] **P0 acceptance test** — register a brand-new account with a real inbox → verification email arrives → click through → sign in successfully. *Owner: Chris · Status: todo · **P0***
- [ ] **Verify-link fallback shipped** (FIX_PLAN chunk E1 item 1) — so an unconfigured or failing email provider can never silently lock users out again. *Owner: Cursor · Status: todo · **P0***

## 1. Domains, cookies, CORS

- [x] **API on `api.ukedl.com`** — custom domain on Render, TLS issued. *done (2026-07-20)*
- [x] **Cookie flags for same-site setup** — `COOKIE_DOMAIN=.ukedl.com`, `COOKIE_SAMESITE=lax`, `COOKIE_SECURE=true`; login verified on `ukedl.com`. *done (2026-07-20)*
- [x] **CORS origins** — `WEB_BASE_URL=https://ukedl.com`; no `*.onrender.com` or localhost origins remain. *done (2026-07-20)*
- [x] **`API_PUBLIC_URL=https://api.ukedl.com`** — ICS feed URLs; preflight fatal if missing. *done (2026-07-20)*
- [x] **HSTS verified on BOTH hosts** — confirmed via curl on web + API. *done (2026-07-20)*
- [ ] **HSTS preload (post-launch)** — only after HSTS has run clean for a while; effectively irreversible. *Owner: Chris · Status: todo*

## 2. Providers

- [ ] **Resend** — see §0. *Status: todo · **P0***
- [ ] **AI provider key** — `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`; confirm `AI_HARD_CAP_*` values are acceptable. Until this is set the product runs the **mock** provider: Agenda ingest, Setup copilot, Concierge, Matchmaker, Ops and Recap all return canned output, which makes the homepage's core claim untrue. *Owner: Chris · Status: todo · **P1***
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
- [ ] **Uptime monitor → `/health/ready`** — external monitor expecting HTTP 200, alerting to email/phone. `/health` alone is insufficient (doesn't cover DB/poller). *Owner: Chris · Status: todo*
- [x] **Boot-log preflight review** — API logs read after cutover; warnings are the expected optional-integration set. *done (2026-07-20)*

## 5. Product fixes from the customer test (see FIX_PLAN.md)

- [ ] **E1 — honesty & unblocking** — verify-link fallback, env preflight warning, Help index, billing-honesty copy, ingest error states, organizer name on public event pages. *Owner: Cursor · Status: todo · **P0/P1***
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
