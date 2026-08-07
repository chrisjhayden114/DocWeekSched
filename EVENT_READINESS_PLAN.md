> **STATUS BANNER — added 2026-08-06.** This plan was written 2026-07-21, when
> Phase E was incomplete. **Every launch gate in §4 is now closed:** Resend is
> live and `support@ukedl.com` both sends and receives; `ANTHROPIC_API_KEY` is
> set with Sentry monitoring; billing went live on Stripe Managed Payments and
> was verified with a real $79 charge, webhook, entitlement, refund and
> cancellation; the invite-code wall and the 8-row ingest truncation were both
> fixed in chunk E0; and file ingest now handles real multi-page PDF, DOCX and
> XLSX programmes.
>
> §4 still names **Lemon Squeezy — that decision was reversed.** Billing is
> Stripe Managed Payments (`LAUNCH_CHECKLIST.md` §2, `RUNBOOK.md` §10).
>
> Also note: chunks E9–E24 have shipped since this was written, including
> bulk track/room assignment, a shared Select control, Messages phase 1, the
> Setup and Event assistants, and a working database test suite (`RUNBOOK.md` §9).
> **Audit the code, not this document, where the two disagree.**
>
> **Event Readiness is unblocked. ER0 is the next step.**

# UKEDL Event Readiness Integration Plan — Current-Codebase Revision

**Document status:** Authoritative product-and-implementation handoff for Event Readiness  
**Supersedes:** `ukedl-event-readiness-integration-plan.md`  
**Validated against:** `HANDOFF_BRIEF.md` and `README.md`, both current as of 2026-07-21  
**Codebase reference in handoff:** branch `main`, HEAD `fc2d061`  
**Production changes authorized by this document:** None  
**Primary build target:** Cursor using the Fable 5 model, operating inside the UKEDL repository  
**Required delivery style:** Repository audit first, then small reviewable phases; never a one-shot autonomous build

---

# 1. Executive decision

The central recommendation remains valid:

> **Preserve UKEDL as the calm academic-event workspace, and add Speaker & Session Readiness as an optional event-level operations module.**

The earlier plan understated how much UKEDL already contains. UKEDL is not a schedule-only prototype. It is a substantial, live application with:

- Organizations and event ownership
- Events, dates, tracks, rooms, sessions, papers and ordered authors
- Publish, public schedule and archive workflows
- CFP submission, review and decisions
- Per-session in-person, virtual and asynchronous attendance modes
- Timezone handling
- Certificates
- Badges
- Check-in and QR workflows
- Capacity and waitlists
- Venue maps
- Community boards
- Direct messages
- Meeting requests
- Per-event feature toggles
- AI, email, object-storage, background-job and billing infrastructure
- Existing authorization, testing and deployment conventions

Therefore, Event Readiness must be implemented as a **thin, integrated operational layer over existing UKEDL records and infrastructure**, not as a new subsystem that duplicates them.

The recommended first commercial module remains:

> **Speaker & Session Readiness**  
> Collect, validate and follow up on everything required to make every accepted speaker, paper and session ready before show day.

Sponsor Readiness remains a possible later add-on, but it is not part of the first build.

---

# 2. What changed after reviewing the current handoff and README

## 2.1 The prior strategy is still valid

Keep these decisions from the previous plan:

- Event Readiness is optional, not mandatory.
- It is enabled per event.
- Existing schedule-only customers retain their current experience.
- Speaker and session readiness comes before sponsor readiness.
- AI drafts and recommends; organizers approve and publish.
- The public schedule must not depend on the AI provider, reminder system or readiness module.
- Database work should be additive.
- New functionality should be hidden behind existing feature/entitlement controls.
- The first production release should be a limited pilot.
- Pricing should reflect operational value rather than low-cost consumer SaaS pricing.
- Do not turn UKEDL into a Whova clone.
- Do not add native-mobile work; UKEDL's mobile product is the PWA.

## 2.2 The prior technical plan must be corrected

The following assumptions from the previous plan must not be used blindly.

### Do not create a second feature-toggle system

UKEDL already has per-event feature toggles. The implementation must first inspect and extend that system. Do not create an `event_modules` table merely because the previous plan suggested one.

### Do not create new AI infrastructure

UKEDL already has an AI gateway at:

```text
apps/api/src/lib/ai
```

Every Event Readiness AI call must go through it for:

- Grounding
- Metering
- Cost caps
- Labelling
- Audit
- Provider fallback

Never call `@anthropic-ai/sdk` directly from a route or from the web application.

### Do not create new email infrastructure

UKEDL already uses:

```text
apps/api/src/lib/email
```

with Resend. Build reminder behavior on that abstraction.

Production currently has no `RESEND_API_KEY`, so no external readiness invitations or reminders should be activated until email delivery and the existing account-verification flow are working.

### Do not create new billing infrastructure

UKEDL already contains Lemon Squeezy billing code. The existing path has not yet executed in production because the keys are unset. Event Readiness should initially use a manual/internal entitlement for pilots and later attach to the existing billing design.

### Do not create a new background-job system

Background jobs already exist. Reminder scheduling, file processing and asynchronous AI work must reuse the existing job conventions.

### Do not create a second object-storage abstraction

Object storage already exists. Speaker files, headshots and presentation uploads must reuse it, including its privacy and lifecycle conventions.

### Do not duplicate people, speakers or proposals

The exact Prisma models must be inspected. UKEDL already has:

- Users and roles
- Authors
- Sessions
- Papers
- CFP submissions and decisions
- Event attendance and invitations

The implementation must map Event Readiness to those models instead of inventing a parallel `Stakeholder`, `Presenter` or `Speaker` identity model.

### Do not build App Router or Next.js server actions

The web application uses:

- Next.js 14.2.5
- Pages Router
- React 18

New organizer pages must follow the current Pages Router and API-client conventions. Backend APIs belong in the Express application, not in new Next.js API routes unless the repository already has a deliberate exception.

### Do not modify the dormant Expo shell

`apps/mobile` is not deployed or maintained. Event Readiness must work responsively in the web/PWA product. No Event Readiness work should be added to the Expo project.

### Reframe the prior “do not build” list

Some features that the previous plan said not to build already exist in UKEDL, including badges, check-in and community features. The correct instruction is:

> Do not expand or couple Event Readiness to those systems during the first build unless an explicit integration is required for the readiness workflow.

---

# 3. Verified current architecture

Cursor must verify these facts against the repository before editing, but they are the documented starting point.

| Layer | Current implementation |
|---|---|
| Monorepo | npm workspaces |
| Web | Next.js 14.2.5, Pages Router, React 18, TypeScript |
| Web hosting | Netlify |
| API | Express 4 and TypeScript |
| API hosting | Render service `docweeksched-api` |
| Database | PostgreSQL on Neon |
| ORM | Prisma 5.18 |
| Authentication | Custom JWT using httpOnly cookies |
| Cookie domain | `.ukedl.com` |
| Authorization | Organization- and event-level roles |
| AI | Anthropic SDK behind `apps/api/src/lib/ai` |
| Email | Resend behind `apps/api/src/lib/email` |
| Billing | Lemon Squeezy |
| Error monitoring | Sentry |
| Tests | Vitest |
| Shared packages | `packages/config`, `packages/shared` |
| Mobile | Dormant Expo shell; ignore |
| Public mobile story | Installable web/PWA |

Documented repository scale:

- 80 Prisma models
- 41 migrations
- 37 API route modules
- 40 web pages
- 41 components
- 56 test files

This is a mature codebase. Any implementation plan that proposes broad new infrastructure without first locating the existing equivalent is invalid.

---

# 4. Current launch blockers and sequencing constraint

As of the current handoff, UKEDL is live but is not yet ready to accept customers because:

1. `RESEND_API_KEY` is unset.
2. Registration creates an unverified user, but verification email cannot be sent.
3. New users are therefore locked out.
4. `ANTHROPIC_API_KEY` is unset and `AI_PROVIDER=mock`.
5. Production AI surfaces return canned output.
6. Lemon Squeezy keys are unset.
7. The production billing path has never executed.
8. The public organizer form shows an invite-code requirement that the backend does not require.
9. The homepage ingest demonstration truncates at eight rows.

These are Phase E launch items and must be coordinated with `FIX_PLAN.md`.

## Sequencing rule

Event Readiness may be developed behind disabled feature controls while Phase E is being completed.

However:

- Do not invite real speakers until production email works.
- Do not market AI readiness capabilities until the real AI provider is configured and monitored.
- Do not expose a paid checkout for Event Readiness until the existing Lemon Squeezy path has been tested.
- Do not publicly launch a new acquisition funnel while organizer registration remains blocked.
- Do not use the homepage import mock as proof of readiness until its truncation and completeness reporting are corrected.

---

# 5. Product definition

## 5.1 Product name

Use the broad family name:

> **Event Readiness**

Use the precise first-module name:

> **Speaker & Session Readiness**

Avoid positioning it merely as “AI event planning.”

## 5.2 Product promise

> **Know exactly what will prevent every accepted speaker, paper and session from being show-ready—and resolve routine issues before they become an emergency.**

## 5.3 Where it sits in UKEDL

UKEDL's existing schedule and public event remain the system of record and presentation.

Speaker & Session Readiness becomes the system of action that prepares:

- Speaker details
- Author details
- Session metadata
- Paper metadata
- Agreements
- Permissions
- Headshots
- Presentation files
- AV needs
- Accessibility needs
- Moderator/chair assignments
- Deadlines
- Approvals
- Exceptions

## 5.4 Primary customer

The first target remains:

> Recurring academic and education conferences in UKEDL's established 50–2,000-attendee segment.

Examples:

- Departmental conferences
- Scholarly societies
- Education programs
- Annual professional-association meetings
- Research symposia
- Multi-track training events

## 5.5 Primary workflow entry point

The strongest integration is:

```text
CFP submission
    ↓
Review and decision
    ↓
Accepted paper/session and authors
    ↓
Readiness requirements assigned
    ↓
Presenter portal
    ↓
Exceptions and approvals
    ↓
Approved updates to event records
    ↓
Organizer publishes
```

This gives UKEDL a differentiated end-to-end academic workflow without replacing its existing CFP or schedule systems.

---

# 6. Scope of the first module

## 6.1 MVP capabilities

### A. Event activation

An authorized organizer can enable Speaker & Session Readiness for one event.

The activation flow must:

- Use the existing per-event feature system.
- Confirm the event.
- Select included roles or record types.
- Select or create a requirement template.
- Set deadlines.
- Preview the external portal.
- Preview invitation/reminder content.
- Require explicit activation.

### B. Requirement templates

Support templates for:

- Keynote speaker
- Paper presenter
- Panelist
- Session chair
- Moderator
- Workshop facilitator
- Poster presenter
- Remote presenter

Initial requirement types:

- Short text
- Long text
- Yes/no confirmation
- Single select
- Multiple select
- Date
- URL
- File upload
- Agreement/permission acceptance
- Internal organizer checklist item

Settings:

- Required or optional
- Applicable role
- Deadline
- Character or word limit
- Allowed file types
- File-size limit
- Image dimensions
- Organizer approval required
- AI suggestion allowed
- Stakeholder-visible or organizer-only
- Reminder behavior

### C. Assignment engine

Assignments connect requirements to existing UKEDL subjects such as:

- Author
- User
- CFP submitter
- Paper
- Session
- Event role

The exact subject model must be determined by repository inspection.

### D. Readiness status

Recommended states:

- Not started
- In progress
- Waiting on presenter
- Submitted
- Needs organizer review
- Ready
- Late
- Blocked
- Waived
- Not applicable

Status must be derived from assignments, submissions, approvals and exceptions. Do not manually store a single authoritative percentage.

### E. Organizer overview

Show:

- Overall readiness
- Ready count
- Waiting on presenter
- Needs review
- Late
- Blocked
- Upcoming deadlines
- Delivery failures
- High-priority conflicts

The default view should be exception-first, not a second giant event spreadsheet.

### F. Speaker/session table

Suggested columns:

- Person
- Role
- Paper/session
- Status
- Missing items
- Deadline
- Last activity
- Reminder state
- Organizer owner

Filters:

- Status
- Role
- Track
- Day
- Requirement
- Deadline
- Organizer owner

Bulk actions:

- Assign template
- Change deadline
- Send or queue reminder
- Mark not applicable
- Waive requirement
- Assign organizer owner
- Export selected

### G. Presenter portal

Use the best existing invitation or token mechanism after repository inspection.

Required behavior:

- Passwordless event-specific access
- Mobile/PWA friendly
- Event branding
- Autosave
- Upload progress
- Accepted-format guidance
- Clear submitted/saved status
- Replacement before deadline
- Visible remaining requirements
- Organizer contact
- Token expiration and revocation
- Strict access only to the intended event and subject

Do not force an external presenter to create a normal UKEDL account unless the current identity model makes that clearly better and the user experience is tested.

### H. Submissions and files

Support:

- Biography
- Headshot
- Final title
- Final abstract or session description
- Presentation deck
- Recording permission
- Publication permission
- AV requirements
- Accessibility requirements
- Remote-presenting details
- Organizer-only notes

Files must use the current object-storage abstraction and remain private unless an organizer explicitly publishes or exposes them.

### I. Validation and exceptions

Deterministic checks:

- Required field missing
- Deadline passed
- File type invalid
- File too large
- Image dimensions invalid
- Biography too long
- Missing moderator/chair
- Speaker double-booked
- Missing room
- Session outside event date range
- Conflicting attendance mode or remote details
- Delivery failure
- Duplicate or unresolved person match

Possible exception states:

- Open
- Waiting on presenter
- Waiting on organizer
- Resolved
- Waived
- Not applicable

### J. Approvals and publishing

AI and presenter submissions may propose changes to existing:

- Author/speaker profile
- Paper title
- Abstract
- Session title
- Session description
- Track tags
- AV metadata

No change may reach the public attendee experience until an organizer explicitly approves and publishes it.

Use the existing reviewable-changeset and publish conventions wherever possible.

### K. Reminders

Start in this order:

1. Preview only
2. Manual send
3. Scheduled reminders
4. Escalation rules

Reminders must:

- Use `apps/api/src/lib/email`.
- Use existing background jobs.
- Include the actual missing items.
- Support test send.
- Support pause.
- Record delivery state.
- Handle failure/bounce information exposed by the current email abstraction.
- Avoid unsolicited or engagement-style notifications.

### L. AI assistance

Initial AI actions:

- Shorten biography to a configured limit.
- Normalize capitalization and formatting.
- Suggest a clearer title.
- Clean a session description.
- Suggest topic tags.
- Summarize changes.
- Draft a personalized reminder.
- Flag suspiciously incomplete or inconsistent content.
- Suggest a schedule-conflict resolution.

AI output must:

- Go through `apps/api/src/lib/ai`.
- Preserve the original.
- Be separately reviewable.
- Record prompt/version/model metadata according to existing gateway conventions.
- Degrade safely when the provider is unavailable.
- Never become a dependency for the public schedule.

### M. Export

Initial exports:

- Readiness status CSV
- Missing-items CSV
- Presenter contact/status CSV
- File manifest
- Audit/activity report
- Approved updates into existing UKEDL records

Do not make Sched or Whova integration an MVP requirement. UKEDL itself is the first and strongest destination.

---

# 7. Explicitly out of scope for the first build

Do not add or expand the following as part of Speaker & Session Readiness:

- Sponsor readiness
- Sponsor contract extraction
- Ticketing changes
- Refund workflows
- New attendee networking
- New community or messaging features
- New badge or check-in features
- Native iOS or Android work
- Livestreaming infrastructure
- Venue sourcing
- General-purpose project management
- SMS reminders
- Abstract peer-review redesign
- Continuing-education compliance
- Full Whova/Sched compatibility
- A general “plan my event” chatbot
- Autonomous public schedule edits
- Engagement leaderboards
- Gamification
- Manufactured activity notifications
- Ads
- Attendee-data monetization
- Dark-pattern upgrade prompts

Existing UKEDL capabilities in these areas must continue to work and must not be removed.

---

# 8. Reuse-first architecture map

Cursor must complete this map using the codebase before proposing migrations.

| Need | Inspect and reuse first |
|---|---|
| Event entitlement | Existing per-event feature toggles and billing entitlement models |
| People identity | User, author, CFP submitter, attendee and invitation models |
| Academic records | Event, session, paper, author ordering, track and room models |
| External access | Existing invitation, verification, reset, join or token models |
| File storage | Existing object-storage services and file metadata models |
| Email | `apps/api/src/lib/email` |
| AI | `apps/api/src/lib/ai` |
| Jobs | Existing job queue/scheduler modules under `apps/api/src/lib/jobs` or current equivalent |
| Authorization | Existing organization/event authorization helpers, including `lib/authorization.ts` |
| Audit | Existing event, publication, AI or general audit models |
| Billing | Existing Lemon Squeezy routes, services, webhook and entitlement logic |
| Error reporting | Existing Sentry conventions |
| API validation | Existing Zod request schemas |
| Shared types | `packages/shared`, compiled to `dist` |
| Product configuration | `packages/config`, compiled to `dist` |
| UI styles | `apps/web/styles/globals.css` and `DESIGN_PHASE_D.md` |
| Organizer pages | Existing `apps/web/pages/organizer/*` patterns |
| API routes | Existing Express route-module conventions under `apps/api/src/routes` |

## Reuse decision rule

For every proposed new model or service, the repository audit must answer:

1. Does an existing model already represent this concept?
2. Can it be safely extended with a nullable/additive field?
3. Is a join model sufficient?
4. Would a new model duplicate an existing source of truth?
5. Is the proposal tenant-safe?
6. Does the current feature-toggle or entitlement system already solve access?
7. Can the current audit/logging mechanism be extended?
8. Can the current invitation or token system be reused?
9. Can the current job or email system perform the work?
10. What existing tests prove compatibility?

A new subsystem should be created only when the answer is clearly “no existing equivalent.”

---

# 9. Conceptual data model—not final Prisma instructions

The prior plan included suggested tables. Those names are no longer authoritative.

The repository-specific plan may need concepts resembling:

- Readiness template
- Template item
- Event-specific requirement
- Requirement assignment
- Stakeholder submission
- Readiness exception
- Approval
- Reminder rule
- Reminder delivery
- Readiness activity/audit event

But before creating any of them, inspect the existing schema for:

- Event feature flags
- Event configuration JSON
- Entitlements/subscriptions
- CFP submissions and decisions
- Author and person identity
- Files/assets/uploads
- Invitations and tokens
- Notifications and deliveries
- Jobs
- Audit events
- Changesets and publish approvals
- Organization membership and event roles

## Data rules

- Do not create a second event model.
- Do not create a second speaker/person source of truth.
- Do not duplicate file metadata.
- Do not duplicate invitation token infrastructure.
- Do not duplicate billing entitlements.
- Every new record must be scoped to an organization/event.
- Authorization must be enforceable at the query and route level.
- Add indexes for event, subject, status, due date and uniqueness where appropriate.
- Use explicit foreign keys.
- Use additive migrations.
- Follow the repository's expand-then-deploy discipline.
- Never drop a field in the same deployment that introduces its replacement.
- Apply production migrations using `DIRECT_DATABASE_URL`, not the Neon pooler.
- Include rollback or forward-fix instructions for each migration.

---

# 10. Frontend and navigation integration

## 10.1 Organizer navigation

Do not create a second application.

Add Event Readiness inside the existing event workspace, following the current organizer page and navigation conventions.

Conceptual destinations:

- Readiness overview
- People and sessions
- Requirements
- Reminders
- Issues and approvals
- Exports
- Activity

The exact Pages Router paths must follow the repository's current naming pattern. Do not impose a new route convention without inspecting existing organizer pages.

## 10.2 Hidden-by-default behavior

When the module is unavailable or disabled:

- Existing navigation is unchanged.
- Existing event creation is unchanged.
- Existing CFP is unchanged.
- Existing schedule editing is unchanged.
- Existing public pages are unchanged.
- Existing billing behavior is unchanged.
- No readiness API or UI should leak event data.

## 10.3 Event dashboard card

When an authorized organization can access the module but it is disabled:

```text
Speaker & Session Readiness

Collect biographies, headshots, final files, permissions and AV needs.
See what is missing and follow up before show day.

[Set up readiness]
```

When active:

```text
Speaker & Session Readiness      82%

Ready                              48
Waiting on presenter                9
Needs review                        4
Blocked                             2

[Open readiness]
```

## 10.4 Design rules

Use the existing visual system:

- Inter
- Existing neutral gray ramp
- Borders rather than heavy shadows
- Existing 4/6/10px radius conventions
- Current table, form, badge, drawer, modal and empty-state components
- Existing accessibility conventions
- Current responsive/PWA patterns

Do not introduce a new component library or visual language for this module.

---

# 11. Authorization and tenant isolation

The repository audit must map every action to existing roles.

Documented baseline:

- Any signed-in user may create an organization and becomes its OWNER.
- Event operations require STAFF-or-above access on the owning organization.
- Authorization is organization- and event-scoped.

The implementation must define permissions for:

- Enable/disable readiness
- Create/edit templates
- Assign requirements
- View private submissions
- Review sensitive accessibility/AV information
- Send reminders
- Approve content changes
- Waive requirements
- Export contact or file data
- Revoke portal access
- View activity/audit history
- Manage billing/entitlement

External portal access must never inherit broad organizer permissions.

Required tests:

- Cross-organization denial
- Cross-event denial
- Revoked token denial
- Expired token denial
- Guessed/modified token denial
- File URL isolation
- Staff versus member permissions
- Disabled-feature denial
- Archived-event behavior

---

# 12. Security, privacy and retention

Before a real pilot:

- Production email must work.
- Magic links must be random, hashed at rest, expiring and revocable.
- Portal access must be event- and subject-scoped.
- Uploaded files must remain private by default.
- MIME type and extension must both be checked.
- File size and image dimensions must be enforced.
- File-serving URLs must be authorized or short-lived.
- Sensitive accessibility information needs restricted visibility.
- Original and AI-proposed content must remain distinguishable.
- Every organizer approval must be auditable.
- Reminder delivery and failures must be logged.
- Retention after event completion must be defined.
- Cancellation behavior must be defined.
- Account/event deletion behavior must include readiness data.
- Export behavior must include readiness data where required.
- AI handling must follow existing data and provider policies.
- Public attendee pages must not expose private readiness files or notes.
- The module must fail closed for unauthorized access and fail open for the public schedule.

---

# 13. Packaging and pricing

## 13.1 Recommended commercial structure

Retain the existing UKEDL core plans.

Add Speaker & Session Readiness as an optional per-event add-on or annual entitlement.

## 13.2 Pilot packaging

Do not begin with public self-service billing.

Use a manually granted entitlement for the first three to five pilot events.

Suggested concierge pilot tests:

| Pilot size | Suggested test price |
|---|---:|
| Up to about 50 presenters | $750 per event |
| Up to about 150 presenters | $1,250 per event |
| Larger or complex event | Individually scoped |

Include:

- Data mapping/import help
- Requirement-template setup
- Portal configuration
- Organizer onboarding
- Limited support during the collection window
- Pilot feedback session

## 13.3 Later pricing tests

After real usage:

- Standard readiness add-on: approximately $499 per event
- Plus readiness add-on: approximately $999–$1,500 per event
- Association annual plan: approximately $4,000–$8,000
- Multi-event organization/agency plan: approximately $8,000–$20,000

These are hypotheses, not code constants.

## 13.4 Billing implementation rules

- Reuse existing Lemon Squeezy services, variants, webhooks and entitlements.
- Verify the current billing path before adding Event Readiness.
- Do not make the core public schedule disappear when readiness expires.
- Define a grace/read-only state.
- Preserve customer exports.
- Stop new invitations, new reminders or new submissions only according to a documented policy.
- Avoid confusing plan-card proliferation.
- Add public pricing only after pilot validation.

---

# 14. Deployment and migration discipline

## 14.1 Required branch and environment

- Work on a feature branch.
- Use a development or preview database.
- Do not use production secrets.
- Do not send production email.
- Do not deploy directly to production from an agent session.
- Keep all new capabilities disabled by default.

## 14.2 Build and test conventions

Documented commands include:

```bash
npm test
npm test --workspace=@event-app/web
npm run build:api
npm run build:web
npm run lint --workspace=@event-app/api
```

Cursor must inspect `package.json` files for the complete current command set.

## 14.3 Migration discipline

UKEDL has already suffered an outage from a destructive migration.

Required discipline:

1. Expand schema with nullable/additive changes.
2. Deploy code that tolerates old and new shapes.
3. Backfill separately when needed.
4. Tighten constraints only after compatibility is proven.
5. Drop old fields only in a later release.
6. Run production migrations using `DIRECT_DATABASE_URL`.
7. Keep migrate and deploy coordinated if any destructive change is ever approved.
8. Provide a forward-fix plan even when rollback is difficult.

## 14.4 Shared package warning

`packages/config` and `packages/shared` are consumed from compiled `dist`.

Do not point package `main` values at source TypeScript.

When shared types/config change:

- Build the package.
- Confirm emitted files.
- Run API and web builds.
- Verify Render CommonJS compatibility.

---

# 15. Recommended delivery phases

## Phase E — prerequisite launch fixes

This phase is governed by the existing `FIX_PLAN.md`, not this document.

At minimum:

- Configure and verify Resend.
- Fix verification/signup lockout.
- Remove the false organizer invite-code UI gate.
- Configure and verify the real AI provider.
- Fix the eight-row ingest truncation.
- Configure and test Lemon Squeezy before charging.
- Complete the current launch checklist.

Event Readiness work may begin privately, but no external pilot should bypass these blockers.

## ER0 — repository audit and final design map

No application changes.

Outputs:

- `docs/EVENT_READINESS_REPO_AUDIT.md`
- Existing-model map
- Existing-feature-toggle map
- Existing invitation/token map
- Existing file/storage map
- Existing notification/job map
- Existing audit/changeset map
- Exact routes and components to reuse
- Exact migration proposal
- Conflict list against this specification
- Revised phase plan

Acceptance:

- No code changes.
- Every proposed new model is justified.
- Every proposed route names an existing convention.
- Open questions are explicit.

## ER1 — hidden entitlement and skeleton

Goal:

- Add one Event Readiness feature key using the existing feature-toggle/entitlement system.
- Add disabled organizer route/page skeleton only if the current system supports hidden routes safely.

No public marketing. No speaker portal. No email. No AI.

Acceptance:

- Feature off means no visible change.
- Unauthorized access is denied.
- Existing event features pass regression tests.
- No destructive migration.

## ER2 — templates, assignments and derived status

Goal:

- Create/reuse the minimum data needed for requirement templates and assignments.
- Derive status.
- Provide internal API tests and optionally a hidden read-only organizer screen.

No external access. No outbound email. No AI.

Acceptance:

- Tenant isolation tested.
- Status derivation deterministic.
- Existing CFP/event data remains source of truth.
- Feature-disabled behavior tested.
- Migration tested on a copy/dev branch.

## ER3 — organizer workflow

Goal:

- Activation wizard
- Requirement templates
- People/session readiness table
- Exception-first overview
- Manual waivers and approvals
- Activity history

No public speaker email yet unless Phase E email is fully operational.

Acceptance:

- Existing organizer design language preserved.
- Role permissions tested.
- Bulk actions safe and auditable.
- No public schedule updates without approval.

## ER4 — external presenter portal

Goal:

- Reuse or extend invitation/token infrastructure.
- Presenter sees only assigned requirements.
- Text and file submissions.
- Token expiry/revocation.
- Mobile/PWA behavior.

Acceptance:

- Security tests pass.
- Private files remain private.
- Presenter cannot access another person/event.
- Existing signup/auth behavior remains unchanged.

## ER5 — validation, exceptions and publish integration

Goal:

- File validation
- Text limits
- Schedule conflict checks
- Low-risk deterministic exceptions
- Approval-to-existing-record flow
- Reviewable changeset/publish integration

Acceptance:

- Original content preserved.
- Approved changes follow existing publish rules.
- Public pages remain unchanged until publish.
- Every change has an audit trail.

## ER6 — reminders

Prerequisite:

- Resend and current email verification flow verified in production/staging.

Goal:

- Preview
- Test send
- Manual send
- Scheduled reminders
- Pause
- Delivery history
- Failure handling

Acceptance:

- Uses existing email and job infrastructure.
- No duplicate or runaway sends.
- Idempotency tested.
- Disabled feature cancels/blocks future sends safely.

## ER7 — AI suggestions

Prerequisite:

- Real provider configured and gateway monitoring verified.

Goal:

- Biography cleanup
- Title/description suggestions
- Tag suggestions
- Reminder drafts
- Change summaries
- Low-confidence flags

Acceptance:

- All calls use the gateway.
- Mock/offline fallback tested.
- Originals preserved.
- Organizer approval required.
- Usage caps and audit records verified.
- Public schedule works when AI is unavailable.

## ER8 — pilot entitlements

Goal:

- Manually enable two or three real pilot events.
- Measure workflow and support load.
- Avoid public checkout until validation.

Acceptance metrics:

- Three paid pilots or equivalent committed trials
- Five or more organizer hours saved per event
- Most presenters complete through the portal
- Fewer chase emails than the previous process
- No data loss
- No accidental public changes
- One repeat-event commitment
- One customer willing to pay at least $3,000 annually

## ER9 — billing and public launch

Prerequisites:

- Existing Lemon Squeezy flow verified
- Pilot evidence positive
- Support/docs complete
- Retention/cancellation behavior defined

Goal:

- Event Readiness entitlement attached to existing billing.
- Marketing page.
- Pricing-page add-on.
- Help documentation.
- Onboarding and limits.

---

# 16. Regression test matrix

## 16.1 Existing-product protection

- Existing organization creation still works.
- Existing event creation still works.
- Existing CFP workflow still works.
- Existing session/paper/author ordering still works.
- Existing rooms and tracks still work.
- Existing publish and archive work.
- Public `/e/[slug]` pages still work.
- Existing attendance modes still work.
- Existing certificates, badges and check-in still work.
- Existing capacity/waitlists still work.
- Existing community, DMs and meeting requests still work.
- Existing per-event feature toggles still work.
- The dormant mobile folder is unchanged.
- Public schedule does not require readiness services.

## 16.2 Feature-disabled tests

- No navigation item.
- No dashboard card unless deliberately previewable.
- API returns the correct denial/not-enabled behavior.
- No jobs run.
- No reminders send.
- No AI calls occur.
- Existing event data remains unaffected.

## 16.3 Authorization tests

- Organization A cannot see Organization B readiness data.
- Event A staff cannot see Event B without permission.
- Non-staff cannot manage requirements.
- Portal token accesses only its intended subject/event.
- Revoked and expired tokens fail.
- File access is scoped.
- Sensitive fields are restricted.
- Export requires sufficient role.

## 16.4 Data and migration tests

- Migration applies to a representative dev database.
- Existing rows remain valid.
- New nullable fields/defaults behave safely.
- Backfill is idempotent.
- Re-running jobs is idempotent.
- Unique constraints do not break legitimate author/session relationships.
- Rollback or forward-fix is documented.

## 16.5 Workflow tests

- Accepted CFP submission can receive requirements.
- Presenter can save and submit.
- Invalid file produces an exception.
- Resubmission supersedes rather than destroys history.
- Organizer can approve or reject a suggestion.
- Approved change enters the existing publish flow.
- Unapproved change is not public.
- Waiver behavior is visible and audited.
- Derived readiness totals match assignments.

## 16.6 Email/job tests

- Preview does not send.
- Test send is isolated.
- Scheduled send is idempotent.
- Pausing prevents future sends.
- Disabled feature prevents future sends.
- Failure is logged.
- Retry policy is bounded.
- Missing API key degrades safely.

## 16.7 AI tests

- Direct Anthropic calls outside the gateway are absent.
- Mock provider works.
- Provider failure preserves core workflow.
- Original content is preserved.
- Suggestion metadata is recorded.
- Approval is required.
- Usage caps are enforced.
- No cross-tenant context leakage.

## 16.8 Frontend tests

- Pages Router build succeeds.
- Existing organizer navigation unaffected when disabled.
- Responsive behavior works at narrow widths.
- Keyboard navigation works.
- Form labels and errors are announced.
- Loading, empty, error and success states are present.
- No new component library or style reset is introduced.

---

# 17. Product and UX decisions still requiring validation

These decisions cannot be finalized from the two orientation documents alone.

Cursor must inspect the repository and flag them:

1. Is an accepted presenter represented primarily as a `User`, `Author`, CFP submitter or another model?
2. Can one person be linked to multiple papers/sessions without duplication?
3. Is there already a reusable invitation or one-time-token model?
4. Is there a general file/asset model with private access?
5. Is there a general audit log or only AI/publication-specific history?
6. How are event feature toggles stored and enforced?
7. How are Lemon Squeezy entitlements represented?
8. Is there already a changeset/approval model suitable for presenter updates?
9. Which existing job mechanism supports scheduled reminders?
10. Which event-role model should own readiness operations?
11. Which data is safe for all event staff versus only selected organizers?
12. What happens to readiness data after an event is archived?
13. What happens when the add-on expires or is cancelled?
14. Should presenter portal access survive publication?
15. Which file formats and size limits are appropriate?
16. Does the existing public speaker profile use `Author`, `User` or a derived record?
17. Can current CFP acceptance trigger assignments cleanly?
18. What existing import/export code can be reused?
19. Are there existing email suppression, bounce and retry models?
20. Which existing test fixtures and seed events should be extended?

---

# 18. Required repository documents for Cursor

Before planning or coding, Cursor/Fable 5 must read:

1. `HANDOFF_BRIEF.md`
2. `README.md`
3. This revised Event Readiness plan
4. `CUSTOMER_TEST_FINDINGS.md`
5. `FIX_PLAN.md`
6. `LAUNCH_CHECKLIST.md`
7. `DESIGN_PHASE_D.md`
8. `RUNBOOK.md`
9. `PARITY_AUDIT.md`

Use carefully:

- `PRODUCT_SPEC.md` only for strategy; its phase instructions are historical.

Do not trust for current facts:

- `GAP_REPORT.md`

Ignore:

- Superseded desktop `CURSOR_INSTRUCTIONS_*.md`
- Superseded `EVENTPILOT_*.md`

If any current document disagrees with this plan about the current repository, Cursor must report the conflict before editing.

---

# 19. Cursor/Fable 5 workflow

## 19.1 Place this file in the repository

Recommended path:

```text
docs/product/ukedl-event-readiness-integration-plan-v2.md
```

## 19.2 Baseline safety

Before implementation:

```bash
git status
git add .
git commit -m "Baseline before Event Readiness work"
git switch -c feature/event-readiness
```

Use an appropriate alternative if the repository has a different branch policy.

Never place secrets or customer data in model context.

## 19.3 First prompt — repository audit only

Paste this into Cursor with Fable 5:

```text
Read these files in full before doing anything else:

- @HANDOFF_BRIEF.md
- @README.md
- @docs/product/ukedl-event-readiness-integration-plan-v2.md
- @CUSTOMER_TEST_FINDINGS.md
- @FIX_PLAN.md
- @LAUNCH_CHECKLIST.md
- @DESIGN_PHASE_D.md
- @RUNBOOK.md
- @PARITY_AUDIT.md

Treat PRODUCT_SPEC.md phase instructions and GAP_REPORT.md as historical.
Do not use superseded desktop Cursor/EventPilot instruction files.

This is an AUDIT-AND-PLAN task only.

Do not:
- edit application code
- edit Prisma schema
- create a migration
- install packages
- modify environment files
- send email
- call production services
- deploy
- alter billing
- modify data

Inspect the complete repository and create:

docs/EVENT_READINESS_REPO_AUDIT.md

The audit must include:

1. CURRENT ARCHITECTURE
   Confirm framework versions, workspaces, deployment, database, auth,
   authorization, AI, email, object storage, jobs, billing, monitoring and tests.

2. DOMAIN MODEL MAP
   Identify exact Prisma models and relationships for:
   organization, membership, event, event feature toggle, user, author/person,
   CFP submission/decision, session, paper, track, room, file/asset, invitation,
   token, job, notification/email delivery, audit/change history, billing and
   entitlement.

3. CURRENT FLOW MAP
   Trace exact files and routes for:
   CFP acceptance, event editing, speaker/author editing, publication, public
   event rendering, invitations, uploads, email sends, AI calls and billing.

4. REUSE DECISIONS
   For every Event Readiness capability, state what existing code/model/service
   should be reused and what genuinely must be new.

5. INVALID ASSUMPTIONS
   Identify anything in the Event Readiness plan that conflicts with the actual
   codebase. Do not silently work around it.

6. EXACT FILE MAP
   List the likely files to create or modify for each proposed phase.

7. DATABASE PLAN
   Propose only additive changes, adapted to existing naming and relationships.
   Include indexes, tenant isolation, migration ordering, expand/deploy/backfill
   steps and forward-fix/rollback guidance.

8. AUTHORIZATION AND SECURITY
   Map each action to existing roles. Analyze portal tokens, files, private data,
   cross-tenant access, retention and audit.

9. TEST PLAN
   Name existing test files/fixtures to extend and new tests required.

10. PHASE PLAN
    Break work into independently reviewable phases. Each phase must include:
    goal, files, schema changes, dependencies, tests, acceptance criteria,
    rollback/disable method and explicit exclusions.

11. OPEN DECISIONS
    List only decisions that cannot safely be derived from the repository or
    current documents.

Hard constraints:
- Do not create a second event or person model.
- Do not create a second AI/email/job/storage/billing system.
- Use the existing per-event feature system.
- Use Express APIs and Next.js Pages Router conventions.
- Ignore apps/mobile.
- Every AI call must use apps/api/src/lib/ai.
- Agents draft; humans publish.
- The feature remains off by default.
- No production changes.

Finish by recommending the smallest safe first implementation phase that creates
no visible change for existing users.
```

## 19.4 Human review gate

Do not allow implementation until the repository audit has been reviewed for:

- Duplicate models
- Destructive migrations
- Wrong routing architecture
- New infrastructure that already exists
- Missing tenant checks
- Missing feature-disabled behavior
- Direct Anthropic calls
- Direct Resend calls outside existing abstractions
- Production dependencies
- Unbounded background jobs
- Public schedule coupling
- Mobile-folder changes
- Unrelated refactors

## 19.5 Per-phase implementation prompt

Use this for one approved phase at a time:

```text
Implement only phase <PHASE_ID> from the approved
docs/EVENT_READINESS_REPO_AUDIT.md.

Before editing, report:

1. Exact scope
2. Exact files expected to change
3. Database changes, if any
4. Existing services/models being reused
5. Tests to add or update
6. Commands to run
7. How the feature remains disabled
8. Rollback or forward-fix method
9. Confirmation that no production deployment or data access will occur

Do not start later phases.
Do not perform unrelated refactors.
Do not modify apps/mobile.
Do not modify .env files.
Do not add a new library unless the approved audit proves it is necessary.
Do not call Anthropic, Resend or Lemon Squeezy outside existing abstractions.
Do not change public event data without organizer approval.

After implementation:

- run relevant API tests
- run relevant web tests
- run API lint
- run API build
- run web build
- run any migration validation required
- inspect the git diff

Then report:

- files changed
- behavior added
- schema/migration details
- tests and exact results
- build/lint results
- known limitations
- manual verification steps
- rollback/disable instructions

Stop after the approved phase.
```

## 19.6 Review prompt after each phase

```text
Review the current branch diff against:

- HANDOFF_BRIEF.md
- README.md
- docs/product/ukedl-event-readiness-integration-plan-v2.md
- docs/EVENT_READINESS_REPO_AUDIT.md
- the approved phase acceptance criteria

Do not edit yet.

Report:
- requirement coverage
- regressions
- authorization risks
- tenant-isolation risks
- migration risks
- data-loss risks
- direct service calls that bypass abstractions
- missing tests
- feature-disabled leaks
- unrelated changes
- whether the phase is safe to merge

Use file and line references.
```

---

# 20. Definition of “the plan has everything Cursor needs”

This plan is complete enough to serve as the product and safety specification when all of the following are true:

- It is stored in the repository.
- Cursor can read the full source tree.
- Cursor reads the current repository documents listed above.
- Cursor performs ER0 before coding.
- Exact model and file names come from the repository audit, not from guesses.
- A human approves each phase.
- Work happens on a feature branch.
- Production credentials and customer data are unavailable to the agent.
- New features remain disabled by default.
- Existing tests and builds pass.
- Each migration has an explicit rollout and recovery plan.
- Public schedule behavior is regression-tested.
- AI, email, jobs, storage and billing reuse current abstractions.
- No one asks the model to “build the whole plan” in one run.

It is not complete as a single blind command such as:

```text
Read this and build everything.
```

No responsible implementation document can replace inspection of an 80-model, 41-migration codebase.

---

# 21. Final recommendation

The revised implementation decision is:

> **Add Speaker & Session Readiness as an optional, event-level UKEDL capability using the platform's existing CFP, event, person, feature-toggle, authorization, AI, email, job, storage, billing, audit and publishing infrastructure.**

Build it in small hidden phases.

Do not duplicate infrastructure.

Do not begin external pilots until email and signup work.

Do not market real AI capability until the provider is configured.

Do not add public billing until Lemon Squeezy is verified.

Do not let any AI-produced change reach attendees without organizer approval.

The likely commercial sequence remains:

```text
Core UKEDL academic workspace
    ↓
Speaker & Session Readiness
    ↓
Paid pilot add-on
    ↓
Annual recurring-conference entitlement
    ↓
Sponsor Readiness only after demonstrated demand
    ↓
Portfolio tools for organizations running multiple events
```

This version is the recommended handoff for Cursor/Fable 5.
