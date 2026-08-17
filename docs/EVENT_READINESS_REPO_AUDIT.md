# Event Readiness — Repository Audit (ER0)

**Produced:** 2026-08-07 · against branch `main`, HEAD `4fb7bf0`
**Task:** ER0 from `EVENT_READINESS_PLAN.md` §15 — repository audit and final design map.
**Application changes made by this audit:** none. This file is the only artifact.
**Rule followed throughout:** where the plan and the code disagree, **the code wins** — every
disagreement found is listed in §12 (conflict list), not silently worked around.

---

## 0. Executive summary

Speaker & Session Readiness can be built as a thin layer over existing UKEDL records with
**five genuinely new tables and zero changes to existing tables**. Every piece of
infrastructure the plan worried about duplicating already exists and is reusable as-is:

| Need | Verdict |
|---|---|
| Feature toggle | **Reuse** — `EventFeatureConfig.overrides` JSON + shared registry (`packages/shared/src/features.ts`). One new `FeatureKey`, `defaultOn: false`, hidden via `plannedPhase`. No new toggle system. |
| Person identity | **Reuse** — event-scoped `Speaker` roster is the readiness subject; CFP conversion already stamps `convertedSpeakerId` / `convertedSessionId` / `convertedSessionItemId`. No new person model. |
| External access | **Reuse the pattern** — hashed opaque tokens (`lib/auth.ts hashToken`, `lib/inviteTokens.ts`), `IcsFeedToken`-style `tokenHash`+`revokedAt` rows. One new token table (justified in §10). |
| Files | **Reuse** — `getStorageProvider().acceptUpload()` with MIME/size allowlists (Cloudflare R2 is live in production). One privacy gap to close, see §11.4. |
| Email | **Reuse** — `lib/mail.ts` helper pattern + the `CfpDecisionEmail` draft→edit→send pattern. |
| Jobs | **Reuse** — `BackgroundJob` poller; `enqueueJob({ scheduledAt })` natively supports scheduled reminders. |
| AI | **Reuse** — `gatewayChat`/`gatewayExtract` with `GatewayCallContext`; caps, metering, audit built in. |
| Audit | **Reuse** — `writeAuditLog` → `AuditLog` (has `OTHER` action + free `entityType`). |
| Billing | **Reuse** — Stripe Managed Payments is **live** (not Lemon Squeezy — see conflict C2). Pilot entitlement needs no billing work at all: an entitlement key absent from the plan catalog is `false` for every public tier and `true` for `INTERNAL`, which is exactly a manual pilot gate. |

**Recommended smallest safe first phase (ER1):** add the `readiness` feature key to the shared
registry with `defaultOn: false` and a `plannedPhase` marker (which hides it from the organizer
Features tab via `getOrganizerVisibleFeatures()`), mount an empty `/readiness` Express router
that 404s behind `requireFeature`, and add the feature-disabled tests. Zero schema changes,
zero visible change for any existing user.

---

## 1. Current architecture (verified against the repository)

The plan's §3 table is mostly right; corrections are **bolded** and repeated in §12.

| Layer | Verified reality |
|---|---|
| Monorepo | npm workspaces: `apps/api`, `apps/web`, `apps/mobile` (dormant), `packages/config`, `packages/shared` |
| Web | Next.js 14.2.5, **Pages Router**, React 18, TypeScript → Netlify (`ukedl.com`) |
| API | Express 4 + TypeScript → Render `docweeksched-api` (`api.ukedl.com`), **single instance** (in-memory rate limits assume this — `RUNBOOK.md` §7) |
| DB | Postgres on Neon, Prisma 5.18. Migrations run against `DIRECT_DATABASE_URL` (pooler causes `P1002`) |
| Auth | Custom JWT in httpOnly cookies, `COOKIE_DOMAIN=.ukedl.com`, CSRF via `X-CSRF-Token` (`requireCsrf` global in `index.ts:136`) |
| Authorization | `apps/api/src/lib/authorization.ts` — org roles OWNER>ADMIN>STAFF, event roles ADMIN/ATTENDEE/SPEAKER/REVIEWER; `requireEventAccess(userId, eventId, { manage })` |
| AI | Anthropic behind `apps/api/src/lib/ai` gateway — **live in production** (`AI_PROVIDER=anthropic`, `AI_MODEL=claude-sonnet-5`) |
| Email | Resend behind `apps/api/src/lib/email` — **live in production** (`mail.ukedl.com` DKIM+SPF verified; `support@ukedl.com` sends and receives) |
| Storage | **Cloudflare R2 configured in production** (2026-08-02, chosen explicitly because of the Event Readiness roadmap); data-URL fallback when unset |
| Billing | **Stripe Managed Payments, live** (2026-08-06, real $79 charge/refund/cancel verified). Lemon Squeezy code remains as a selectable legacy provider (`lib/billing/index.ts`). Webhook: `POST /billing/webhooks/stripe` |
| Jobs | In-process `BackgroundJob` poller (`lib/jobs/index.ts`), 5s poll, 30s retry backoff, `maxAttempts` then `DEAD`. No separate worker: restarting the API restarts all jobs |
| Monitoring | Sentry live on both sides; uptime on `/health/ready`; status page `ukedl.betteruptime.com` |
| Tests | Vitest. `*.unit.test.ts` need no DB; `*.db.test.ts` (26 suites) run only against a disposable Neon `ukedl_test` branch per `RUNBOOK.md` §9 ("Running the database test suites"). **`ALLOW_DESTRUCTIVE_DB` must never be set**; the guard is `lib/destructiveGuard.ts`. Last full run: 391/391 pass (2026-08-04) |
| Scale | 80 Prisma models · 41 migrations (latest `20260802120000_org_plan_sku`) · 38 route files · 60 test files / 391 tests (RUNBOOK §9 log, 2026-08-04) |

Chunks **E0–E24 have shipped** since the plan was written (git log `f3eaa06`→`4fb7bf0`),
including: full organizer editing (E2), CSV import (E3), Stripe billing (E5/E5.1/E23/E24),
publish-draft-sessions-on-publish + changeset reconcile (E13), bulk track/room assignment (E16),
shared `Select` control (E17), Messages phase 1 + event-chat retirement (E18), the named
"Setup assistant" / "Event assistant" pair (E19), DOCX/XLSX ingest (E21), DB-test honesty (E22).

---

## 2. Existing-model map

All models in `apps/api/prisma/schema.prisma` (line refs from HEAD `4fb7bf0`).

### 2.1 Tenancy and roles
| Concept | Model | Notes for readiness |
|---|---|---|
| Organization | `Organization` (L337) | Billing fields live here: `plan`, `planSku`, `subscriptionStatus`, `eventAllowance`, `gracePeriodEndsAt` |
| Org membership | `OrgMembership` (L374) — role OWNER/ADMIN/STAFF | `requireOrgRole` checks this |
| Event | `Event` (L610) — status DRAFT/ACTIVE/ARCHIVED; join/slug-invite token fields inline | Every readiness row must FK to `Event` (and carry `organizationId` like `OpsInboxCard` does) |
| Event membership | `EventMembership` (L420) — role ADMIN/ATTENDEE/SPEAKER/REVIEWER, soft-delete `deletedAt`, `checkInCode` | REVIEWER never gets manage rights (`authorization.ts:96-99`) |
| Event series | `EventSeries` (L387) — `setupChecklist` JSON, price lock | Recurring-conference template reuse could later ride this |

### 2.2 People — the readiness subject question (plan §17 Q1)
There are **three** person representations; none should be duplicated:

1. **`User`** (L501) — account with password; token fields for verify/reset/profile-setup.
2. **`Speaker`** (L762) — **event-scoped roster row**: `name`, `title`, `affiliation`, `bio`,
   `photoUrl`, `sortOrder`. **No `userId` link and no email.** Linked to sessions via
   `SessionSpeaker`, to papers via `SessionItemAuthor` (ordered, `isPresenter`), and to CFP via
   `CfpSubmission.convertedSpeakerId`.
3. **CFP submitter** — plain `submitterName`/`submitterEmail` on `CfpSubmission` (L1584) with
   hashed `verifyTokenHash`/`accessTokenHash` (no account required).

**Answer:** the accepted presenter is primarily a **`Speaker`**. CFP conversion
(`lib/cfp/convert.ts:32-53 ensureSpeaker`) find-or-creates the Speaker by event +
case-insensitive name and stamps all three `converted*` FKs on the submission. One person can
hold multiple papers/sessions without duplication (Q2: yes — `SessionSpeaker` and
`SessionItemAuthor` are join tables). Contact email for a converted speaker is recoverable via
`CfpSubmission.submitterEmail`; for hand-entered speakers there is **no email anywhere** —
readiness must store one (see §10.3 and open decision O2).

### 2.3 Academic records
| Concept | Model |
|---|---|
| Session | `Session` (L781) — `publishStatus` DRAFT/PUBLISHED; capacity fields; legacy free-text `location`/`speakers` kept |
| Paper | `SessionItem` (L845) — title/abstract/discussant, ordered under a session |
| Ordered authors | `SessionItemAuthor` (L862) — `name` (denormalized) + optional `speakerId`, `isPresenter`, `sortOrder` |
| Track / Room | `Track` (L698) / `Room` (L712) — `@@unique([eventId, name])` |
| CFP | `CfpForm` (L1543 — `customFields` JSON, rubric, blind review) / `CfpSubmission` / `CfpAttachment` / `CfpReview` / `CfpReviewer` / `CfpDecisionEmail` |

### 2.4 Infrastructure models
| Concern | Model | Reuse note |
|---|---|---|
| Feature toggles | `EventFeatureConfig` (L689) — one row per event, `overrides` JSON | See §3 |
| Files | No central file model — `CfpAttachment` (fileName/mime/sizeBytes/url/storageKey), `SessionResource` (kind LINK/FILE, url, storageKey), `AgendaIngestRun.sourceStorageKey`, `IssuedCertificate.pdfStorageKey` | Per-domain file tables + `storageKey` column is the house pattern |
| Tokens | See §4 map | |
| Jobs | `BackgroundJob` (L1475) — type string, input/result JSON, progress, `scheduledAt` | |
| Notifications | `UserNotification` (L1065) + `NotificationPreference` + `NotificationPushDay` — **User-only**; external people (CFP submitters) get plain email | Readiness reminders to presenters are email-first |
| AI metering | `AiUsageRecord` (L1429) keyed by `AiMeterFeature` enum (AGENDA_INGEST, CONCIERGE, SETUP_COPILOT, MATCHMAKER, OPS_DRAFT, RECAP, **OTHER**) | New readiness calls can meter as `OTHER` initially (hard cap `AI_HARD_CAP_OTHER_PER_EVENT`, default 10 000/event — `lib/ai/caps.ts:28`), or add an enum value by additive migration at ER7 |
| Audit | `AuditLog` (L1454) — `AuditAction` enum incl. `OTHER`, free `entityType`/`entityId`, `aiGenerated`, JSON payload | `writeAuditLog` in `lib/ai/audit.ts` |
| Billing | `EventPurchase`, `BillingWebhookEvent`; entitlements resolved from `packages/shared/src/plans.ts` catalog via `lib/billing/entitlements.ts can()` | |
| Draft→approve patterns | `AgendaIngestRun` (ingest changeset), `OpsInboxCard` (draft until Apply/Send, evidence snapshot), `ConciergePendingAction` (propose/confirm, 30-min expiry), `CfpDecisionEmail` + `EventRecapEmail` (draft/sent/superseded) | There is **no generic changeset model** (conflict C7) — but four strong per-domain precedents |

---

## 3. Existing-feature-toggle map

**Exactly one system. Do not build another** (plan §2.2 warning — confirmed satisfied by reuse).

- **Registry:** `packages/shared/src/features.ts` — `FeatureKey` union + `FEATURE_REGISTRY`
  entries `{ key, name, plainDescription, category, defaultOn, dependsOn?, plannedPhase?, defaultValue?, retired? }`.
  28 keys today. `getOrganizerVisibleFeatures()` filters out `plannedPhase`/`retired` entries —
  **this is the built-in mechanism for a hidden, disabled-by-default feature.**
- **Storage:** `EventFeatureConfig.overrides` JSON, one row per event, validated/normalized by
  `normalizeOverridesForSave` (dependency force-off cascade).
- **Resolution:** `resolveFeatureEnabled(key, overrides, { planAllows })` — effective =
  **plan allows it AND organizer enabled it** (`.cursor/rules/product.mdc` rule 9).
  `planAllows` comes from `lib/billing/entitlements.ts can(orgId, key)`, which resolves the
  plan catalog (`plans.ts resolveEntitlement`); `INTERNAL` tier is always `true`;
  **a key absent from a tier's entitlements is `false`**.
- **API enforcement:** `featureEnabled(eventId, key)` / `requireFeature(eventId, key)` (→ 404
  "Feature not available for this event") in `apps/api/src/lib/features/featureEnabled.ts`.
- **HTTP surface:** `GET/PUT /event/features` (`routes/event.ts:565-631`), header `x-event-id`
  via `organizerFetch`. UI: `components/FeatureConfigPanel.tsx`, mounted on the event page
  Features tab and wizard step 3.
- **Precedent for an off-by-default module:** `cfp` — `defaultOn: false`; creating a CFP form
  auto-flips the override on (`routes/cfp.ts:405-410`). Readiness activation should do the same.

**Plan-entitlement wiring for readiness:** add `readiness` to the `FeatureKey` union. Because
`EntitlementKey = FeatureKey | PlanFlagKey`, leaving it out of every public tier's
`entitlements` map means: FREE/PER_EVENT/PRO/ENTERPRISE orgs → blocked at the plan level;
`INTERNAL` orgs → allowed. That is the manual pilot gate the plan's §13.2 asks for, with zero
new billing code (open decision O4 covers pilots on paying orgs).

---

## 4. Existing invitation/token map

Every token in the codebase is opaque-random + SHA-256-hashed at rest (`lib/auth.ts
generateOpaqueToken`/`hashToken`). There is **no generic invitation table** — token fields live
on the row they authorize:

| Token | Where stored | Expiry | Revocation | Minted by |
|---|---|---|---|---|
| Email verify | `User.emailVerifyTokenHash/-ExpiresAt` | yes | cleared on use | `routes/auth.ts` |
| Password reset | `User.passwordResetTokenHash/-ExpiresAt` | yes | cleared on use | `routes/auth.ts` |
| Profile setup (invite) | `User.profileSetupTokenHash/-ExpiresAt` | yes (`env.inviteTokenDays`, default 7) | remint replaces | `routes/attendees.ts createAndEmailInvite` (L47-148) → `mail.ts sendParticipantInviteEmail`; accept at `GET/POST /auth/profile-setup` |
| Event join link | `Event.joinTokenHash` + expiry/capacity/useCount/`revokedAt` | optional | yes | `lib/inviteTokens.ts` |
| Slug invite | `Event.slugInvite*` fields | optional | enable flag | `lib/inviteTokens.ts` |
| ICS feed | `IcsFeedToken` — `tokenHash @unique`, `revokedAt` | no | yes | `routes/ics.ts` |
| CFP verify | `CfpSubmission.verifyTokenHash` | **none** (checked only for presence) | cleared on verify | `routes/cfp.ts:314-349` |
| CFP access ("your submission") | `CfpSubmission.accessTokenHash` | **none** | rotated on verify | `routes/cfp.ts:109-141` |
| Check-in code | `EventMembership.checkInCode` (cuid, **client-side default — never remove `@default(cuid())`**, `.cursor/rules/product.mdc` rule 16) | no | n/a | membership create |

**Two reusable external-access patterns exist** (plan §17 Q3):
1. **Account-based:** attendee invite → `User` + `EventMembership(ATTENDEE)` + profile-setup
   token. Forces account creation; invites are always ATTENDEE role — there is no speaker-invite path.
2. **Account-less:** CFP submitter access token. Closest to the presenter-portal need, but its
   tokens **never expire** — below the plan's §12 bar ("expiring and revocable"). Readiness
   portal tokens must copy the CFP *shape* and add `expiresAt` + `revokedAt` (the
   `IcsFeedToken` + `inviteExpiresAt()` precedents). See §10.3.

Recommendation: **account-less portal** (plan §6.1.G explicitly prefers not forcing accounts),
one token per (event, speaker) in a new small table.

---

## 5. Existing file/storage map

- **Provider:** `apps/api/src/lib/storage/index.ts getStorageProvider()` — S3-compatible
  (Cloudflare R2, **live**, bucket `ukedl-uploads`, `STORAGE_MAX_UPLOAD_BYTES` default 20 MB)
  with data-URL-in-Postgres fallback.
- **Contract:** `acceptUpload({ url, keyPrefix, maxBytes, allowedMimeTypes })` →
  `{ url, storageKey }`. MIME **and** size enforced inside the provider.
- **Consumer pattern (copy it):** CFP attachments — `routes/cfp.ts:261-284`:
  client sends data-URL, server calls `acceptUpload` with
  `keyPrefix: events/{eventId}/cfp/{submissionId}`, allowlist (PDF/DOC/DOCX/TXT/PNG/JPEG),
  10 MB cap, persists `fileName`/`mime`/`sizeBytes`/`url`/`storageKey`. Body limit raised
  per-path in `lib/bodyLimit.ts` (`12mb` for the CFP submit path).
- **Web UI:** `components/UploadDropzone.tsx` (drag-drop, size feedback).
- **PRIVACY GAP (conflict C8):** the storage interface produces **public URLs only**
  (`StoragePutResult.url` is "Public or data URL"; R2 uses the public r2.dev base). CFP
  attachments are effectively unlisted-but-public. The plan's §12 requires readiness files
  (headshots are fine; decks, AV/accessibility notes are not) to be **private by default**.
  Options in §11.4; this is a real gap the first file-accepting phase (ER4) must close.
- **No image-dimension validation exists anywhere** — headshot dimension rules (plan §6.1.B)
  would be new validation code (`sharp` or similar would be a new dependency — flag per
  `.cursor/rules`; or skip dimension rules for MVP).

---

## 6. Existing notification/job/email map

- **Jobs:** `lib/jobs/index.ts` — `registerJobHandler(type, handler)` +
  `enqueueJob({ type, organizationId, eventId, createdById, payload, maxAttempts, scheduledAt })`.
  `scheduledAt` makes future-dated reminder jobs native. Poller heartbeat feeds
  `/health/ready`. Every enqueue/complete/fail writes `AuditLog`. Job types today:
  `demo.event.reset`, `account.delete.hard`, `ai.agenda_ingest`, `ai.matchmaker_*`,
  `ai.ops_detect_*`, `certificates.batch_issue`, `recap.generate` (RUNBOOK §5 kill-switch map).
- **Email:** `getEmailProvider()` (Resend or unconfigured-with-copy-link). Two conventions:
  - `lib/mail.ts` named helpers (`sendParticipantInviteEmail`, `sendPasswordResetEmail`,
    `sendEmailVerificationEmail`, `sendCertificateReadyEmail`, `sendWaitlistPromotedEmail`) —
    all pass `copyUrl` so the UI degrades to copy-link when delivery is down.
  - **Draft→edit→send record**: `CfpDecisionEmail` (draft rows with `sentAt: null`, editable
    until sent, then immutable) — this is the model for readiness reminder previews/manual
    sends (plan §6.1.K steps 1–2). `EventRecapEmail` repeats the pattern with SUPERSEDED.
  - Delivery state: `SendEmailResult { delivered, copyUrl?, fallbackMessage? }`. **No bounce or
    suppression models exist** (plan §17 Q19: answer — none; Resend-side only). Reminder
    delivery logging must be a readiness-side table (ER6), recording `delivered` at minimum.
  - Rate precedent: `ANNOUNCEMENT_EMAIL_RATE_PER_HOUR` (default 3/hr) for bulk email pacing.
- **In-app notifications:** `lib/notifications/deliver.ts deliverNotification/notifyMany` with
  quiet hours, digest classes, push budgets — **only reaches `User`s**. Presenters without
  accounts can't receive these; reminders are email-first, with optional `UserNotification`
  when the presenter happens to be a roster member.

---

## 7. Existing audit/changeset map

- **General audit:** `AuditLog` via `writeAuditLog` — org/event/actor scoped, `AuditAction`
  enum (AI_*, JOB_*, DATA_EXPORT, ACCOUNT_DELETE_*, **OTHER**), `entityType`/`entityId`
  strings, `aiGenerated` flag, JSON payload. Readiness actions (approve, waive, send, revoke)
  fit `OTHER` + `entityType: "readiness_*"` today; dedicated enum values are an optional
  additive migration later.
- **Domain audit:** `AnnouncementAuditLog` shows the per-domain pattern when a domain needs
  its own queryable history.
- **Reviewable changeset:** `AgendaIngestRun` — JSON `extraction`/`changeset`/`reviewState`,
  statuses PENDING→…→CONFIRMED, `aiGenerated`, confirm applies to real Session/Speaker rows
  and (post-E13) **reconciles updates instead of replacing** hand-entered data. This is
  ingest-specific; **there is no generic approval/changeset model** (plan §6.1.J's "existing
  reviewable-changeset conventions" must be read as *pattern*, not *shared table* — conflict C7).
- **Draft-until-applied:** `OpsInboxCard` (evidence snapshot frozen on apply, applied/dismissed
  by + timestamps) and `ConciergePendingAction` (server-minted, expiring, confirm-gated).
  Readiness approvals (presenter submission → organizer approves → value written to
  `Speaker`/`SessionItem`) should copy the OpsInboxCard shape: store proposed value + original
  snapshot on the submission row, write-through on explicit approve, audit both.
- **Publish gate to attendees:** `Session.publishStatus` + event `status` — public payload
  (`lib/publicEvent.ts`) serves only `PUBLISHED` sessions of `ACTIVE` events with explicit
  field selects (no PII). `POST /event/publish` promotes draft sessions in the same
  transaction (`routes/event.ts:334-359` → `lib/ai/ingest/publish.ts`). Approved readiness
  changes reach attendees the same way every other edit does — by editing the organizer-owned
  row; nothing readiness-specific touches the public path.

---

## 8. Current flow map (files and routes)

| Flow | Exact path |
|---|---|
| CFP submit (public) | `POST /cfp/public/:slug/submit` (`routes/cfp.ts:200-307`) — feature-gated `requireFeature("cfp")`, window-checked, mints verify+access tokens, stores attachments via `acceptUpload` |
| CFP verify | `POST /cfp/public/verify` (`cfp.ts:314-349`) — sets SUBMITTED, rotates access token |
| CFP review | `requireCfpReviewer` (`authorization.ts:138-165`); blind redaction for non-managers (`cfp.ts:875-929`) |
| CFP decision | `POST /cfp/manage/:formId/decisions` (`cfp.ts:675-724`) — sets ACCEPTED/REJECTED and queues **draft** `CfpDecisionEmail` |
| Decision email send | `POST /cfp/manage/emails/:emailId/send` (`cfp.ts:774-806`) — `getEmailProvider().send`, then `sentAt` |
| **CFP accept → records** | `POST /cfp/manage/:formId/convert` (`cfp.ts:821-868` → `lib/cfp/convert.ts:59-188`) — modes `session_item` (SessionItem + ordered SessionItemAuthors under a target session) and `standalone_session` (DRAFT Session + SessionSpeaker + SessionItem); `ensureSpeaker` find-or-creates the roster Speaker; stamps `converted*` FKs. **Not automatic on ACCEPT** — a separate explicit organizer action (good: readiness assignment can hook the same place) |
| Speaker roster CRUD | `routes/speakers.ts` — GET member-visible, POST/PUT/DELETE `manage: true` |
| Event editing | `routes/event.ts` + Program tab (`components/organizer/ProgramTab.tsx`) |
| Publish | `POST /event/publish` → ACTIVE + `publishEventDraftSessions` in one `$transaction`. Note: `PATCH /event/status` with ACTIVE does **not** promote draft sessions — only `POST /publish` does |
| Public page | `apps/web/pages/e/[slug].tsx` SSR → `GET /event/public/:slug` (no auth, `publicRateLimit`) → `lib/publicEvent.ts getPublicEventBySlug` |
| Attendee invite | `POST /attendees/invite[-bulk|-dry-run]` → `createAndEmailInvite` → `sendParticipantInviteEmail`; accept via `/auth/profile-setup` |
| Uploads | `acceptUpload` call sites: CFP attachments, session resources, maps, ingest sources, certificate PDFs (`pdfStorageKey`) |
| AI calls | all through `gatewayChat/gatewayExtract/gatewayEmbed(ctx: GatewayCallContext{ organizationId, feature, eventId?, userId? })` — caps (`assertAiCap`) → provider (mock fallback) → metering → audit. Provider errors return `{ ok:false, code:"PROVIDER_ERROR" }`, never throw |
| Billing | `GET /billing/pricing|config|summary`, `POST /billing/checkout|portal` (org ADMIN), webhooks mounted **before** the JSON parser (`index.ts:105-131`); entitlement transitions in `lib/billing/webhooks.ts` |

---

## 9. Exact routes and components to reuse

### API conventions (follow `routes/tracks.ts` verbatim)
- `export const readinessRouter = Router()`; mount `app.use("/readiness", readinessRouter)` in
  `apps/api/src/index.ts` inside the block at L172-211 (after global CSRF/demo middleware).
- Per-route: `requireAuth` always; `requireCsrf` implicit-global for mutations; Zod
  `safeParse` → `validationErrorBody`; `asyncHandler`; event scope via
  `resolveEventFromRequest(req)` (header `x-event-id`) + `requireEventAccess(req.user!.id,
  event.id, { manage: true })` for organizer ops; every query filtered by `eventId`; 404 body
  `{ error }`, delete returns `{ ok: true }`, create returns 201.
- Feature gate first line of every handler: `await requireFeature(event.id, "readiness")`.
- Public portal routes: no `requireAuth`, `publicRateLimit()` + token lookup by hash — copy
  `GET /cfp/public/submission` (`cfp.ts:109-141`).
- Rate limits: opt-in per handler, never `router.use` (`lib/rateLimit.ts` warning).

### Web conventions
- **Organizer page:** `apps/web/pages/organizer/events/[eventId]/readiness.tsx`, modeled on
  `cfp/index.tsx` (a module subpage, not seven nav items — the plan's §10.1 destination list
  becomes in-page sections/tabs like the event page's `?tab=` switch).
- **Nav:** one item appended to `organizeItems` in `components/OrganizerShell.tsx`. Items are
  currently unconditional; the readiness item must be rendered only when the feature resolves
  enabled (fetch `GET /event/features` state or pass from the page) — the "no navigation item
  when disabled" regression test (plan §16.2) covers this.
- **API client:** `lib/api.ts apiFetch` / `lib/organizerApi.ts organizerFetch` (adds
  `x-event-id`).
- **Primitives:** `Select`, `ListState` (skeleton/empty/error), `StatusChip`, `ConfirmDialog`,
  `UploadDropzone`, `KebabMenu`, `AiGeneratedChip`, `.console-panel` CSS pattern; tokens from
  `styles/tokens.css` (Inter, gray ramp, radii 4/6/10). No new component library.
- **Portal page (public):** follow `apps/web/pages/e/[slug].tsx` + `pages/invite/` patterns —
  a top-level `pages/r/[token].tsx` (or similar) SSR page, mobile-first.
- **Assistant naming rule:** any readiness AI copy must come from a shared module the way
  `ASSISTANT_COPY` (`packages/shared/src/assistants.ts`) does — never hardcoded.

### Test conventions
- `apps/api/src/__tests__/readiness.unit.test.ts` + `readiness.db.test.ts` next to existing
  suites. Copy fixture/tenancy patterns from `tenancy.db.test.ts`, `features.db.test.ts`,
  `cfp.db.test.ts`. DB suites run per RUNBOOK §9 against the Neon `ukedl_test` branch —
  **never `ALLOW_DESTRUCTIVE_DB`**, and note the agent sandbox has no route to Neon (the
  founder runs DB suites; CI runs them against a service Postgres).

---

## 10. Exact migration proposal

All changes are **additive**. No existing table or column is modified, renamed or dropped. No
existing enum is touched in the first migration. Every new table carries `organizationId` +
`eventId` FKs (the `OpsInboxCard` tenancy shape) and indexes on (event, status, due date).
Apply with `prisma migrate deploy` against `DIRECT_DATABASE_URL`; forward-fix only.

Applying the plan §8 reuse decision rule to each concept from plan §9:

| Plan concept | Verdict | Justification against `schema.prisma` |
|---|---|---|
| Readiness template | **NEW `ReadinessTemplate`** | Closest existing: `CfpForm.customFields` (one public form per event, submission-oriented) and `EventSeries.setupChecklist` (organizer todo JSON). Neither represents reusable per-role requirement sets with per-item config; extending CfpForm would overload the CFP domain the plan says not to redesign |
| Template item / requirement | **NEW `ReadinessRequirement`** | Child-row pattern precedent: `SurveyQuestion`, `SessionPollOption`. A JSON blob (CfpForm-style) would prevent FK-ing assignments to a single requirement, which derived status needs |
| Requirement assignment | **NEW `ReadinessAssignment`** | No existing join connects a requirement to Speaker/Session/SessionItem. Pure join+status model like `SessionSpeaker`+state |
| Stakeholder submission | **NEW `ReadinessSubmission`** | Supersede-not-destroy precedent: `EventRecapSection.status SUPERSEDED`. Original/AI/proposed value separation precedent: `OpsInboxCard` draft + evidence snapshot |
| Portal access token | **NEW `ReadinessPortalAccess`** | Token-on-the-row precedent (`CfpSubmission.accessTokenHash`) fails the plan §12 expiry bar; `IcsFeedToken` shape (`tokenHash @unique`, `revokedAt`) + `expiresAt` is the right pattern. Speakers have no email column, so contact email lives here (not on `Speaker` — avoids leaking through `GET /speakers`, which event members can read) |
| Readiness exception | **DEFER** (ER5) | Most §6.1.I checks derive from data already present (missing field, past deadline, missing room, session outside window). Persist only when a human workflow state must survive (waive/resolve) — decide at ER5 with real usage; may reuse `ReadinessAssignment.status` values instead of a table |
| Approval | **FOLD into `ReadinessSubmission`** | Approve/reject is submission-level: `approvedAt/approvedById/rejectedAt/...` columns (OpsInboxCard applied/dismissed pattern), plus `AuditLog` rows. A separate table adds nothing until multi-step approvals exist |
| Reminder rule / delivery | **DEFER to ER6** — `ReadinessReminder` (+ delivery log) | `CfpDecisionEmail` proves the draft→send record; scheduled sends ride `BackgroundJob.scheduledAt`. Not needed by ER2-ER5 |
| Readiness activity | **REUSE `AuditLog`** | `OTHER` action + `entityType` covers it; the activity tab reads `AuditLog` filtered by event + entityType prefix |

### 10.1 Migration 1 (ER2) — sketch

```prisma
enum ReadinessAssignmentStatus {
  NOT_STARTED
  IN_PROGRESS
  SUBMITTED
  NEEDS_REVIEW
  READY
  WAIVED
  NOT_APPLICABLE
}
// LATE and BLOCKED are derived (dueAt < now, unresolved checks) — never stored,
// per plan §6.1.D "do not manually store a single authoritative percentage".

model ReadinessTemplate {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  eventId        String       // event-scoped for MVP; org-level template sharing = later copy operation
  event          Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  name           String       // "Keynote speaker", "Paper presenter", …
  description    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  requirements   ReadinessRequirement[]

  @@unique([eventId, name])
  @@index([organizationId])
}

model ReadinessRequirement {
  id           String  @id @default(cuid())
  templateId   String
  template     ReadinessTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  eventId      String            // denormalized for tenant-scoped queries (OpsInboxCard pattern)
  label        String
  helpText     String?
  kind         String            // short_text | long_text | confirm | select | multi_select |
                                 // date | url | file | agreement | internal_checklist
  config       Json    @default("{}")  // options, char limits, allowed MIME, max bytes,
                                       // organizerOnly, approvalRequired, aiSuggestAllowed
  required     Boolean @default(true)
  dueAt        DateTime?
  sortOrder    Int     @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  assignments  ReadinessAssignment[]

  @@index([templateId, sortOrder])
  @@index([eventId])
}

model ReadinessAssignment {
  id             String  @id @default(cuid())
  organizationId String
  eventId        String
  event          Event   @relation(fields: [eventId], references: [id], onDelete: Cascade)
  requirementId  String
  requirement    ReadinessRequirement @relation(fields: [requirementId], references: [id], onDelete: Cascade)
  // Subject: exactly one of speakerId | sessionId set; sessionItemId optional refinement.
  speakerId      String?
  speaker        Speaker?     @relation(fields: [speakerId], references: [id], onDelete: Cascade)
  sessionId      String?
  session        Session?     @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sessionItemId  String?
  sessionItem    SessionItem? @relation(fields: [sessionItemId], references: [id], onDelete: Cascade)
  status         ReadinessAssignmentStatus @default(NOT_STARTED)
  dueAtOverride  DateTime?
  waivedAt       DateTime?
  waivedById     String?      // User id, SetNull semantics via app layer + AuditLog
  ownerUserId    String?      // organizer owner (table column, plan §6.1.F)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  submissions    ReadinessSubmission[]

  @@unique([requirementId, speakerId, sessionId, sessionItemId])
  @@index([eventId, status])
  @@index([eventId, dueAtOverride])
  @@index([speakerId])
  @@index([sessionId])
}

model ReadinessSubmission {
  id            String  @id @default(cuid())
  assignmentId  String
  assignment    ReadinessAssignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  eventId       String
  // Presenter- or organizer- or AI-entered value. Original preserved by supersede-chain.
  valueText     String?
  valueJson     Json?
  fileName      String?
  fileMime      String?
  fileSizeBytes Int?
  fileUrl       String?      // storage URL (see §11.4 privacy decision)
  fileStorageKey String?
  aiGenerated   Boolean @default(false)
  submittedVia  String       // portal | organizer | ai
  supersededAt  DateTime?    // EventRecapSection pattern: resubmission supersedes, never deletes
  approvedAt    DateTime?
  approvedById  String?
  rejectedAt    DateTime?
  rejectedById  String?
  reviewNote    String?
  createdAt     DateTime @default(now())

  @@index([assignmentId, createdAt])
  @@index([eventId, approvedAt])
}

model ReadinessPortalAccess {
  id           String  @id @default(cuid())
  organizationId String
  eventId      String
  event        Event   @relation(fields: [eventId], references: [id], onDelete: Cascade)
  speakerId    String
  speaker      Speaker @relation(fields: [speakerId], references: [id], onDelete: Cascade)
  email        String       // contact email — lives here, NOT on Speaker (see §2.2)
  tokenHash    String  @unique   // sha-256 of opaque token (lib/auth.ts hashToken)
  expiresAt    DateTime          // REQUIRED — closes the CFP-token gap (conflict C9)
  revokedAt    DateTime?
  lastSentAt   DateTime?
  lastUsedAt   DateTime?
  createdAt    DateTime @default(now())

  @@unique([eventId, speakerId])
  @@index([eventId])
  @@index([speakerId])
}
```

Relation back-fields on `Organization`, `Event`, `Speaker`, `Session`, `SessionItem` are the
only touches to existing models — **pure additive relation lists, no column changes**.
(Reminder from `.cursor/rules/product.mdc` rule 16: when editing `schema.prisma`, verify
`EventMembership.checkInCode` still reads `String @default(cuid())`.)

### 10.2 Ordering, backfill, rollback
- **Migration 1 (ER2):** the five tables above. No backfill — all tables start empty.
- **Migration 2 (ER6):** `ReadinessReminder` + delivery log, shaped after `CfpDecisionEmail`.
- **Migration 3 (ER7, optional):** additive `READINESS` value on `AiMeterFeature` (until then,
  meter as `OTHER`).
- Expand-then-deploy is trivially satisfied: no existing reader can be broken by tables it
  never queries. **Rollback = disable the feature key** (rows become unreachable); a
  drop-tables down-migration is a later cleanup, never an emergency action. Forward-fix per
  RUNBOOK §4.
- Idempotency: assignment creation keyed by the `@@unique` above; template application is
  upsert-by-key, safe to re-run.

---

## 11. Authorization and security map

### 11.1 Role mapping (plan §11)
| Action | Guard (all existing helpers) |
|---|---|
| Enable/disable readiness | `PUT /event/features` — already `requireEventAccess(manage: true)` |
| Templates / requirements CRUD, assign, waive, approve, remind, revoke portal, export | `requireEventAccess(userId, eventId, { manage: true })` — org STAFF+ or event ADMIN, same bar as CFP manage. REVIEWER never qualifies (`authorization.ts:96-99`) |
| View submissions incl. sensitive AV/accessibility | manage-level for MVP; a finer split (selected organizers only, plan §17 Q11) has **no existing mechanism** — flagged O6 rather than inventing a permission system |
| Activity history | manage-level; reads `AuditLog` scoped by event |
| Billing/entitlement | org ADMIN (billing routes' existing bar) |
| Portal access | token only — resolves to exactly one `(event, speaker)`; portal handlers must load **only** assignments joined to that speaker id; never accepts client-supplied event/speaker ids |

### 11.2 Tenant isolation
Every route follows the `tracks.ts` pattern (`eventId` filter on every query;
`findFirst({ id, eventId })` before mutate). Required tests are enumerated in §13. Archived
events: `requireEventAccess` does not block reads on ARCHIVED; readiness mutations should
check `event.status !== "ARCHIVED"` like editing surfaces do (verify in ER2 tests).

### 11.3 Token security
Portal tokens: `generateOpaqueToken(32)` + `hashToken` at rest, required `expiresAt`
(default from `inviteExpiresAt()`; policy O3), `revokedAt` honored on every request, remint
rotates. Guessed/modified tokens fail on the unique-hash lookup exactly as CFP access does.

### 11.4 File privacy (the one real infrastructure gap)
Current storage returns public URLs (R2 public dev URL). Two closable options for ER4:

- **(a) API-proxied private files (recommended):** store only `fileStorageKey` for
  readiness uploads; add an additive `get(key)` to the `StorageProvider` interface
  (S3 `GetObject`; data-URL provider returns inline); serve via
  `GET /readiness/files/:submissionId` behind `requireEventAccess(manage)` or a valid portal
  token. No bucket policy change; headshots destined for publication get re-put to the public
  path on approval.
- **(b) Signed URLs:** add `getSignedUrl(key, ttl)` to the provider. Less API traffic, but
  introduces expiring-link UX and caching complexity.

Either way this is an **additive interface extension** to `lib/storage`, not a second storage
abstraction. Decision recorded as O5.

### 11.5 Data protection
- Sensitive text (accessibility/AV): organizer-only visibility flag on the requirement
  (`config.organizerOnly`) — never in any public payload; `lib/publicEvent.ts` uses explicit
  selects, so no accidental exposure path exists.
- Originals preserved: supersede chain on `ReadinessSubmission`; approved values are copied to
  `Speaker`/`SessionItem` fields, source rows retained.
- Every approval/waiver/send/revoke writes `AuditLog` with actor.
- Retention after archive / on account deletion: `AccountDeletionRequest` hard-delete job and
  `lib/accountExport.ts` must include readiness tables **when they land** (ER2 acceptance
  item); event-archive retention policy is O7.
- Email logging: follow `lib/email/redact.ts` conventions; never log raw tokens.

---

## 12. Conflict list — plan vs. repository (code wins)

Each item: what the plan says → what the code says. **The code is authoritative.**

- **C1 — Launch blockers (plan §4, §15 Phase E).** Plan text says Resend/Anthropic/billing are
  unconfigured and signups are locked out. Reality: **all §4 gates are closed** (LAUNCH_CHECKLIST
  §0 done 2026-07-21; §10 "Launch state as of 2026-08-06: every blocker closed"). The banner is
  right; the body text is stale. Phase E is complete — ER-phase prerequisites that depended on
  it (ER6 email, ER7 AI) are **already satisfied**.
- **C2 — Billing provider (plan §3, §13.4, §15 ER9).** Plan: Lemon Squeezy. Reality: **Stripe
  Managed Payments live** since 2026-08-06 (`BILLING_PROVIDER=stripe`, webhook
  `/billing/webhooks/stripe`, verified with a real charge). LS code remains as a selectable
  legacy provider. Every plan instruction naming Lemon Squeezy maps to "the `lib/billing`
  provider abstraction, Stripe configuration". ER9 attaches readiness to Stripe products, and
  the §13.4 rule "verify the current billing path" is already done.
- **C3 — `HANDOFF_BRIEF.md` and `README.md` still say "Billing: Lemon Squeezy"** and describe
  the three-things-off state. Stale relative to code and to RUNBOOK §8/LAUNCH_CHECKLIST §10.
  (Docs bug, worth a one-line fix outside ER0's no-change rule.)
- **C4 — Repo counts (plan §3).** "37 API route modules · 40 web pages · 41 components ·
  56 test files" → now 38 route files, 60 API test files (391 tests), 43+ components.
  Immaterial drift; noted for accuracy.
- **C5 — Plan §8 jobs row** guesses `apps/api/src/lib/jobs` "or current equivalent" —
  confirmed `lib/jobs/index.ts` (`BackgroundJob` poller, in-process, single instance).
- **C6 — No generic invitation/token model (plan §8 "existing invitation … token models").**
  Tokens are per-domain columns (§4). Readiness reuses the *pattern* (hash at rest, expiry,
  revocation), but a new small table is required — there is nothing generic to reuse.
- **C7 — No generic changeset/approval model (plan §6.1.J, §17 Q8).** The "reviewable
  changeset" is `AgendaIngestRun`, ingest-specific. Four draft→approve precedents exist
  (§7) but no shared table. Readiness approvals are submission-level columns + AuditLog.
- **C8 — Private files (plan §12) vs. public-URL storage.** The storage abstraction produces
  public URLs only; CFP attachments are unlisted-but-public today. Readiness must extend the
  provider additively (§11.4) — the plan's assumption that existing storage already has
  "privacy and lifecycle conventions" (§2.2) is **too generous**; conventions exist for
  upload validation, not for access control.
- **C9 — CFP access tokens never expire**, though the code's own error copy says "Invalid or
  expired" (`cfp.ts:326`) and plan §12 requires expiring links. Readiness portal tokens add
  `expiresAt` and must not copy the CFP omission.
- **C10 — Organizer IA (plan §10.1).** The plan sketches seven readiness destinations. Actual
  convention: one workspace page with in-page tabs (`?tab=`) plus one subpage per heavy module
  (`ingest`, `cfp`, `sponsors`, `analytics`, `scanner`). Readiness = **one subpage** with
  internal sections, one nav item in `OrganizerShell`.
- **C11 — Nav conditioning.** `OrganizerShell` nav items are currently unconditional
  (API-gated only). The plan's hidden-by-default requirement means the readiness nav item is
  the **first feature-conditional organizer nav item** — small new wiring, no new system.
- **C12 — RUNBOOK section numbering is broken:** two "§9" and two "§10" headings
  (`RUNBOOK.md` L148/L197 and L155/L300). The plan's banner cites "RUNBOOK §9" for the test
  suite — that's the **second** §9 (L197). The user-facing instruction "verify per RUNBOOK §9"
  resolves to the DB-test procedure: disposable Neon `ukedl_test` branch, never
  `ALLOW_DESTRUCTIVE_DB`. (Docs bug.)
- **C13 — Plan §19.1 says to place the plan at `docs/product/ukedl-event-readiness-integration-plan-v2.md`;**
  it actually lives at repo root as `EVENT_READINESS_PLAN.md` (commit `4fb7bf0`). References
  in this audit use the actual path.
- **C14 — Event chat retired (E18).** Plan §1 lists "direct messages" etc. as current — still
  true, but `messaging_event_chat` is `retired: true` in the registry; Messages now owns 1:1 /
  group only. No readiness impact beyond not building on retired keys.
- **C15 — Speaker self-service.** `PARITY_AUDIT.md` asks to "verify speakers can upload/edit
  their own materials post-acceptance". Verified: only partially — a speaker **with a User
  account** who joins their session can add `SessionResource`s
  (`routes/sessions.ts:86-104 assertCanContributeSessionResources` allows manage-rights OR a
  `JOINING` attendance), but roster `Speaker` rows have no account link, invites only mint
  ATTENDEE memberships, and there is no way to edit one's own bio/headshot/session metadata.
  The presenter portal is genuinely new surface, not a duplicate.
- **C16 — `AiMeterFeature` has no readiness value (plan §6.1.L metering).** Use `OTHER`
  (hard-capped) until an additive enum migration at ER7.
- **C17 — Image-dimension validation (plan §6.1.B settings)** does not exist anywhere in the
  codebase and would need a new dependency; recommend dropping dimension rules from MVP (O8).

---

## 13. Test plan

Extend existing patterns; every new endpoint ships its authorization test in the same session
(`.cursor/rules/product.mdc` rule 5).

**New files (ER2 onward):**
- `readiness.unit.test.ts` — derived-status function (deterministic, table-driven), template
  normalization, config validation.
- `readiness.db.test.ts` — fixtures copied from `cfp.db.test.ts` (org A/org B, event, speakers):
  - Cross-org and cross-event denial (assignments, templates, submissions) — pattern from
    `tenancy.db.test.ts` and `sessionsBulkAssign.db.test.ts`.
  - Feature-disabled: every `/readiness` route 404s via `requireFeature` when the override is
    off, when the plan disallows, and by default — pattern from `features.db.test.ts`.
  - Staff-vs-member vs REVIEWER permission split.
  - Assignment uniqueness idempotency; waive/approve audit rows.
- `readinessPortal.db.test.ts` (ER4) — expired token 404, revoked token 404, tampered token
  404, token scoped to its own speaker's assignments only, file access isolation.
- `readinessReminders.db.test.ts` (ER6) — preview-does-not-send, idempotent scheduled send
  (re-running `processDueJobs` sends once), pause, feature-off cancels sends; job-drain helper
  from `__tests__/setup/jobDrain.ts` (E20 taught the drain-not-first-empty-poll lesson).
- ER7: assert no direct `@anthropic-ai/sdk` import outside `lib/ai/providers` (the
  existing lint/audit convention), mock-provider fallback, originals preserved.
- Web: `apps/web/__tests__/` (Vitest, node env) for any extracted pure logic, e.g. status
  rollup display — pattern `billingStatus.test.ts`.

**Regression protection (plan §16.1):** the existing suites already cover CFP, publish,
public event, features, tenancy; ER phases run the full suite. Public-page independence is
structural (readiness never touches `lib/publicEvent.ts`), and `publicEvent.db.test.ts`
already pins the payload.

**How to run:** unit — `npm test` (from `apps/api`); DB — per RUNBOOK §9 (second §9):
`DATABASE_URL="<direct ukedl_test url>" npx vitest run` from `apps/api`, disposable Neon
branch only, **never `ALLOW_DESTRUCTIVE_DB`**. ER0 itself ran nothing.

---

## 14. Revised phase plan

Resequenced against reality: Phase E is done, so ER6/ER7 prerequisites are already met;
billing is Stripe. Each phase is independently reviewable, feature remains off by default
throughout, and "disable" always means: turn the feature key off (plan-level default already
off) — no data loss, no migration reversal.

### ER1 — feature key + hidden skeleton (no schema)
- **Files:** `packages/shared/src/features.ts` (add `readiness` to `FeatureKey` union +
  registry entry: `defaultOn: false`, `plannedPhase: "ER"`, category `sessions`;
  rebuild `packages/shared` to `dist` and run API+web builds — §14.4 shared-package warning),
  `apps/api/src/routes/readiness.ts` (router with one `GET /readiness/overview` stub behind
  `requireAuth` + `requireFeature`), `apps/api/src/index.ts` (mount), tests.
- **Schema:** none.
- **Acceptance:** feature off ⇒ no organizer UI change (plannedPhase hides it from
  FeatureConfigPanel), API 404s; existing suites green; no entitlement grants it on any
  public tier (INTERNAL only).
- **Excluded:** any UI, any schema.

### ER2 — data model + derived status (migration 1)
- **Files:** `schema.prisma` (+5 models, §10.1), migration, `apps/api/src/lib/readiness/`
  (status derivation, template apply), `routes/readiness.ts` (templates/requirements/
  assignments CRUD, derived-status rollup endpoint), account-deletion/export inclusion,
  `readiness.unit.test.ts`, `readiness.db.test.ts`.
- **Acceptance:** tenant isolation tested; status derivation deterministic; CFP/event data
  untouched (readiness only FKs to it); feature-disabled tested; migration applied to the
  `ukedl_test` branch.
- **Excluded:** portal, email, AI, UI beyond nothing-visible.

### ER3 — organizer workflow UI
- **Files:** `apps/web/pages/organizer/events/[eventId]/readiness.tsx`, nav item in
  `OrganizerShell.tsx` (feature-conditional — C11), panels reusing `console-panel`/`ListState`/
  `StatusChip`/`Select`/`ConfirmDialog`; activation flow flips the override like CFP form
  creation does (`cfp: true` precedent); exception-first overview; manual waive/approve with
  `AuditLog` writes; activity tab reading AuditLog.
- **Acceptance:** design tokens only; role permissions tested; bulk actions audited; nothing
  publishes to attendees; disabled ⇒ no nav item, no dead links.

### ER4 — presenter portal + private files (needs §11.4 decision O5)
- **Files:** `ReadinessPortalAccess` usage + mint/revoke endpoints, `lib/mail.ts`
  `sendReadinessInviteEmail` (copyUrl fallback like every other helper), public portal page
  `apps/web/pages/r/[token].tsx`, portal API routes (`publicRateLimit`, token-hash lookup),
  `acceptUpload` with per-requirement MIME/size config, storage `get()` extension + authorized
  file route, `readinessPortal.db.test.ts`.
- **Acceptance:** security tests (§13) pass; files private; token expiry/revocation enforced;
  existing signup/auth unchanged (portal never touches `User`).

### ER5 — validation, exceptions, approval→record write-through
- Deterministic checks (§6.1.I subset that derives from existing data: missing required,
  deadline passed, file invalid, session outside event window via `Event.startDate/endDate`,
  missing room/chair, double-booked speaker via `SessionSpeaker` times); approve copies value
  to `Speaker.bio/photoUrl/...` or `SessionItem.title/abstract` with original snapshot in the
  submission row; attendee visibility continues to ride event/session publish (§7).
- **Acceptance:** originals preserved; public pages unchanged until organizer publishes;
  every change audited.

### ER6 — reminders (prereq already met: Resend live)
- Migration 2 (`ReadinessReminder` + deliveries, `CfpDecisionEmail` shape); preview → test
  send → manual send → scheduled via `enqueueJob({ scheduledAt })`; pause = revoke pending
  job rows (RUNBOOK §5 kill-switch idiom); rate-pace like announcements.
- **Acceptance:** idempotent sends; feature-off blocks future sends; delivery state recorded;
  no engagement-bait copy (anti-goals).

### ER7 — AI assistance (prereq already met: Anthropic live)
- All calls via `gatewayChat`/`gatewayExtract` with `feature: OTHER` (or migration 3 enum);
  bio shorten/normalize, title/description suggestions, reminder drafts, change summaries;
  suggestions land as `ReadinessSubmission { aiGenerated: true, submittedVia: "ai" }` needing
  the same approval as presenter input; labels via a shared copy module (assistants.ts rule).
- **Acceptance:** mock-provider fallback tested; originals preserved; caps enforced; no
  direct SDK imports.

### ER8 — pilots (manual entitlement)
- Grant via `INTERNAL` plan orgs or decision O4; measure per plan §15 ER8 metrics. No code
  beyond feature-key visibility (drop `plannedPhase` for pilot orgs is **not** possible
  per-org — see O9 for the visibility mechanism).

### ER9 — billing attach + GA
- Add `readiness` entitlement to chosen tiers/SKUs in `plans.ts`; Stripe product/price +
  `STRIPE_PRICE_*` var; webhook path already generic (`applyPlanSkuToOrg`); grace/read-only
  behavior inherits `isOrgReadOnly` (`assertOrgWritable` already blocks mutations —
  readiness mutations must call it like event creation does); pricing page + help article
  (`.cursor/rules` rule 12: help articles updated in the same session).

---

## 15. Open decisions (cannot be safely derived from the repository)

Answers to plan §17's twenty questions are embedded above where derivable
(Q1→§2.2, Q2→yes, Q3→§4, Q4→§5/C8, Q5→§7, Q6→§3, Q7→§3/C2, Q8→C7, Q9→§6, Q10→§11.1,
Q16→`Speaker`, Q17→convert hook §8, Q18→CSV export precedent `cfp.ts export.csv`,
Q19→none exist §6, Q20→CFP/tenancy/features fixtures §13). Genuinely open:

- **O1 — Portal token lifetime + reissue policy** (Q14 included: does access survive
  publication / event end?). Recommendation: 30 days, remint-on-demand, auto-revoke on
  event archive.
- **O2 — Where presenter email lives long-term.** ER0 proposes `ReadinessPortalAccess.email`
  (keeps `GET /speakers` clean). Alternative: nullable `Speaker.contactEmail` with explicit
  selects everywhere. Product call.
- **O3 — Sensitive-field visibility tier** (Q11): manage-level for MVP or a per-organizer
  allowlist (no mechanism exists today; would be new).
- **O4 — Pilot entitlement for paying orgs**: run pilots on `INTERNAL`-plan comped orgs
  (zero code), or add a per-org entitlement override column (small additive migration).
  Recommendation: comped `INTERNAL` orgs for the first 3–5 pilots, exactly like plan §13.2.
- **O5 — Private file serving**: API-proxied (recommended) vs signed URLs (§11.4).
- **O6 — Exception persistence** (ER5): derive-only vs `ReadinessException` table.
- **O7 — Retention** (Q12/Q13): readiness data after archive, and on add-on expiry —
  plan §13.4 wants a documented grace/read-only policy; nothing in code answers it.
- **O8 — Image dimension rules**: drop from MVP (no validation infra, new dependency) or
  accept the dependency. Recommendation: drop; enforce MIME+size only.
- **O9 — Pre-GA visibility mechanism**: `plannedPhase` hides the toggle from **all**
  organizers globally; there is no per-org UI reveal. For pilots, either remove
  `plannedPhase` at ER8 (visible to everyone but plan-blocked for non-entitled orgs — the
  existing `blockedReason` UX) or keep it hidden and activate via support. Recommendation:
  the former; it reuses the registry's plan-lock display path.
- **O10 — File formats/size limits per requirement type** (Q15): product call; CFP's
  10 MB / PDF-DOCX-image allowlist is the sane default, decks likely need more (R2 cap is
  configurable via `STORAGE_MAX_UPLOAD_BYTES`, default 20 MB).

---

*End of ER0. No application code, schema, environment, or data was changed. The next step,
after human review of this audit (plan §19.4 checklist), is ER1.*

---

## §15 (addendum) — O1–O10 RESOLVED by founder, 2026-08-16

- O1 RESOLVED: portal tokens expire 30 days; remint on demand; auto-revoke on event archive.
- O2 RESOLVED (amended at ER2): presenter email lives on `ReadinessPortalAccess.email`, NOT `Speaker.contactEmail` — Speaker rows are member-readable via GET /speakers and must not leak contact emails.
- O3 RESOLVED: sensitive-field visibility is manage-level for MVP; no per-organizer allowlist.
- O4 RESOLVED: first 3–5 pilots run as comped INTERNAL-plan orgs (zero entitlement code).
- O5 RESOLVED: private files are API-proxied (auth-checked streaming); no signed URLs. Unblocks ER4.
- O6 RESOLVED: exceptions are derived, not stored; WAIVERS are persisted (join the ER2 models).
- O7 RESOLVED: readiness files retained for the life of the event, removed on event deletion; privacy-draft sentence to be added; tiered retention revisited at ER9.
- O8 RESOLVED: image dimension rules dropped from MVP.
- O9 RESOLVED: at ER8, remove `plannedPhase` from the readiness key; rely on plan-lock blockedReason UX for non-entitled orgs.
- O10 RESOLVED: default file rules = CFP allowlist (PDF/DOCX/images, 10 MB); deck-type requirements up to the 20 MB storage cap; configured per requirement type.

Sequencing (founder, 2026-08-16): full pre-pilot build — ER2 → ER3 → ER4 (then reassess
ER5–ER7) after AGENT-1/AGENT-2 (real conversational concierge + setup copilot).

### ER4 / ER6 — template evolution after portal invites (founder, 2026-08-17)

Founder requirement (2026-08-17): when the presenter portal exists, requirement changes made
after portal invites must surface to presenters (calm 'your checklist changed' notice via
the ER6 reminder machinery — no immediate push).

### ER5.1 — O1 amended: portal link grace on remint (founder, 2026-08-17)

O1 said "remint on demand", and ER4/ER5 read that as "each new link kills every older one".
In practice presenters open whichever invite or reminder email is nearest to hand, so every
reminder turned an already-emailed link into a support ticket.

Amendment: `ReadinessPortalAccess` keeps ONE previous token beside the current one
(`previousTokenHash` + `previousExpiresAt`, both nullable; additive migration
`20260820120000_er51_portal_link_grace`). On remint — organizer resend AND the ER5 reminder
sweep — the outgoing token moves into that slot carrying its ORIGINAL expiry, which is never
extended; a second remint retires the oldest. Token lookup accepts either hash and stamps
`lastUsedAt` either way.

Unchanged: 30 days per token, auto-revoke on archive, and revocation as the absolute answer —
revoke clears both slots, and a revoked token is never carried into grace by the remint that
clears `revokedAt`.

