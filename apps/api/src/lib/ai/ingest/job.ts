import { AgendaIngestRunStatus, type Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { registerJobHandler, type JobHandler } from "../../jobs";
import { AGENDA_INGEST_JOB_TYPE } from "./constants";
import { runAgendaExtract } from "./extract";
import { textFromDataUrl } from "./sourceText";

type JobPayload = {
  runId: string;
  sourceText?: string;
};

const handler: JobHandler = async (job) => {
  const payload = (job.input || {}) as JobPayload;
  const runId = payload.runId;
  if (!runId) throw new Error("agenda_ingest job missing runId");
  if (!job.organizationId || !job.eventId) throw new Error("agenda_ingest job missing org/event");

  const run = await prisma.agendaIngestRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`AgendaIngestRun ${runId} not found`);

  await prisma.agendaIngestRun.update({
    where: { id: runId },
    data: { status: AgendaIngestRunStatus.EXTRACTING },
  });
  await job.updateProgress(10, "Loading source");

  let sourceText = payload.sourceText || run.sourceTextPreview || "";
  if (!sourceText && run.sourceUrl?.startsWith("data:")) {
    sourceText = textFromDataUrl(run.sourceUrl);
  }
  if (!sourceText) {
    throw new Error("No source text available for extract");
  }

  const event = await prisma.event.findUniqueOrThrow({
    where: { id: job.eventId },
    select: { timezone: true },
  });

  const existing = await prisma.session.findMany({
    where: { eventId: job.eventId },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      location: true,
      track: { select: { name: true } },
      room: { select: { name: true } },
    },
  });

  await job.updateProgress(40, "Extracting agenda");

  try {
    const extracted = await runAgendaExtract({
      organizationId: job.organizationId,
      eventId: job.eventId,
      userId: job.createdById,
      jobId: job.id,
      sourceText,
      eventTimezone: event.timezone,
      existingSessions: existing.map((s) => ({
        id: s.id,
        title: s.title,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        location: s.location,
        trackName: s.track?.name,
        roomName: s.room?.name,
      })),
    });

    await job.updateProgress(90, "Saving review changeset");

    await prisma.agendaIngestRun.update({
      where: { id: runId },
      data: {
        status: AgendaIngestRunStatus.READY_FOR_REVIEW,
        extraction: extracted.extraction as unknown as Prisma.InputJsonValue,
        assumptions: extracted.assumptions as unknown as Prisma.InputJsonValue,
        changeset: extracted.changeset as unknown as Prisma.InputJsonValue,
        sourceTextPreview: extracted.sourcePreview,
        error: null,
      },
    });

    return {
      runId,
      sessionCount: extracted.extraction.sessions.length,
      fixtureId: extracted.fixtureId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extract failed";
    await prisma.agendaIngestRun.update({
      where: { id: runId },
      data: {
        status: AgendaIngestRunStatus.FAILED,
        error: message,
      },
    });
    throw err;
  }
};

let registered = false;

export function registerAgendaIngestJob(): void {
  if (registered) return;
  registered = true;
  registerJobHandler(AGENDA_INGEST_JOB_TYPE, handler);
}

// Register on import so API boot and tests that processDueJobs both work.
registerAgendaIngestJob();
