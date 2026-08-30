import { AgendaIngestRunStatus, SessionAttendanceStatus, type Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { registerJobHandler, type JobHandler } from "../../jobs";
import { log } from "../../log";
import { AGENDA_INGEST_JOB_TYPE, AGENDA_INGEST_MAX_BYTES } from "./constants";
import { runAgendaExtract } from "./extract";
import { attachmentFromDataUrl, sourceTextFromUpload, type IngestAttachment } from "./sourceText";

type JobPayload = {
  runId: string;
  sourceText?: string;
  /**
   * E9.1: base64 source (PDF/image) passed by the ingest route so the job can
   * build the multimodal attachment without re-reading storage — the stored
   * URL may be an opaque object-store address with no read API.
   */
  attachment?: IngestAttachment;
  /** H-GEN: "generate" drafts a skeleton from serialized form parameters. */
  mode?: "extract" | "generate";
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
    // E21: mime-aware — a DOCX stored as a data URL (dev storage fallback)
    // re-extracts through mammoth instead of hitting the binary stub.
    sourceText = await sourceTextFromUpload(run.sourceUrl);
  }
  if (!sourceText) {
    throw new Error("No source text available for extract");
  }

  let attachment: IngestAttachment | undefined;
  const fromPayload = payload.attachment;
  if (fromPayload?.base64 && (fromPayload.type === "document" || fromPayload.type === "image")) {
    if (Buffer.from(fromPayload.base64, "base64").length > AGENDA_INGEST_MAX_BYTES) {
      throw new Error(`File exceeds max size of ${AGENDA_INGEST_MAX_BYTES} bytes`);
    }
    attachment = fromPayload;
  } else if (run.sourceUrl?.startsWith("data:")) {
    // Legacy/dev path: the data-URL storage fallback keeps the bytes on the run.
    attachment = attachmentFromDataUrl(run.sourceUrl) ?? undefined;
  }

  const event = await prisma.event.findUniqueOrThrow({
    where: { id: job.eventId },
    select: { timezone: true, startDate: true, endDate: true },
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
      // E13.3: children travel with the diff so a re-import proposes
      // removals explicitly instead of confirm silently rewriting them.
      sessionSpeakers: {
        orderBy: { sortOrder: "asc" },
        select: { speakerId: true, speaker: { select: { name: true } } },
      },
      items: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true },
      },
      // W-6 — blast radius for a proposed delete (same honesty as Program).
      attendances: { where: { status: SessionAttendanceStatus.JOINING }, select: { id: true } },
      _count: { select: { bookmarks: true } },
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
      // E31: anchor date inference for sources that carry times but no dates
      // (e.g. timeslots in spreadsheet sheet names).
      eventDates: {
        start: event.startDate.toISOString().slice(0, 10),
        end: event.endDate.toISOString().slice(0, 10),
      },
      existingSessions: existing.map((s) => ({
        id: s.id,
        title: s.title,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        location: s.location,
        trackName: s.track?.name,
        roomName: s.room?.name,
        speakers: s.sessionSpeakers.map((l) => ({ speakerId: l.speakerId, name: l.speaker.name })),
        items: s.items.map((it) => ({ itemId: it.id, title: it.title })),
        joinedCount: s.attendances.length,
        bookmarkCount: s._count.bookmarks,
      })),
      attachment,
      mode: payload.mode,
    });

    // E9.2: a zero-session extract is evidence the parse failed, never
    // evidence the organizer deleted their programme. End the run visibly
    // empty/failed and propose nothing (buildReimportChangeset also refuses
    // to emit delete rows for an empty extract).
    if (extracted.extraction.sessions.length === 0) {
      await prisma.agendaIngestRun.update({
        where: { id: runId },
        data: {
          status: AgendaIngestRunStatus.FAILED,
          extraction: extracted.extraction as unknown as Prisma.InputJsonValue,
          assumptions: extracted.assumptions as unknown as Prisma.InputJsonValue,
          changeset: [] as unknown as Prisma.InputJsonValue,
          sourceTextPreview: extracted.sourcePreview,
          error:
            "No sessions found in the source — nothing was changed. Include times like '9:00–10:15' and one session per line, then try again.",
        },
      });
      return { runId, sessionCount: 0, fixtureId: extracted.fixtureId };
    }

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
    const raw = err instanceof Error ? err.message : "Extract failed";
    const code = (err as { code?: string }).code;
    // Provider failures often carry raw API-error JSON (e.g.
    // {"type":"not_found_error"...}) — log that server-side, but store a
    // plain-English message the organizer can act on.
    const looksLikeProviderBlob =
      code === "PROVIDER_ERROR" || /"type"\s*:\s*"(?:error|not_found_error|invalid_request_error)"/.test(raw);
    // E10: truncation is honest and actionable — never blame JSON formatting.
    const message =
      code === "TRUNCATED"
        ? "The programme was too long to process in one pass. Split it into smaller sections and ingest each one separately, or use the CSV import instead."
        : looksLikeProviderBlob
          ? "The AI provider rejected the request — the team has been notified. Try again shortly."
          : raw;
    if (looksLikeProviderBlob) {
      log("error", "agenda ingest provider error", { runId, detail: raw });
    }
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
