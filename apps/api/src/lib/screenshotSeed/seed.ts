/**
 * SHOT-CI — writes the screenshot fixture into a throwaway database.
 *
 * Only ever pointed at the CI service container (see screenshots.yml) or a
 * local Postgres; `assertDestructiveAllowed` is the gate, because this wipes
 * the two Northbridge events by slug on every run so captures are identical.
 *
 * The org is created on PlanTier.INTERNAL on purpose: several features the
 * guide documents (waitlist visibility, ops inbox, recap) are entitlement-gated
 * above Free, and an INTERNAL org short-circuits `can()` so every surface
 * renders without inventing a fake subscription.
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  BillingProvider,
  CertificateEligibilityRule,
  CfpFormStatus,
  CfpSubmissionStatus,
  ConversationType,
  EventMemberRole,
  EventStatus,
  NetworkChannel,
  NotificationClass,
  NotificationKind,
  OrgRole,
  PlanTier,
  ReadinessAssignmentStatus,
  RecapSectionKind,
  RecapSectionStatus,
  RecapStatus,
  Role,
  SessionAttendanceStatus,
  SessionJoinMode,
  SessionPollStatus,
  SessionPublishStatus,
  SponsorProspectStatus,
  SubscriptionStatus,
  type Prisma,
} from "@prisma/client";
import { applyPreset } from "@event-app/shared";
import { hashPassword } from "../auth";
import {
  formatCertificateDates,
  generateCertificatePublicId,
  renderCertificatePdf,
} from "../certificates";
import { prisma } from "../db";
import { assertDestructiveAllowed } from "../destructiveGuard";
import { computeRecapMetrics } from "../ai/recap/metrics";
import { upsertFeatureOverrides } from "../features/featureEnabled";
import { newJoinToken } from "../inviteTokens";
import {
  buildScreenshotSeedSpec,
  eventLogoDataUrl,
  floorPlanDataUrl,
  SCREENSHOT_ATTENDEE_KEY,
  SCREENSHOT_ORGANIZER_KEY,
  SCREENSHOT_SEED_PASSWORD,
  screenshotFeatureOverrides,
  seedImageDataUrl,
  type ScreenshotSeedSpec,
  type ScreenshotSessionSpec,
} from "./fixture";

/**
 * What the Playwright driver needs: two sign-ins and the ids that manifest
 * paths interpolate. Written to disk as JSON by the seed script.
 */
export type ScreenshotSeedOutput = {
  password: string;
  organizerEmail: string;
  attendeeEmail: string;
  /**
   * Where the issued certificate's PDF was written, when the caller asked for
   * one. The certificate shot photographs this file rather than a web page.
   */
  certificatePdfPath?: string;
  /** Substituted into `{token}` placeholders in screenshot-manifest.ts. */
  tokens: Record<string, string>;
};

export type ScreenshotSeedOptions = {
  /** Write the issued certificate's PDF here so a capture run can photograph it. */
  certificatePdfPath?: string | null;
};

type UserRow = { id: string; email: string; name: string };

function at(nowMs: number, minutes: number): Date {
  return new Date(nowMs + minutes * 60_000);
}

function daysFromNow(nowMs: number, days: number): Date {
  return new Date(nowMs + days * 24 * 60 * 60_000);
}

async function ensureOrg(spec: ScreenshotSeedSpec): Promise<{ id: string }> {
  const existing = await prisma.organization.findUnique({ where: { slug: spec.org.slug } });
  const data = {
    name: spec.org.name,
    plan: PlanTier.INTERNAL,
    billingProvider: BillingProvider.INTERNAL,
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    eventAllowance: null,
  };
  if (existing) return prisma.organization.update({ where: { id: existing.id }, data });
  return prisma.organization.create({ data: { ...data, slug: spec.org.slug } });
}

/**
 * Deletes the seeded event and everything hanging off it. Ordered children
 * first because several relations are Restrict or SetNull rather than Cascade.
 */
async function wipeEvent(slug: string, organizationId: string): Promise<void> {
  const event = await prisma.event.findUnique({ where: { slug }, select: { id: true, organizationId: true } });
  if (!event) return;
  if (event.organizationId !== organizationId) {
    throw new Error(
      `Refusing to wipe event "${slug}" (${event.id}): it belongs to another organization. ` +
        `The screenshot seed only owns events under "${slug}"'s Northbridge org.`,
    );
  }
  const eventId = event.id;

  await prisma.eventRecapEmail.deleteMany({ where: { recap: { eventId } } });
  await prisma.eventRecapSection.deleteMany({ where: { recap: { eventId } } });
  await prisma.eventRecap.deleteMany({ where: { eventId } });
  await prisma.issuedCertificate.deleteMany({ where: { eventId } });
  await prisma.certificateTemplate.deleteMany({ where: { eventId } });
  await prisma.readinessAssignment.deleteMany({ where: { eventId } });
  await prisma.readinessRequirement.deleteMany({ where: { eventId } });
  await prisma.readinessTemplate.deleteMany({ where: { eventId } });
  await prisma.cfpSubmission.deleteMany({ where: { cfpForm: { eventId } } });
  await prisma.cfpReviewer.deleteMany({ where: { cfpForm: { eventId } } });
  await prisma.cfpForm.deleteMany({ where: { eventId } });
  await prisma.matchSuggestion.deleteMany({ where: { eventId } });
  await prisma.userNotification.deleteMany({ where: { eventId } });
  await prisma.conversationMessage.deleteMany({ where: { conversation: { eventId } } });
  await prisma.conversationMember.deleteMany({ where: { conversation: { eventId } } });
  await prisma.conversation.deleteMany({ where: { eventId } });
  await prisma.sponsorProspect.deleteMany({ where: { eventId } });
  await prisma.outreachTemplate.deleteMany({ where: { eventId } });
  await prisma.sponsorLead.deleteMany({ where: { sponsor: { eventId } } });
  await prisma.sponsor.deleteMany({ where: { eventId } });
  await prisma.mapPin.deleteMany({ where: { map: { eventId } } });
  await prisma.venueMap.deleteMany({ where: { eventId } });
  await prisma.networkReply.deleteMany({ where: { thread: { eventId } } });
  await prisma.networkThread.deleteMany({ where: { eventId } });
  await prisma.announcement.deleteMany({ where: { eventId } });
  await prisma.checkIn.deleteMany({ where: { eventId } });
  await prisma.sessionPollVote.deleteMany({ where: { poll: { session: { eventId } } } });
  await prisma.sessionPollOption.deleteMany({ where: { poll: { session: { eventId } } } });
  await prisma.sessionPoll.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionFeedback.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionDiscussionUpvote.deleteMany({ where: { thread: { session: { eventId } } } });
  await prisma.sessionDiscussionReply.deleteMany({ where: { thread: { session: { eventId } } } });
  await prisma.sessionDiscussionThread.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionItemAuthor.deleteMany({ where: { sessionItem: { session: { eventId } } } });
  await prisma.sessionItem.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionSpeaker.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionResource.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionBookmark.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionAttendance.deleteMany({ where: { session: { eventId } } });
  await prisma.waitlistEntry.deleteMany({ where: { session: { eventId } } });
  await prisma.sessionLike.deleteMany({ where: { session: { eventId } } });
  await prisma.session.deleteMany({ where: { eventId } });
  await prisma.speaker.deleteMany({ where: { eventId } });
  await prisma.track.deleteMany({ where: { eventId } });
  await prisma.room.deleteMany({ where: { eventId } });
  await prisma.eventMembership.deleteMany({ where: { eventId } });
  await prisma.eventFeatureConfig.deleteMany({ where: { eventId } });
  await prisma.event.delete({ where: { id: eventId } });
}

async function upsertUsers(spec: ScreenshotSeedSpec): Promise<Map<string, UserRow>> {
  const passwordHash = await hashPassword(SCREENSHOT_SEED_PASSWORD);
  const byKey = new Map<string, UserRow>();
  for (const u of spec.users) {
    const data = {
      name: u.name,
      role: Role[u.accountRole],
      title: u.title ?? null,
      affiliation: u.affiliation ?? null,
      bio: u.bio ?? null,
      researchInterests: u.researchInterests ?? null,
      participantType: u.participantType ?? null,
      engagementPoints: u.engagementPoints,
      passwordHash,
      // Login refuses unverified accounts (routes/auth.ts) — the driver signs
      // in through the real form, so this has to be stamped.
      emailVerifiedAt: new Date(),
      deactivatedAt: null,
    };
    const row = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, ...data },
      update: data,
      select: { id: true, email: true, name: true },
    });
    byKey.set(u.key, row);
  }
  return byKey;
}

async function seedSessions(
  eventId: string,
  sessions: ScreenshotSessionSpec[],
  nowMs: number,
  trackIds: Map<string, string>,
  roomIds: Map<string, string>,
  speakerIds: Map<string, string>,
  speakerNames: Map<string, string>,
): Promise<Map<string, string>> {
  const sessionIds = new Map<string, string>();
  for (const s of sessions) {
    const startsAt = at(nowMs, s.startsInMinutes);
    const endsAt = at(nowMs, s.startsInMinutes + s.durationMinutes);
    const created = await prisma.session.create({
      data: {
        eventId,
        title: s.title,
        description: s.description,
        trackId: trackIds.get(s.trackKey) ?? null,
        roomId: s.roomKey ? roomIds.get(s.roomKey) ?? null : null,
        startsAt,
        endsAt,
        inPersonCapacity: s.inPersonCapacity ?? null,
        publishStatus: SessionPublishStatus.PUBLISHED,
        speakers: s.speakerKeys.map((k) => speakerNames.get(k)).filter(Boolean).join(", "),
        sessionSpeakers: {
          create: s.speakerKeys
            .map((k, idx) => {
              const id = speakerIds.get(k);
              return id ? { speakerId: id, sortOrder: idx } : null;
            })
            .filter((x): x is { speakerId: string; sortOrder: number } => Boolean(x)),
        },
      },
    });
    sessionIds.set(s.key, created.id);

    for (let i = 0; i < (s.items?.length ?? 0); i++) {
      const item = s.items![i]!;
      await prisma.sessionItem.create({
        data: {
          sessionId: created.id,
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
  return sessionIds;
}

/**
 * Recreates both Northbridge events and every row the Feature Guide shots
 * need. Idempotent: safe to run repeatedly against the same throwaway DB.
 */
export async function seedScreenshotData(
  now = new Date(),
  options: ScreenshotSeedOptions = {},
): Promise<ScreenshotSeedOutput> {
  assertDestructiveAllowed("seed-script");

  const spec = buildScreenshotSeedSpec();
  const nowMs = now.getTime();
  const org = await ensureOrg(spec);
  const users = await upsertUsers(spec);

  const organizer = users.get(SCREENSHOT_ORGANIZER_KEY)!;
  const attendee = users.get(SCREENSHOT_ATTENDEE_KEY)!;

  await wipeEvent(spec.event.slug, org.id);
  await wipeEvent(spec.breakoutEvent.slug, org.id);

  for (const [, user] of users) {
    const membership = await prisma.orgMembership.findFirst({
      where: { organizationId: org.id, userId: user.id },
    });
    if (!membership && user.id === organizer.id) {
      await prisma.orgMembership.create({
        data: { organizationId: org.id, userId: user.id, role: OrgRole.OWNER },
      });
    }
  }

  const sessionStarts = spec.sessions.map((s) => s.startsInMinutes);
  const sessionEnds = spec.sessions.map((s) => s.startsInMinutes + s.durationMinutes);
  const event = await prisma.event.create({
    data: {
      name: spec.event.name,
      slug: spec.event.slug,
      description: spec.event.description,
      venueName: spec.event.venueName,
      venueAddress: spec.event.venueAddress,
      brandColor: spec.event.brandColor,
      timezone: spec.event.timezone,
      startDate: at(nowMs, Math.min(...sessionStarts) - 60),
      endDate: at(nowMs, Math.max(...sessionEnds) + 60),
      status: EventStatus.ACTIVE,
      activatedAt: new Date(),
      organizationId: org.id,
      createdById: organizer.id,
      joinTokenHash: newJoinToken().hash,
      slugInviteEnabled: true,
      attendeeCap: spec.event.attendeeCap,
      cfpLabel: spec.event.cfpLabel,
      // Brands the app's top bar and the certificate PDF's logo slot. Null
      // unless the artwork is committed, which both surfaces already handle.
      logoUrl: eventLogoDataUrl(),
      assistantStartersJson: JSON.stringify(spec.event.assistantStarters),
      paymentPriceText: spec.event.paymentPriceText,
      paymentUrl: spec.event.paymentUrl,
      paymentInstructions: spec.event.paymentInstructions,
    },
  });

  await upsertFeatureOverrides(event.id, screenshotFeatureOverrides());

  for (const u of spec.users) {
    const row = users.get(u.key)!;
    await prisma.eventMembership.create({
      data: {
        eventId: event.id,
        userId: row.id,
        role: EventMemberRole[u.eventRole],
        directoryOptIn: u.directoryOptIn,
        matchMeEnabled: true,
        welcomeSeenAt: new Date(),
        paymentStatus: u.paymentStatus,
        paymentReference: u.paymentReference ?? null,
      },
    });
    if (u.checkedIn) {
      await prisma.checkIn.create({ data: { eventId: event.id, userId: row.id } });
    }
  }

  const trackIds = new Map<string, string>();
  for (let i = 0; i < spec.tracks.length; i++) {
    const t = spec.tracks[i]!;
    const row = await prisma.track.create({
      data: { eventId: event.id, name: t.name, color: t.color, sortOrder: i },
    });
    trackIds.set(t.key, row.id);
  }

  const roomIds = new Map<string, string>();
  for (let i = 0; i < spec.rooms.length; i++) {
    const r = spec.rooms[i]!;
    const row = await prisma.room.create({
      data: { eventId: event.id, name: r.name, capacity: r.capacity, sortOrder: i },
    });
    roomIds.set(r.key, row.id);
  }

  const speakerIds = new Map<string, string>();
  const speakerNames = new Map<string, string>();
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
    speakerIds.set(s.key, row.id);
    speakerNames.set(s.key, s.name);
  }

  const sessionIds = await seedSessions(
    event.id,
    spec.sessions,
    nowMs,
    trackIds,
    roomIds,
    speakerIds,
    speakerNames,
  );

  // Joins + likes across the roster so agenda cards carry real counts.
  const joinerKeys = [SCREENSHOT_ATTENDEE_KEY, "tomas", "nadia", "eero", "hana", "yusuf"];
  for (const sessionKey of ["opening-keynote", "reading-conferences", "feedback-panel", "closing-roundtable"]) {
    const sessionId = sessionIds.get(sessionKey)!;
    for (const key of joinerKeys) {
      await prisma.sessionAttendance.create({
        data: {
          sessionId,
          userId: users.get(key)!.id,
          status: SessionAttendanceStatus.JOINING,
          joinMode: SessionJoinMode.IN_PERSON,
        },
      });
    }
    for (const key of joinerKeys.slice(0, 4)) {
      await prisma.sessionLike.create({ data: { sessionId, userId: users.get(key)!.id } });
    }
  }

  // The capped session: two seats taken, the rest ordered on the waitlist so
  // "Full — waitlist" and real positions both photograph.
  const fullSessionId = sessionIds.get("reporting-lab")!;
  const fullSeated = ["tomas", "nadia"];
  const fullWaiting = [SCREENSHOT_ATTENDEE_KEY, "eero", "hana"];
  for (const key of fullSeated) {
    await prisma.sessionAttendance.create({
      data: {
        sessionId: fullSessionId,
        userId: users.get(key)!.id,
        status: SessionAttendanceStatus.JOINING,
        joinMode: SessionJoinMode.IN_PERSON,
      },
    });
  }
  for (let i = 0; i < fullWaiting.length; i++) {
    await prisma.waitlistEntry.create({
      data: {
        sessionId: fullSessionId,
        userId: users.get(fullWaiting[i]!)!.id,
        mode: SessionJoinMode.IN_PERSON,
        position: i + 1,
      },
    });
  }

  for (const t of spec.threads) {
    const thread = await prisma.networkThread.create({
      data: {
        eventId: event.id,
        authorId: users.get(t.authorKey)!.id,
        channel: NetworkChannel[t.channel],
        title: t.title,
        body: t.body,
        createdAt: at(nowMs, -t.createdMinutesAgo),
        imageUrls: t.imageUrls ?? [],
        mapsUrl: t.mapsUrl ?? null,
        meetupMode: t.meetupMode ? SessionJoinMode[t.meetupMode] : null,
        meetupStartsAt: t.meetupStartsInMinutes != null ? at(nowMs, t.meetupStartsInMinutes) : null,
        meetupMeetingUrl: t.meetupMeetingUrl ?? null,
        meetupInviteEveryone: Boolean(t.meetupInviteEveryone),
        taggedUserIds: (t.taggedUserKeys ?? []).map((k) => users.get(k)!.id),
        audienceType: t.audienceType ?? "EVERYONE",
        audienceSessionId: t.audienceSessionKey ? sessionIds.get(t.audienceSessionKey) ?? null : null,
      },
    });
    for (let i = 0; i < (t.replies?.length ?? 0); i++) {
      const reply = t.replies![i]!;
      await prisma.networkReply.create({
        data: {
          threadId: thread.id,
          authorId: users.get(reply.authorKey)!.id,
          body: reply.body,
          createdAt: at(nowMs, -t.createdMinutesAgo + (i + 1) * 12),
        },
      });
    }
  }

  const announcement = await prisma.announcement.create({
    data: {
      eventId: event.id,
      createdById: organizer.id,
      title: spec.announcement.title,
      body: spec.announcement.body,
      createdAt: at(nowMs, -spec.announcement.postedMinutesAgo),
      publishedAt: at(nowMs, -spec.announcement.postedMinutesAgo),
    },
  });

  const pollSessionId = sessionIds.get(spec.poll.sessionKey)!;
  const poll = await prisma.sessionPoll.create({
    data: {
      sessionId: pollSessionId,
      question: spec.poll.question,
      status: SessionPollStatus.OPEN,
      openedAt: at(nowMs, -30),
      showResultsToAttendees: true,
      createdById: organizer.id,
      options: {
        create: spec.poll.options.map((label, i) => ({ label, sortOrder: i })),
      },
    },
    include: { options: { orderBy: { sortOrder: "asc" } } },
  });
  for (const vote of spec.poll.votes) {
    await prisma.sessionPollVote.create({
      data: {
        pollId: poll.id,
        optionId: poll.options[vote.optionIndex]!.id,
        userId: users.get(vote.userKey)!.id,
      },
    });
  }

  for (const f of spec.feedback) {
    await prisma.sessionFeedback.create({
      data: {
        sessionId: sessionIds.get(f.sessionKey)!,
        userId: users.get(f.userKey)!.id,
        rating: f.rating,
        comment: f.comment,
      },
    });
  }

  for (const q of spec.qa) {
    const thread = await prisma.sessionDiscussionThread.create({
      data: {
        sessionId: sessionIds.get(q.sessionKey)!,
        authorId: users.get(q.authorKey)!.id,
        title: q.title,
        body: q.body,
        answeredAt: q.answered ? at(nowMs, -20) : null,
        answeredById: q.answered ? organizer.id : null,
      },
    });
    for (const key of q.upvoterKeys) {
      await prisma.sessionDiscussionUpvote.create({
        data: { threadId: thread.id, userId: users.get(key)!.id },
      });
    }
  }

  const venueMap = await prisma.venueMap.create({
    data: { eventId: event.id, name: spec.map.name, imageUrl: floorPlanDataUrl(), sortOrder: 0 },
  });
  const pinIds: string[] = [];
  for (const pin of spec.map.pins) {
    const row = await prisma.mapPin.create({
      data: {
        mapId: venueMap.id,
        roomLabel: pin.roomLabel,
        x: pin.x,
        y: pin.y,
        linkedRoomId: pin.roomKey ? roomIds.get(pin.roomKey) ?? null : null,
      },
    });
    pinIds.push(row.id);
  }

  const sponsorIdsByName = new Map<string, string>();
  for (let i = 0; i < spec.sponsors.length; i++) {
    const s = spec.sponsors[i]!;
    const row = await prisma.sponsor.create({
      data: {
        eventId: event.id,
        name: s.name,
        tier: s.tier,
        url: s.url,
        description: s.description,
        boothLabel: s.boothLabel,
        logoUrl: seedImageDataUrl(s.logoFile),
        sortOrder: i,
      },
    });
    sponsorIdsByName.set(s.name, row.id);
  }

  for (const p of spec.prospects) {
    await prisma.sponsorProspect.create({
      data: {
        eventId: event.id,
        orgName: p.orgName,
        contactName: p.contactName,
        contactEmail: p.contactEmail,
        websiteUrl: p.websiteUrl,
        notes: p.notes,
        status: SponsorProspectStatus[p.status],
        lastContactedAt: p.lastContactedDaysAgo != null ? daysFromNow(nowMs, -p.lastContactedDaysAgo) : null,
        // A CONFIRMED prospect that became a sponsor is the interesting row:
        // it shows the pipeline's only write into the public sponsor list.
        sponsorId: p.status === "CONFIRMED" ? sponsorIdsByName.get(p.orgName) ?? null : null,
      },
    });
  }

  await prisma.outreachTemplate.create({
    data: {
      eventId: event.id,
      name: spec.outreachTemplate.name,
      subject: spec.outreachTemplate.subject,
      body: spec.outreachTemplate.body,
    },
  });

  const cfpForm = await prisma.cfpForm.create({
    data: {
      eventId: event.id,
      title: spec.cfp.title,
      description: spec.cfp.description,
      opensAt: daysFromNow(nowMs, spec.cfp.opensInDays),
      closesAt: daysFromNow(nowMs, spec.cfp.closesInDays),
      status: CfpFormStatus.OPEN,
      customFields: spec.cfp.customFields,
      maxSubmissionsPerPerson: 2,
      blindReview: true,
      rubric: [
        { id: "relevance", criterion: "Relevance to practitioners", weight: 2 },
        { id: "evidence", criterion: "Evidence it worked", weight: 2 },
        { id: "clarity", criterion: "Clarity of the takeaway", weight: 1 },
      ],
    },
  });
  await prisma.cfpSubmission.create({
    data: {
      cfpFormId: cfpForm.id,
      submitterName: spec.cfp.submission.submitterName,
      submitterEmail: spec.cfp.submission.submitterEmail,
      emailVerifiedAt: daysFromNow(nowMs, -3),
      title: spec.cfp.submission.title,
      abstract: spec.cfp.submission.abstract,
      answers: { format: "Short talk", audience: "Secondary", materials: "A revision-behaviour observation protocol." },
      status: CfpSubmissionStatus.UNDER_REVIEW,
      submittedAt: daysFromNow(nowMs, -3),
    },
  });
  await prisma.cfpReviewer.create({
    data: { cfpFormId: cfpForm.id, userId: users.get("marisol")!.id },
  });

  const readinessTemplate = await prisma.readinessTemplate.create({
    data: {
      organizationId: org.id,
      eventId: event.id,
      name: spec.readiness.templateName,
      description: spec.readiness.templateDescription,
    },
  });
  const requirementIds = new Map<string, string>();
  for (let i = 0; i < spec.readiness.requirements.length; i++) {
    const r = spec.readiness.requirements[i]!;
    const row = await prisma.readinessRequirement.create({
      data: {
        templateId: readinessTemplate.id,
        eventId: event.id,
        label: r.label,
        helpText: r.helpText,
        kind: r.kind,
        required: r.required,
        dueAt: daysFromNow(nowMs, r.dueInDays),
        sortOrder: i,
      },
    });
    requirementIds.set(r.key, row.id);
  }
  for (const a of spec.readiness.assignments) {
    await prisma.readinessAssignment.create({
      data: {
        organizationId: org.id,
        eventId: event.id,
        requirementId: requirementIds.get(a.requirementKey)!,
        speakerId: speakerIds.get(a.speakerKey)!,
        status: ReadinessAssignmentStatus[a.status],
        waivedAt: a.status === "WAIVED" ? daysFromNow(nowMs, -1) : null,
        waivedById: a.status === "WAIVED" ? organizer.id : null,
        ownerUserId: organizer.id,
      },
    });
  }

  const certificateTemplate = await prisma.certificateTemplate.create({
    data: {
      organizationId: org.id,
      eventId: event.id,
      name: spec.certificate.templateName,
      titleText: spec.certificate.titleText,
      bodyText: spec.certificate.bodyText,
      hours: spec.certificate.hours,
      eligibilityRule: CertificateEligibilityRule.ANY_CHECKIN,
    },
  });
  const snapshot = await computeRecapMetrics(event.id);
  const recap = await prisma.eventRecap.create({
    data: {
      organizationId: org.id,
      eventId: event.id,
      status: RecapStatus.READY,
      metricsSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      generatedAt: new Date(),
    },
  });
  for (const section of spec.recap.sections) {
    await prisma.eventRecapSection.create({
      data: {
        recapId: recap.id,
        kind: RecapSectionKind[section.kind],
        status: RecapSectionStatus.DRAFT,
        title: section.title,
        bodyMarkdown: section.bodyMarkdown,
        aiGenerated: false,
        metered: false,
      },
    });
  }

  // The certificate is photographed as the PDF itself, so the seed issues it
  // the way the product does: the same publicId shape, the same renderer, the
  // same accent and logo off the event row. The bytes go on the row as a data
  // URL (what the storage stub does) and, when asked, to disk for the capture.
  const certificateHolder = users.get(spec.certificate.holderKey)!;
  const certificatePublicId = generateCertificatePublicId();
  const certificateDateSnapshot = at(nowMs, Math.max(...sessionEnds));
  const certificatePdf = await renderCertificatePdf({
    titleText: spec.certificate.titleText,
    bodyText: spec.certificate.bodyText,
    merge: {
      attendeeName: certificateHolder.name,
      eventName: spec.event.name,
      dates: formatCertificateDates(event.startDate, event.endDate, spec.event.timezone),
      hours: spec.certificate.hours,
      signatureImage: null,
      certificateId: certificatePublicId,
    },
    accentColor: event.brandColor,
    logoUrl: event.logoUrl,
  });
  const issuedCertificate = await prisma.issuedCertificate.create({
    data: {
      publicId: certificatePublicId,
      organizationId: org.id,
      eventId: event.id,
      certificateTemplateId: certificateTemplate.id,
      userId: certificateHolder.id,
      attendeeNameSnapshot: certificateHolder.name,
      eventNameSnapshot: spec.event.name,
      eventDateSnapshot: certificateDateSnapshot,
      hoursSnapshot: spec.certificate.hours,
      pdfStorageKey: `data:application/pdf;base64,${certificatePdf.toString("base64")}`,
      issuedAt: new Date(),
      issuedByUserId: organizer.id,
    },
  });
  if (options.certificatePdfPath) {
    mkdirSync(dirname(options.certificatePdfPath), { recursive: true });
    writeFileSync(options.certificatePdfPath, certificatePdf);
  }

  for (let i = 0; i < spec.matchSuggestions.length; i++) {
    const m = spec.matchSuggestions[i]!;
    await prisma.matchSuggestion.create({
      data: {
        eventId: event.id,
        forUserId: users.get(m.forUserKey)!.id,
        suggestedUserId: users.get(m.suggestedUserKey)!.id,
        rank: i + 1,
        whyLine: m.whyLine,
        draftIntro: m.draftIntro,
        batchKey: "join",
        aiGenerated: false,
      },
    });
  }

  for (const n of spec.notifications) {
    await prisma.userNotification.create({
      data: {
        userId: users.get(n.forUserKey)!.id,
        eventId: event.id,
        kind: NotificationKind[n.kind as keyof typeof NotificationKind],
        class: n.kind === "ANNOUNCEMENT" ? NotificationClass.INTERRUPT : NotificationClass.DIGEST,
        title: n.title,
        body: n.body,
        announcementId: n.kind === "ANNOUNCEMENT" ? announcement.id : null,
        createdAt: at(nowMs, -n.minutesAgo),
      },
    });
  }

  const directConversation = await prisma.conversation.create({
    data: {
      eventId: event.id,
      type: ConversationType.DIRECT,
      status: "ACTIVE",
      initiatedById: users.get(spec.directMessage.memberKeys[1]!)!.id,
      members: { create: spec.directMessage.memberKeys.map((k) => ({ userId: users.get(k)!.id })) },
    },
  });
  for (let i = 0; i < spec.directMessage.messages.length; i++) {
    const m = spec.directMessage.messages[i]!;
    await prisma.conversationMessage.create({
      data: {
        conversationId: directConversation.id,
        userId: users.get(m.authorKey)!.id,
        body: m.body,
        createdAt: at(nowMs, -90 + i * 8),
      },
    });
  }

  const groupConversation = await prisma.conversation.create({
    data: {
      eventId: event.id,
      type: ConversationType.GROUP,
      name: spec.groupChat.name,
      status: "ACTIVE",
      initiatedById: users.get(spec.groupChat.memberKeys[0]!)!.id,
      members: { create: spec.groupChat.memberKeys.map((k) => ({ userId: users.get(k)!.id })) },
    },
  });
  for (let i = 0; i < spec.groupChat.messages.length; i++) {
    const m = spec.groupChat.messages[i]!;
    await prisma.conversationMessage.create({
      data: {
        conversationId: groupConversation.id,
        userId: users.get(m.authorKey)!.id,
        body: m.body,
        createdAt: at(nowMs, -50 + i * 6),
      },
    });
  }

  // REQUESTED + exactly one message from the initiator is what the Requests
  // section renders; a second message would mean the gate had been accepted.
  const requestConversation = await prisma.conversation.create({
    data: {
      eventId: event.id,
      type: ConversationType.DIRECT,
      status: "REQUESTED",
      initiatedById: users.get(spec.messageRequest.fromKey)!.id,
      members: {
        create: [
          { userId: users.get(spec.messageRequest.fromKey)!.id },
          { userId: users.get(spec.messageRequest.toKey)!.id },
        ],
      },
    },
  });
  await prisma.conversationMessage.create({
    data: {
      conversationId: requestConversation.id,
      userId: users.get(spec.messageRequest.fromKey)!.id,
      body: spec.messageRequest.body,
      createdAt: at(nowMs, -25),
    },
  });

  // Second event: pick-one breakouts only. It cannot share the main event
  // because breakout_style rewrites the Agenda that six other shots rely on.
  const breakoutStarts = spec.breakoutEvent.sessions.map((s) => s.startsInMinutes);
  const breakoutEnds = spec.breakoutEvent.sessions.map((s) => s.startsInMinutes + s.durationMinutes);
  const breakoutEvent = await prisma.event.create({
    data: {
      name: spec.breakoutEvent.name,
      slug: spec.breakoutEvent.slug,
      description: spec.breakoutEvent.description,
      venueName: spec.breakoutEvent.venueName,
      timezone: spec.breakoutEvent.timezone,
      startDate: at(nowMs, Math.min(...breakoutStarts) - 60),
      endDate: at(nowMs, Math.max(...breakoutEnds) + 60),
      status: EventStatus.ACTIVE,
      activatedAt: new Date(),
      organizationId: org.id,
      createdById: organizer.id,
      joinTokenHash: newJoinToken().hash,
      attendeeCap: spec.breakoutEvent.attendeeCap,
    },
  });
  await upsertFeatureOverrides(breakoutEvent.id, { ...applyPreset("pd_day"), breakout_style: true });

  const breakoutTrackIds = new Map<string, string>();
  for (let i = 0; i < spec.tracks.length; i++) {
    const t = spec.tracks[i]!;
    const row = await prisma.track.create({
      data: { eventId: breakoutEvent.id, name: t.name, color: t.color, sortOrder: i },
    });
    breakoutTrackIds.set(t.key, row.id);
  }
  const breakoutRoomIds = new Map<string, string>();
  for (let i = 0; i < spec.rooms.length; i++) {
    const r = spec.rooms[i]!;
    const row = await prisma.room.create({
      data: { eventId: breakoutEvent.id, name: r.name, capacity: r.capacity, sortOrder: i },
    });
    breakoutRoomIds.set(r.key, row.id);
  }
  const breakoutSpeakerIds = new Map<string, string>();
  for (let i = 0; i < spec.speakers.length; i++) {
    const s = spec.speakers[i]!;
    const row = await prisma.speaker.create({
      data: {
        eventId: breakoutEvent.id,
        name: s.name,
        title: s.title,
        affiliation: s.affiliation,
        bio: s.bio,
        sortOrder: i,
      },
    });
    breakoutSpeakerIds.set(s.key, row.id);
  }
  await seedSessions(
    breakoutEvent.id,
    spec.breakoutEvent.sessions,
    nowMs,
    breakoutTrackIds,
    breakoutRoomIds,
    breakoutSpeakerIds,
    speakerNames,
  );
  for (const u of spec.users) {
    await prisma.eventMembership.create({
      data: {
        eventId: breakoutEvent.id,
        userId: users.get(u.key)!.id,
        role: EventMemberRole[u.eventRole],
        directoryOptIn: u.directoryOptIn,
        welcomeSeenAt: new Date(),
      },
    });
  }

  return {
    password: SCREENSHOT_SEED_PASSWORD,
    organizerEmail: organizer.email,
    attendeeEmail: attendee.email,
    ...(options.certificatePdfPath ? { certificatePdfPath: options.certificatePdfPath } : {}),
    tokens: {
      eventId: event.id,
      slug: event.slug,
      breakoutEventId: breakoutEvent.id,
      liveSessionId: sessionIds.get("feedback-panel")!,
      endedSessionId: sessionIds.get("reading-conferences")!,
      fullSessionId,
      mapId: venueMap.id,
      pinId: pinIds[0]!,
      certificateId: issuedCertificate.publicId,
      directConversationId: directConversation.id,
      groupConversationId: groupConversation.id,
    },
  };
}
