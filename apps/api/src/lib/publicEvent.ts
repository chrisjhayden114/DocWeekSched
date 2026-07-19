/**
 * Side-effect-free public event payload for SSR / unfurls.
 * Does NOT increment slugInviteUseCount.
 */

import { SessionPublishStatus, type EventStatus } from "@prisma/client";
import { can } from "./billing/entitlements";
import { prisma } from "./db";
import { featureEnabled } from "./features/featureEnabled";
import { isSlugLinkActive } from "./inviteTokens";
import { isPubliclyJoinable } from "./eventStatus";

export type PublicEventPayload = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
  venueName: string | null;
  venueAddress: string | null;
  onlineUrl: string | null;
  showPoweredByBadge: boolean;
  sessions: Array<{
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    startsAt: string;
    endsAt: string;
    trackName: string | null;
    roomName: string | null;
    speakers: Array<{ id: string; name: string; title: string | null; affiliation: string | null }>;
    items: Array<{
      id: string;
      title: string;
      abstract: string | null;
      sortOrder: number;
      authors: Array<{ name: string; isPresenter: boolean; sortOrder: number }>;
    }>;
  }>;
  speakers: Array<{
    id: string;
    name: string;
    title: string | null;
    affiliation: string | null;
    bio: string | null;
    photoUrl: string | null;
    sortOrder: number;
  }>;
  sponsors: Array<{
    id: string;
    name: string;
    logoUrl: string | null;
    url: string | null;
    tier: string;
    sortOrder: number;
    boothLabel: string | null;
    description: string | null;
  }>;
};

function slugOk(raw: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw);
}

/**
 * Load a published, slug-linkable event for public SSR.
 * Returns null when not found / not public (caller should 404).
 */
export async function getPublicEventBySlug(slugRaw: string): Promise<PublicEventPayload | null> {
  const slug = String(slugRaw || "").trim().toLowerCase();
  if (!slug || !slugOk(slug)) return null;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      bannerUrl: true,
      logoUrl: true,
      brandColor: true,
      timezone: true,
      startDate: true,
      endDate: true,
      venueName: true,
      venueAddress: true,
      onlineUrl: true,
      status: true,
      organizationId: true,
      slugInviteEnabled: true,
      slugInviteExpiresAt: true,
      slugInviteCapacity: true,
      slugInviteUseCount: true,
    },
  });

  if (!event || !isPubliclyJoinable(event.status as EventStatus) || !isSlugLinkActive(event)) {
    return null;
  }

  const [hideBadge, sponsorsOn, sessions, speakers, sponsors] = await Promise.all([
    can(event.organizationId, "hide_powered_by_badge"),
    featureEnabled(event.id, "sponsors"),
    prisma.session.findMany({
      where: { eventId: event.id, publishStatus: SessionPublishStatus.PUBLISHED },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        startsAt: true,
        endsAt: true,
        track: { select: { name: true } },
        room: { select: { name: true } },
        sessionSpeakers: {
          orderBy: { sortOrder: "asc" },
          select: {
            speaker: {
              select: { id: true, name: true, title: true, affiliation: true },
            },
          },
        },
        items: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            title: true,
            abstract: true,
            sortOrder: true,
            authors: {
              orderBy: { sortOrder: "asc" },
              select: { name: true, isPresenter: true, sortOrder: true },
            },
          },
        },
      },
    }),
    prisma.speaker.findMany({
      where: { eventId: event.id },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        title: true,
        affiliation: true,
        bio: true,
        photoUrl: true,
        sortOrder: true,
      },
    }),
    sponsorsOn
      ? prisma.sponsor.findMany({
          where: { eventId: event.id },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            logoUrl: true,
            url: true,
            tier: true,
            sortOrder: true,
            boothLabel: true,
            description: true,
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    id: event.id,
    name: event.name,
    slug: event.slug,
    description: event.description,
    bannerUrl: event.bannerUrl,
    logoUrl: event.logoUrl,
    brandColor: event.brandColor,
    timezone: event.timezone,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    onlineUrl: event.onlineUrl,
    showPoweredByBadge: !hideBadge,
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      location: s.location ?? s.room?.name ?? null,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      trackName: s.track?.name ?? null,
      roomName: s.room?.name ?? null,
      speakers: s.sessionSpeakers.map((ss) => ({
        id: ss.speaker.id,
        name: ss.speaker.name,
        title: ss.speaker.title,
        affiliation: ss.speaker.affiliation,
      })),
      items: s.items.map((it) => ({
        id: it.id,
        title: it.title,
        abstract: it.abstract,
        sortOrder: it.sortOrder,
        authors: it.authors.map((a) => ({
          name: a.name,
          isPresenter: a.isPresenter,
          sortOrder: a.sortOrder,
        })),
      })),
    })),
    speakers: speakers.map((sp) => ({
      id: sp.id,
      name: sp.name,
      title: sp.title,
      affiliation: sp.affiliation,
      bio: sp.bio,
      photoUrl: sp.photoUrl,
      sortOrder: sp.sortOrder,
    })),
    sponsors: sponsors.map((sp) => ({
      id: sp.id,
      name: sp.name,
      logoUrl: sp.logoUrl,
      url: sp.url,
      tier: sp.tier,
      sortOrder: sp.sortOrder,
      boothLabel: sp.boothLabel,
      description: sp.description,
    })),
  };
}
