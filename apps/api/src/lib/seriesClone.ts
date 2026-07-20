import type { Prisma, PrismaClient } from "@prisma/client";
import { EventMemberRole, EventStatus } from "@prisma/client";
import { ensureUniqueEventSlug, slugifyEventBase } from "./slug";
import { newJoinToken } from "./inviteTokens";

type Tx = Prisma.TransactionClient | PrismaClient;

export type CloneNextEditionInput = {
  sourceEventId: string;
  organizationId: string;
  createdById: string;
  /** New edition name (defaults to source name + year). */
  name?: string;
  /** New start date; end/session times shift by the same delta from source start. */
  startDate: Date;
  endDate?: Date;
  timezone?: string;
  slug?: string;
};

export type CloneNextEditionResult = {
  seriesId: string;
  eventId: string;
  joinToken: string;
  checklist: unknown;
};

const DEFAULT_CHECKLIST = [
  { key: "review_tracks", label: "Review tracks", done: false },
  { key: "review_rooms", label: "Confirm rooms / venues", done: false },
  { key: "review_speakers", label: "Update speaker roster", done: false },
  { key: "shift_dates", label: "Verify session times", done: false },
  { key: "invite_attendees", label: "Invite attendees", done: false },
  { key: "publish", label: "Publish when ready", done: false },
];

/**
 * Clone event structure into a new DRAFT edition under an EventSeries.
 * Copies tracks, rooms, speakers, sessions, session speakers, items/authors.
 * Does NOT copy attendees, memberships (except creator ADMIN), check-ins, or messages.
 */
export async function cloneNextEdition(
  prisma: PrismaClient,
  input: CloneNextEditionInput,
): Promise<CloneNextEditionResult> {
  const source = await prisma.event.findUniqueOrThrow({
    where: { id: input.sourceEventId },
    include: {
      tracks: { orderBy: { sortOrder: "asc" } },
      rooms: { orderBy: { sortOrder: "asc" } },
      speakersRoster: { orderBy: { sortOrder: "asc" } },
      sessions: {
        orderBy: { startsAt: "asc" },
        include: {
          sessionSpeakers: { orderBy: { sortOrder: "asc" } },
          items: {
            orderBy: { sortOrder: "asc" },
            include: { authors: { orderBy: { sortOrder: "asc" } } },
          },
        },
      },
      series: true,
    },
  });

  if (source.organizationId !== input.organizationId) {
    throw new Error("Source event is not in this organization");
  }

  const deltaMs = input.startDate.getTime() - source.startDate.getTime();
  const endDate =
    input.endDate ??
    new Date(source.endDate.getTime() + deltaMs);
  const name =
    input.name?.trim() ||
    `${source.name.replace(/\s+\d{4}\s*$/, "").trim()} ${input.startDate.getUTCFullYear()}`;
  const slugBase = input.slug?.trim() || slugifyEventBase(name);
  const slug = await ensureUniqueEventSlug(slugBase);
  const { raw: joinRaw, hash: joinHash } = newJoinToken();

  return prisma.$transaction(async (tx) => {
    let seriesId = source.seriesId;
    let checklist: unknown = DEFAULT_CHECKLIST;

    if (seriesId && source.series) {
      checklist = source.series.setupChecklist ?? DEFAULT_CHECKLIST;
      // Reset checklist done flags for the new edition
      if (Array.isArray(checklist)) {
        checklist = (checklist as { key: string; label: string; done?: boolean }[]).map((c) => ({
          ...c,
          done: false,
        }));
      }
      await tx.eventSeries.update({
        where: { id: seriesId },
        data: { setupChecklist: checklist as Prisma.InputJsonValue },
      });
    } else {
      const seriesSlug = await uniqueSeriesSlug(tx, input.organizationId, slugifyEventBase(source.name));
      const series = await tx.eventSeries.create({
        data: {
          organizationId: input.organizationId,
          name: source.name.replace(/\s+\d{4}\s*$/, "").trim() || source.name,
          slug: seriesSlug,
          setupChecklist: DEFAULT_CHECKLIST,
        },
      });
      seriesId = series.id;
      checklist = DEFAULT_CHECKLIST;
      await tx.event.update({
        where: { id: source.id },
        data: { seriesId },
      });
    }

    const created = await tx.event.create({
      data: {
        name,
        slug,
        description: source.description,
        venueName: source.venueName,
        venueAddress: source.venueAddress,
        onlineUrl: source.onlineUrl,
        brandColor: source.brandColor,
        bannerUrl: source.bannerUrl,
        logoUrl: source.logoUrl,
        timezone: input.timezone || source.timezone,
        startDate: input.startDate,
        endDate,
        status: EventStatus.DRAFT,
        organizationId: input.organizationId,
        seriesId,
        createdById: input.createdById,
        joinTokenHash: joinHash,
        memberships: {
          create: { userId: input.createdById, role: EventMemberRole.ADMIN },
        },
      },
    });

    const trackMap = new Map<string, string>();
    for (const t of source.tracks) {
      const nt = await tx.track.create({
        data: {
          eventId: created.id,
          name: t.name,
          color: t.color,
          sortOrder: t.sortOrder,
        },
      });
      trackMap.set(t.id, nt.id);
    }

    const roomMap = new Map<string, string>();
    for (const r of source.rooms) {
      const nr = await tx.room.create({
        data: {
          eventId: created.id,
          name: r.name,
          sortOrder: r.sortOrder,
        },
      });
      roomMap.set(r.id, nr.id);
    }

    const speakerMap = new Map<string, string>();
    for (const s of source.speakersRoster) {
      const ns = await tx.speaker.create({
        data: {
          eventId: created.id,
          name: s.name,
          title: s.title,
          affiliation: s.affiliation,
          bio: s.bio,
          photoUrl: s.photoUrl,
          sortOrder: s.sortOrder,
        },
      });
      speakerMap.set(s.id, ns.id);
    }

    for (const sess of source.sessions) {
      const ns = await tx.session.create({
        data: {
          eventId: created.id,
          title: sess.title,
          description: sess.description,
          location: sess.location,
          speakers: sess.speakers,
          imageUrl: sess.imageUrl,
          zoomLink: sess.zoomLink,
          allowVirtualJoin: sess.allowVirtualJoin,
          startsAt: new Date(sess.startsAt.getTime() + deltaMs),
          endsAt: new Date(sess.endsAt.getTime() + deltaMs),
          trackId: sess.trackId ? trackMap.get(sess.trackId) ?? null : null,
          roomId: sess.roomId ? roomMap.get(sess.roomId) ?? null : null,
        },
      });

      for (const ss of sess.sessionSpeakers) {
        const newSpeakerId = speakerMap.get(ss.speakerId);
        if (!newSpeakerId) continue;
        await tx.sessionSpeaker.create({
          data: {
            sessionId: ns.id,
            speakerId: newSpeakerId,
            sortOrder: ss.sortOrder,
          },
        });
      }

      for (const item of sess.items) {
        const ni = await tx.sessionItem.create({
          data: {
            sessionId: ns.id,
            title: item.title,
            abstract: item.abstract,
            sortOrder: item.sortOrder,
            discussantName: item.discussantName,
            discussantSpeakerId: item.discussantSpeakerId
              ? speakerMap.get(item.discussantSpeakerId) ?? null
              : null,
          },
        });
        for (const author of item.authors) {
          await tx.sessionItemAuthor.create({
            data: {
              sessionItemId: ni.id,
              name: author.name,
              isPresenter: author.isPresenter,
              sortOrder: author.sortOrder,
              speakerId: author.speakerId ? speakerMap.get(author.speakerId) ?? null : null,
            },
          });
        }
      }
    }

    return {
      seriesId: seriesId!,
      eventId: created.id,
      joinToken: joinRaw,
      checklist,
    };
  });
}

async function uniqueSeriesSlug(tx: Tx, organizationId: string, base: string): Promise<string> {
  const root = (base || "series").slice(0, 48);
  for (let n = 0; n < 100; n += 1) {
    const slug = n === 0 ? root : `${root}-${n}`;
    const found = await tx.eventSeries.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
    });
    if (!found) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}
