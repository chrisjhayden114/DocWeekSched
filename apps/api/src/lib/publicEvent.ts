/**
 * Side-effect-free public event payload for SSR / unfurls.
 * Does NOT increment slugInviteUseCount.
 */

import { SessionPublishStatus, type EventStatus } from "@prisma/client";
import { eventLogoWithOrgFallback, hasFeeNotice, type FeeNotice } from "@event-app/shared";
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
  /**
   * ORG-1 — `logoUrl` is always the event's OWN logo (null when it never chose
   * one) and `displayLogoUrl` is always the one to render, falling back to the
   * organization's. The two are separate everywhere on purpose: an editable
   * form must never be handed the fallback, or the next save would stamp the
   * org's logo onto the event row (prefill-not-seed, BRAND-2).
   */
  logoUrl: string | null;
  displayLogoUrl: string | null;
  brandColor: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
  venueName: string | null;
  venueAddress: string | null;
  onlineUrl: string | null;
  /**
   * ORG-1 — hosting organization identity, and only the identity: who is
   * hosting and how to reach them. The org's description never reaches a public
   * page (there is no public org page — J-C: identity, not billboard).
   */
  organizationName: string;
  organizationWebsiteUrl: string | null;
  organizationSupportEmail: string | null;
  showPoweredByBadge: boolean;
  /**
   * PAY-T0: the organizer's own registration fee, or null when the
   * paid_attendance feature is off for this event. Informational only — this
   * phase adds no payment gate, and no attendee's payment status is ever
   * public.
   */
  payment: FeeNotice | null;
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
      paymentPriceText: true,
      paymentUrl: true,
      paymentInstructions: true,
      status: true,
      organizationId: true,
      organization: {
        select: { name: true, websiteUrl: true, supportEmail: true, logoUrl: true },
      },
      slugInviteEnabled: true,
      slugInviteExpiresAt: true,
      slugInviteCapacity: true,
      slugInviteUseCount: true,
    },
  });

  if (!event || !isPubliclyJoinable(event.status as EventStatus) || !isSlugLinkActive(event)) {
    return null;
  }

  const [hideBadge, sponsorsOn, paidAttendanceOn] = await Promise.all([
    can(event.organizationId, "hide_powered_by_badge"),
    featureEnabled(event.id, "sponsors"),
    featureEnabled(event.id, "paid_attendance"),
  ]);

  // PAY-T0: with the feature off, the fee columns never reach the public
  // payload at all — and with it on but nothing filled in, `payment` stays
  // null so the page renders no empty "how to pay" box.
  const feeNotice: FeeNotice = {
    priceText: event.paymentPriceText,
    url: event.paymentUrl,
    instructions: event.paymentInstructions,
  };
  const payment = paidAttendanceOn && hasFeeNotice(feeNotice) ? feeNotice : null;

  const [sessions, speakers, sponsors] = await Promise.all([
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
    displayLogoUrl: eventLogoWithOrgFallback(event.logoUrl, event.organization.logoUrl),
    brandColor: event.brandColor,
    timezone: event.timezone,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    onlineUrl: event.onlineUrl,
    organizationName: event.organization.name,
    organizationWebsiteUrl: event.organization.websiteUrl,
    organizationSupportEmail: event.organization.supportEmail,
    showPoweredByBadge: !hideBadge,
    payment,
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
