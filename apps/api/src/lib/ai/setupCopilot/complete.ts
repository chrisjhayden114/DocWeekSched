/**
 * Persist setup-copilot completion: draft event, skeleton sessions/tracks,
 * invite email draft, optional ice-breakers, feature config, onboarding checklist.
 */

import {
  EventMemberRole,
  EventStatus,
  NetworkChannel,
  SessionPublishStatus,
  type Prisma,
} from "@prisma/client";
import {
  AI_GENERATED_CHIP_LABEL,
  PHASE6_ONBOARDING_CHECKLIST,
  resolveFeatureEnabled,
  type SetupCopilotFormState,
} from "@event-app/shared";
import { prisma } from "../../db";
import { ensureUniqueEventSlug, slugifyEventBase } from "../../slug";
import { newJoinToken } from "../../inviteTokens";
import { zonedWallTimeToUtc } from "../../notifications/timezone";
import { limit } from "../../billing/entitlements";
import { writeAuditLog } from "../audit";
import { applyConfigureFeatures } from "./features";
import { buildSkeleton } from "./skeleton";

function parseHm(t: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return { h: 9, m: 0 };
  return { h: Number(m[1]), m: Number(m[2]) };
}

function addDaysYmd(ymd: string, offset: number): { y: number; mo: number; d: number } {
  const base = new Date(ymd.includes("T") ? ymd : `${ymd}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return { y: base.getUTCFullYear(), mo: base.getUTCMonth() + 1, d: base.getUTCDate() };
}

function toStartEndIso(form: SetupCopilotFormState): { start: Date; end: Date } {
  const startYmd = form.startDate.slice(0, 10);
  const endYmd = form.endDate.slice(0, 10);
  const start = new Date(`${startYmd}T09:00:00`);
  const end = new Date(`${endYmd}T17:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const now = new Date();
    const later = new Date(now.getTime() + 2 * 86_400_000);
    return { start: now, end: later };
  }
  return { start, end };
}

export type CompleteSetupResult = {
  eventId: string;
  slug: string;
  slugUrl: string;
  joinUrl: string;
  joinToken: string;
  sessionIds: string[];
  trackIds: string[];
  icebreakerIds: string[];
  announcementId: string | null;
  checklist: typeof PHASE6_ONBOARDING_CHECKLIST;
  handoffIngestPath: string | null;
  aiGenerated: true;
  skeleton: ReturnType<typeof buildSkeleton> | null;
};

export async function completeSetupCopilot(opts: {
  organizationId: string;
  actorUserId: string;
  form: SetupCopilotFormState;
  webBaseUrl: string;
}): Promise<CompleteSetupResult> {
  const { form, organizationId, actorUserId } = opts;
  if (!form.name.trim()) throw new Error("Event name is required");
  if (!form.startDate || !form.endDate) throw new Error("Event dates are required");

  const { start, end } = toStartEndIso(form);
  const slugBase = slugifyEventBase(form.name);
  const slug = await ensureUniqueEventSlug(slugBase);
  const { raw: joinRaw, hash: joinHash } = newJoinToken();
  const attendeeLimit = await limit(organizationId, "attendees");
  const attendeeCap = attendeeLimit == null ? 100000 : attendeeLimit;

  // Ensure series with Phase 6 onboarding checklist
  const seriesSlug = `${slug}-series`.slice(0, 72);
  const checklist = PHASE6_ONBOARDING_CHECKLIST.map((c) => ({
    ...c,
    done: c.key === "create_event" || c.key === "add_sessions",
  }));

  const series = await prisma.eventSeries.create({
    data: {
      organizationId,
      name: form.name.trim(),
      slug: `${seriesSlug}-${Date.now().toString(36)}`.slice(0, 72),
      setupChecklist: checklist as unknown as Prisma.InputJsonValue,
    },
  });

  const created = await prisma.event.create({
    data: {
      name: form.name.trim(),
      slug,
      description: form.estimatedSize
        ? `Estimated size: ~${form.estimatedSize} attendees. ${AI_GENERATED_CHIP_LABEL}`
        : `Created with Setup Copilot. ${AI_GENERATED_CHIP_LABEL}`,
      venueName: form.venueName.trim() || null,
      venueAddress: form.venueAddress.trim() || null,
      onlineUrl: form.onlineUrl.trim() || null,
      timezone: form.timezone || "UTC",
      startDate: start,
      endDate: end,
      status: EventStatus.DRAFT,
      createdById: actorUserId,
      organizationId,
      seriesId: series.id,
      attendeeCap,
      joinTokenHash: joinHash,
      memberships: {
        create: { userId: actorUserId, role: EventMemberRole.ADMIN },
      },
    },
  });

  if (Object.keys(form.featureOverrides).length > 0) {
    await applyConfigureFeatures({
      eventId: created.id,
      organizationId,
      actorUserId,
      overrides: form.featureOverrides,
      liveEvent: false,
      diffSummary: "Applied during Setup Copilot completion",
    });
  }

  const iceOn = resolveFeatureEnabled("community_icebreakers", form.featureOverrides);
  const wantsSkeleton = form.hasProgramDocument !== true;
  const skeleton = wantsSkeleton ? buildSkeleton(form, iceOn) : null;

  const trackIds: string[] = [];
  const sessionIds: string[] = [];
  const icebreakerIds: string[] = [];
  let announcementId: string | null = null;

  if (skeleton) {
    const trackIdByName = new Map<string, string>();
    for (const [i, t] of skeleton.tracks.entries()) {
      const row = await prisma.track.create({
        data: {
          eventId: created.id,
          name: t.name,
          color: t.color,
          sortOrder: i,
        },
      });
      trackIds.push(row.id);
      trackIdByName.set(t.name, row.id);
    }

    const startYmd = form.startDate.slice(0, 10);
    for (const s of skeleton.sessions) {
      const { y, mo, d } = addDaysYmd(startYmd, s.dayOffset);
      const sh = parseHm(s.startHm);
      const eh = parseHm(s.endHm);
      const startsAt = zonedWallTimeToUtc(form.timezone, y, mo, d, sh.h, sh.m);
      let endsAt = zonedWallTimeToUtc(form.timezone, y, mo, d, eh.h, eh.m);
      if (endsAt <= startsAt) endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
      const row = await prisma.session.create({
        data: {
          eventId: created.id,
          title: s.title,
          description: s.description,
          startsAt,
          endsAt,
          publishStatus: SessionPublishStatus.DRAFT,
          trackId: trackIds[0] || null,
        },
      });
      sessionIds.push(row.id);
    }

    const ann = await prisma.announcement.create({
      data: {
        eventId: created.id,
        title: skeleton.inviteEmail.subject,
        body: skeleton.inviteEmail.body,
        createdById: actorUserId,
        isPreview: true,
        publishedAt: null,
      },
    });
    announcementId = ann.id;

    if (iceOn) {
      for (const ice of skeleton.icebreakers) {
        const thread = await prisma.networkThread.create({
          data: {
            eventId: created.id,
            authorId: actorUserId,
            channel: NetworkChannel.ICEBREAKER,
            title: ice.title,
            body: ice.body,
          },
        });
        icebreakerIds.push(thread.id);
      }
    }
  } else {
    // Document path: still check create_event; sessions come from A1
    await prisma.eventSeries.update({
      where: { id: series.id },
      data: {
        setupChecklist: PHASE6_ONBOARDING_CHECKLIST.map((c) => ({
          ...c,
          done: c.key === "create_event",
        })) as unknown as Prisma.InputJsonValue,
      },
    });
    checklist.forEach((c) => {
      c.done = c.key === "create_event";
    });
  }

  await writeAuditLog({
    organizationId,
    eventId: created.id,
    actorUserId,
    action: "AI_DRAFT",
    entityType: "setup_copilot_complete",
    entityId: created.id,
    aiGenerated: true,
    payload: {
      form: {
        name: form.name,
        eventType: form.eventType,
        hasProgramDocument: form.hasProgramDocument,
        networkingChoice: form.networkingChoice,
      },
      sessionCount: sessionIds.length,
      trackCount: trackIds.length,
      icebreakerCount: icebreakerIds.length,
      checklist,
    },
  });

  const base = opts.webBaseUrl.replace(/\/$/, "");
  return {
    eventId: created.id,
    slug: created.slug,
    slugUrl: `${base}/e/${created.slug}`,
    joinUrl: `${base}/e/join/${joinRaw}`,
    joinToken: joinRaw,
    sessionIds,
    trackIds,
    icebreakerIds,
    announcementId,
    checklist,
    handoffIngestPath: form.hasProgramDocument
      ? `/organizer/events/${created.id}/ingest`
      : null,
    aiGenerated: true,
    skeleton,
  };
}
