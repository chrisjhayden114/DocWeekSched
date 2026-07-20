import {
  CfpSubmissionStatus,
  EventMemberRole,
  SessionPublishStatus,
  type PrismaClient,
} from "@prisma/client";
import { HttpError } from "../authorization";

export type ConvertMode = "standalone_session" | "session_item";

export type ConvertInput = {
  prisma: PrismaClient;
  submissionId: string;
  mode: ConvertMode;
  /** Required when mode is session_item */
  targetSessionId?: string;
  /** Optional schedule for standalone session */
  startsAt?: Date;
  endsAt?: Date;
  /** Extra authors after submitter (ordered). Submitter is always author 0 / presenter. */
  additionalAuthors?: string[];
};

export type ConvertResult = {
  submissionId: string;
  sessionId: string | null;
  sessionItemId: string | null;
  speakerId: string;
  authorOrder: string[];
};

async function ensureSpeaker(
  prisma: PrismaClient,
  eventId: string,
  name: string,
  cache: Map<string, string>,
): Promise<string> {
  const key = name.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const existing = await prisma.speaker.findFirst({
    where: { eventId, name: { equals: name.trim(), mode: "insensitive" } },
  });
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }
  const created = await prisma.speaker.create({
    data: { eventId, name: name.trim(), sortOrder: cache.size },
  });
  cache.set(key, created.id);
  return created.id;
}

/**
 * Convert an ACCEPTED submission into a DRAFT session or SessionItem.
 * Submitter → Speaker; author order preserved (submitter first).
 */
export async function convertSubmission(input: ConvertInput): Promise<ConvertResult> {
  const sub = await input.prisma.cfpSubmission.findUnique({
    where: { id: input.submissionId },
    include: {
      cfpForm: { include: { event: true } },
    },
  });
  if (!sub) throw new HttpError(404, { error: "Submission not found" });
  if (sub.status !== CfpSubmissionStatus.ACCEPTED) {
    throw new HttpError(400, { error: "Only accepted submissions can be converted" });
  }
  if (sub.convertedSessionId || sub.convertedSessionItemId) {
    throw new HttpError(400, { error: "Submission already converted" });
  }

  const eventId = sub.cfpForm.eventId;
  const timezone = sub.cfpForm.event.timezone;
  const cache = new Map<string, string>();
  const speakerId = await ensureSpeaker(input.prisma, eventId, sub.submitterName, cache);
  const authorNames = [sub.submitterName, ...(input.additionalAuthors || []).map((a) => a.trim()).filter(Boolean)];

  if (input.mode === "session_item") {
    if (!input.targetSessionId) {
      throw new HttpError(400, { error: "targetSessionId required for session_item conversion" });
    }
    const session = await input.prisma.session.findFirst({
      where: { id: input.targetSessionId, eventId },
      include: { items: { orderBy: { sortOrder: "desc" }, take: 1 } },
    });
    if (!session) throw new HttpError(404, { error: "Target session not found" });
    const nextOrder = (session.items[0]?.sortOrder ?? -1) + 1;
    const item = await input.prisma.sessionItem.create({
      data: {
        sessionId: session.id,
        title: sub.title,
        abstract: sub.abstract,
        sortOrder: nextOrder,
      },
    });
    for (let i = 0; i < authorNames.length; i += 1) {
      const sid = await ensureSpeaker(input.prisma, eventId, authorNames[i], cache);
      await input.prisma.sessionItemAuthor.create({
        data: {
          sessionItemId: item.id,
          speakerId: sid,
          name: authorNames[i],
          sortOrder: i,
          isPresenter: i === 0,
        },
      });
    }
    await input.prisma.cfpSubmission.update({
      where: { id: sub.id },
      data: {
        convertedSessionItemId: item.id,
        convertedSpeakerId: speakerId,
        convertedSessionId: session.id,
      },
    });
    return {
      submissionId: sub.id,
      sessionId: session.id,
      sessionItemId: item.id,
      speakerId,
      authorOrder: authorNames,
    };
  }

  // standalone DRAFT session
  const start = input.startsAt || sub.cfpForm.event.startDate;
  const end =
    input.endsAt ||
    new Date(start.getTime() + 60 * 60 * 1000);
  const session = await input.prisma.session.create({
    data: {
      eventId,
      title: sub.title,
      description: sub.abstract,
      startsAt: start,
      endsAt: end,
      publishStatus: SessionPublishStatus.DRAFT,
      speakers: authorNames.join(", "),
    },
  });
  for (let i = 0; i < authorNames.length; i += 1) {
    const sid = await ensureSpeaker(input.prisma, eventId, authorNames[i], cache);
    await input.prisma.sessionSpeaker.create({
      data: { sessionId: session.id, speakerId: sid, sortOrder: i },
    });
  }
  // Also create a single SessionItem so multi-paper tooling sees the paper
  const item = await input.prisma.sessionItem.create({
    data: {
      sessionId: session.id,
      title: sub.title,
      abstract: sub.abstract,
      sortOrder: 0,
    },
  });
  for (let i = 0; i < authorNames.length; i += 1) {
    const sid = await ensureSpeaker(input.prisma, eventId, authorNames[i], cache);
    await input.prisma.sessionItemAuthor.create({
      data: {
        sessionItemId: item.id,
        speakerId: sid,
        name: authorNames[i],
        sortOrder: i,
        isPresenter: i === 0,
      },
    });
  }

  await input.prisma.cfpSubmission.update({
    where: { id: sub.id },
    data: {
      convertedSessionId: session.id,
      convertedSessionItemId: item.id,
      convertedSpeakerId: speakerId,
    },
  });

  void timezone; // reserved for wall-clock scheduling UI
  return {
    submissionId: sub.id,
    sessionId: session.id,
    sessionItemId: item.id,
    speakerId,
    authorOrder: authorNames,
  };
}

/** Ensure user has EventMembership.REVIEWER (does not grant manage). */
export async function ensureReviewerMembership(
  prisma: PrismaClient,
  eventId: string,
  userId: string,
): Promise<void> {
  const existing = await prisma.eventMembership.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
  if (!existing) {
    await prisma.eventMembership.create({
      data: { eventId, userId, role: EventMemberRole.REVIEWER },
    });
    return;
  }
  if (existing.deletedAt) {
    await prisma.eventMembership.update({
      where: { id: existing.id },
      data: { deletedAt: null, role: EventMemberRole.REVIEWER },
    });
    return;
  }
  // Do not demote ADMIN/SPEAKER
  if (existing.role === EventMemberRole.ATTENDEE) {
    await prisma.eventMembership.update({
      where: { id: existing.id },
      data: { role: EventMemberRole.REVIEWER },
    });
  }
}

/**
 * Assign reviewers to submissions.
 * - all: every reviewer gets a CfpReview stub for every open submission
 * - round_robin: cycle submissions across reviewers
 */
export async function assignReviews(
  prisma: PrismaClient,
  cfpFormId: string,
  mode: "all" | "round_robin",
): Promise<{ created: number }> {
  const reviewers = await prisma.cfpReviewer.findMany({
    where: { cfpFormId },
    orderBy: { createdAt: "asc" },
  });
  if (!reviewers.length) throw new HttpError(400, { error: "Add reviewers first" });

  const submissions = await prisma.cfpSubmission.findMany({
    where: {
      cfpFormId,
      status: { in: [CfpSubmissionStatus.SUBMITTED, CfpSubmissionStatus.UNDER_REVIEW] },
      emailVerifiedAt: { not: null },
    },
    orderBy: { submittedAt: "asc" },
  });

  let created = 0;
  if (mode === "all") {
    for (const sub of submissions) {
      for (const rev of reviewers) {
        const existing = await prisma.cfpReview.findUnique({
          where: {
            submissionId_reviewerUserId: { submissionId: sub.id, reviewerUserId: rev.userId },
          },
        });
        if (existing) continue;
        await prisma.cfpReview.create({
          data: { submissionId: sub.id, reviewerUserId: rev.userId, scores: {} },
        });
        created += 1;
      }
      if (sub.status === CfpSubmissionStatus.SUBMITTED) {
        await prisma.cfpSubmission.update({
          where: { id: sub.id },
          data: { status: CfpSubmissionStatus.UNDER_REVIEW },
        });
      }
    }
  } else {
    let i = 0;
    for (const sub of submissions) {
      const rev = reviewers[i % reviewers.length];
      i += 1;
      const existing = await prisma.cfpReview.findUnique({
        where: {
          submissionId_reviewerUserId: { submissionId: sub.id, reviewerUserId: rev.userId },
        },
      });
      if (!existing) {
        await prisma.cfpReview.create({
          data: { submissionId: sub.id, reviewerUserId: rev.userId, scores: {} },
        });
        created += 1;
      }
      if (sub.status === CfpSubmissionStatus.SUBMITTED) {
        await prisma.cfpSubmission.update({
          where: { id: sub.id },
          data: { status: CfpSubmissionStatus.UNDER_REVIEW },
        });
      }
    }
  }
  return { created };
}
