import { createOpsCardIfAbsent } from "../cards";
import { isEventCalendarDay } from "../time";
import { QA_STALE_HOURS } from "../types";
import { prisma } from "../../../db";
import type { DetectorRunResult } from "../types";

export async function detectQaStale(
  eventId: string,
  organizationId: string,
  opts?: { jobId?: string | null; now?: Date },
): Promise<DetectorRunResult> {
  const now = opts?.now || new Date();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { startDate: true, endDate: true, timezone: true },
  });
  if (!event) return { detectorKind: "QA_STALE", created: 0, skipped: 0 };
  if (!isEventCalendarDay(now, event)) {
    return { detectorKind: "QA_STALE", created: 0, skipped: 0 };
  }

  const cutoff = new Date(now.getTime() - QA_STALE_HOURS * 60 * 60 * 1000);
  const threads = await prisma.sessionDiscussionThread.findMany({
    where: {
      answeredAt: null,
      hiddenAt: null,
      createdAt: { lte: cutoff },
      session: { eventId, publishStatus: "PUBLISHED" },
    },
    take: 40,
    select: {
      id: true,
      title: true,
      body: true,
      createdAt: true,
      sessionId: true,
      session: {
        select: {
          title: true,
          speakerId: true,
          sessionSpeakers: { select: { speakerId: true }, take: 1 },
        },
      },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const thread of threads) {
    // Boundary: younger than 3h should not appear (already filtered by cutoff).
    const ageMs = now.getTime() - thread.createdAt.getTime();
    if (ageMs < QA_STALE_HOURS * 60 * 60 * 1000) {
      skipped += 1;
      continue;
    }

    const speakerUserId = thread.session.speakerId;
    const draftActionType = speakerUserId ? "SPEAKER_NUDGE" : "DM";
    const triggerInstanceKey = `qa_stale:${thread.id}`;

    const { created: didCreate } = await createOpsCardIfAbsent(
      {
        organizationId,
        eventId,
        detectorKind: "QA_STALE",
        triggerInstanceKey,
        triggerSummary: `Unanswered Q&A (>${QA_STALE_HOURS}h): “${thread.title}” on ${thread.session.title}`,
        evidence: {
          threadId: thread.id,
          sessionId: thread.sessionId,
          createdAt: thread.createdAt.toISOString(),
          links: [{ label: "Session Q&A", href: `/session/${thread.sessionId}` }],
        },
        draftActionType,
        draftPayload: {
          threadId: thread.id,
          sessionId: thread.sessionId,
          targetUserId: speakerUserId || null,
          postQaReply: !speakerUserId,
        },
        draftHint: speakerUserId
          ? {
              title: `Reminder: question on ${thread.session.title}`,
              body:
                `A question has been waiting over ${QA_STALE_HOURS} hours:\n\n` +
                `“${thread.title}”\n${thread.body.slice(0, 400)}\n\n` +
                `Please reply on the session page when you can.`,
            }
          : {
              title: `Suggested reply: ${thread.title}`,
              body:
                `Thanks for the question — we're following up with the speaker and will post an answer here shortly.`,
            },
      },
      { jobId: opts?.jobId },
    );

    if (didCreate) created += 1;
    else skipped += 1;
  }

  return { detectorKind: "QA_STALE", created, skipped };
}
