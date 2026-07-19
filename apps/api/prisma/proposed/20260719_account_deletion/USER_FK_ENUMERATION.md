# User FK enumeration + account deletion design (Chunk B gate)

**Read from** `apps/api/prisma/schema.prisma` on `saas-build`.  
**No deletion code has been written. No migration has been applied.**

Prisma note: omitting `onDelete` means **Restrict** for required FKs (and Restrict for optional FKs unless SetNull is set).

---

## Complete inventory (60 relations → User)

| # | Model | Relation field | FK column | Null? | Current onDelete | Proposed delete class |
|---|---|---|---|---|---|---|
| 1 | OrgMembership | user | userId | no | Cascade | PERSONAL — remove |
| 2 | SeriesContinuityConsent | user | userId | no | Cascade | PERSONAL — remove |
| 3 | EventMembership | user | userId | no | Cascade | PERSONAL — remove |
| 4 | AdminAccessRequest | user | userId | no | Cascade | PERSONAL — remove |
| 5 | AdminAccessRequest | resolvedBy | resolvedById | yes | SetNull | PRESERVE — SetNull (already) |
| 6 | Event | createdBy | createdById | yes | **Restrict (default)** | PRESERVE — change to **SetNull** |
| 7 | Session | speaker | speakerId | yes | **Restrict (default)** | PRESERVE — change to **SetNull** (User link only; `Speaker` roster rows are not User FKs) |
| 8 | SessionBookmark | user | userId | no | **Restrict (default)** | PERSONAL — change to **Cascade** |
| 9 | SessionAttendance | user | userId | no | **Restrict (default)** | PERSONAL — change to **Cascade** |
| 10 | WaitlistEntry | user | userId | no | Cascade | PERSONAL — remove |
| 11 | SessionLike | user | userId | no | **Restrict (default)** | PERSONAL — change to **Cascade** |
| 12 | Announcement | createdBy | createdById | yes | SetNull | PRESERVE — SetNull (already) |
| 13 | SurveyAnswer | user | userId | no | **Restrict (default)** | PERSONAL — change to **Cascade** (or anonymize if org needs aggregate retention) |
| 14 | ConversationMember | user | userId | no | **Restrict (default)** | PERSONAL — change to **Cascade** |
| 15 | ConversationMessage | user | userId | no | **Restrict (default)** | **SPECIAL** — prefer SetNull + nullable userId + redact `body` to `[deleted]`, so thread history remains; Cascade only if product accepts losing message rows |
| 16 | CheckIn | user | userId | no | **Restrict (default)** | PERSONAL — change to **Cascade** |
| 17 | CheckIn | scannedBy | scannedByUserId | yes | SetNull | PRESERVE — SetNull (already) |
| 18 | NetworkThread | author | authorId | no | Cascade | **SPECIAL** — authored community content: **anonymize** (SetNull requires nullable authorId) or replace author with tombstone user; **do not** Cascade-delete threads (would erase event community history). *Today Cascade would delete threads — migration must change this before account delete.* |
| 19 | NetworkReply | author | authorId | no | Cascade | Same as threads — **change off Cascade** to SetNull/tombstone |
| 20 | UserNotification | user | userId | no | Cascade | PERSONAL — remove |
| 21 | SessionDiscussionThread | author | authorId | no | Cascade | **SPECIAL** — Q&A history: SetNull/tombstone, not Cascade |
| 22 | SessionDiscussionThread | answeredBy | answeredById | yes | SetNull | PRESERVE |
| 23 | SessionDiscussionThread | hiddenBy | hiddenById | yes | SetNull | PRESERVE |
| 24 | SessionDiscussionReply | author | authorId | no | Cascade | **SPECIAL** — SetNull/tombstone |
| 25 | SessionDiscussionUpvote | user | userId | no | Cascade | PERSONAL — remove |
| 26 | SessionPoll | createdBy | createdById | yes | SetNull | PRESERVE |
| 27 | SessionPollVote | user | userId | no | Cascade | PERSONAL — remove |
| 28 | SessionFeedback | user | userId | no | Cascade | PERSONAL — remove (or aggregate-then-delete) |
| 29 | SponsorLead | capturedBy | capturedByUserId | yes | SetNull | PRESERVE |
| 30 | SponsorLead | attendee | attendeeUserId | yes | SetNull | PRESERVE / clear PII fields on lead row |
| 31 | SessionResource | user | userId | no | Cascade | PERSONAL if private uploads; confirm not shared agenda assets |
| 32 | NotificationPreference | user | userId | no | Cascade | PERSONAL — remove |
| 33 | NotificationPushDay | user | userId | no | Cascade | PERSONAL — remove |
| 34 | MeetingRequest | fromUser | fromUserId | no | Cascade | PERSONAL — remove |
| 35 | MeetingRequest | toUser | toUserId | no | Cascade | PERSONAL — remove |
| 36 | PersonalAgendaBlock | user | userId | no | Cascade | PERSONAL — remove |
| 37 | AnnouncementAuditLog | actor | actorId | no | Cascade | PRESERVE intent — change to **SetNull** + nullable actorId so audit survives |
| 38 | UserBlock | blocker | blockerId | no | Cascade | PERSONAL — remove |
| 39 | UserBlock | blocked | blockedId | no | Cascade | PERSONAL — remove |
| 40 | UserReport | reporter | reporterId | no | Cascade | PERSONAL — remove report rows **or** SetNull reporter for moderation archive |
| 41 | UserReport | reportedUser | reportedUserId | no | Cascade | Same — prefer retain report with anonymized subject |
| 42 | UserReport | resolver | resolverId | yes | SetNull | PRESERVE |
| 43 | IcsFeedToken | user | userId | no | Cascade | PERSONAL — remove |
| 44 | PushSubscription | user | userId | no | Cascade | PERSONAL — remove |
| 45 | AiUsageRecord | user | userId | yes | SetNull | PRESERVE metering — SetNull (already) |
| 46 | AuditLog | actor | actorUserId | yes | SetNull | PRESERVE — SetNull (already) |
| 47 | BackgroundJob | createdBy | createdById | yes | SetNull | PRESERVE |
| 48 | AgendaIngestRun | createdBy | createdById | yes | SetNull | PRESERVE |
| 49 | CfpReviewer | user | userId | no | Cascade | PERSONAL membership — remove; **CfpSubmission / converted Session / SessionItem / Speaker roster have no User FK and are preserved** |
| 50 | CfpReview | reviewer | reviewerUserId | no | Cascade | SPECIAL — anonymize reviewer on reviews rather than Cascade-delete review scores |
| 51 | CfpDecisionEmail | createdBy | createdById | yes | SetNull | PRESERVE |
| 52 | ConciergeConversation | user | userId | no | Cascade | PERSONAL — remove |
| 53 | ConciergePendingAction | user | userId | no | Cascade | PERSONAL — remove |
| 54 | MatchProfileEmbedding | user | userId | no | Cascade | PERSONAL — remove |
| 55 | MatchSuggestion | forUser | forUserId | no | Cascade | PERSONAL — remove |
| 56 | MatchSuggestion | suggestedUser | suggestedUserId | no | Cascade | PERSONAL — remove |
| 57 | OpsInboxCard | dismissedBy | dismissedById | yes | SetNull | PRESERVE |
| 58 | OpsInboxCard | appliedBy | appliedById | yes | SetNull | PRESERVE |
| 59 | IssuedCertificate | user | userId | no | Cascade | PERSONAL — remove issued certs for that attendee |
| 60 | IssuedCertificate | issuedBy | issuedByUserId | yes | SetNull | PRESERVE |

**Not User FKs (explicitly preserved by design):** `Speaker`, `Session`, `SessionItem`, `SessionItemAuthor`, `CfpSubmission`, `CfpForm`, `Track`, `Room`, `Sponsor` — these belong to the event, not the account.

---

## Proposed delete design

### A. Pre-checks (application layer)

1. Authenticate; rate-limit; confirm password / email challenge.
2. **Sole-OWNER rule:** if the user is `OrgRole.OWNER` on any org where no other OWNER exists → **block** with message to transfer ownership or close the organization first.
3. Soft-queue via `AccountDeletionRequest` (PENDING → COMPLETE) so we can audit and retry.

### B. PERSONAL data (remove with the account)

Memberships, preferences, push/ICS tokens, attendance, bookmarks, likes, waitlists, check-ins (as subject), poll votes, feedback, meeting requests, blocks, personal agenda, concierge/matchmaker rows, issued certificates (as holder), notifications, AI embeddings.

### C. AUTHORED / SHARED (must survive)

| Content | Approach |
|---|---|
| Event.createdById | SetNull |
| Session.speakerId (legacy User link) | SetNull — agenda sessions remain; Speaker roster unaffected |
| Announcement.createdById | SetNull (already) |
| Agenda ingest / jobs / polls createdBy | SetNull (already) |
| AuditLog.actorUserId | SetNull (already) |
| NetworkThread / NetworkReply / SessionDiscussion* authors | **Change Cascade → SetNull** (nullable author) or reassign to a system “Deleted user” tombstone so community/Q&A history remains |
| ConversationMessage | Prefer redact + SetNull over Cascade |
| CfpReview reviewerUserId | Anonymize; keep scores |
| CfpSubmission / Session / SessionItem | No User FK — untouched |

**Hard rule:** Deleting a speaker’s *login account* must never delete `Session` / `SessionItem` / CFP-converted content.

### D. Sole OWNER

```
IF EXISTS org where user is OWNER AND count(other OWNER members) = 0
  THEN reject with 409 + { code: "SOLE_OWNER", organizationIds: [...] }
```

### E. Migration required (not applied)

See `migration.sql` in this folder:

1. New `AuditAction` values: `DATA_EXPORT`, `ACCOUNT_DELETE_REQUEST`, `ACCOUNT_DELETE_COMPLETE` (export currently logs as `OTHER` + payload to avoid a migration).
2. `AccountDeletionRequest` table.
3. Flip Restrict → Cascade for personal tables listed above.
4. Flip Cascade → SetNull (nullable author) for community/Q&A authors; Event.createdById / Session.speakerId → SetNull.

**Schema.prisma constraint:** any edit must keep  
`checkInCode String @default(cuid())` on `EventMembership`.

---

## Approval ask

Please confirm or amend:

1. Conversation messages: **redact+SetNull** vs Cascade-delete rows?  
2. Community threads/replies & session Q&A: **SetNull author** vs tombstone user?  
3. CfpReview: keep anonymized reviews (recommended) vs delete reviews?  
4. Grace period (e.g. 7–30 days) on `AccountDeletionRequest.scheduledFor`?

After approval, implementation + migrate will be a separate session.
