/**
 * Phase 6 — account deletion safety story.
 * Skips unless migration 20260726100000_phase6_account_deletion is applied.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import {
  CfpFormStatus,
  CfpSubmissionStatus,
  ConversationType,
  EventMemberRole,
  OrgRole,
  PrismaClient,
  SessionAttendanceStatus,
  SessionJoinMode,
  SessionPublishStatus,
  SessionResourceKind,
} from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { HttpError } from "../lib/authorization";
import {
  ACCOUNT_DELETION_GRACE_MS,
  DELETED_MESSAGE_BODY,
  cancelAccountDeletion,
  findSoleOwnerOrgIds,
  hardDeleteUserAccount,
  requestAccountDeletion,
} from "../lib/accountDeletion";
import { authorOrDeleted } from "../lib/authorDisplay";
import { DELETED_PARTICIPANT_LABEL } from "@event-app/shared";

describe("authorOrDeleted (unit)", () => {
  it("returns Deleted participant when author is null", () => {
    expect(authorOrDeleted(null)).toEqual({
      id: null,
      name: DELETED_PARTICIPANT_LABEL,
      role: null,
      photoUrl: null,
      deleted: true,
    });
  });

  it("passes through live authors", () => {
    expect(authorOrDeleted({ id: "u1", name: "Ada", role: "ATTENDEE", photoUrl: null })).toMatchObject({
      id: "u1",
      name: "Ada",
      deleted: false,
    });
  });
});

describe("account deletion (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    victimId?: string;
    peerId?: string;
    ownerId?: string;
    soleOrgId?: string;
    sharedOrgId?: string;
    eventId?: string;
    sessionId?: string;
    speakerId?: string;
    sessionItemId?: string;
    cfpSubmissionId?: string;
    networkThreadId?: string;
    networkReplyId?: string;
    qaThreadId?: string;
    qaReplyId?: string;
    conversationId?: string;
    messageId?: string;
    cfpReviewId?: string;
    bookmarkId?: string;
    sessionResourceId?: string;
  } = {};
  let dbReady = false;
  const password = "TestPass12!x";
  let passwordHash = "";

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.accountDeletionRequest.findFirst();
      // Confirm nullable author columns exist (migration applied).
      await prisma.$queryRaw`SELECT "authorId" FROM "NetworkThread" LIMIT 0`;
    } catch {
      console.warn(
        "[accountDeletion.db.test] DB unreachable or phase6_account_deletion migration not applied — skipping",
      );
      return;
    }
    dbReady = true;
    passwordHash = await hashPassword(password);
    const stamp = Date.now();

    const victim = await prisma.user.create({
      data: {
        email: `del-victim-${stamp}@example.com`,
        name: "Delete Victim",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const peer = await prisma.user.create({
      data: {
        email: `del-peer-${stamp}@example.com`,
        name: "Delete Peer",
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const owner = await prisma.user.create({
      data: {
        email: `del-owner-${stamp}@example.com`,
        name: "Co Owner",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.victimId = victim.id;
    ids.peerId = peer.id;
    ids.ownerId = owner.id;

    // Sole-OWNER org (blocks deletion)
    const soleOrg = await prisma.organization.create({
      data: {
        name: `Sole Org ${stamp}`,
        slug: `sole-org-${stamp}`,
        memberships: { create: { userId: victim.id, role: OrgRole.OWNER } },
      },
    });
    ids.soleOrgId = soleOrg.id;

    // Shared org (victim + co-owner) used for the hard-delete fixture
    const sharedOrg = await prisma.organization.create({
      data: {
        name: `Shared Org ${stamp}`,
        slug: `shared-org-${stamp}`,
        memberships: {
          create: [
            { userId: victim.id, role: OrgRole.OWNER },
            { userId: owner.id, role: OrgRole.OWNER },
          ],
        },
      },
    });
    ids.sharedOrgId = sharedOrg.id;

    const event = await prisma.event.create({
      data: {
        name: `Delete Event ${stamp}`,
        slug: `del-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-09-01T12:00:00Z"),
        endDate: new Date("2027-09-03T12:00:00Z"),
        organizationId: sharedOrg.id,
        createdById: victim.id,
        memberships: {
          create: [
            {
              userId: victim.id,
              role: EventMemberRole.ATTENDEE,
              directoryOptIn: true,
              matchMeEnabled: true,
            },
            { userId: peer.id, role: EventMemberRole.ATTENDEE, directoryOptIn: true, matchMeEnabled: true },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const speaker = await prisma.speaker.create({
      data: {
        eventId: event.id,
        name: "Roster Speaker (not a User FK)",
        affiliation: "Test U",
      },
    });
    ids.speakerId = speaker.id;

    const session = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Preserved session",
        startsAt: new Date("2027-09-01T15:00:00Z"),
        endsAt: new Date("2027-09-01T16:00:00Z"),
        publishStatus: SessionPublishStatus.PUBLISHED,
        speakerId: victim.id,
        sessionSpeakers: { create: { speakerId: speaker.id, sortOrder: 0 } },
      },
    });
    ids.sessionId = session.id;

    const item = await prisma.sessionItem.create({
      data: {
        sessionId: session.id,
        title: "Preserved item",
        sortOrder: 0,
        authors: { create: [{ name: "Paper Author", sortOrder: 0, speakerId: speaker.id }] },
      },
    });
    ids.sessionItemId = item.id;

    const form = await prisma.cfpForm.create({
      data: {
        eventId: event.id,
        title: "CFP",
        opensAt: new Date("2020-01-01T00:00:00Z"),
        closesAt: new Date("2099-01-01T00:00:00Z"),
        status: CfpFormStatus.OPEN,
        rubric: [{ id: "q", criterion: "Quality", weight: 1 }],
      },
    });
    const submission = await prisma.cfpSubmission.create({
      data: {
        cfpFormId: form.id,
        submitterName: "Submitter",
        submitterEmail: `sub-${stamp}@example.com`,
        title: "Preserved CFP submission",
        abstract: "Keep me",
        status: CfpSubmissionStatus.ACCEPTED,
        emailVerifiedAt: new Date(),
        submittedAt: new Date(),
        convertedSessionId: session.id,
        convertedSpeakerId: speaker.id,
      },
    });
    ids.cfpSubmissionId = submission.id;

    await prisma.cfpReviewer.create({ data: { cfpFormId: form.id, userId: victim.id } });
    const review = await prisma.cfpReview.create({
      data: {
        submissionId: submission.id,
        reviewerUserId: victim.id,
        scores: { q: 5 },
        comment: "Strong accept",
      },
    });
    ids.cfpReviewId = review.id;

    const thread = await prisma.networkThread.create({
      data: {
        eventId: event.id,
        authorId: victim.id,
        title: "Community post",
        body: "Keep this thread",
      },
    });
    ids.networkThreadId = thread.id;
    const reply = await prisma.networkReply.create({
      data: { threadId: thread.id, authorId: victim.id, body: "Keep this reply" },
    });
    ids.networkReplyId = reply.id;

    const qa = await prisma.sessionDiscussionThread.create({
      data: {
        sessionId: session.id,
        authorId: victim.id,
        title: "Q&A",
        body: "Keep this question",
      },
    });
    ids.qaThreadId = qa.id;
    const qaReply = await prisma.sessionDiscussionReply.create({
      data: { threadId: qa.id, authorId: victim.id, body: "Keep this answer" },
    });
    ids.qaReplyId = qaReply.id;

    const conv = await prisma.conversation.create({
      data: {
        eventId: event.id,
        type: ConversationType.DIRECT,
        members: { create: [{ userId: victim.id }, { userId: peer.id }] },
        messages: {
          create: { userId: victim.id, body: "Secret DM from victim" },
        },
      },
      include: { messages: true },
    });
    ids.conversationId = conv.id;
    ids.messageId = conv.messages[0]!.id;

    const bookmark = await prisma.sessionBookmark.create({
      data: { userId: victim.id, sessionId: session.id },
    });
    ids.bookmarkId = bookmark.id;

    await prisma.sessionAttendance.create({
      data: {
        userId: victim.id,
        sessionId: session.id,
        status: SessionAttendanceStatus.JOINING,
        joinMode: SessionJoinMode.IN_PERSON,
      },
    });
    await prisma.sessionLike.create({ data: { userId: victim.id, sessionId: session.id } });
    await prisma.checkIn.create({
      data: { userId: victim.id, eventId: event.id },
    });
    await prisma.pushSubscription.create({
      data: {
        userId: victim.id,
        endpoint: `https://push.example/${stamp}`,
        p256dh: "x",
        auth: "y",
      },
    });

    const resource = await prisma.sessionResource.create({
      data: {
        sessionId: session.id,
        userId: victim.id,
        title: "Slides PDF",
        kind: SessionResourceKind.LINK,
        url: "https://example.com/slides.pdf",
      },
    });
    ids.sessionResourceId = resource.id;
  });

  afterAll(async () => {
    if (!dbReady) {
      await prisma.$disconnect();
      return;
    }
    // Best-effort cleanup for leftover fixtures (hard-delete removes victim).
    try {
      if (ids.victimId) {
        await prisma.accountDeletionRequest.deleteMany({ where: { userId: ids.victimId } }).catch(() => undefined);
        await prisma.user.delete({ where: { id: ids.victimId } }).catch(() => undefined);
      }
      if (ids.peerId) await prisma.user.delete({ where: { id: ids.peerId } }).catch(() => undefined);
      if (ids.ownerId) await prisma.user.delete({ where: { id: ids.ownerId } }).catch(() => undefined);
      if (ids.eventId) {
        const eventId = ids.eventId;
        await prisma.sessionDiscussionReply.deleteMany({
          where: { thread: { session: { eventId } } },
        });
        await prisma.sessionDiscussionThread.deleteMany({ where: { session: { eventId } } });
        await prisma.networkReply.deleteMany({ where: { thread: { eventId } } });
        await prisma.networkThread.deleteMany({ where: { eventId } });
        await prisma.conversationMessage.deleteMany({ where: { conversation: { eventId } } });
        await prisma.conversationMember.deleteMany({ where: { conversation: { eventId } } });
        await prisma.conversation.deleteMany({ where: { eventId } });
        await prisma.cfpReview.deleteMany({ where: { submission: { cfpForm: { eventId } } } });
        await prisma.cfpReviewer.deleteMany({ where: { cfpForm: { eventId } } });
        await prisma.cfpSubmission.deleteMany({ where: { cfpForm: { eventId } } });
        await prisma.cfpForm.deleteMany({ where: { eventId } });
        await prisma.sessionItemAuthor.deleteMany({
          where: { sessionItem: { session: { eventId } } },
        });
        await prisma.sessionItem.deleteMany({ where: { session: { eventId } } });
        await prisma.sessionSpeaker.deleteMany({ where: { session: { eventId } } });
        await prisma.sessionResource.deleteMany({ where: { session: { eventId } } });
        await prisma.sessionBookmark.deleteMany({ where: { session: { eventId } } });
        await prisma.sessionAttendance.deleteMany({ where: { session: { eventId } } });
        await prisma.sessionLike.deleteMany({ where: { session: { eventId } } });
        await prisma.checkIn.deleteMany({ where: { eventId } });
        await prisma.session.deleteMany({ where: { eventId } });
        await prisma.speaker.deleteMany({ where: { eventId } });
        await prisma.eventMembership.deleteMany({ where: { eventId } });
        await prisma.event.delete({ where: { id: eventId } }).catch(() => undefined);
      }
      if (ids.soleOrgId) {
        await prisma.orgMembership.deleteMany({ where: { organizationId: ids.soleOrgId } });
        await prisma.organization.delete({ where: { id: ids.soleOrgId } }).catch(() => undefined);
      }
      if (ids.sharedOrgId) {
        await prisma.orgMembership.deleteMany({ where: { organizationId: ids.sharedOrgId } });
        await prisma.organization.delete({ where: { id: ids.sharedOrgId } }).catch(() => undefined);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it("blocks sole-OWNER deletion with 409 SOLE_OWNER", async () => {
    if (!dbReady) return;
    const sole = await findSoleOwnerOrgIds(ids.victimId!);
    expect(sole).toContain(ids.soleOrgId!);

    await expect(
      requestAccountDeletion({
        userId: ids.victimId!,
        email: `unused@example.com`,
        password: "wrong",
      }),
    ).rejects.toBeInstanceOf(HttpError);

    try {
      await requestAccountDeletion({
        userId: ids.victimId!,
        email: (await prisma.user.findUniqueOrThrow({ where: { id: ids.victimId! } })).email,
        password,
      });
      expect.fail("expected SOLE_OWNER");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const http = err as HttpError;
      expect(http.status).toBe(409);
      expect(http.body).toMatchObject({
        code: "SOLE_OWNER",
        organizationIds: expect.arrayContaining([ids.soleOrgId!]),
      });
    }
  });

  it("7-day grace: deactivates immediately, cancel restores, hard-delete only after window", async () => {
    if (!dbReady) return;

    // Remove sole-OWNER block so request can proceed.
    await prisma.orgMembership.deleteMany({ where: { organizationId: ids.soleOrgId! } });
    await prisma.organization.delete({ where: { id: ids.soleOrgId! } });
    ids.soleOrgId = undefined;

    const user = await prisma.user.findUniqueOrThrow({ where: { id: ids.victimId! } });
    const membershipBefore = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventId!, userId: ids.victimId! } },
    });
    expect(membershipBefore.directoryOptIn).toBe(true);
    expect(membershipBefore.matchMeEnabled).toBe(true);

    const result = await requestAccountDeletion({
      userId: ids.victimId!,
      email: user.email,
      password,
    });

    expect(result.scheduledFor.getTime()).toBeGreaterThan(Date.now() + ACCOUNT_DELETION_GRACE_MS - 60_000);

    const afterReq = await prisma.user.findUniqueOrThrow({ where: { id: ids.victimId! } });
    expect(afterReq.deactivatedAt).not.toBeNull();

    const membershipAfter = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventId!, userId: ids.victimId! } },
    });
    expect(membershipAfter.directoryOptIn).toBe(false);
    expect(membershipAfter.matchMeEnabled).toBe(false);

    expect(await prisma.pushSubscription.count({ where: { userId: ids.victimId! } })).toBe(0);

    const pending = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { userId: ids.victimId! },
    });
    expect(pending.status).toBe("PENDING");
    expect(pending.scheduledFor.toISOString()).toBe(result.scheduledFor.toISOString());

    await expect(hardDeleteUserAccount(ids.victimId!)).rejects.toThrow(/before scheduledFor/);

    await cancelAccountDeletion(ids.victimId!);
    const restored = await prisma.user.findUniqueOrThrow({ where: { id: ids.victimId! } });
    expect(restored.deactivatedAt).toBeNull();
    const membershipRestored = await prisma.eventMembership.findUniqueOrThrow({
      where: { eventId_userId: { eventId: ids.eventId!, userId: ids.victimId! } },
    });
    expect(membershipRestored.directoryOptIn).toBe(true);
    expect(membershipRestored.matchMeEnabled).toBe(true);

    const cancelled = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { userId: ids.victimId! },
    });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("hard-delete: personal gone, community/Q&A/DMs/CFP scores preserved, agenda untouched", async () => {
    if (!dbReady) return;

    const user = await prisma.user.findUniqueOrThrow({ where: { id: ids.victimId! } });
    await requestAccountDeletion({
      userId: ids.victimId!,
      email: user.email,
      password,
    });

    // Simulate grace elapsed.
    await prisma.accountDeletionRequest.update({
      where: { userId: ids.victimId! },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });

    const sessionBefore = await prisma.session.findUniqueOrThrow({ where: { id: ids.sessionId! } });
    const itemBefore = await prisma.sessionItem.findUniqueOrThrow({ where: { id: ids.sessionItemId! } });
    const speakerBefore = await prisma.speaker.findUniqueOrThrow({ where: { id: ids.speakerId! } });
    const subBefore = await prisma.cfpSubmission.findUniqueOrThrow({
      where: { id: ids.cfpSubmissionId! },
    });

    await hardDeleteUserAccount(ids.victimId!);

    expect(await prisma.user.findUnique({ where: { id: ids.victimId! } })).toBeNull();

    // PERSONAL rows gone
    expect(await prisma.sessionBookmark.count({ where: { userId: ids.victimId! } })).toBe(0);
    expect(await prisma.sessionAttendance.count({ where: { userId: ids.victimId! } })).toBe(0);
    expect(await prisma.sessionLike.count({ where: { userId: ids.victimId! } })).toBe(0);
    expect(await prisma.checkIn.count({ where: { userId: ids.victimId! } })).toBe(0);
    expect(await prisma.eventMembership.count({ where: { userId: ids.victimId! } })).toBe(0);
    expect(await prisma.conversationMember.count({ where: { userId: ids.victimId! } })).toBe(0);
    expect(await prisma.cfpReviewer.count({ where: { userId: ids.victimId! } })).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { userId: ids.victimId! } })).toBe(0);

    // Community / Q&A survive with null author
    const nt = await prisma.networkThread.findUniqueOrThrow({ where: { id: ids.networkThreadId! } });
    expect(nt.authorId).toBeNull();
    expect(nt.body).toBe("Keep this thread");
    const nr = await prisma.networkReply.findUniqueOrThrow({ where: { id: ids.networkReplyId! } });
    expect(nr.authorId).toBeNull();
    expect(nr.body).toBe("Keep this reply");

    const qa = await prisma.sessionDiscussionThread.findUniqueOrThrow({ where: { id: ids.qaThreadId! } });
    expect(qa.authorId).toBeNull();
    expect(qa.body).toBe("Keep this question");
    const qar = await prisma.sessionDiscussionReply.findUniqueOrThrow({ where: { id: ids.qaReplyId! } });
    expect(qar.authorId).toBeNull();

    // DM survives redacted
    const msg = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: ids.messageId! } });
    expect(msg.userId).toBeNull();
    expect(msg.body).toBe(DELETED_MESSAGE_BODY);
    expect(await prisma.conversation.findUnique({ where: { id: ids.conversationId! } })).not.toBeNull();

    // CfpReview anonymized, scores kept
    const review = await prisma.cfpReview.findUniqueOrThrow({ where: { id: ids.cfpReviewId! } });
    expect(review.reviewerUserId).toBeNull();
    expect(review.scores).toEqual({ q: 5 });
    expect(review.comment).toBe("Strong accept");

    // SessionResource (shared materials) survives with uploader nulled
    const resource = await prisma.sessionResource.findUniqueOrThrow({
      where: { id: ids.sessionResourceId! },
    });
    expect(resource.userId).toBeNull();
    expect(resource.title).toBe("Slides PDF");
    expect(resource.url).toBe("https://example.com/slides.pdf");
    expect(resource.sessionId).toBe(ids.sessionId!);

    // Agenda / CFP conversion completely untouched
    const sessionAfter = await prisma.session.findUniqueOrThrow({ where: { id: ids.sessionId! } });
    expect(sessionAfter.title).toBe(sessionBefore.title);
    expect(sessionAfter.speakerId).toBeNull(); // SetNull on User link only
    const itemAfter = await prisma.sessionItem.findUniqueOrThrow({ where: { id: ids.sessionItemId! } });
    expect(itemAfter.title).toBe(itemBefore.title);
    const speakerAfter = await prisma.speaker.findUniqueOrThrow({ where: { id: ids.speakerId! } });
    expect(speakerAfter.name).toBe(speakerBefore.name);
    const subAfter = await prisma.cfpSubmission.findUniqueOrThrow({ where: { id: ids.cfpSubmissionId! } });
    expect(subAfter.title).toBe(subBefore.title);
    expect(subAfter.convertedSessionId).toBe(ids.sessionId!);
    expect(subAfter.convertedSpeakerId).toBe(speakerBefore.id);

    // Event.createdBy SetNull
    const event = await prisma.event.findUniqueOrThrow({ where: { id: ids.eventId! } });
    expect(event.createdById).toBeNull();

    ids.victimId = undefined; // already deleted
  });
});
