# Customer test findings — three end-to-end walkthroughs of ukedl.com (live production)

Method: three persona-driven passes through the live site plus code verification of each root cause.
1. Cold visitor / skeptical buyer — marketing, pricing, help, security, signup path.
2. Organizer building an event manually — org → event → tracks → rooms → sessions → papers → publish → public page → archive. (A real event, "QA Test Symposium 2026," was created, published, verified, then archived. Production is clean.)
3. AI setup + ingest + attendee experience — Set up with AI, Agenda ingest paste flow, attendee-side surfaces.

---

## P0 — Blocks real signups TODAY

### 1. New users cannot sign in: verification email is never sent
**What happens:** `POST /auth/register` creates the user with `emailVerifiedAt: null`, generates a verify token, and calls `sendEmailVerificationEmail`. Login (`routes/auth.ts:245`) returns **403 EMAIL_NOT_VERIFIED** until that timestamp is set. But production has **no `RESEND_API_KEY`**, so `getEmailProvider()` returns `UnconfiguredEmailProvider`, which logs "Delivery unavailable" and returns `delivered: false`. The register response still says *"Check your email to verify your UKEDL account before signing in."*
**Customer impact:** every self-serve signup is a dead end. The person waits for an email that will never arrive, then can't log in. This silently breaks the entire "Create your event" funnel that the homepage, pricing page, and every CTA point at.
**Why it wasn't caught:** you and the seeded users were already verified; this only bites brand-new accounts.
**Fix (pick one, in order of preference):**
- (a) **Configure Resend** — add `RESEND_API_KEY` + verified sender domain (SPF/DKIM/DMARC). This is the real fix and unblocks invites, password resets, and digests at the same time.
- (b) **Until (a) lands:** when the email provider is unconfigured, either auto-verify the account on register, or return the verify URL in the register response and show it in the UI ("Email delivery isn't set up yet — click here to verify"), matching the pattern invites already use (`copyUrl` / `EMAIL_COPY_FALLBACK`). Do NOT leave the current state: the message promises an email the system knows it cannot send.
- Add a startup warning to the env preflight: *"RESEND_API_KEY missing — self-serve registration cannot complete."*

### 2. Paid plans cannot be purchased
"Sign in to upgrade" on all six pricing tiers leads to billing, but Lemon Squeezy live keys aren't configured, so no checkout can complete. The pricing page reads as a real catalog with real prices. Either wire the live keys + webhook, or add one honest line ("Billing opens [date] — contact support@ukedl.com to get set up now") so a ready-to-buy visitor has a path.

---

## P1 — Credibility / conversion damage

### 3. `/help` is an empty page
It renders a heading, one sentence ("Guides for organizers and attendees. Full-text search arrives in a later release."), and nothing else — no article list, despite `content/help/*.md` existing (getting-started, attendee-faq, contact). A buyer clicking Help sees a hollow product. Fix: render the article index; if search isn't ready, drop the sentence about it (it advertises an absence).

### 4. The "AI-native" promise is running on the mock provider
`AI_PROVIDER` defaults to `mock` and `ANTHROPIC_API_KEY` is unset in production, so Agenda ingest, the Setup copilot, Concierge, Matchmaker, Ops, and Recap all return canned output. In test 3, pasting a realistic program into Agenda ingest produced no review changeset. The homepage's central claim is "Paste your program. Your event is live." — this is the single biggest gap between marketing and reality. Fix: set `ANTHROPIC_API_KEY` + `AI_PROVIDER=anthropic` (metering/caps already exist), and re-run the paste test end-to-end before any demo.

### 5. Ingest failures are silent
When extraction returns nothing, the page simply doesn't change — no error, no empty-state, no "we couldn't find sessions in that text." The polling loop gives up after 20 tries (~8s) and only surfaces a message on an explicit `FAILED` status. Fix: always resolve to a visible outcome — success, "no sessions detected, try including times," or a real error — and show a spinner/progress while polling.

### 6. Public event pages don't say who's running the event
`/e/qa-test-symposium-2026` shows date, venue, description, schedule — but no organizer/organization name anywhere. Academic attendees decide legitimacy by the hosting body. Add "Hosted by {organization}" under the title.

---

## P2 — Real friction, worth fixing soon

7. **No timezone picker.** The event wizard's Timezone field is a free-text box pre-filled with the browser's zone. Typos silently produce wrong session times for every attendee. Make it a searchable select of IANA zones.
8. **No "back to editing" after creating a draft.** The wizard's final screen offers Build the program / Back to dashboard, but no way to revisit dates, venue, or branding — those inputs are only reachable by re-doing the wizard. Add an Event settings panel on the organizer Overview (name, dates, venue, timezone, brand color, description).
9. **Program tab is add-only.** Tracks, rooms, sessions, and papers render as plain bullet lists with no edit or delete affordance. A typo in a track name or a cancelled session is unfixable from this screen. This is the biggest day-to-day organizer gap: add inline edit/delete for all four object types.
10. **Blank slug is silently auto-generated.** Leaving Public slug empty produces a machine slug (`sample-mrtwok16`) with no preview or warning. Show the generated slug live as the user types the event name.
11. **Sessions can be created with no date validation** against the event's own start/end. A mistyped year lands a session outside the event window with no warning.
12. **Empty published event is publishable.** You can publish an event with zero sessions; attendees get an empty page. A soft warning ("This event has no sessions yet — publish anyway?") would prevent an embarrassing link-share.
13. **Speakers vs. papers overlap is unexplained.** The Program tab collects paper authors; the Speakers tab collects speakers; nothing tells an organizer how they relate or which appears where.
14. **No bulk/CSV import for sessions** as a non-AI fallback. When AI ingest doesn't fit (or is unavailable), the only path is one-at-a-time forms. A CSV template would serve the "I already have a spreadsheet" majority.

---

## P3 — Polish

15. Wizard fields lose typed input if the page re-renders mid-entry (observed: name/description/slug cleared once). Worth a look at the loading-state remount.
16. "Create your event" for a signed-out visitor lands on `/login` rather than a signup-first screen — a small conversion tax on the site's primary CTA.
17. `/pricing` per-event cards all say "Sign in to upgrade" even when signed in as an owner (should read "Buy" / "Upgrade").
18. Footer "Status" links to a status page that doesn't exist yet (`status.ukedl.com`).
19. No favicon/OG image check on `/e/{slug}` — event pages shared in Slack/email will preview generically.
20. Help/Terms/Privacy/Security are reachable but have no "last updated" date — cheap credibility signal for institutional buyers.

---

## What worked well (don't touch)
- The manual build chain is solid: org → event → track (with color) → room → session → paper with **author order preserved** worked first try, and the public page rendered the parent-session → child-paper hierarchy correctly with track color bars, filters, ICS, print, and the three view modes.
- Publish / Unpublish / Archive states behave exactly as the copy promises, and the QR code + public link on the draft-created screen is a genuinely nice touch.
- The Features tab (per-event capability toggles with three presets and honest "Attendees see:" labels) is better than anything the three competitors ship.
- Pricing page: open catalog, per-event options, recurring-event price lock, plain-English tax note. This is a real differentiator against sales-call-gated competitors.
- Security page: architecture, subprocessors, data export, product principles, vulnerability contact — and it never claims a certification it doesn't have.

## Suggested order of work
1. **Email delivery (#1)** — nothing else matters if new users can't get in.
2. **Real AI key (#4)** + ingest error states (#5) — makes the core pitch true.
3. **Help index (#3)**, organizer name on public pages (#6), billing honesty (#2).
4. **Edit/delete in Program (#9)** + event settings panel (#8) + timezone picker (#7) — the organizer's daily reality.
5. Everything else as encountered.

---

# Part 2 — findings from the independent logged-out audit (2026-07-21)

A second AI tool audited the **public, logged-out** journey (three personas: academic conference, wedding, nonprofit fundraiser). It could not authenticate, so it saw nothing of the organizer app — but that limitation made it the better tester of the acquisition funnel, which is exactly where my admin session was blind. Each item below was **verified in code** before inclusion.

## NEW P0 — the organizer signup form turns away every real customer

**What it saw:** "Create your event" → `/login` → Create an account → a role dropdown whose only non-participant option is **"Organizer (invite code)"**, which then demands a required **Admin invite code**. No way to request one. Its verdict: organizer acquisition is blocked.

**What the code actually says** (`apps/web/pages/login.tsx:219–243`, `apps/api/src/routes/organizations.ts`, `routes/event.ts:200`): the audit's *diagnosis* is wrong in a way that makes the fix far easier. The backend does **not** gate organizer capability behind any invite code:
- `POST /organizations` requires only `requireAuth` — any signed-in user creates an org and becomes its **OWNER**.
- `POST /event` requires `requireOrgRole(..., STAFF)` — which an OWNER satisfies.
The admin invite code belongs to `/auth/register-admin`, which mints the *legacy global platform-admin* role — something no customer should ever want.

**So:** the product supports self-serve organizers today; the **signup form lies about it** and scares them off. Fix is UI-only: drop the "Organizer (invite code)" option from the public form (keep `register-admin` reachable only via a private URL for yourself), and after registration route anyone who arrived via a "Create your event" CTA into: create organization → create event. *This is a P0 alongside email — together they mean a motivated buyer literally cannot become a customer.*

## NEW P0 — the homepage ingest demo silently truncates at 8 rows

**What it saw:** pasted 14-line and 12-line programs into the homepage demo; got 8 rows, no warning, afternoon items gone; parallel sessions collapsed into one row.
**Verified:** `apps/web/components/marketing/HeroIngestDemo.tsx:32` — `return out.slice(0, 8);` — a hard cap with no "showing 8 of 14" affordance.
**Why it matters:** this is the *public proof* of the product's central claim. A prospect pastes their real program and watches the tool lose a third of it. Fix: raise/remove the cap, and when truncating for display, say so ("Showing 8 of 14 extracted — the full importer handles the rest"); preserve concurrent sessions as separate rows.

## Also missed by me — verified real

21. **`status.ukedl.com` returns 502 Bad Gateway.** I logged this as a dead footer link (P3). Wrong severity: a visitor checking reliability gets an error page that reads as *the product is down*. It's also referenced from the security page's incident guidance. Remove the link (E1) until a real provider is up.
22. **Demo event header shows one day for a three-day event.** Renders "Mon, Jul 20, 2026 · 7:00 AM–2:00 PM" while the schedule spans Jul 20–22. Data is correct (`demoConferenceWindow()` = start +2 days); the **formatter** collapses a multi-day range into a single date + time range. Fix the date display for multi-day events everywhere it appears. I had this in my own screenshots and didn't catch it.
23. **The demo has no rooms**, so By-room groups everything under "No room" on the flagship demo. Add realistic rooms to the demo fixture — the By-room view we just built looks broken without them.
24. **Grid / By-room blocks carry button semantics but do nothing on the public page.** Either wire them to the session view or render non-interactive cards; announcing a control that does nothing is both a trust and an accessibility problem.
25. **Pricing logic hole for 51–250 attendees:** Pro at $79/mo is *cheaper and more capable* than the $149 per-event 250 tier, so the per-event option is irrational for that band. Also undefined: what happens to a published event when Pro is cancelled. Needs a plan-guidance line and a cancellation/continued-access answer.
26. **Procurement PDFs (`/legal/dpa.pdf`, `/legal/hecvat-lite.pdf`) are placeholders** and may still carry the old "Colloquium" name; the security page publicly states account-deletion rules aren't approved. Education procurement dies on exactly this. Either finish them or remove the download links until they're real.
27. **No guest / magic-link route to view a schedule** — attendees must create an account to use My Schedule. A local (browser-only) personal agenda or magic-link join would remove real friction.
28. **No `Event` structured data (schema.org) and no per-event 1200×630 social image** — I had OG tags in E3 but not JSON-LD; both matter for how shared event links look and index.
29. **Search engines still surface stale EventPilot metadata.** Resubmit the sitemap and refresh titles/descriptions after the final rename.
30. **Mobile/accessibility of the new grid + by-room views wasn't verified by either audit** at 390/768px — worth an explicit pass since D6 shipped after my phone test.
31. **Positioning confirmation (not a defect):** its wedding and nonprofit personas both concluded UKEDL is visibly not for them — which is the academic focus working as intended. Its own advice matches ours: don't dilute the positioning; only add a segment page after the underlying workflows exist.

## Where the second audit was limited
It could not authenticate, so everything in Part 1 — the email-verification lockout, no edit/delete in Program, no post-wizard settings, free-text timezone, silent failures in the *real* importer, publish-with-zero-sessions — was invisible to it. Its "not demonstrated" list (organizer editor, review UI, invites, analytics) describes features that do exist. Conversely, my admin session made the acquisition funnel invisible to me. **Neither audit alone was sufficient; together they cover the funnel end to end.**
