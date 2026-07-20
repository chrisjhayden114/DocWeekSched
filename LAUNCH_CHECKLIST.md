# LAUNCH_CHECKLIST.md — Phase 7 cutover

Every item must be checked (or consciously waived, with a note) before opening the
product to paying customers. Default owner: Chris Hayden. References:
`RUNBOOK.md` §10 (env), `.env.example` (var docs), `GAP_REPORT.md` (deferred items).

Status legend: `todo` · `in-progress` · `blocked` · `done (YYYY-MM-DD)`.

## 1. Domains, cookies, CORS

- [ ] **API on `api.ukedl.com`** — custom domain on Render, TLS issued. *Owner: Chris · Status: todo*
- [ ] **Cookie flags for same-site setup** — `COOKIE_DOMAIN=.ukedl.com`, `COOKIE_SAMESITE=lax`, `COOKIE_SECURE=true`; retire the interim `SameSite=None` config. Verify login works on `ukedl.com` and `www.ukedl.com`. *Owner: Chris · Status: todo*
- [ ] **CORS origins** — `WEB_BASE_URL=https://ukedl.com` on the API (allowlist auto-includes the `www.` variant); confirm no `*.onrender.com` or localhost origins remain. *Owner: Chris · Status: todo*
- [ ] **`API_PUBLIC_URL=https://api.ukedl.com`** — ICS feed URLs; preflight makes this fatal if forgotten. *Owner: Chris · Status: todo*
- [ ] **HSTS verified on BOTH hosts** — `curl -sI https://ukedl.com` and `https://api.ukedl.com` show `Strict-Transport-Security` (web ships `max-age=31536000; includeSubDomains` via Chunk E headers). *Owner: Chris · Status: todo*
- [ ] **HSTS preload (post-launch)** — only after HSTS has run clean for a while: add `preload` to the header and submit to hstspreload.org. Deliberately NOT shipped in Chunk E — preload is effectively irreversible. *Owner: Chris · Status: todo*

## 2. Providers

- [ ] **Lemon Squeezy live keys** — live store, products/variants created; `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, all `LEMONSQUEEZY_VARIANT_*` set; `BILLING_PROVIDER=lemonsqueezy`. *Owner: Chris · Status: todo*
- [ ] **Lemon Squeezy webhook registered** — `https://api.ukedl.com/billing/webhooks/lemonsqueezy` with `LEMONSQUEEZY_WEBHOOK_SECRET`; events: order_created, subscription_created/updated/cancelled, subscription_payment_failed/success. Fire a test event and confirm entitlement updates. *Owner: Chris · Status: todo*
- [ ] **VAPID keypair generated** — `npx web-push generate-vapid-keys`; set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`. Keys are permanent — rotating invalidates all subscriptions. *Owner: Chris · Status: todo*
- [ ] **Resend production key + sending domain** — `RESEND_API_KEY`, `RESEND_FROM_EMAIL` on the real domain. *Owner: Chris · Status: todo*
- [ ] **SPF / DKIM / DMARC records** — published for the sending domain; Resend dashboard shows verified; test an invite lands in inbox (not spam) for Gmail + Outlook. *Owner: Chris · Status: todo*
- [ ] **AI provider key** — `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`; confirm hard caps (`AI_HARD_CAP_*`) are acceptable for launch. *Owner: Chris · Status: todo*
- [ ] **Storage decision** — either configure S3/R2 (`STORAGE_*`) or explicitly accept the data-URL-in-Postgres fallback for launch and record that decision here. *Owner: Chris · Status: todo*
- [ ] **Sentry DSNs** — `SENTRY_DSN` (API) + `NEXT_PUBLIC_SENTRY_DSN` (web), release tagging via git SHA; trigger one test error per side and see it arrive. *Owner: Chris · Status: todo*

## 3. Data safety & first boot

- [ ] **Demo seeded BEFORE first public boot** — run `npm run seed:demo` against production so the internal org owns the `demo` slug before any customer can claim lookalikes (slug is reserved either way; seeding makes the demo actually exist). *Owner: Chris · Status: todo*
- [ ] **Neon retention window confirmed** — record the PITR window in RUNBOOK §2 and confirm it meets the recovery objective. *Owner: Chris · Status: todo*
- [ ] **Restore drill performed + dated** — full RUNBOOK §3 procedure against a PITR branch; record the row in the RUNBOOK table. *Owner: Chris · Status: todo*
- [ ] **`ALLOW_DESTRUCTIVE_DB` absent from all production env** — check Render dashboard explicitly. *Owner: Chris · Status: todo*

## 4. Hardening verification

- [ ] **CSP report-only → enforce** — headers ship report-only by default (`apps/web/lib/securityHeaders.js`). Walk the full demo event (dashboard, scanner, maps, uploads, push, billing) with devtools open and zero CSP violations logged, then set `CSP_ENFORCE=1` in the Netlify build env and redeploy. No `unsafe-inline` in `script-src`, ever. Known watch item: if `NEXT_PUBLIC_SENTRY_DSN` is set, the browser SDK's `connect-src` to `*.ingest.sentry.io` will violate — decide (add the ingest origin or drop web Sentry) BEFORE enforcing. *Owner: Chris · Status: todo*
- [ ] **Rate-limit smoke test from a cold IP** — from a network that hasn't hit the API (mobile hotspot/VPS): hammer `POST /auth/login` and one public CFP route; expect 429s at the documented thresholds; confirm normal browsing is unaffected. *Owner: Chris · Status: todo*
- [ ] **Uptime monitor → `/health/ready`** — external monitor (UptimeRobot or similar) on `https://api.ukedl.com/health/ready` expecting HTTP 200; alert to email/phone. `/health` alone is NOT sufficient (doesn't cover DB/poller). *Owner: Chris · Status: todo*
- [ ] **Boot-log preflight review** — after the production deploy, read the first screen of API logs; zero unexpected `[preflight]` warnings. *Owner: Chris · Status: todo*

## 5. Rename & legal

- [ ] **Final product name decided** — replaces the "Colloquium" working name; update `packages/config` branding in one commit. *Owner: Chris · Status: todo*
- [ ] **Post-rename domain purchased + redirects planned** — ukedl.com → new domain strategy (or keep ukedl.com). *Owner: Chris · Status: todo*
- [ ] **ToS + Privacy Policy legal sign-off** — including the subprocessor list (Neon, Render, Netlify, Resend, Lemon Squeezy, Anthropic, Sentry, storage provider). *Owner: Chris · Status: todo*
- [ ] **Support commitment reviewed** — `supportHours` in `packages/config` matches what one person can actually deliver. *Owner: Chris · Status: todo*

## 6. CI / deploy gating

- [ ] **CI green on the launch commit** — lint + typecheck + unit + DB tests (`.github/workflows/ci.yml`). *Owner: Chris · Status: todo*
- [ ] **Render/Netlify deploy only on green** — see "Deploy gating" in `.github/workflows/ci.yml` header comment; verify a red build does not deploy. *Owner: Chris · Status: todo*
