/**
 * Account deletion — 7-day grace, sole-OWNER guard, hard-delete cascade.
 * Requires migration 20260726100000_phase6_account_deletion (review before apply).
 */

import {
  AccountDeletionStatus,
  OrgRole,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../db";
import { verifyPassword } from "../auth";
import { writeAuditLog } from "../ai/audit";
import { enqueueJob, registerJobHandler } from "../jobs";
import { HttpError } from "../authorization";

export const ACCOUNT_DELETE_HARD_JOB = "account.delete.hard";
export const ACCOUNT_DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const DELETED_MESSAGE_BODY = "[deleted]";
export const DELETED_PARTICIPANT_LABEL = "Deleted participant";

export type MembershipSnapshot = {
  eventId: string;
  directoryOptIn: boolean;
  matchMeEnabled: boolean;
};

export type DeletionPayload = {
  memberships: MembershipSnapshot[];
  hardDeleteJobId?: string | null;
};

export async function findSoleOwnerOrgIds(userId: string): Promise<string[]> {
  const ownerships = await prisma.orgMembership.findMany({
    where: { userId, role: OrgRole.OWNER },
    select: { organizationId: true },
  });
  const sole: string[] = [];
  for (const row of ownerships) {
    const otherOwners = await prisma.orgMembership.count({
      where: {
        organizationId: row.organizationId,
        role: OrgRole.OWNER,
        userId: { not: userId },
      },
    });
    if (otherOwners === 0) sole.push(row.organizationId);
  }
  return sole;
}

async function assertCanDelete(userId: string): Promise<void> {
  const sole = await findSoleOwnerOrgIds(userId);
  if (sole.length > 0) {
    throw new HttpError(409, {
      error: "Transfer or close organizations where you are the only owner before deleting your account.",
      code: "SOLE_OWNER",
      organizationIds: sole,
    });
  }
}

/**
 * Request deletion: password re-auth, sole-OWNER check, deactivate immediately, schedule hard-delete.
 */
export async function requestAccountDeletion(input: {
  userId: string;
  email: string;
  password: string;
}): Promise<{
  requestId: string;
  scheduledFor: Date;
  jobId: string;
}> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new HttpError(404, { error: "Account not found" });

  const emailOk = user.email.trim().toLowerCase() === input.email.trim().toLowerCase();
  const passOk = await verifyPassword(input.password, user.passwordHash);
  if (!emailOk || !passOk) {
    throw new HttpError(401, { error: "Email or password is incorrect." });
  }

  await assertCanDelete(user.id);

  const existing = await prisma.accountDeletionRequest.findUnique({ where: { userId: user.id } });
  if (existing?.status === AccountDeletionStatus.PENDING) {
    throw new HttpError(409, {
      error: "Account deletion is already scheduled.",
      code: "DELETE_ALREADY_PENDING",
      scheduledFor: existing.scheduledFor.toISOString(),
    });
  }

  const memberships = await prisma.eventMembership.findMany({
    where: { userId: user.id },
    select: { eventId: true, directoryOptIn: true, matchMeEnabled: true },
  });
  const snapshot: DeletionPayload = {
    memberships: memberships.map((m) => ({
      eventId: m.eventId,
      directoryOptIn: m.directoryOptIn,
      matchMeEnabled: m.matchMeEnabled,
    })),
  };

  const scheduledFor = new Date(Date.now() + ACCOUNT_DELETION_GRACE_MS);

  const request = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { deactivatedAt: new Date() },
    });
    await tx.eventMembership.updateMany({
      where: { userId: user.id },
      data: { directoryOptIn: false, matchMeEnabled: false },
    });
    await tx.pushSubscription.deleteMany({ where: { userId: user.id } });

    if (existing) {
      return tx.accountDeletionRequest.update({
        where: { id: existing.id },
        data: {
          status: AccountDeletionStatus.PENDING,
          requestedAt: new Date(),
          scheduledFor,
          completedAt: null,
          cancelledAt: null,
          blockedReason: null,
          payload: snapshot as unknown as Prisma.InputJsonValue,
          hardDeleteJobId: null,
        },
      });
    }
    return tx.accountDeletionRequest.create({
      data: {
        userId: user.id,
        status: AccountDeletionStatus.PENDING,
        scheduledFor,
        payload: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
  });

  const job = await enqueueJob({
    type: ACCOUNT_DELETE_HARD_JOB,
    createdById: user.id,
    payload: { userId: user.id, requestId: request.id },
    scheduledAt: scheduledFor,
    maxAttempts: 5,
  });

  await prisma.accountDeletionRequest.update({
    where: { id: request.id },
    data: {
      hardDeleteJobId: job.id,
      payload: { ...snapshot, hardDeleteJobId: job.id } as unknown as Prisma.InputJsonValue,
    },
  });

  await writeAuditLog({
    actorUserId: user.id,
    action: "ACCOUNT_DELETE_REQUEST",
    entityType: "account_deletion_request",
    entityId: request.id,
    payload: { scheduledFor: scheduledFor.toISOString() },
  });

  return { requestId: request.id, scheduledFor, jobId: job.id };
}

export async function cancelAccountDeletion(userId: string): Promise<{ ok: true }> {
  const request = await prisma.accountDeletionRequest.findUnique({ where: { userId } });
  if (!request || request.status !== AccountDeletionStatus.PENDING) {
    throw new HttpError(404, { error: "No pending deletion request." });
  }

  const payload = (request.payload ?? {}) as DeletionPayload;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { deactivatedAt: null },
    });
    for (const m of payload.memberships ?? []) {
      await tx.eventMembership.updateMany({
        where: { userId, eventId: m.eventId },
        data: {
          directoryOptIn: m.directoryOptIn,
          matchMeEnabled: m.matchMeEnabled,
        },
      });
    }
    await tx.accountDeletionRequest.update({
      where: { id: request.id },
      data: {
        status: AccountDeletionStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });
    if (request.hardDeleteJobId) {
      await tx.backgroundJob.updateMany({
        where: {
          id: request.hardDeleteJobId,
          status: { in: ["PENDING", "FAILED"] },
        },
        data: {
          status: "DEAD",
          finishedAt: new Date(),
          error: "Cancelled by user",
        },
      });
    }
  });

  await writeAuditLog({
    actorUserId: userId,
    action: "ACCOUNT_DELETE_CANCELLED",
    entityType: "account_deletion_request",
    entityId: request.id,
  });

  return { ok: true };
}

/**
 * Login-path helper: if PENDING deletion, cancel grace and allow login.
 */
export async function cancelPendingDeletionIfAny(userId: string): Promise<boolean> {
  const request = await prisma.accountDeletionRequest.findUnique({ where: { userId } });
  if (!request || request.status !== AccountDeletionStatus.PENDING) return false;
  await cancelAccountDeletion(userId);
  return true;
}

/**
 * Hard-delete after grace: redact/SetNull preserve rows, then delete User (cascades personal).
 * Never touches Speaker / Session / SessionItem / CfpSubmission rows except SetNull on Session.speakerId.
 */
export async function hardDeleteUserAccount(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

  const request = await prisma.accountDeletionRequest.findUnique({ where: { userId } });
  if (request && request.status === AccountDeletionStatus.CANCELLED) {
    return;
  }
  if (request && request.status === AccountDeletionStatus.PENDING) {
    if (request.scheduledFor.getTime() > Date.now() + 1000) {
      throw new Error("Hard delete attempted before scheduledFor");
    }
  }

  await prisma.$transaction(async (tx) => {
    // Preserve DMs: redact + detach author
    await tx.conversationMessage.updateMany({
      where: { userId },
      data: { body: DELETED_MESSAGE_BODY, userId: null },
    });

    // Community + Q&A authors → null (UI shows Deleted participant)
    await tx.networkThread.updateMany({ where: { authorId: userId }, data: { authorId: null } });
    await tx.networkReply.updateMany({ where: { authorId: userId }, data: { authorId: null } });
    await tx.sessionDiscussionThread.updateMany({ where: { authorId: userId }, data: { authorId: null } });
    await tx.sessionDiscussionReply.updateMany({ where: { authorId: userId }, data: { authorId: null } });

    // CFP reviews: anonymize, keep scores
    await tx.cfpReview.updateMany({ where: { reviewerUserId: userId }, data: { reviewerUserId: null } });

    await tx.announcementAuditLog.updateMany({ where: { actorId: userId }, data: { actorId: null } });
    // Shared session materials — keep slides/papers/links attached to the Session
    await tx.sessionResource.updateMany({ where: { userId }, data: { userId: null } });
    await tx.event.updateMany({ where: { createdById: userId }, data: { createdById: null } });
    await tx.session.updateMany({ where: { speakerId: userId }, data: { speakerId: null } });

    if (request) {
      await tx.accountDeletionRequest.update({
        where: { id: request.id },
        data: { status: AccountDeletionStatus.COMPLETE, completedAt: new Date() },
      });
    }

    // Cascade removes PERSONAL rows; SetNull already applied for preserved content.
    await tx.user.delete({ where: { id: userId } });
  });

  await writeAuditLog({
    actorUserId: null,
    action: "ACCOUNT_DELETE_COMPLETE",
    entityType: "user",
    entityId: userId,
    payload: { completedAt: new Date().toISOString() },
  });
}

export function registerAccountDeletionJobs(): void {
  registerJobHandler(ACCOUNT_DELETE_HARD_JOB, async (job) => {
    const input = job.input as { userId?: string; requestId?: string };
    const userId = typeof input.userId === "string" ? input.userId : null;
    if (!userId) throw new Error("account.delete.hard missing userId");

    const request = await prisma.accountDeletionRequest.findUnique({ where: { userId } });
    if (!request || request.status !== AccountDeletionStatus.PENDING) {
      await job.updateProgress(100, "Skipped — not pending");
      return { skipped: true };
    }
    if (request.scheduledFor.getTime() > Date.now()) {
      throw new Error("Not yet due");
    }

    await job.updateProgress(20, "Hard-deleting account");
    await hardDeleteUserAccount(userId);
    await job.updateProgress(100, "Done");
    return { deleted: true, userId };
  });
}
