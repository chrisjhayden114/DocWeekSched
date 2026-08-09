# DESIGN_PHASE_M — Messaging overhaul (synthesis of 3 independent planning passes)

Written 2026-08-09. Three agents planned this independently (architecture lens,
product/UX+calm lens, delivery/risk lens); this is the merge. Where all three
agreed it's marked HIGH CONFIDENCE; genuine forks are in "Open decisions."

---

## 0. Headline findings (all three agents, independently)

1. **Most of the "full messaging phase" is already built or modeled.** The Phase-1
   Messages UI shipped (E18: two-pane list+thread, avatars, unread dots, day
   grouping, optimistic send/retry, drafts, a11y `role="log"`, visibility-gated
   polling). `UserBlock` + `UserReport` models AND `/moderation/*` routes exist.
   The digest-email pipeline already carries MESSAGE notifications. So M-series is
   mostly **wiring, hardening, and one genuinely new mechanic (the request gate)** —
   not a green-field build.

2. **Two live behaviors contradict the calm positioning — fix FIRST:**
   - Every DM send **awards engagement points** (`conversations.ts:278`,
     `points.ts`). Gamifying private mail is a named anti-goal.
   - MESSAGE notifications are class **INTERRUPT (push-eligible)**
     (`notifications/types.ts`), i.e. a DM can fire a push — the opposite of
     "messages never push." Reclassify to DIGEST.
   - Also retire the legacy "Everyone — event chat" room (duplicates Community;
     still materialized server-side).

3. **A real safety hole:** block is enforced when *creating* a DM
   (`visibility.ts`) but NOT on `POST /:id/messages` — so blocking someone you
   already have a thread with doesn't stop them. Fix before widening who-can-contact.

4. **The request gate (consent at the front door) is the only new subsystem** — and
   it's the headline value + the safety/procurement story.

5. **Real-time: keep polling.** Single free Render instance + Neon pooler (breaks
   LISTEN/NOTIFY) + ~0–10 msgs/attendee/event make websockets/SSE a bad trade.
   Cheap win: add a `?since=` cursor so the 8s thread poll returns empty in the
   common case (today it re-fetches all pages via `apiFetchAll`).

---

## 1. CALM FILTER (unanimous unless noted)

| Feature | Verdict | Why |
|---|---|---|
| Message requests / consent gate | **KEEP** (headline) | Makes stranger-spam structurally impossible; the differentiation. |
| Block | **KEEP + harden** | Enforce on send, expose in-thread. Model exists. |
| Report to organizers | **KEEP + harden** | Add transcript snapshot + organizer actions. Procurement/code-of-conduct need. |
| Mute (per-conversation) | **KEEP** | Fixes "said hi once, now I get everything." |
| "Who can message me" pref | **KEEP** | Anyone / existing+organizers / no-one. |
| Sent-state checks (✓ sending/sent/failed) | **KEEP** (built) | Reassures sender, tells recipient nothing — the non-coercive half of receipts. |
| Read receipts ("Seen") | **SOFTEN → opt-in, OFF by default** (RESOLVED 2026-08-09) | Cheap (rides on `lastReadAt`); offered iMessage/Telegram-style — turn yours off and you don't see others'. Messaging-only. |
| Typing indicators | **REFUSE** (RESOLVED) | Needs a live connection the stack can't hold; would lag/look broken on polling. |
| Presence / online-now | **REFUSE** (RESOLVED) | Needs live connection; misleading in a twice-a-day app; surveillant. |
| Reactions / emoji | **DEFER** | One ack later to cut "thanks!" noise; not on the path. |
| Media / image attachments | **REFUSE** | Storage + malware scan + quota + unpublished-manuscript liability. Links suffice. |
| Group chats | **KEEP** (built), soften mgmt | Cap ~8, no channels/@-firehose. |
| Search | **KEEP client-side** (built); refuse server FTS for now | Client filter covers realistic volume. |
| Real-time transport | **SOFTEN** — tuned polling + `since` cursor | No websockets/SSE; ~95% of felt value at ~2% of risk. |
| Push / OS notifications for messages | **REFUSE** | Anti-goal; digest email is the outbound channel. |
| Engagement points on messages | **REFUSE / remove** | Live anti-goal breach. |

**Note:** the founder's original "full phase" wording listed presence/read/typing.
All three agents independently recommend REFUSING presence + typing and keeping
read as self-visible sent-checks only. This is the top open decision (§4).

---

## 2. Data model changes (all additive / nullable / defaulted — safe under Render migrate-on-deploy)

- Read state: `ConversationMember.lastReadAt DateTime?` (retires the
  notification-derived unread hack).
- Request gate: `Conversation.status String @default("ACTIVE")` (or an enum) +
  `Conversation.initiatedById String?`. Request = `status REQUESTED` / `acceptedAt IS NULL`.
  Rate limits computed by COUNTing Conversation rows (NOT the in-memory limiter,
  which resets on restart).
- Who-can-message: `EventMembership.messagePolicy String @default("ANYONE")`.
- Mute: `ConversationMember.mutedAt DateTime?`.
- Report hardening: `UserReport.conversationId String?`,
  `UserReport.transcriptSnapshot Json?`, `EventMembership.messagingSuspendedAt DateTime?`,
  `ConversationMessage.deletedAt DateTime?` (soft-delete so evidence survives).
- Context chips: `Conversation.contextSessionId String?`, `contextPaperId String?`
  (do NOT reuse the reserved `sessionId @unique`).

Governing rule: additive-only, nullable-or-defaulted, expand→migrate→contract.
Never rename/drop/NOT-NULL-without-default in the same deploy as the code using it.

---

## 3. Phased plan (merged; each chunk independently shippable + testable)

Verification per chunk = (a) vitest unit tests (pure logic, CI), (b) `.db.test.ts`
on the `ukedl_test` Neon branch (Chris runs with `UKEDL_TEST_DB`), (c) two-profile
click-through on ukedl.com after deploy.

- **M0 — Calm cleanup (S, no migration, do first).** Remove engagement points on
  send; reclassify MESSAGE INTERRUPT→DIGEST; stop materializing "Everyone — event
  chat"; delete the Messages "purpose" explainer; replace `window.alert` errors.
- **M1 — Visual finish (S, frontend only).** Finish the WhatsApp-style polish
  (full-width master-detail, pinned composer, bubble geometry). Zero backend risk.
- **M2 — Read state done right (M, migration `lastReadAt`).** Unread by conversation
  from `lastReadAt`; "Mark all as read"; per-conversation Mute.
- **M3 — Block hardening + in-thread safety (S/M, no migration; SAFETY, do before M4).**
  Enforce block on send/fetch; thread kebab = View profile · Mute · Block · Report;
  neutral copy (never confirm a block to the blocked party).
- **M4 — Request gate (L; split: M4a additive migration only → M4b behavior behind
  flag `messaging_requests`).** First cold message → REQUESTS section; no notify,
  no unread, no email; one-message cap until reply; reply = accept; DB-counted rate
  limits; organizers + prior contacts exempt. Reversible via the flag.
- **M5 — Report hardening + organizer actions (M, migration).** Report-from-thread
  with immutable transcript snapshot; soft-delete messages; organizer "suspend
  messaging for event" / remove; "also block" default-on.
- **M6 — Messaging digest email + who-can-message pref (M, migration).** Batched,
  quiet-hours-respecting email (never for requests/muted/own); global +
  per-conversation opt-out; "Who can message me" setting.
- **M7 — Mobile route `/dashboard/messages/[id]` (M, no migration).** Real routing
  so digest deep links + OS back work; safe-area composer.
- **M8 — Context chips + entry points (M, migration).** "Message about this
  session/paper" provenance chip.
- **M9 — Real-time polish (S, no migration).** `?since=` cursor; incremental append
  instead of `apiFetchAll`.
- **Later (defer):** one acknowledgement reaction; Postgres FTS; reply-by-email;
  conversation export; post-event read-only.

Dependency spine: M0/M1/M2/M3 independent (do M3 early — live safety gap) →
M4a (invisible migration) → M4b (gated behavior) → M5/M6/M7/M8 → M9.

---

## 4. Open decisions — founder only (with recommendation)

1. **Scope conflict — presence/typing/read-receipts.** RESOLVED 2026-08-09: keep
   the ✓ sent/failed checks; add "Seen" read receipts as an **opt-in setting, OFF
   by default** (messaging-only; turn yours off → you don't see others'); REFUSE
   typing + presence (live-connection infra the single Render instance can't hold).
   New chunk **M-SEEN** (small, after M2's `lastReadAt`, behind the opt-in pref).
2. **Inbox model — one cross-event inbox vs per-event.** RESOLVED 2026-08-09:
   **per-event inbox** (matches current event-scoped schema; revisit cross-event
   later if the account-between-conferences value becomes a priority).
3. **Does the gate relax "both must be in the directory"?** Today both must opt in
   even to start. The gate model is "anyone in the directory can send a first
   message → Requests." Confirm intended model (decides M4b semantics).
4. **Block scope — per-event (current) vs per-account.** Per-account is friendlier
   for repeat harassment but a non-additive change; recommend deciding before data grows.
5. **Rate-limit values** (≈10 new/day, 25/event, 1,000-char first message) — defaults
   vs per-event configurable.
6. **Messaging digest default** on vs opt-in (`digestEmail` defaults false today;
   off-by-default means most 3-day-a-year users never get notified).
7. **Organizer reach into DMs** — badge yes, reading only via a report? Confirm it
   satisfies institutional buyers.
8. **Event-ended behavior** — stays open (year-round network) vs read-only after
   event+N days (firmly an event tool). Positioning call.
9. **Retention/deletion** — how long transcripts/report snapshots live; snapshots
   should survive account deletion; needs a privacy-policy line before M5.
10. **Speaker "listed but unmessageable"** opt-out — recommend yes (small).
11. **"Share my email" composer affordance** — lean yes (honest act made easy).

Decisions 1–3 gate the build; 4–11 can be settled as we reach each chunk.
