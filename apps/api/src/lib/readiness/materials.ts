/**
 * AGENDA-3 — presenter materials on the agenda.
 *
 * Speaker Readiness already collects the decks; this module is the ONE place
 * that decides which of them an attendee may see, and it is deliberately
 * paranoid. Four independent things must all be true before a byte is served:
 *
 *   1. the organizer flipped "Share with attendees" on the submission,
 *   2. the submission is approved — and not rejected,
 *   3. it is the CURRENT submission (a resubmission supersedes, never deletes,
 *      so the whole history sits in the same table as the live row),
 *   4. the caller passes the event's materialsVisibility check.
 *
 * Rules 1–3 live in `SHARED_MATERIAL_WHERE`, which every read goes through so
 * the list route, the file route and the public payload cannot drift apart —
 * a drift here is a leak, not a bug.
 */

import type { Prisma } from "@prisma/client";
import { materialsArePublic } from "@event-app/shared";
import { HttpError, requireEventAccess } from "../authorization";
import { prisma } from "../db";
import { featureEnabled } from "../features/featureEnabled";
import { fileRulesForRequirement, isDeckRequirement } from "./files";

/**
 * The requirement kinds that can carry something an attendee could open.
 * A `confirm` or `short_text` answer is an organizer's record, never a handout.
 */
const SHAREABLE_REQUIREMENT_KINDS = ["file", "url"] as const;

/**
 * Current + approved + explicitly shared. Exported so tests can assert the
 * exact clause rather than re-describing it, and so every caller reuses it.
 *
 * `approvedAt: { not: null }` and `rejectedAt: null` are BOTH required on
 * purpose: reviewSubmission clears the other timestamp when it writes one, but
 * a row hand-edited into carrying both must read as rejected, not approved.
 */
export const SHARED_MATERIAL_WHERE: Prisma.ReadinessSubmissionWhereInput = {
  sharedWithAttendees: true,
  supersededAt: null,
  rejectedAt: null,
  approvedAt: { not: null },
  assignment: { requirement: { kind: { in: [...SHAREABLE_REQUIREMENT_KINDS] } } },
};

/** One shared handout as every attendee-facing surface sees it. */
export type SharedMaterial = {
  id: string;
  /** The requirement's label ("Slide deck"), falling back to the file name. */
  title: string;
  kind: "file" | "link";
  /** Files only — drives the peek's glyph and the download disposition. */
  mime: string | null;
  /** Files only — rendered next to the title so nobody opens a 90 MB deck on data. */
  sizeBytes: number | null;
  /** Links only. A file is fetched from GET /materials/:id/file, never from a raw URL. */
  url: string | null;
};

type SubmissionRow = {
  id: string;
  valueText: string | null;
  fileName: string | null;
  fileMime: string | null;
  fileSizeBytes: number | null;
  fileUrl: string | null;
  fileStorageKey: string | null;
  assignment: {
    sessionId: string | null;
    speakerId: string | null;
    requirement: { label: string; kind: string; config: unknown };
  };
};

const submissionSelect = {
  id: true,
  valueText: true,
  fileName: true,
  fileMime: true,
  fileSizeBytes: true,
  fileUrl: true,
  fileStorageKey: true,
  assignment: {
    select: {
      sessionId: true,
      speakerId: true,
      requirement: { select: { label: true, kind: true, config: true } },
    },
  },
} satisfies Prisma.ReadinessSubmissionSelect;

/**
 * Whether approving this requirement's submission also shares it.
 *
 * An explicit `config.shareByDefault` always wins, in both directions — an
 * organizer who turned it off on a deck requirement means it. With nothing
 * configured, a DECK shares and everything else does not: a deck is collected
 * in order to be presented, whereas a signed release form or a dietary note
 * is collected in order to be filed. Getting that default backwards is a leak,
 * so anything we are unsure about stays private.
 *
 * This only ever runs on a fresh approve action, so no already-approved
 * submission is published by deploying it.
 */
export function sharesOnApproval(config: Record<string, unknown> | null | undefined): boolean {
  if (typeof config?.shareByDefault === "boolean") return config.shareByDefault;
  return isDeckRequirement(config);
}

/** True when a submission holds something an attendee could actually open. */
export function isShareableSubmission(row: {
  valueText: string | null;
  fileUrl: string | null;
  fileStorageKey: string | null;
  requirementKind: string;
}): boolean {
  if (!(SHAREABLE_REQUIREMENT_KINDS as readonly string[]).includes(row.requirementKind)) {
    return false;
  }
  return hasStoredFile(row) || Boolean(httpLink(row.valueText));
}

/** A stored file, as opposed to a requirement satisfied by pasting a link. */
function hasStoredFile(row: {
  fileStorageKey: string | null;
  fileUrl: string | null;
}): boolean {
  return Boolean(row.fileStorageKey) || Boolean(row.fileUrl?.startsWith("data:"));
}

function httpLink(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/**
 * Row → payload. Returns null for a submission that is shared and approved but
 * holds nothing openable (an empty file requirement, or a `url` answer that is
 * not a URL) — the agenda shows no chip rather than a chip that 404s.
 */
export function toSharedMaterial(row: SubmissionRow): SharedMaterial | null {
  const label = row.assignment.requirement.label?.trim() || "";
  if (hasStoredFile(row)) {
    return {
      id: row.id,
      title: label || row.fileName?.trim() || "Materials",
      kind: "file",
      mime: row.fileMime,
      sizeBytes: row.fileSizeBytes,
      url: null,
    };
  }
  const link = httpLink(row.valueText);
  if (!link) return null;
  return {
    id: row.id,
    title: label || "Materials",
    kind: "link",
    mime: null,
    sizeBytes: null,
    url: link,
  };
}

/**
 * Every shared material on an event, keyed by the session it belongs on.
 *
 * A readiness assignment's subject is EITHER a session or a speaker. A
 * session-subject submission lands on that session; a speaker-subject one
 * lands on every session that speaker is presenting, which is what "the
 * speaker's deck" means when one person gives the same talk twice.
 *
 * Batched by event on purpose: the public page and the in-app agenda both need
 * this for a whole program at once, and a per-session query there would be one
 * round trip per card.
 */
export async function sharedMaterialsByEvent(
  eventId: string,
): Promise<Map<string, SharedMaterial[]>> {
  const bySession = new Map<string, SharedMaterial[]>();
  if (!(await featureEnabled(eventId, "readiness"))) return bySession;

  const rows = await prisma.readinessSubmission.findMany({
    where: { eventId, ...SHARED_MATERIAL_WHERE },
    orderBy: { createdAt: "asc" },
    select: submissionSelect,
  });
  if (rows.length === 0) return bySession;

  // Speaker-subject submissions need the speaker → sessions fan-out.
  const needsSpeakerFanOut = rows.some((r) => !r.assignment.sessionId && r.assignment.speakerId);
  const speakerSessions = new Map<string, string[]>();
  if (needsSpeakerFanOut) {
    const links = await prisma.sessionSpeaker.findMany({
      where: { session: { eventId } },
      select: { speakerId: true, sessionId: true },
    });
    for (const link of links) {
      const list = speakerSessions.get(link.speakerId) ?? [];
      list.push(link.sessionId);
      speakerSessions.set(link.speakerId, list);
    }
  }

  for (const row of rows) {
    const material = toSharedMaterial(row);
    if (!material) continue;
    const targets = row.assignment.sessionId
      ? [row.assignment.sessionId]
      : speakerSessions.get(row.assignment.speakerId ?? "") ?? [];
    for (const sessionId of targets) {
      const list = bySession.get(sessionId) ?? [];
      list.push(material);
      bySession.set(sessionId, list);
    }
  }
  return bySession;
}

/** The shared materials on one session. Same rules, one card's worth. */
export async function sharedMaterialsForSession(
  eventId: string,
  sessionId: string,
): Promise<SharedMaterial[]> {
  const all = await sharedMaterialsByEvent(eventId);
  return all.get(sessionId) ?? [];
}

/** What the gate tells the caller about the viewer. Anonymous is never a manager. */
export type MaterialsViewer = { canManageEvent: boolean };

/**
 * The event's visibility gate, and the only way in.
 *
 * PUBLIC serves anyone, signed in or not. ATTENDEES requires a signed-in
 * member of THIS event — an anonymous caller gets 403, not 401, because the
 * honest answer is "this event does not publish its materials", and that is
 * not a fact a login screen would change for a non-member.
 *
 * Throws rather than returning a boolean so a caller cannot forget to read the
 * result. `materialsVisibilityOrDefault` inside `materialsArePublic` collapses
 * a value it does not recognise to ATTENDEES, so a corrupt row fails CLOSED.
 *
 * Returns the manage flag because a draft session's materials must stay
 * invisible to everyone except the organizers who can see the draft itself.
 */
export async function requireMaterialsViewer(
  eventId: string,
  userId: string | null | undefined,
): Promise<MaterialsViewer> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { materialsVisibility: true },
  });
  if (!event) throw new HttpError(404, { error: "Event not found" });

  const isPublic = materialsArePublic(event.materialsVisibility);

  if (!userId) {
    if (isPublic) return { canManageEvent: false };
    throw new HttpError(403, {
      error:
        "This event shares presenter materials with the people who joined it. Sign in to open them.",
      reason: "materials_attendees_only",
    });
  }

  // On a PUBLIC event a signed-in stranger is no worse off than a signed-out
  // one, so membership is not required — but we still resolve access, because
  // only a manager may reach an unpublished session's materials.
  const access = await requireEventAccess(userId, eventId, { requireMembership: !isPublic });
  return { canManageEvent: access.canManageEvent };
}

/** A shared submission that actually holds a stored file, before MIME screening. */
export type SharedMaterialFile = {
  eventId: string;
  fileName: string | null;
  fileMime: string | null;
  fileUrl: string | null;
  fileStorageKey: string | null;
  requirementConfig: Record<string, unknown>;
};

/**
 * Find a submission for streaming, applying rules 1–3 IN THE QUERY so an
 * unshared, rejected, superseded or non-file id simply does not exist here.
 *
 * Deliberately returns only the event id and the file locator: the caller must
 * pass `requireMaterialsViewer` for that event before it is allowed to learn
 * anything else, including whether the file's type is servable.
 */
export async function findSharedMaterialFile(
  submissionId: string,
): Promise<SharedMaterialFile | null> {
  const row = await prisma.readinessSubmission.findFirst({
    where: { id: submissionId, ...SHARED_MATERIAL_WHERE },
    select: {
      eventId: true,
      fileName: true,
      fileMime: true,
      fileUrl: true,
      fileStorageKey: true,
      assignment: { select: { requirement: { select: { config: true } } } },
    },
  });
  if (!row || !hasStoredFile(row)) return null;
  // An organizer who switched Speaker Readiness off has withdrawn the whole
  // surface, links included — a disabled feature disappears cleanly rather
  // than leaving a URL that still streams.
  if (!(await featureEnabled(row.eventId, "readiness"))) return null;
  return {
    eventId: row.eventId,
    fileName: row.fileName,
    fileMime: row.fileMime,
    fileUrl: row.fileUrl,
    fileStorageKey: row.fileStorageKey,
    requirementConfig: (row.assignment.requirement.config ?? {}) as Record<string, unknown>,
  };
}

/**
 * The O10 allowlist, re-checked at read time rather than trusted from upload:
 * a requirement's `allowedMimeTypes` can be narrowed after a file has landed,
 * and this is the one readiness file route an anonymous visitor can reach.
 *
 * 415 with a plain reason, not a 404: the file is real and the caller is
 * allowed to know it exists — it is the type that cannot be handed out, and
 * the organizer is the one who can fix that.
 */
export function assertMaterialMimeAllowed(file: SharedMaterialFile): string {
  const { allowedMimeTypes } = fileRulesForRequirement(file.requirementConfig);
  const mime = (file.fileMime || "").trim().toLowerCase();
  if (!mime || !allowedMimeTypes.includes(mime)) {
    throw new HttpError(415, {
      error:
        "This file's type is not one this event can hand out. Ask the organizer to upload it as a PDF, PowerPoint, Word file, or image.",
      reason: "wrong_type",
    });
  }
  return mime;
}
