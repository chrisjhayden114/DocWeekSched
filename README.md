# UKEDL

**A calm, AI-native event workspace for recurring academic and education conferences.**

Live at **[ukedl.com](https://ukedl.com)** · API at `api.ukedl.com` · public demo event at
[`/e/demo`](https://ukedl.com/e/demo)

An organiser pastes an existing conference programme; an AI ingest agent extracts
sessions, papers, authors, rooms and tracks into a reviewable changeset; the organiser
approves it; attendees get a fast installable web app with no app-store download.
Built for the 50–2,000 attendee band — annual departmental conferences, scholarly
societies, education programmes.

> **New here?** Read [`HANDOFF_BRIEF.md`](HANDOFF_BRIEF.md) first. It covers what the
> product is, what is genuinely working today, what is broken, and which documents in
> this repo are current versus historical.

---

## Stack

| Layer | Choice |
|---|---|
| Monorepo | npm workspaces |
| Web | Next.js 14 (**Pages Router**), React 18, TypeScript → Netlify |
| API | Express 4, TypeScript → Render |
| Database | PostgreSQL (Neon) via Prisma 5 |
| Auth | Custom JWT in httpOnly cookies |
| AI | Anthropic, behind an in-house gateway (metering, caps, audit) |
| Email | Resend |
| Billing | Lemon Squeezy (merchant of record) |
| Errors | Sentry |
| Tests | Vitest |

## Layout

```
apps/
  api/          Express API — 37 route modules, Prisma schema + migrations
    prisma/     schema.prisma, migrations/ (41), seed scripts
    src/
      routes/   one module per resource (auth, event, sessions, cfp, billing, …)
      lib/      ai/, email/, billing/, certificates/, badges/, push/, jobs/, …
      __tests__/
  web/          Next.js front end
    pages/      Pages Router — /organizer/*, /e/[slug], marketing, auth
    components/ shared UI + marketing/
    content/    help articles (markdown)
    styles/     globals.css — design tokens live here
  mobile/       DORMANT Expo shell. Not deployed, not maintained. The mobile
                story is the PWA. Do not add features here.
packages/
  config/       brand + product configuration (product name, support hours, URLs)
  shared/       shared TypeScript types
```

**80 Prisma models · 41 migrations · 37 API route modules · 40 pages · 56 test files.**

Both `packages/*` compile to `dist/` and are consumed as compiled JavaScript. Their
`package.json` `main` fields must point at `dist/index.js`, never `src/index.ts` — the
API bundles as CommonJS and will fail to boot on Render otherwise.

---

## Local setup

Requires Node 20+ and a PostgreSQL database (a Neon dev branch works well).

```bash
git clone <repo> && cd DocWeekSched
npm install

cp .env.example .env          # then fill in DATABASE_URL and JWT_SECRET
npm run prisma:deploy --workspace=@event-app/api
npm run seed:demo --workspace=@event-app/api
```

`.env.example` is the authoritative reference for every variable — it documents what
degrades when each one is unset. `RUNBOOK.md` §10 lists what is required in production.

Run the two servers in **separate terminal windows**:

```bash
npm run dev:api    # Express on :4000
npm run dev:web    # Next.js on :3000
```

### When the web dev server goes strange

Next.js occasionally leaves a corrupt `.next` cache after large refactors — symptoms are
blank pages, 404s on routes that exist, or `Cannot find module ./chunks/vendor-chunks/next.js`.
The fix, in the terminal running `dev:web`:

```bash
# Ctrl-C to stop the server, then:
cd apps/web && rm -rf .next && npm run dev
```

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev:api` / `npm run dev:web` | Development servers |
| `npm test` | API test suite (Vitest) |
| `npm test --workspace=@event-app/web` | Web test suite |
| `npm run build:api` / `npm run build:web` | Production builds |
| `npm run prisma:migrate --workspace=@event-app/api` | Create a migration (dev) |
| `npm run prisma:deploy --workspace=@event-app/api` | Apply migrations (prod) |
| `npm run seed:demo --workspace=@event-app/api` | Seed the public demo event |
| `npm run lint --workspace=@event-app/api` | ESLint, zero warnings tolerated |

Destructive database test suites are gated behind an explicit environment guard and do
not run by default. `ALLOW_DESTRUCTIVE_DB` must never be set in production.

---

## Deployment

**Web → Netlify**, building `apps/web` on push to `main`.

**API → Render** (service `docweeksched-api`), build command:

```bash
npm install && npm run build --workspace=@event-app/api && \
  DATABASE_URL="$DIRECT_DATABASE_URL" npm run prisma:deploy --workspace=@event-app/api
```

Migrations run against `DIRECT_DATABASE_URL` (Neon's direct, non-pooled host). Running
`prisma migrate deploy` through the pooler causes advisory-lock failures (`P1002`) that
can leave a lock held after the process dies.

**Migration discipline: expand, then deploy.** Add columns as nullable, deploy code that
tolerates both shapes, backfill, and only drop in a later migration. This was violated
once and took production down — a migration dropped a column the running code still read.
If a migration set contains any destructive change, the migrate and the deploy must be
back to back with no window in between.

---

## Conventions

Two rules override everything else:

1. **Agents draft, humans publish.** No AI-generated content reaches an attendee without
   an organiser explicitly approving it. No exceptions.
2. **Every AI call goes through the gateway** in `apps/api/src/lib/ai` — for grounding,
   metering, cost caps, labelling and audit. Never call the Anthropic SDK directly from
   a route.

Also:

- **Design tokens live in `apps/web/styles/globals.css`.** Inter throughout, a neutral
  gray ramp, borders in preference to shadows, radii of 4/6/10px. See
  `DESIGN_PHASE_D.md` for the full system and the reasoning behind it.
- **Authorisation is role-based per organisation and per event** (`lib/authorization.ts`).
  Any signed-in user may create an organisation and becomes its OWNER; event operations
  require a STAFF-or-above role on the owning organisation.
- **Zod validates every request body.** Route handlers should not see unvalidated input.
- **Anti-goals are deliberate**, not gaps: no engagement leaderboards or gamification, no
  unsolicited push notifications, no manufactured activity, no dark-pattern upgrades, no
  ads or attendee-data monetisation, no sales-call-gated pricing. Do not add these.

---

## Documentation

| File | What it is |
|---|---|
| [`HANDOFF_BRIEF.md`](HANDOFF_BRIEF.md) | **Start here.** Orientation, current status, doc map |
| [`CUSTOMER_TEST_FINDINGS.md`](CUSTOMER_TEST_FINDINGS.md) | Defects found by end-to-end product testing |
| [`FIX_PLAN.md`](FIX_PLAN.md) | Phase E — what is being fixed, in what order |
| [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md) | Everything required before charging customers |
| [`PARITY_AUDIT.md`](PARITY_AUDIT.md) | Feature comparison vs Whova / EventPilot / Sched |
| [`DESIGN_PHASE_D.md`](DESIGN_PHASE_D.md) | Design system, tokens, competitor teardowns |
| [`RUNBOOK.md`](RUNBOOK.md) | Environment variables, restore procedure, incident steps |
| [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) | *Historical.* The Phase 0–7 build plan, now complete. Strategy sections remain authoritative |
| [`GAP_REPORT.md`](GAP_REPORT.md) | *Historical.* Codebase audit from before the build. Do not trust for current facts |

---

## Status

Live in production since 2026-07-20. Not yet accepting customers: email delivery, the
AI provider key and billing are unconfigured, which blocks signup, makes AI surfaces
return mock output, and prevents purchases. `LAUNCH_CHECKLIST.md` §0 tracks these.

The product name is interim, pending trademark clearance. Changing it is a one-line edit
in `packages/config`.
