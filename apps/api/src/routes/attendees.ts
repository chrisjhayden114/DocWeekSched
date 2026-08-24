import { EventMemberRole, NotificationKind, OrgRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { hashPassword } from "../lib/auth";
import { asyncHandler, HttpError, requireEventAccess } from "../lib/authorization";
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { newInviteToken, ensureEventJoinToken } from "../lib/inviteTokens";
import { sendParticipantInviteEmail } from "../lib/mail";
import { notifyMany } from "../lib/notifications";
import { resolveEventFromRequest } from "../lib/requestEvent";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { authRateLimit } from "../lib/rateLimit";
import { randomBytes } from "crypto";
import { requireFeature } from "../lib/features";
import { validationErrorBody } from "../lib/errors";
import { deriveInviteStatus } from "../lib/inviteStatus";
import { parsePagination, setPageHeaders, slicePage } from "../lib/pagination";
import {
  normalizeMembershipLabel,
  parseParticipantLabels,
  setMembershipParticipantLabel,
} from "../lib/participantLabels";

export const attendeesRouter = Router();

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  photoUrl: z.string().max(12_000_000).optional(),
  researchInterests: z.string().max(4000).optional(),
});

const inviteBulkSchema = z.object({
  invites: z.array(inviteSchema).min(1).max(200),
});

const attendeePublicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  photoUrl: true,
  researchInterests: true,
  title: true,
  affiliation: true,
  bio: true,
} as const;

type InviteInput = z.infer<typeof inviteSchema>;

type EventRef = { id: string; slug: string; name: string };

type RosterSeatInput = InviteInput & {
  /** W-2: assigned at import time. Must be one of the event's labels. */
  participantLabel?: string | null;
};

type SeatFailure = {
  ok: false;
  /** ALREADY_ACTIVE = a live seat whose owner has already finished setup. */
  code?: "ALREADY_ACTIVE";
  error: string;
  status?: number;
  body?: Record<string, unknown>;
};

type SeatSuccess = {
  ok: true;
  userId: string;
  email: string;
  name: string;
  /** No user account existed for this address before now. */
  isNewUser: boolean;
  /** No live roster seat existed before now (a soft-removed one counts as new). */
  isNewRosterSeat: boolean;
  participantLabel: string | null;
};

/**
 * W-2 — the seat half of the old createAndEmailInvite: user account (created
 * if needed), billing seat check, roster membership, optional participant
 * label. Sends NOTHING. A seat created here reads as "Not invited" on the
 * roster until sendInvite runs (EventMembership.addedWithoutInviteAt).
 */
async function ensureRosterSeat(
  event: EventRef,
  data: RosterSeatInput,
): Promise<SeatSuccess | SeatFailure> {
  const email = data.email.trim().toLowerCase();
  const name = data.name.trim();

  // Validate the label against THIS event's list before writing anything.
  let participantLabel: string | null = null;
  if (data.participantLabel != null) {
    const row = await prisma.event.findUnique({
      where: { id: event.id },
      select: { participantLabelsJson: true },
    });
    if (!row) return { ok: false, error: "Event not found", status: 404, body: { error: "Event not found" } };
    const normalized = normalizeMembershipLabel(
      data.participantLabel,
      parseParticipantLabels(row.participantLabelsJson),
    );
    if (!normalized.ok) {
      return { ok: false, error: normalized.error, status: 400, body: { error: normalized.error } };
    }
    participantLabel = normalized.label;
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  let userId: string;
  let isNewUser = false;
  let isNewRosterSeat = true;

  if (existing) {
    const already = await prisma.eventMembership.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: existing.id } },
    });
    if (already && !already.deletedAt) {
      const status = deriveInviteStatus({
        profileSetupTokenHash: existing.profileSetupTokenHash,
        profileSetupTokenExpiresAt: existing.profileSetupTokenExpiresAt,
        addedWithoutInviteAt: already.addedWithoutInviteAt,
      });
      if (status === "ACTIVE") {
        return {
          ok: false,
          code: "ALREADY_ACTIVE",
          error: "This person is already on the event roster",
        };
      }
      isNewRosterSeat = false;
    }
    const profilePatch = {
      ...(data.photoUrl?.trim() ? { photoUrl: data.photoUrl.trim() } : {}),
      ...(data.researchInterests?.trim() ? { researchInterests: data.researchInterests.trim() } : {}),
    };
    if (Object.keys(profilePatch).length > 0) {
      await prisma.user.update({ where: { id: existing.id }, data: profilePatch });
    }
    userId = existing.id;
  } else {
    const passwordHash = await hashPassword(randomBytes(24).toString("hex"));
    const created = await prisma.user.create({
      data: {
        email,
        name,
        photoUrl: data.photoUrl?.trim() || null,
        researchInterests: data.researchInterests?.trim() || null,
        role: "ATTENDEE",
        passwordHash,
        emailVerifiedAt: null,
      },
    });
    userId = created.id;
    isNewUser = true;
  }

  if (isNewRosterSeat) {
    try {
      const { assertCanAddAttendee } = await import("../lib/billing");
      await assertCanAddAttendee(event.id);
    } catch (err) {
      if (err instanceof HttpError) {
        return { ok: false, error: err.message, status: err.status, body: err.body };
      }
      throw err;
    }
  }

  const labelPatch = participantLabel != null ? { participantLabel } : {};
  await prisma.eventMembership.upsert({
    where: { eventId_userId: { eventId: event.id, userId } },
    create: {
      eventId: event.id,
      userId,
      role: EventMemberRole.ATTENDEE,
      addedWithoutInviteAt: new Date(),
      ...labelPatch,
    },
    update: {
      deletedAt: null,
      // Role is only (re)set when a soft-removed seat comes back, as before.
      // Touching a LIVE seat's role here would silently demote an admin who
      // happens to appear in an imported spreadsheet.
      ...(isNewRosterSeat
        ? // A revived seat has had no invite either — sendInvite clears this.
          { role: EventMemberRole.ATTENDEE, addedWithoutInviteAt: new Date() }
        : {}),
      ...labelPatch,
    },
  });

  return { ok: true, userId, email, name, isNewUser, isNewRosterSeat, participantLabel };
}

/**
 * W-2 — the email half: mint a fresh setup token for a seat that already
 * exists and send the invite. Clearing addedWithoutInviteAt is what moves the
 * roster row off "Not invited".
 */
async function sendInvite(
  event: EventRef,
  target: { userId: string; email: string; name: string },
): Promise<{ ok: true; inviteUrl: string; emailDelivered: boolean; emailFallbackMessage?: string }> {
  const { raw, hash, expiresAt } = newInviteToken();
  const base = env.webBaseUrl.replace(/\/$/, "");

  await prisma.user.update({
    where: { id: target.userId },
    data: { profileSetupTokenHash: hash, profileSetupTokenExpiresAt: expiresAt },
  });
  await prisma.eventMembership.updateMany({
    where: { eventId: event.id, userId: target.userId },
    data: { addedWithoutInviteAt: null },
  });

  const membership = await prisma.eventMembership.findUnique({
    where: { eventId_userId: { eventId: event.id, userId: target.userId } },
    select: { checkInCode: true },
  });

  const minted = await ensureEventJoinToken(event.id);
  const joinPath = minted.raw ? `${base}/e/join/${minted.raw}` : `${base}/e/${event.slug}`;
  const inviteUrl = `${base}/invite/${raw}?event=${encodeURIComponent(event.id)}`;

  const mailResult = await sendParticipantInviteEmail({
    to: target.email,
    name: target.name,
    eventName: event.name,
    inviteUrl,
    permanentEventUrl: joinPath,
    expiresInDays: env.inviteTokenDays,
    checkInCode: membership?.checkInCode ?? null,
  });

  return {
    ok: true,
    inviteUrl,
    emailDelivered: mailResult.delivered,
    emailFallbackMessage: mailResult.fallbackMessage,
  };
}

/** The pre-W-2 behavior, now a composition: seat, then email. */
async function createAndEmailInvite(
  event: EventRef,
  data: InviteInput,
): Promise<
  | { ok: true; inviteUrl: string; emailDelivered: boolean; emailFallbackMessage?: string }
  | { ok: false; error: string; status?: number; body?: Record<string, unknown> }
> {
  const seat = await ensureRosterSeat(event, data);
  if (!seat.ok) {
    const { ok, error, status, body } = seat;
    return { ok, error, status, body };
  }
  return sendInvite(event, { userId: seat.userId, email: seat.email, name: seat.name });
}

attendeesRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    const access = await requireEventAccess(req.user!.id, event.id);
    if (!access.canManageEvent) {
      await requireFeature(event.id, "attendee_directory");
    }
    const { take, cursor } = parsePagination(req.query);

    let cursorMembershipId: string | undefined;
    if (cursor) {
      const cursorRow = await prisma.eventMembership.findUnique({
        where: { eventId_userId: { eventId: event.id, userId: cursor } },
        select: { id: true },
      });
      if (cursorRow) cursorMembershipId = cursorRow.id;
    }

    const members = await prisma.eventMembership.findMany({
      where: {
        eventId: event.id,
        deletedAt: null,
        ...(access.canManageEvent
          ? {}
          : { OR: [{ directoryOptIn: true }, { userId: req.user!.id }] }),
      },
      include: {
        user: {
          select: {
            ...attendeePublicSelect,
            profileSetupTokenHash: true,
            profileSetupTokenExpiresAt: true,
          },
        },
      },
      orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
      ...(cursorMembershipId ? { cursor: { id: cursorMembershipId }, skip: 1 } : {}),
      take: take + 1,
    });

    const mapped = members.map((m) => {
      if (!access.canManageEvent) {
        return {
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.user.role,
          photoUrl: m.user.photoUrl,
          researchInterests: m.user.researchInterests,
          title: m.user.title,
          affiliation: m.user.affiliation,
          bio: m.user.bio,
          participantLabel: m.participantLabel ?? null,
          eventRole: m.role,
          directoryOptIn: m.directoryOptIn,
        };
      }
      const u = m.user;
      const pending = u.profileSetupTokenHash != null;
      const expiresAt = u.profileSetupTokenExpiresAt;
      // W-2: NOT_INVITED is the fourth state — a seat added from a spreadsheet
      // that has never been emailed.
      const inviteStatus = deriveInviteStatus({
        profileSetupTokenHash: u.profileSetupTokenHash,
        profileSetupTokenExpiresAt: expiresAt,
        addedWithoutInviteAt: m.addedWithoutInviteAt,
      });
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        photoUrl: u.photoUrl,
        researchInterests: u.researchInterests,
        title: u.title,
        affiliation: u.affiliation,
        bio: u.bio,
        participantLabel: m.participantLabel ?? null,
        eventRole: m.role,
        directoryOptIn: m.directoryOptIn,
        inviteStatus,
        inviteExpiresAt: pending && expiresAt ? expiresAt.toISOString() : null,
      };
    });

    const page = slicePage(mapped, take);
    setPageHeaders(res, page);
    return res.json(page.items);
  }),
);

attendeesRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const m = await prisma.eventMembership.findFirst({
      where: { eventId: event.id, userId: req.user!.id, deletedAt: null },
    });
    if (!m) throw new HttpError(404, { error: "Not a member of this event" });
    const welcomeSeenAt = (m as { welcomeSeenAt?: Date | null }).welcomeSeenAt ?? null;
    return res.json({
      directoryOptIn: m.directoryOptIn,
      matchMeEnabled: m.matchMeEnabled,
      messagePolicy: m.messagePolicy ?? "ANYONE",
      role: m.role,
      participantLabel: m.participantLabel ?? null,
      welcomeSeenAt: welcomeSeenAt ? welcomeSeenAt.toISOString() : null,
    });
  }),
);

const membershipLabelSchema = z.object({
  participantLabel: z.string().max(40).nullable(),
});

/** Attendee self-set: pick (or clear) this event's participant label. */
attendeesRouter.put(
  "/me",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = membershipLabelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const participantLabel = await setMembershipParticipantLabel({
      eventId: event.id,
      userId: req.user!.id,
      label: parsed.data.participantLabel,
    });
    return res.json({ participantLabel });
  }),
);

attendeesRouter.put(
  "/me/directory",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        directoryOptIn: z.boolean(),
        messagePolicy: z.enum(["ANYONE", "EXISTING_ONLY", "NONE"]).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const updated = await prisma.eventMembership.updateMany({
      where: { eventId: event.id, userId: req.user!.id, deletedAt: null },
      data: {
        directoryOptIn: parsed.data.directoryOptIn,
        ...(parsed.data.messagePolicy ? { messagePolicy: parsed.data.messagePolicy } : {}),
      },
    });
    if (updated.count === 0) throw new HttpError(404, { error: "Not a member of this event" });

    // On opt-in, enqueue join-batch match suggestions (DIGEST) when matchmaker is live.
    if (parsed.data.directoryOptIn) {
      const { maybeEnqueueJoinMatch } = await import("../lib/ai/matchmaker");
      await maybeEnqueueJoinMatch({
        eventId: event.id,
        organizationId: event.organizationId,
        userId: req.user!.id,
      }).catch(() => undefined);
    }

    return res.json({
      directoryOptIn: parsed.data.directoryOptIn,
      ...(parsed.data.messagePolicy ? { messagePolicy: parsed.data.messagePolicy } : {}),
    });
  }),
);

attendeesRouter.put(
  "/me/match-me",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z.object({ matchMeEnabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const updated = await prisma.eventMembership.updateMany({
      where: { eventId: event.id, userId: req.user!.id, deletedAt: null },
      data: { matchMeEnabled: parsed.data.matchMeEnabled },
    });
    if (updated.count === 0) throw new HttpError(404, { error: "Not a member of this event" });
    return res.json({ matchMeEnabled: parsed.data.matchMeEnabled });
  }),
);

attendeesRouter.post(
  "/me/welcome-seen",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id);
    const m = await prisma.eventMembership.findFirst({
      where: { eventId: event.id, userId: req.user!.id, deletedAt: null },
    });
    if (!m) throw new HttpError(404, { error: "Not a member of this event" });
    const existing = (m as { welcomeSeenAt?: Date | null }).welcomeSeenAt ?? null;
    if (existing) {
      return res.json({ welcomeSeenAt: existing.toISOString() });
    }
    const now = new Date();
    await prisma.eventMembership.update({
      where: { id: m.id },
      data: { welcomeSeenAt: now } as never,
    });
    const stamped = await prisma.eventMembership.findUnique({ where: { id: m.id } });
    const at = (stamped as { welcomeSeenAt?: Date | null } | null)?.welcomeSeenAt ?? now;
    return res.json({ welcomeSeenAt: at.toISOString() });
  }),
);

attendeesRouter.post(
  "/invite",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const result = await createAndEmailInvite(event, parsed.data);
    if (!result.ok) {
      if (result.status && result.body) {
        return res.status(result.status).json(result.body);
      }
      return res.status(409).json({ error: result.error });
    }
    const { markEventChecklistDone } = await import("../lib/onboarding/checklist");
    await markEventChecklistDone(event.id, "invite_attendees").catch(() => undefined);
    return res.json({
      ok: true,
      inviteUrl: result.inviteUrl,
      emailDelivered: result.emailDelivered,
      emailFallbackMessage: result.emailFallbackMessage,
    });
  }),
);

const dryRunSchema = z.object({
  headers: z.array(z.string()).min(1),
  rows: z.array(z.record(z.string())).max(500),
  mapping: z
    .record(z.enum(["email", "name", "description", "bio", "photoUrl", "label", "skip"]))
    .optional(),
});

attendeesRouter.post(
  "/invite-dry-run",
  requireAuth,
  requireCsrf,
  authRateLimit({ windowMs: 60_000, max: 10, keyBy: "user" }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = dryRunSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const members = await prisma.eventMembership.findMany({
      where: { eventId: event.id, deletedAt: null },
      include: { user: { select: { email: true } } },
    });
    const existingEmails = members.map((m) => m.user.email);

    const { dryRunCsvInvites } = await import("../lib/csvInviteDryRun");
    const result = dryRunCsvInvites({
      headers: parsed.data.headers,
      rows: parsed.data.rows,
      mapping: parsed.data.mapping,
      existingEmails,
      // W-2: a mapped label column is validated here, so an unknown label is a
      // visible row error in the review instead of a silently dropped value.
      eventLabels: parseParticipantLabels(
        (
          await prisma.event.findUniqueOrThrow({
            where: { id: event.id },
            select: { participantLabelsJson: true },
          })
        ).participantLabelsJson,
      ),
    });
    return res.json(result);
  }),
);

attendeesRouter.post(
  "/invite-bulk",
  requireAuth,
  requireCsrf,
  authRateLimit({ windowMs: 60_000, max: 10, keyBy: "user" }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = inviteBulkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const seen = new Set<string>();
    const unique: InviteInput[] = [];
    for (const row of parsed.data.invites) {
      const key = row.email.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }

    const sent: {
      email: string;
      inviteUrl: string;
      emailDelivered: boolean;
      emailFallbackMessage?: string;
    }[] = [];
    const failed: { email: string; error: string }[] = [];

    for (const inv of unique) {
      const result = await createAndEmailInvite(event, inv);
      if (result.ok) {
        sent.push({
          email: inv.email.trim().toLowerCase(),
          inviteUrl: result.inviteUrl,
          emailDelivered: result.emailDelivered,
          emailFallbackMessage: result.emailFallbackMessage,
        });
      } else {
        if (result.status === 402 || result.status === 403) {
          return res.status(result.status).json({
            ...(result.body || { error: result.error }),
            sent,
            failed,
          });
        }
        failed.push({ email: inv.email.trim().toLowerCase(), error: result.error });
      }
    }

    const anyUndelivered = sent.some((s) => !s.emailDelivered);
    if (sent.length > 0) {
      const { markEventChecklistDone } = await import("../lib/onboarding/checklist");
      await markEventChecklistDone(event.id, "invite_attendees").catch(() => undefined);
    }
    return res.json({
      ok: true,
      sentCount: sent.length,
      failedCount: failed.length,
      sent,
      failed,
      emailFallbackMessage: anyUndelivered
        ? "Email delivery isn't set up — copy this invite link instead"
        : undefined,
    });
  }),
);

const importRowSchema = inviteSchema.extend({
  participantLabel: z.string().max(40).nullable().optional(),
});

const importSchema = z.object({
  participants: z.array(importRowSchema).min(1).max(200),
});

/**
 * W-2 — add spreadsheet rows to the roster and send NOTHING. Same dry-run →
 * confirm shape as invite-bulk, but it calls only ensureRosterSeat, so every
 * row lands as "Not invited" until the organizer sends invites deliberately.
 */
attendeesRouter.post(
  "/import",
  requireAuth,
  requireCsrf,
  authRateLimit({ windowMs: 60_000, max: 10, keyBy: "user" }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const seen = new Set<string>();
    const unique: z.infer<typeof importRowSchema>[] = [];
    for (const row of parsed.data.participants) {
      const key = row.email.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }

    // Labels are checked for the whole batch first: a mapping mistake stops the
    // import instead of writing half a roster (the dry-run flags these too).
    const eventLabels = parseParticipantLabels(
      (
        await prisma.event.findUniqueOrThrow({
          where: { id: event.id },
          select: { participantLabelsJson: true },
        })
      ).participantLabelsJson,
    );
    const invalidLabels = unique
      .filter((row) => row.participantLabel != null && row.participantLabel.trim() !== "")
      .filter((row) => !normalizeMembershipLabel(row.participantLabel!, eventLabels).ok)
      .map((row) => ({ email: row.email.trim().toLowerCase(), label: row.participantLabel!.trim() }));
    if (invalidLabels.length > 0) {
      return res.status(400).json({
        error: "Some rows use a label this event doesn't define. Nothing was imported.",
        invalidLabels,
      });
    }

    const created: {
      userId: string;
      email: string;
      name: string;
      participantLabel: string | null;
      isNewUser: boolean;
    }[] = [];
    const skipped: { email: string; reason: string }[] = [];

    // Rows for people already on the roster are reported without writing
    // anything — importing a list twice must not touch existing members.
    const onRoster = new Set(
      (
        await prisma.eventMembership.findMany({
          where: {
            eventId: event.id,
            deletedAt: null,
            user: { email: { in: [...seen] } },
          },
          select: { user: { select: { email: true } } },
        })
      ).map((m) => m.user.email.toLowerCase()),
    );

    for (const row of unique) {
      const rowEmail = row.email.trim().toLowerCase();
      if (onRoster.has(rowEmail)) {
        skipped.push({ email: rowEmail, reason: "Already on the roster" });
        continue;
      }
      const seat = await ensureRosterSeat(event, row);
      if (seat.ok) {
        if (!seat.isNewRosterSeat) {
          skipped.push({ email: seat.email, reason: "Already on the roster" });
          continue;
        }
        created.push({
          userId: seat.userId,
          email: seat.email,
          name: seat.name,
          participantLabel: seat.participantLabel,
          isNewUser: seat.isNewUser,
        });
        continue;
      }
      // A seat limit stops the run — the rows already added stay added, and the
      // response says exactly which ones they were (J-A #13).
      if (seat.status === 402 || seat.status === 403) {
        return res.status(seat.status).json({
          ...(seat.body || { error: seat.error }),
          createdCount: created.length,
          skippedCount: skipped.length,
          created,
          skipped,
          emailsSent: false,
        });
      }
      skipped.push({ email: row.email.trim().toLowerCase(), reason: seat.error });
    }

    // Deliberately NOT marking the "Invite attendees" checklist step: no one
    // has been invited yet.
    return res.json({
      ok: true,
      createdCount: created.length,
      skippedCount: skipped.length,
      created,
      skipped,
      emailsSent: false,
    });
  }),
);

const sendInvitesSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(200),
});

/**
 * W-2 — the deliberate second step: mint tokens and email the roster members
 * the organizer picked. Members who already finished setup are reported, not
 * emailed; every per-item outcome comes back so the UI can show the breakdown.
 */
attendeesRouter.post(
  "/send-invites",
  requireAuth,
  requireCsrf,
  authRateLimit({ windowMs: 60_000, max: 10, keyBy: "user" }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = sendInvitesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(validationErrorBody(parsed.error));
    }
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const userIds = [...new Set(parsed.data.userIds)];
    const members = await prisma.eventMembership.findMany({
      where: { eventId: event.id, userId: { in: userIds }, deletedAt: null },
      select: {
        userId: true,
        addedWithoutInviteAt: true,
        user: {
          select: {
            name: true,
            email: true,
            profileSetupTokenHash: true,
            profileSetupTokenExpiresAt: true,
          },
        },
      },
    });
    const byUserId = new Map(members.map((m) => [m.userId, m]));

    type SendResult = {
      userId: string;
      email: string | null;
      status: "sent" | "failed" | "already-active";
      emailDelivered?: boolean;
      inviteUrl?: string;
      error?: string;
    };
    const results: SendResult[] = [];

    for (const userId of userIds) {
      const member = byUserId.get(userId);
      if (!member) {
        results.push({
          userId,
          email: null,
          status: "failed",
          error: "Not on this event's roster",
        });
        continue;
      }
      const status = deriveInviteStatus({
        profileSetupTokenHash: member.user.profileSetupTokenHash,
        profileSetupTokenExpiresAt: member.user.profileSetupTokenExpiresAt,
        addedWithoutInviteAt: member.addedWithoutInviteAt,
      });
      if (status === "ACTIVE") {
        results.push({ userId, email: member.user.email, status: "already-active" });
        continue;
      }
      try {
        const sent = await sendInvite(event, {
          userId,
          email: member.user.email,
          name: member.user.name,
        });
        results.push({
          userId,
          email: member.user.email,
          status: "sent",
          emailDelivered: sent.emailDelivered,
          inviteUrl: sent.inviteUrl,
        });
      } catch (err) {
        results.push({
          userId,
          email: member.user.email,
          status: "failed",
          error: err instanceof Error ? err.message : "Invite failed",
        });
      }
    }

    const sentResults = results.filter((r) => r.status === "sent");
    if (sentResults.length > 0) {
      const { markEventChecklistDone } = await import("../lib/onboarding/checklist");
      await markEventChecklistDone(event.id, "invite_attendees").catch(() => undefined);
    }

    return res.json({
      ok: true,
      sentCount: sentResults.length,
      failedCount: results.filter((r) => r.status === "failed").length,
      alreadyActiveCount: results.filter((r) => r.status === "already-active").length,
      results,
      emailFallbackMessage: sentResults.some((r) => !r.emailDelivered)
        ? "Email delivery isn't set up — copy the invite links instead"
        : undefined,
    });
  }),
);

attendeesRouter.post(
  "/admin-access-request",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    const access = await requireEventAccess(req.user!.id, event.id);
    if (access.canManageEvent) {
      return res.status(400).json({ error: "You already have organizer access for this event." });
    }

    const me = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, name: true, email: true },
    });
    if (!me) throw new HttpError(404, { error: "User not found" });

    const existingPending = await prisma.adminAccessRequest.findFirst({
      where: { eventId: event.id, userId: me.id, status: "PENDING" },
    });
    if (existingPending) {
      return res.json({ ok: true, alreadyRequested: true });
    }

    await prisma.adminAccessRequest.create({
      data: {
        organizationId: event.organizationId,
        eventId: event.id,
        userId: me.id,
        status: "PENDING",
      },
    });

    const owners = await prisma.orgMembership.findMany({
      where: { organizationId: event.organizationId, role: OrgRole.OWNER },
      select: { userId: true },
    });
    if (owners.length === 0) {
      return res.status(503).json({ error: "No organization owners are available to review this request." });
    }

    const title = "Administrator access requested";
    const body = `${me.name} (${me.email}) requested administrator access for ${event.name}. Only an organization OWNER can grant this.`;

    await notifyMany(
      owners
        .filter((row) => row.userId !== me.id)
        .map((row) => ({
          userId: row.userId,
          eventId: event.id,
          kind: NotificationKind.ADMIN_REQUEST,
          title,
          body,
        })),
    );

    return res.json({ ok: true });
  }),
);

attendeesRouter.get(
  "/admin-access-requests",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    const access = await requireEventAccess(req.user!.id, event.id, { manage: true });

    const requests = await prisma.adminAccessRequest.findMany({
      where: { eventId: event.id, status: "PENDING" },
      include: {
        user: { select: { id: true, name: true, email: true, photoUrl: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return res.json({
      requests,
      canGrant: access.orgRole === OrgRole.OWNER,
    });
  }),
);

attendeesRouter.post(
  "/admin-access-requests/:requestId/grant",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { ownerOnly: true });

    const request = await prisma.adminAccessRequest.findFirst({
      where: { id: req.params.requestId, eventId: event.id, status: "PENDING" },
    });
    if (!request) throw new HttpError(404, { error: "Request not found" });

    await prisma.$transaction(async (tx) => {
      await tx.adminAccessRequest.update({
        where: { id: request.id },
        data: {
          status: "GRANTED",
          resolvedAt: new Date(),
          resolvedById: req.user!.id,
        },
      });
      await tx.orgMembership.upsert({
        where: {
          organizationId_userId: { organizationId: event.organizationId, userId: request.userId },
        },
        create: {
          organizationId: event.organizationId,
          userId: request.userId,
          role: OrgRole.ADMIN,
        },
        update: { role: OrgRole.ADMIN },
      });
      await tx.eventMembership.upsert({
        where: { eventId_userId: { eventId: event.id, userId: request.userId } },
        create: { eventId: event.id, userId: request.userId, role: EventMemberRole.ADMIN },
        update: { role: EventMemberRole.ADMIN },
      });
      // Keep legacy global role for UI that still checks user.role during transition.
      await tx.user.update({
        where: { id: request.userId },
        data: { role: "ADMIN" },
      });
    });

    return res.json({ ok: true });
  }),
);

attendeesRouter.post(
  "/admin-access-requests/:requestId/deny",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { ownerOnly: true });

    const request = await prisma.adminAccessRequest.findFirst({
      where: { id: req.params.requestId, eventId: event.id, status: "PENDING" },
    });
    if (!request) throw new HttpError(404, { error: "Request not found" });

    await prisma.adminAccessRequest.update({
      where: { id: request.id },
      data: {
        status: "DENIED",
        resolvedAt: new Date(),
        resolvedById: req.user!.id,
      },
    });

    return res.json({ ok: true });
  }),
);

/** Promote event participant to event ADMIN + org ADMIN. OWNER-only. */
attendeesRouter.post(
  "/:id/make-admin",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { ownerOnly: true });

    const targetId = req.params.id;
    const membership = await prisma.eventMembership.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: targetId } },
    });
    if (!membership) throw new HttpError(404, { error: "Participant not found" });

    await prisma.$transaction(async (tx) => {
      await tx.orgMembership.upsert({
        where: {
          organizationId_userId: { organizationId: event.organizationId, userId: targetId },
        },
        create: { organizationId: event.organizationId, userId: targetId, role: OrgRole.ADMIN },
        update: { role: OrgRole.ADMIN },
      });
      await tx.eventMembership.update({
        where: { eventId_userId: { eventId: event.id, userId: targetId } },
        data: { role: EventMemberRole.ADMIN },
      });
      await tx.user.update({ where: { id: targetId }, data: { role: "ADMIN" } });
    });

    return res.json({ ok: true });
  }),
);

attendeesRouter.post(
  "/:id/remove-admin",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { ownerOnly: true });

    const targetId = req.params.id;
    if (targetId === req.user!.id) {
      return res.status(400).json({ error: "You cannot remove your own administrator access here." });
    }

    const orgMem = await prisma.orgMembership.findUnique({
      where: {
        organizationId_userId: { organizationId: event.organizationId, userId: targetId },
      },
    });
    if (orgMem?.role === OrgRole.OWNER) {
      return res.status(400).json({ error: "Cannot demote the organization owner." });
    }

    await prisma.$transaction(async (tx) => {
      if (orgMem) {
        await tx.orgMembership.update({
          where: { id: orgMem.id },
          data: { role: OrgRole.STAFF },
        });
      }
      await tx.eventMembership.updateMany({
        where: { eventId: event.id, userId: targetId },
        data: { role: EventMemberRole.ATTENDEE },
      });
      await tx.user.update({ where: { id: targetId }, data: { role: "ATTENDEE" } });
    });

    return res.json({ ok: true });
  }),
);

/** Organizer set/override of a member's label at this event. Clear = null. */
attendeesRouter.put(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = membershipLabelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });
    const targetId = req.params.id;
    const participantLabel = await setMembershipParticipantLabel({
      eventId: event.id,
      userId: targetId,
      label: parsed.data.participantLabel,
    });
    return res.json({ participantLabel });
  }),
);

attendeesRouter.delete(
  "/:id",
  requireAuth,
  requireCsrf,
  asyncHandler(async (req: AuthedRequest, res) => {
    const event = await resolveEventFromRequest(req);
    await requireEventAccess(req.user!.id, event.id, { manage: true });

    const targetId = req.params.id;
    if (targetId === req.user!.id) {
      return res.status(400).json({ error: "You cannot remove yourself" });
    }

    const membership = await prisma.eventMembership.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: targetId } },
      include: { user: { select: { id: true, role: true } } },
    });
    if (!membership || membership.deletedAt) throw new HttpError(404, { error: "Participant not found" });

    const orgMem = await prisma.orgMembership.findUnique({
      where: {
        organizationId_userId: { organizationId: event.organizationId, userId: targetId },
      },
    });
    if (orgMem && (orgMem.role === OrgRole.OWNER || orgMem.role === OrgRole.ADMIN)) {
      return res.status(403).json({ error: "Org admins cannot be removed from the roster here" });
    }

    await prisma.eventMembership.update({
      where: { eventId_userId: { eventId: event.id, userId: targetId } },
      data: { deletedAt: new Date() },
    });

    return res.json({
      ok: true,
      softDeleted: true,
      message: "Participant removed from the roster. Their data is retained for 30 days.",
    });
  }),
);
