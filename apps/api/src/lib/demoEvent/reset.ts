/**
 * Idempotent wipe/recreate of the public demo event under the INTERNAL founder org.
 */

import { brand } from "@event-app/config";
import {
  EventMemberRole,
  EventStatus,
  OrgRole,
  PlanTier,
  BillingProvider,
  SubscriptionStatus,
  SessionPublishStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { assertDestructiveAllowed } from "../destructiveGuard";
import { upsertFeatureOverrides } from "../features/featureEnabled";
import { newJoinToken } from "../inviteTokens";
import { buildDemoFixtureSpec, demoConferenceWindow } from "./fixture";

export const DEMO_RESET_JOB = "demo.event.reset";

let cachedDemoEventId: string | null | undefined;

export function clearDemoEventIdCache(): void {
  cachedDemoEventId = undefined;
}

export async function getDemoEventId(): Promise<string | null> {
  if (cachedDemoEventId !== undefined) return cachedDemoEventId;
  const row = await prisma.event.findUnique({
    where: { slug: brand.demoEventSlug },
    select: { id: true },
  });
  cachedDemoEventId = row?.id ?? null;
  return cachedDemoEventId;
}

export async function ensureInternalDemoOrg(): Promise<{ id: string }> {
  const existing = await prisma.organization.findUnique({
    where: { slug: brand.internalOrgSlug },
  });
  if (existing) {
    if (existing.plan !== PlanTier.INTERNAL) {
      return prisma.organization.update({
        where: { id: existing.id },
        data: {
          plan: PlanTier.INTERNAL,
          billingProvider: BillingProvider.INTERNAL,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          eventAllowance: null,
          name: brand.internalOrgName,
        },
      });
    }
    return existing;
  }
  return prisma.organization.create({
    data: {
      name: brand.internalOrgName,
      slug: brand.internalOrgSlug,
      plan: PlanTier.INTERNAL,
      billingProvider: BillingProvider.INTERNAL,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      eventAllowance: null,
    },
  });
}

async function wipeEventChildren(eventId: string): Promise<void> {
  await prisma.sessionItemAuthor.deleteMany({
    where: { sessionItem: { session: { eventId } } },
  });
  await prisma.sessionItem.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionSpeaker.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionResource.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionBookmark.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionAttendance.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionLike.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionDiscussionReply.deleteMany({
    where: { thread: { session: { eventId } } },
  });
  await prisma.sessionDiscussionUpvote.deleteMany({
    where: { thread: { session: { eventId } } },
  });
  await prisma.sessionDiscussionThread.deleteMany({ where: { session: { eventId } } });
  await prisma.session.deleteMany({ where: { eventId } });
  await prisma.speaker.deleteMany({ where: { eventId } });
  await prisma.sponsorLead.deleteMany({ where: { sponsor: { eventId } } });
  await prisma.sponsor.deleteMany({ where: { eventId } });
  await prisma.track.deleteMany({ where: { eventId } });
  await prisma.room.deleteMany({ where: { eventId } });
  await prisma.networkReply.deleteMany({ where: { thread: { eventId } } });
  await prisma.networkThread.deleteMany({ where: { eventId } });
  await prisma.announcement.deleteMany({ where: { eventId } });
  await prisma.checkIn.deleteMany({ where: { eventId } });
  await prisma.eventMembership.deleteMany({ where: { eventId } });
}

function sessionWallTime(anchor: Date, dayOffset: number, startMinute: number): Date {
  const d = new Date(anchor);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(16, 0, 0, 0); // ~09:00 America/Los_Angeles during PDT
  d.setUTCMinutes(d.getUTCMinutes() + startMinute);
  return d;
}

/**
 * Idempotent: ensures INTERNAL org + ACTIVE demo event with realistic fixture.
 * Safe to run nightly; does not send invite emails.
 */
export async function resetPublicDemoEvent(): Promise<{ eventId: string; slug: string; created: boolean }> {
  // Legitimate in production (nightly job); the guard stops dev/test processes
  // pointed at the production Neon URL from wiping the demo event's children.
  assertDestructiveAllowed("demo-reset");
  const org = await ensureInternalDemoOrg();
  const spec = buildDemoFixtureSpec("public_demo");
  const { start, end } = demoConferenceWindow();
  const { hash: joinHash } = newJoinToken();

  let event = await prisma.event.findUnique({ where: { slug: brand.demoEventSlug } });
  let created = false;

  // Second safety condition (independent of slug reservation): never wipe an
  // event that is not the internal org's. If a non-internal event somehow holds
  // the demo slug, refuse loudly instead of destroying it.
  if (event && event.organizationId !== org.id) {
    throw new Error(
      `Refusing demo reset: event holding slug "${brand.demoEventSlug}" (id ${event.id}) ` +
        `does not belong to the internal org "${brand.internalOrgSlug}".`,
    );
  }

  if (!event) {
    created = true;
    event = await prisma.event.create({
      data: {
        name: spec.name,
        slug: brand.demoEventSlug,
        description: spec.description,
        venueName: spec.venueName,
        venueAddress: spec.venueAddress,
        timezone: spec.timezone,
        startDate: start,
        endDate: end,
        status: EventStatus.ACTIVE,
        activatedAt: new Date(),
        organizationId: org.id,
        slugInviteEnabled: true,
        joinTokenHash: joinHash,
        attendeeCap: 10_000,
      },
    });
  } else {
    await wipeEventChildren(event.id);
    event = await prisma.event.update({
      where: { id: event.id },
      data: {
        name: spec.name,
        description: spec.description,
        venueName: spec.venueName,
        venueAddress: spec.venueAddress,
        timezone: spec.timezone,
        startDate: start,
        endDate: end,
        status: EventStatus.ACTIVE,
        activatedAt: event.activatedAt ?? new Date(),
        organizationId: org.id,
        slugInviteEnabled: true,
        joinTokenRevokedAt: null,
      },
    });
  }

  await upsertFeatureOverrides(event.id, {
    sponsors: true,
    community: false,
    messaging_dms: false,
    messaging_groups: false,
    messaging_event_chat: false,
  });

  const tracks = [];
  for (let i = 0; i < spec.tracks.length; i++) {
    const t = spec.tracks[i]!;
    tracks.push(
      await prisma.track.create({
        data: { eventId: event.id, name: t.name, color: t.color ?? "#0033A0", sortOrder: i },
      }),
    );
  }

  const speakerByKey = new Map<string, string>();
  for (let i = 0; i < spec.speakers.length; i++) {
    const s = spec.speakers[i]!;
    const row = await prisma.speaker.create({
      data: {
        eventId: event.id,
        name: s.name,
        title: s.title,
        affiliation: s.affiliation,
        bio: s.bio,
        sortOrder: i,
      },
    });
    speakerByKey.set(s.key, row.id);
  }

  for (const sp of spec.sponsors) {
    await prisma.sponsor.create({
      data: {
        eventId: event.id,
        name: sp.name,
        tier: sp.tier,
        url: sp.url,
        description: sp.description,
        sortOrder: sp.sortOrder,
      },
    });
  }

  for (const sess of spec.sessions) {
    const startsAt = sessionWallTime(start, sess.dayOffset, sess.startMinute);
    const endsAt = new Date(startsAt.getTime() + sess.durationMinutes * 60_000);
    const track = tracks[sess.trackIndex];
    const createdSession = await prisma.session.create({
      data: {
        eventId: event.id,
        title: sess.title,
        description: sess.description,
        trackId: track?.id ?? null,
        startsAt,
        endsAt,
        publishStatus: SessionPublishStatus.PUBLISHED,
        speakers: sess.speakerKeys
          .map((k) => spec.speakers.find((s) => s.key === k)?.name)
          .filter(Boolean)
          .join(", "),
        sessionSpeakers: {
          create: sess.speakerKeys
            .map((k, idx) => {
              const id = speakerByKey.get(k);
              return id ? { speakerId: id, sortOrder: idx } : null;
            })
            .filter((x): x is { speakerId: string; sortOrder: number } => Boolean(x)),
        },
      },
    });

    if (sess.items?.length) {
      for (let i = 0; i < sess.items.length; i++) {
        const item = sess.items[i]!;
        await prisma.sessionItem.create({
          data: {
            sessionId: createdSession.id,
            title: item.title,
            abstract: item.abstract,
            sortOrder: i,
            authors: {
              create: item.authors.map((a, j) => ({
                name: a.name,
                isPresenter: Boolean(a.isPresenter),
                sortOrder: j,
              })),
            },
          },
        });
      }
    }
  }

  clearDemoEventIdCache();
  return { eventId: event.id, slug: brand.demoEventSlug, created };
}

/**
 * Create a DRAFT sample event in a customer org from the same fixture shape.
 * Caller must have already passed assertCanCreateEvent.
 */
export async function createSampleEventForOrg(input: {
  organizationId: string;
  actorUserId: string;
}): Promise<{ eventId: string; slug: string }> {
  const spec = buildDemoFixtureSpec("sample_draft");
  const { start, end } = demoConferenceWindow();
  const { hash: joinHash } = newJoinToken();
  const slugBase = `sample-${Date.now().toString(36)}`;

  const series = await prisma.eventSeries.create({
    data: {
      organizationId: input.organizationId,
      name: spec.name,
      slug: `${slugBase}-series`.slice(0, 72),
      setupChecklist: [
        { key: "create_event", label: "Create event", done: true },
        { key: "add_sessions", label: "Add sessions", done: true },
        { key: "invite_attendees", label: "Invite attendees", done: false },
        { key: "publish", label: "Publish", done: false },
      ],
    },
  });

  const event = await prisma.event.create({
    data: {
      name: spec.name,
      slug: slugBase,
      description: spec.description,
      venueName: spec.venueName,
      venueAddress: spec.venueAddress,
      timezone: spec.timezone,
      startDate: start,
      endDate: end,
      status: EventStatus.DRAFT,
      organizationId: input.organizationId,
      seriesId: series.id,
      createdById: input.actorUserId,
      joinTokenHash: joinHash,
      attendeeCap: 100,
      memberships: {
        create: { userId: input.actorUserId, role: EventMemberRole.ADMIN },
      },
    },
  });

  await upsertFeatureOverrides(event.id, { sponsors: true });

  const tracks = [];
  for (let i = 0; i < spec.tracks.length; i++) {
    const t = spec.tracks[i]!;
    tracks.push(
      await prisma.track.create({
        data: { eventId: event.id, name: t.name, color: t.color ?? "#0033A0", sortOrder: i },
      }),
    );
  }

  const speakerByKey = new Map<string, string>();
  for (let i = 0; i < spec.speakers.length; i++) {
    const s = spec.speakers[i]!;
    const row = await prisma.speaker.create({
      data: {
        eventId: event.id,
        name: s.name,
        title: s.title,
        affiliation: s.affiliation,
        bio: s.bio,
        sortOrder: i,
      },
    });
    speakerByKey.set(s.key, row.id);
  }

  for (const sp of spec.sponsors) {
    await prisma.sponsor.create({
      data: {
        eventId: event.id,
        name: sp.name,
        tier: sp.tier,
        url: sp.url,
        description: sp.description,
        sortOrder: sp.sortOrder,
      },
    });
  }

  for (const sess of spec.sessions) {
    const startsAt = sessionWallTime(start, sess.dayOffset, sess.startMinute);
    const endsAt = new Date(startsAt.getTime() + sess.durationMinutes * 60_000);
    const track = tracks[sess.trackIndex];
    const createdSession = await prisma.session.create({
      data: {
        eventId: event.id,
        title: sess.title,
        description: sess.description,
        trackId: track?.id ?? null,
        startsAt,
        endsAt,
        publishStatus: SessionPublishStatus.PUBLISHED,
        speakers: sess.speakerKeys
          .map((k) => spec.speakers.find((s) => s.key === k)?.name)
          .filter(Boolean)
          .join(", "),
        sessionSpeakers: {
          create: sess.speakerKeys
            .map((k, idx) => {
              const id = speakerByKey.get(k);
              return id ? { speakerId: id, sortOrder: idx } : null;
            })
            .filter((x): x is { speakerId: string; sortOrder: number } => Boolean(x)),
        },
      },
    });
    if (sess.items?.length) {
      for (let i = 0; i < sess.items.length; i++) {
        const item = sess.items[i]!;
        await prisma.sessionItem.create({
          data: {
            sessionId: createdSession.id,
            title: item.title,
            abstract: item.abstract,
            sortOrder: i,
            authors: {
              create: item.authors.map((a, j) => ({
                name: a.name,
                isPresenter: Boolean(a.isPresenter),
                sortOrder: j,
              })),
            },
          },
        });
      }
    }
  }

  // Ensure founder-facing org membership exists for actor if they own the org
  const om = await prisma.orgMembership.findFirst({
    where: { organizationId: input.organizationId, userId: input.actorUserId },
  });
  if (!om) {
    await prisma.orgMembership.create({
      data: {
        organizationId: input.organizationId,
        userId: input.actorUserId,
        role: OrgRole.OWNER,
      },
    });
  }

  return { eventId: event.id, slug: event.slug };
}
