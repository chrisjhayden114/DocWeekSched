# BRAND-R — UKEDL → Readyhall migration runbook

Date opened: 2026-09-01. Name verified clean (2 research rounds, 15 candidates;
Readyhall was the only full sweep: no collisions, virgin SERP, .com+.app free).
Domains registered 2026-09-01 via Cloudflare Registrar: readyhall.com,
readyhall.app. Logo assets staged in apps/web/public/brand-next/.
Tagline (also the SEO category line): "Calm event software for conferences and
PD days in education." Short form under logo: "Conference schedules and speaker
readiness, without the chase." Mascot: the octopus, informally "Octo".
Open item (non-blocking): formal USPTO clearance search when an attorney
reviews the privacy DRAFT banner. Repo name stays DocWeekSched.

## Sequencing principle
Nothing user-visible flips until DNS + email are provably ready. Order:
prepare (parallel) → code flip that accepts BOTH domains → domain cutover →
email cutover LAST (only after Resend verifies). ukedl.com 301-redirects to
readyhall.com indefinitely and stays registered.

## Phase 1 — Founder dashboard tasks (start now; some have wait times)
1a. Netlify → Domain management → Add domain: readyhall.com (and
    www.readyhall.com). Netlify shows the DNS targets. In Cloudflare DNS for
    readyhall.com, add exactly what Netlify asks (typically apex A/flattened
    CNAME + www CNAME to the site's netlify.app host). Set records to
    "DNS only" (grey cloud) — Netlify serves its own TLS. Do NOT change the
    primary domain yet; ukedl.com stays attached.
1b. Render (docweeksched-api) → Settings → Custom domains → add
    api.readyhall.com. Add the CNAME Render asks for in Cloudflare
    ("DNS only"). Keep api.ukedl.com attached.
1c. Resend → Domains → Add readyhall.com. Add the DKIM/SPF (TXT/CNAME/MX)
    records Resend lists into Cloudflare. Then WAIT for "Verified" (minutes to
    ~a day). No email sends from the new domain before this shows Verified.
1d. Cloudflare → readyhall.com → Email → Email Routing: enable, create
    address support@readyhall.com → forward to cjhayden114@gmail.com. (Resend
    sends; this receives.)
1e. Stripe → Settings → Business/Public details: public name "Readyhall",
    statement descriptor READYHALL. Do NOT touch webhook endpoints yet
    (Phase 3d).

## Phase 2 — Code flip (Cursor chunk BRAND-R1; safe to deploy any time)
STATUS: done. What shipped, and the two things that did NOT rename:
- packages/config is the only place a brand host is written down. Every one of
  them is overridable at deploy time, NEXT_PUBLIC_ names only (a brand string
  that differed between server and browser render would be a hydration error):
  NEXT_PUBLIC_BRAND_DOMAIN, NEXT_PUBLIC_WEB_BASE_URL, NEXT_PUBLIC_SUPPORT_EMAIL,
  NEXT_PUBLIC_STATUS_PAGE_URL, NEXT_PUBLIC_LEGACY_WEB_DOMAINS,
  NEXT_PUBLIC_EXTRA_API_ORIGINS. Defaults are readyhall.com. If this deploys
  BEFORE 1a/1b, pin the three brand vars to the ukedl.com values in the Netlify
  build env and drop them at cutover — see .env.example §Brand hosts.
- CORS (API) and connect-src (web CSP) accept BOTH brands' origins from one list
  in packages/config, so neither breaks mid-cutover in either direction.
- NOT renamed, on purpose: the legal entity (real sole proprietorship, names the
  party liable) and the Better Stack status host, which is printed as visible
  text on /security — rename the subdomain in Better Stack first, then set
  NEXT_PUBLIC_STATUS_PAGE_URL. Same for the unused x/linkedin handles.
- Assets live at /favicon.ico, /icons/* (favicon-16/32/64, apple-touch,
  icon-192/512), /brand/logo-256.png, /brand/logo-full.png. The OG card is
  generated: `npm --workspace apps/web run gen:og` rebuilds
  /brand/og-image.png from the config name + tagline + mark.
- Certificate PDFs now print "Verify at <WEB_BASE_URL>/verify/<id>" under the id.
Deployable before cutover because it changes names/assets, not domains, and
every domain reference becomes env-driven accepting BOTH origins.
- packages/config brand module: productName "Readyhall"; tagline strings;
  marketingSeo titles/descriptions keep category keywords, swap the name;
  legal pages keep "operated by <legal name>" wording (sole prop unchanged).
- Assets: move public/brand-next/* into place: favicon.ico + favicon-16/32,
  apple-touch-icon, icon-192/512 (+ webmanifest), logo in site header, email
  header if any, OG image regenerated with new name, PDF (certificate) logo
  slot unaffected (event-branded), built-in cert verify line uses env URL.
- Domain plumbing: audit every literal "ukedl" in apps/ + packages/ (marketing
  prose like compare pages "demo at ukedl.com", robots.txt, sitemap, JSON-LD,
  CSP connect-src, CORS allowlist, WEB_BASE_URL fallbacks). Replace literals
  with env/config-driven values; CORS + CSP accept BOTH ukedl.com and
  readyhall.com during transition. "Powered by Readyhall" badge.
- Docs/collateral in repo: outreach playbook + marketing-drafts get the name
  swap (Claude will regenerate the one-pager PDF separately).
- Tests: brand-name scan test updated (no stray "UKEDL" in user-visible
  strings outside legal-entity references), token substitution unchanged.

## Phase 3 — Cutover (after 1a-1e complete AND BRAND-R1 deployed)
3a. Netlify: set primary domain = readyhall.com. Verify site loads there with
    valid TLS.
3b. Redirects: ensure ukedl.com + www 301 → readyhall.com preserving paths
    (Netlify domain alias redirect or _redirects file — BRAND-R2 chunk adds
    the file if needed). Test: ukedl.com/pricing → readyhall.com/pricing.
3c. Render env: WEB_BASE_URL=https://readyhall.com. Netlify env: API base
    (NEXT_PUBLIC_API_URL) → https://api.readyhall.com. If Phase 2 was deployed
    with the brand vars pinned to ukedl.com, delete NEXT_PUBLIC_BRAND_DOMAIN /
    NEXT_PUBLIC_WEB_BASE_URL / NEXT_PUBLIC_SUPPORT_EMAIL now so the defaults
    take over. Redeploy both. Leave NEXT_PUBLIC_LEGACY_WEB_DOMAINS and
    NEXT_PUBLIC_EXTRA_API_ORIGINS alone — they are what keeps the old origin
    working while it redirects.
3d. Stripe: add webhook endpoint at api.readyhall.com (same events), confirm
    deliveries succeed, then disable the api.ukedl.com endpoint.
3e. Resend (only if 1c shows Verified): switch FROM addresses env to
    @readyhall.com (invites, readiness reminders, certificates). Send a test
    invite to a Gmail you control; confirm inbox (not spam), DKIM pass,
    List-Unsubscribe present.
3f. Sentry: allowed domains/environment tags if origin-scoped.
3g. Optional now, recommended: Google Search Console for readyhall.com,
    submit sitemap; ukedl.com property with change-of-address later.

## Phase 4 — Collateral (Claude)
- Rebuild UKEDL-one-pager.pdf → Readyhall-one-pager.pdf (new name/logo).
- Update outreach email variants + follow-up playbook name/domain.
- Tracker: no change (prospect data name-agnostic).
- Demo event (Northbridge) unaffected.

## Phase 5 — Verification checklist (live)
[ ] readyhall.com homepage, pricing, help, feature-guide load w/ new name+logo
[ ] favicon shows grid mark; tab title says Readyhall
[ ] ukedl.com/anything 301s to readyhall.com/anything
[ ] api.readyhall.com health; portal /r/<token> works; CSP header lists new api
[ ] Invite email arrives from @readyhall.com in Gmail inbox, DKIM pass
[ ] Certificate PDF verify line shows readyhall.com/verify; page verifies
[ ] Stripe test checkout completes; webhook delivery green on new endpoint
[ ] Organizer assistant answers "what is this product called" correctly
