import { ModerationReportStatus } from "@prisma/client";
import { createOpsCardIfAbsent } from "../cards";
import { prisma } from "../../../db";
import type { DetectorRunResult } from "../types";

function parseBlocklist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function hitsBlocklist(text: string, terms: string[]): string | null {
  const hay = text.toLowerCase();
  for (const term of terms) {
    if (term && hay.includes(term)) return term;
  }
  return null;
}

export async function detectModeration(
  eventId: string,
  organizationId: string,
  opts?: { jobId?: string | null; now?: Date },
): Promise<DetectorRunResult> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { communityBlocklist: true },
  });
  if (!event) return { detectorKind: "MODERATION", created: 0, skipped: 0 };

  const terms = parseBlocklist(event.communityBlocklist);
  let created = 0;
  let skipped = 0;

  const openReports = await prisma.userReport.findMany({
    where: { eventId, status: ModerationReportStatus.OPEN },
    take: 40,
    select: {
      id: true,
      reason: true,
      details: true,
      reportedUserId: true,
      reporterId: true,
      createdAt: true,
    },
  });

  for (const report of openReports) {
    const triggerInstanceKey = `moderation:report:${report.id}`;
    const { created: didCreate } = await createOpsCardIfAbsent(
      {
        organizationId,
        eventId,
        detectorKind: "MODERATION",
        triggerInstanceKey,
        triggerSummary: `Open user report: ${report.reason.slice(0, 80)}`,
        evidence: {
          reportId: report.id,
          reportedUserId: report.reportedUserId,
          reporterId: report.reporterId,
          reason: report.reason,
          links: [{ label: "Moderation", href: `/organizer/events/${eventId}` }],
        },
        draftActionType: "MODERATION_REVIEW",
        draftPayload: { reportId: report.id, action: "review" },
        draftHint: {
          title: "Review flagged attendee",
          body:
            `A participant filed a report (${report.reason}). ` +
            `${report.details ? report.details.slice(0, 300) : "No extra details."} ` +
            `Review in Moderation and resolve when ready.`,
        },
      },
      { jobId: opts?.jobId },
    );
    if (didCreate) created += 1;
    else skipped += 1;
  }

  if (terms.length === 0) {
    return { detectorKind: "MODERATION", created, skipped };
  }

  const threads = await prisma.networkThread.findMany({
    where: { eventId },
    take: 100,
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, body: true, authorId: true },
  });

  for (const thread of threads) {
    const hit = hitsBlocklist(`${thread.title}\n${thread.body}`, terms);
    if (!hit) {
      skipped += 1;
      continue;
    }
    const triggerInstanceKey = `moderation:blocklist:thread:${thread.id}`;
    const { created: didCreate } = await createOpsCardIfAbsent(
      {
        organizationId,
        eventId,
        detectorKind: "MODERATION",
        triggerInstanceKey,
        triggerSummary: `Blocklist hit (“${hit}”) in community thread`,
        evidence: {
          threadId: thread.id,
          authorId: thread.authorId,
          matchedTerm: hit,
          links: [{ label: "Community", href: `/?tab=community` }],
        },
        draftActionType: "MODERATION_REVIEW",
        draftPayload: { threadId: thread.id, matchedTerm: hit, action: "review_thread" },
        draftHint: {
          title: "Review community post",
          body:
            `A community thread may violate your blocklist (matched “${hit}”). ` +
            `Title: “${thread.title}”. Review and hide or follow up with the author if needed.`,
        },
      },
      { jobId: opts?.jobId },
    );
    if (didCreate) created += 1;
    else skipped += 1;
  }

  const replies = await prisma.networkReply.findMany({
    where: { thread: { eventId } },
    take: 100,
    orderBy: { createdAt: "desc" },
    select: { id: true, body: true, authorId: true, threadId: true },
  });

  for (const reply of replies) {
    const hit = hitsBlocklist(reply.body, terms);
    if (!hit) {
      skipped += 1;
      continue;
    }
    const triggerInstanceKey = `moderation:blocklist:reply:${reply.id}`;
    const { created: didCreate } = await createOpsCardIfAbsent(
      {
        organizationId,
        eventId,
        detectorKind: "MODERATION",
        triggerInstanceKey,
        triggerSummary: `Blocklist hit (“${hit}”) in community reply`,
        evidence: {
          replyId: reply.id,
          threadId: reply.threadId,
          authorId: reply.authorId,
          matchedTerm: hit,
        },
        draftActionType: "MODERATION_REVIEW",
        draftPayload: { replyId: reply.id, threadId: reply.threadId, matchedTerm: hit, action: "review_reply" },
        draftHint: {
          title: "Review community reply",
          body:
            `A community reply may violate your blocklist (matched “${hit}”). ` +
            `Review the thread and take action if needed.`,
        },
      },
      { jobId: opts?.jobId },
    );
    if (didCreate) created += 1;
    else skipped += 1;
  }

  return { detectorKind: "MODERATION", created, skipped };
}
