import {
  SessionPublishStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { zonedWallTimeToUtc } from "../../notifications/timezone";
import type { ChangesetRow } from "./changeset";
import type { ExtractedItem, ExtractedSession } from "./schema";
import { normalizeTitle } from "./schema";
import { writeAuditLog } from "../audit";

export type ConfirmResult = {
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  speakerCount: number;
  itemCount: number;
  sessionIds: string[];
};

function parseHm(t: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return { h: 9, m: 0 };
  return { h: Number(m[1]), m: Number(m[2]) };
}

function parseYmd(date: string): { y: number; mo: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
  if (!m) throw new Error(`Invalid date: ${date}`);
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function sessionBounds(session: ExtractedSession, timezone: string): { startsAt: Date; endsAt: Date } {
  const { y, mo, d } = parseYmd(session.date);
  const start = parseHm(session.startTime);
  const startsAt = zonedWallTimeToUtc(timezone, y, mo, d, start.h, start.m);
  let endsAt: Date;
  if (session.endTime) {
    const end = parseHm(session.endTime);
    endsAt = zonedWallTimeToUtc(timezone, y, mo, d, end.h, end.m);
    if (endsAt <= startsAt) {
      endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    }
  } else {
    endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  }
  return { startsAt, endsAt };
}

async function ensureTrack(
  prisma: PrismaClient,
  eventId: string,
  name: string | undefined,
): Promise<string | null> {
  const n = name?.trim();
  if (!n) return null;
  const existing = await prisma.track.findUnique({
    where: { eventId_name: { eventId, name: n } },
  });
  if (existing) return existing.id;
  const created = await prisma.track.create({
    data: { eventId, name: n, color: "#0033A0", sortOrder: 0 },
  });
  return created.id;
}

async function ensureRoom(
  prisma: PrismaClient,
  eventId: string,
  name: string | undefined,
): Promise<string | null> {
  const n = name?.trim();
  if (!n) return null;
  const existing = await prisma.room.findUnique({
    where: { eventId_name: { eventId, name: n } },
  });
  if (existing) return existing.id;
  const created = await prisma.room.create({
    data: { eventId, name: n, sortOrder: 0 },
  });
  return created.id;
}

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

async function writeItemAuthors(
  prisma: PrismaClient,
  sessionItemId: string,
  eventId: string,
  item: ExtractedItem,
  speakerCache: Map<string, string>,
): Promise<void> {
  for (let a = 0; a < item.authors.length; a += 1) {
    const authorName = item.authors[a];
    const speakerId = await ensureSpeaker(prisma, eventId, authorName, speakerCache);
    await prisma.sessionItemAuthor.create({
      data: {
        sessionItemId,
        speakerId,
        name: authorName,
        sortOrder: a,
        isPresenter: item.presenterIndex === a,
      },
    });
  }
}

async function createSessionItem(
  prisma: PrismaClient,
  sessionId: string,
  eventId: string,
  item: ExtractedItem,
  sortOrder: number,
  speakerCache: Map<string, string>,
): Promise<void> {
  const created = await prisma.sessionItem.create({
    data: {
      sessionId,
      title: item.title,
      sortOrder,
      discussantName: item.discussant || null,
    },
  });
  await writeItemAuthors(prisma, created.id, eventId, item, speakerCache);
}

async function writeSessionItems(
  prisma: PrismaClient,
  sessionId: string,
  eventId: string,
  session: ExtractedSession,
  speakerCache: Map<string, string>,
): Promise<number> {
  if (!session.items?.length) return 0;
  for (let i = 0; i < session.items.length; i += 1) {
    await createSessionItem(prisma, sessionId, eventId, session.items[i], i, speakerCache);
  }
  return session.items.length;
}

async function linkSessionSpeakers(
  prisma: PrismaClient,
  sessionId: string,
  eventId: string,
  names: string[],
  speakerCache: Map<string, string>,
): Promise<number> {
  let n = 0;
  for (let i = 0; i < names.length; i += 1) {
    const speakerId = await ensureSpeaker(prisma, eventId, names[i], speakerCache);
    await prisma.sessionSpeaker.create({
      data: { sessionId, speakerId, sortOrder: i },
    });
    n += 1;
  }
  return n;
}

/**
 * Apply accepted changeset rows. Creates/updates as DRAFT only — never PUBLISHED.
 */
export async function confirmAgendaChangeset(input: {
  prisma: PrismaClient;
  organizationId: string;
  eventId: string;
  timezone: string;
  actorUserId?: string | null;
  runId: string;
  rows: ChangesetRow[];
}): Promise<ConfirmResult> {
  const accepted = input.rows.filter((r) => {
    if (r.kind === "delete") return r.accepted === true;
    if (r.kind === "create" || r.kind === "update") return r.accepted !== false;
    return false;
  });

  const result: ConfirmResult = {
    createdCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    speakerCount: 0,
    itemCount: 0,
    sessionIds: [],
  };
  const speakerCache = new Map<string, string>();

  for (const row of accepted) {
    if (row.kind === "delete") {
      // Scoped to the event: the changeset can arrive from the client, so a
      // sessionId belonging to another event must be a no-op.
      const deleted = await input.prisma.session.deleteMany({
        where: { id: row.sessionId, eventId: input.eventId },
      });
      result.deletedCount += deleted.count;
      continue;
    }

    const trackId = await ensureTrack(input.prisma, input.eventId, row.session.track);
    const roomId = await ensureRoom(input.prisma, input.eventId, row.session.room);
    const { startsAt, endsAt } = sessionBounds(row.session, input.timezone);
    const speakersText = row.session.speakers.join(", ") || null;

    if (row.kind === "create") {
      const created = await input.prisma.session.create({
        data: {
          eventId: input.eventId,
          title: row.session.title,
          description: row.session.description || null,
          location: row.session.room || null,
          speakers: speakersText,
          trackId,
          roomId,
          startsAt,
          endsAt,
          publishStatus: SessionPublishStatus.DRAFT,
        },
      });
      result.createdCount += 1;
      result.sessionIds.push(created.id);
      result.speakerCount += await linkSessionSpeakers(
        input.prisma,
        created.id,
        input.eventId,
        row.session.speakers,
        speakerCache,
      );
      result.itemCount += await writeSessionItems(
        input.prisma,
        created.id,
        input.eventId,
        row.session,
        speakerCache,
      );
    } else {
      // E13.3: reconcile instead of blind-replacing. Update what the source
      // covers, add what it introduces, and delete ONLY children whose
      // removal the organiser explicitly ticked. Hand-entered speakers and
      // papers the source does not mention survive untouched.
      const sessionId = row.sessionId;
      const existing = await input.prisma.session.findFirst({
        where: { id: sessionId, eventId: input.eventId },
        select: { id: true, speakers: true },
      });
      if (!existing) continue; // Not this event's session — ignore the row.

      const tickedSpeakerIds = (row.speakerRemovals || [])
        .filter((r) => r.accepted === true)
        .map((r) => r.speakerId);
      if (tickedSpeakerIds.length) {
        await input.prisma.sessionSpeaker.deleteMany({
          where: { sessionId, speakerId: { in: tickedSpeakerIds } },
        });
      }
      const tickedItemIds = (row.itemRemovals || [])
        .filter((r) => r.accepted === true)
        .map((r) => r.itemId);
      if (tickedItemIds.length) {
        await input.prisma.sessionItem.deleteMany({
          where: { sessionId, id: { in: tickedItemIds } },
        });
      }

      // Speakers: link extracted names that are not already linked.
      const links = await input.prisma.sessionSpeaker.findMany({
        where: { sessionId },
        orderBy: { sortOrder: "asc" },
        select: { speaker: { select: { name: true } } },
      });
      const linkedKeys = new Set(links.map((l) => normalizeTitle(l.speaker.name)));
      let nextSpeakerSort = links.length;
      for (const name of row.session.speakers) {
        const key = normalizeTitle(name);
        if (linkedKeys.has(key)) continue;
        const speakerId = await ensureSpeaker(input.prisma, input.eventId, name, speakerCache);
        await input.prisma.sessionSpeaker.create({
          data: { sessionId, speakerId, sortOrder: nextSpeakerSort++ },
        });
        linkedKeys.add(key);
        result.speakerCount += 1;
      }

      // The free-text speakers column merges rather than overwrites: names
      // the organiser typed stay unless their removal was ticked.
      const removedKeys = new Set(
        (row.speakerRemovals || [])
          .filter((r) => r.accepted === true)
          .map((r) => normalizeTitle(r.name)),
      );
      const textNames = (existing.speakers || "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        .filter((n) => !removedKeys.has(normalizeTitle(n)));
      const textKeys = new Set(textNames.map((n) => normalizeTitle(n)));
      for (const name of row.session.speakers) {
        if (textKeys.has(normalizeTitle(name))) continue;
        textNames.push(name.trim());
        textKeys.add(normalizeTitle(name));
      }
      const mergedSpeakersText = textNames.join(", ") || null;

      await input.prisma.session.update({
        where: { id: sessionId },
        data: {
          title: row.session.title,
          // Only overwrite fields the source actually provides — a missing
          // description/room in the import must not erase a hand-typed one.
          ...(row.session.description ? { description: row.session.description } : {}),
          ...(row.session.room ? { location: row.session.room } : {}),
          speakers: mergedSpeakersText,
          ...(trackId ? { trackId } : {}),
          ...(roomId ? { roomId } : {}),
          startsAt,
          endsAt,
          // Keep existing publishStatus on update — do not force PUBLISHED
        },
      });
      result.updatedCount += 1;
      result.sessionIds.push(sessionId);

      // Papers: match by normalized title. Matched items update in place
      // (authors rewritten only when the source names authors); unmatched
      // source items are created; unmatched existing items are left alone.
      const existingItems = await input.prisma.sessionItem.findMany({
        where: { sessionId },
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true },
      });
      const itemsByKey = new Map(existingItems.map((it) => [normalizeTitle(it.title), it]));
      let nextItemSort = existingItems.length;
      for (const item of row.session.items || []) {
        const match = itemsByKey.get(normalizeTitle(item.title));
        if (match) {
          await input.prisma.sessionItem.update({
            where: { id: match.id },
            data: {
              title: item.title,
              ...(item.discussant ? { discussantName: item.discussant } : {}),
            },
          });
          if (item.authors.length) {
            await input.prisma.sessionItemAuthor.deleteMany({
              where: { sessionItemId: match.id },
            });
            await writeItemAuthors(input.prisma, match.id, input.eventId, item, speakerCache);
          }
          result.itemCount += 1;
        } else {
          await createSessionItem(
            input.prisma,
            sessionId,
            input.eventId,
            item,
            nextItemSort++,
            speakerCache,
          );
          result.itemCount += 1;
        }
      }
    }
  }

  await writeAuditLog({
    organizationId: input.organizationId,
    eventId: input.eventId,
    actorUserId: input.actorUserId,
    action: "AI_DRAFT",
    entityType: "agenda_ingest_run",
    entityId: input.runId,
    aiGenerated: true,
    payload: {
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      deletedCount: result.deletedCount,
      speakerCount: result.speakerCount,
      itemCount: result.itemCount,
      publishStatus: "DRAFT",
    } as Prisma.InputJsonValue,
  });

  return result;
}
