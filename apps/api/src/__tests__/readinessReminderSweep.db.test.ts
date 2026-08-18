/**
 * ER5 — automatic readiness reminders (DB harness).
 *
 * One aggregated email per presenter per run; a second run sends nothing;
 * OVERDUE still fires once after a due date passes even though both upcoming
 * stages were already sent; revoked portals, never-invited speakers, and
 * archived events are left alone. The mailer is mocked — no email leaves this
 * test — and the sweep is driven by an explicit clock rather than real time.
 *
 * Does NOT set ALLOW_DESTRUCTIVE_DB.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import { EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import type { SendEmailInput } from "../lib/email";
import { hashPassword } from "../lib/auth";
import { getEmailProvider } from "../lib/email";
import { upsertFeatureOverrides } from "../lib/features";
import { newPortalToken } from "../lib/readiness/portalTokens";
import { sweepReadinessReminders } from "../lib/readiness/reminderSweep";

describe("readiness reminder sweep (DB, ER5)", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const now = new Date("2027-01-10T12:00:00Z");
  const DAY_MS = 24 * 60 * 60 * 1000;
  /** Both of Ada's deadlines are past by now — one reminder, subject "overdue". */
  const afterBothDue = new Date(now.getTime() + 6 * DAY_MS);
  /**
   * Invites are sent before the sweep runs. Minting them off this earlier clock
   * keeps the grace slot's carried expiry strictly older than the fresh 30 days
   * a reminder mints — minting both at `now` makes the two equal and the
   * comparison vacuous.
   */
  const invitedAt = new Date(now.getTime() - 3 * DAY_MS);

  const email = (who: string) => `er5-${who}-${stamp}@example.com`;
  const ADA = email("ada");
  const GRACE = email("grace");
  const IRIS = email("iris");
  const ZED = email("zed");
  const DRAFT_PRESENTER = email("draft");

  const ids: {
    adminId?: string;
    orgId?: string;
    eventId?: string;
    draftEventId?: string;
    archivedEventId?: string;
    adaId?: string;
    adaAccessId?: string;
    adaSlides?: string;
    adaBio?: string;
    adaInternal?: string;
    adaApproved?: string;
    graceBio?: string;
    irisBio?: string;
    zedBio?: string;
    draftBio?: string;
  } = {};
  /**
   * Mock the mailer: the sweep refuses to spend a reminder stage when email is
   * unconfigured, which is exactly the state a test environment is in.
   */
  function mockMailer() {
    const provider = getEmailProvider();
    vi.spyOn(provider, "isConfigured").mockReturnValue(true);
    return vi.spyOn(provider, "send").mockResolvedValue({ delivered: true });
  }

  let adaOriginalTokenHash = "";
  let adaOriginalExpiresAt: Date | null = null;
  /** ER5.1 — the hash the first reminder minted, so the second can retire it. */
  let adaFirstReminderTokenHash = "";
  let sendSpy: ReturnType<typeof mockMailer>;

  /** Only the mails this fixture caused — the sweep is global by design. */
  function fixtureMails(): SendEmailInput[] {
    return sendSpy.mock.calls
      .map((call) => call[0] as SendEmailInput)
      .filter((input) => input.to.endsWith(`-${stamp}@example.com`));
  }

  function mailsTo(address: string): SendEmailInput[] {
    return fixtureMails().filter((input) => input.to === address);
  }

  /** Ledger rows as sorted "assignmentId:stage" keys — order-independent. */
  async function ledgerFor(eventId: string): Promise<string[]> {
    const rows = await prisma.readinessReminderSend.findMany({
      where: { eventId },
      select: { assignmentId: true, stage: true },
    });
    return rows.map((row) => `${row.assignmentId}:${row.stage}`).sort();
  }

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const admin = await prisma.user.create({
      data: { email: email("admin"), name: "Reminder Admin", passwordHash, role: "ADMIN" },
    });
    ids.adminId = admin.id;

    // INTERNAL plan: the readiness entitlement is granted, so the per-event
    // override alone decides whether the feature is on.
    const org = await prisma.organization.create({
      data: {
        name: `Reminder Org ${stamp}`,
        slug: `er5-org-${stamp}`,
        plan: "INTERNAL",
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const makeEvent = async (label: string, status: EventStatus) =>
      prisma.event.create({
        data: {
          name: `Reminder ${label} ${stamp}`,
          slug: `er5-${label}-${stamp}`,
          timezone: "UTC",
          startDate: new Date("2027-03-01T12:00:00Z"),
          endDate: new Date("2027-03-03T12:00:00Z"),
          status,
          organizationId: org.id,
          createdById: admin.id,
        },
      });

    const event = await makeEvent("live", EventStatus.ACTIVE);
    const draftEvent = await makeEvent("draft", EventStatus.DRAFT);
    const archivedEvent = await makeEvent("archived", EventStatus.ARCHIVED);
    ids.eventId = event.id;
    ids.draftEventId = draftEvent.id;
    ids.archivedEventId = archivedEvent.id;
    for (const id of [event.id, draftEvent.id, archivedEvent.id]) {
      await upsertFeatureOverrides(id, { readiness: true });
    }

    const speaker = (eventId: string, name: string) =>
      prisma.speaker.create({ data: { eventId, name } });
    const ada = await speaker(event.id, "Dr. Ada Keynote");
    const grace = await speaker(event.id, "Prof. Grace Panelist");
    const iris = await speaker(event.id, "Iris Uninvited");
    const zed = await speaker(archivedEvent.id, "Zed Archived");
    const draftPresenter = await speaker(draftEvent.id, "Dana Draft");
    ids.adaId = ada.id;

    const template = async (eventId: string) =>
      prisma.readinessTemplate.create({
        data: { eventId, organizationId: org.id, name: "Presenter pack" },
      });
    const liveTemplate = await template(event.id);
    const draftTemplate = await template(draftEvent.id);
    const archivedTemplate = await template(archivedEvent.id);

    const requirement = (
      templateId: string,
      eventId: string,
      label: string,
      kind: string,
      dueAt: Date | null,
    ) =>
      prisma.readinessRequirement.create({
        data: { templateId, eventId, label, kind, dueAt, required: true },
      });

    // 5 days out → UPCOMING_7D; 1 day out → UPCOMING_2D.
    const reqSlides = await requirement(
      liveTemplate.id,
      event.id,
      "Upload slides",
      "file",
      new Date(now.getTime() + 5 * DAY_MS),
    );
    const reqBio = await requirement(
      liveTemplate.id,
      event.id,
      "Short bio",
      "short_text",
      new Date(now.getTime() + DAY_MS),
    );
    const reqInternal = await requirement(
      liveTemplate.id,
      event.id,
      "AV booked",
      "internal_checklist",
      new Date(now.getTime() + DAY_MS),
    );
    const reqHeadshot = await requirement(
      liveTemplate.id,
      event.id,
      "Headshot",
      "file",
      new Date(now.getTime() + DAY_MS),
    );
    const reqDraftBio = await requirement(
      draftTemplate.id,
      draftEvent.id,
      "Short bio",
      "short_text",
      new Date(now.getTime() + DAY_MS),
    );
    const reqArchivedBio = await requirement(
      archivedTemplate.id,
      archivedEvent.id,
      "Short bio",
      "short_text",
      new Date(now.getTime() + DAY_MS),
    );

    const assign = async (
      eventId: string,
      requirementId: string,
      speakerId: string,
      status: "NOT_STARTED" | "IN_PROGRESS" | "READY" = "NOT_STARTED",
    ) =>
      prisma.readinessAssignment.create({
        data: { organizationId: org.id, eventId, requirementId, speakerId, status },
      });

    ids.adaSlides = (await assign(event.id, reqSlides.id, ada.id)).id;
    ids.adaBio = (await assign(event.id, reqBio.id, ada.id, "IN_PROGRESS")).id;
    ids.adaInternal = (await assign(event.id, reqInternal.id, ada.id)).id;
    ids.adaApproved = (await assign(event.id, reqHeadshot.id, ada.id, "READY")).id;
    ids.graceBio = (await assign(event.id, reqBio.id, grace.id)).id;
    ids.irisBio = (await assign(event.id, reqSlides.id, iris.id)).id;
    ids.zedBio = (await assign(archivedEvent.id, reqArchivedBio.id, zed.id)).id;
    ids.draftBio = (await assign(draftEvent.id, reqDraftBio.id, draftPresenter.id)).id;

    const access = async (
      eventId: string,
      speakerId: string,
      to: string,
      revokedAt: Date | null = null,
    ) => {
      const token = newPortalToken(invitedAt);
      return prisma.readinessPortalAccess.create({
        data: {
          organizationId: org.id,
          eventId,
          speakerId,
          email: to,
          tokenHash: token.hash,
          expiresAt: token.expiresAt,
          revokedAt,
          lastSentAt: now,
        },
      });
    };
    const adaAccess = await access(event.id, ada.id, ADA);
    ids.adaAccessId = adaAccess.id;
    adaOriginalTokenHash = adaAccess.tokenHash;
    adaOriginalExpiresAt = adaAccess.expiresAt;
    await access(event.id, grace.id, GRACE, new Date(now.getTime() - DAY_MS));
    await access(archivedEvent.id, zed.id, ZED);
    await access(draftEvent.id, draftPresenter.id, DRAFT_PRESENTER);
    // Iris is deliberately never invited: no ReadinessPortalAccess row at all.

    sendSpy = mockMailer();
  }, 120_000);

  afterAll(async () => {
    const eventIds = [ids.eventId, ids.draftEventId, ids.archivedEventId].filter(
      (v): v is string => Boolean(v),
    );
    if (eventIds.length) {
      await prisma.readinessReminderSend.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.auditLog.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.readinessSubmission.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.readinessAssignment.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.readinessRequirement.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.readinessTemplate.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.readinessPortalAccess.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.speaker.deleteMany({ where: { eventId: { in: eventIds } } });
      await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.deleteMany({ where: { id: ids.orgId } });
    }
    if (ids.adminId) await prisma.user.deleteMany({ where: { id: ids.adminId } });
    vi.restoreAllMocks();
    await prisma.$disconnect();
  }, 120_000);

  beforeEach(() => {
    sendSpy?.mockClear();
  });

  it("emails each presenter once, aggregating their open items (DRAFT events included)", async () => {
    const result = await sweepReadinessReminders(now);
    expect(result.sent).toBeGreaterThanOrEqual(2);

    const adaMails = mailsTo(ADA);
    expect(adaMails).toHaveLength(1);
    const mail = adaMails[0]!;
    expect(mail.subject).toBe(`Reminder: materials due for Reminder live ${stamp}`);
    expect(mail.html).toContain("Upload slides");
    expect(mail.html).toContain("Short bio");
    // Organizer-only work and already-approved work are never mentioned.
    expect(mail.html).not.toContain("AV booked");
    expect(mail.html).not.toContain("Headshot");

    // The stored token is a hash, so the reminder mints a fresh working link.
    const access = await prisma.readinessPortalAccess.findUniqueOrThrow({
      where: { id: ids.adaAccessId! },
    });
    expect(access.tokenHash).not.toBe(adaOriginalTokenHash);
    expect(mail.html).toContain("/r/");
    expect(mail.copyUrl).toBeTruthy();
    adaFirstReminderTokenHash = access.tokenHash;

    // ER5.1 — the link from the invite email survives the reminder, on its own
    // original expiry rather than a new 30-day one.
    expect(access.previousTokenHash).toBe(adaOriginalTokenHash);
    expect(access.previousExpiresAt?.getTime()).toBe(adaOriginalExpiresAt?.getTime());
    expect(access.previousExpiresAt!.getTime()).toBeLessThan(access.expiresAt.getTime());

    // Two stages fired: 5 days out and 1 day out.
    expect(await ledgerFor(ids.eventId!)).toEqual(
      [`${ids.adaSlides}:UPCOMING_7D`, `${ids.adaBio}:UPCOMING_2D`].sort(),
    );

    // Readiness work happens before publication, so a DRAFT event still sends.
    expect(mailsTo(DRAFT_PRESENTER)).toHaveLength(1);
    expect(await ledgerFor(ids.draftEventId!)).toEqual([`${ids.draftBio}:UPCOMING_2D`]);

    // The activity feed sees an actorless row it can label "Automatic".
    const audit = await prisma.auditLog.findFirst({
      where: { eventId: ids.eventId!, entityType: "ReadinessPortalAccess" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorUserId).toBeNull();
    expect(audit?.payload).toMatchObject({
      action: "reminder",
      system: true,
      itemCount: 2,
      overdue: false,
      delivered: true,
    });
  }, 120_000);

  it("a second run at the same clock sends nothing — the ledger is the whole rule", async () => {
    await sweepReadinessReminders(now);
    expect(fixtureMails()).toHaveLength(0);
    expect(await ledgerFor(ids.eventId!)).toHaveLength(2);
    expect(await ledgerFor(ids.draftEventId!)).toHaveLength(1);
  }, 120_000);

  it("OVERDUE fires once after the due date, even though both upcoming stages were sent", async () => {
    await sweepReadinessReminders(afterBothDue);

    const adaMails = mailsTo(ADA);
    expect(adaMails).toHaveLength(1);
    expect(adaMails[0]!.subject).toBe(`Reminder: materials overdue for Reminder live ${stamp}`);
    expect(adaMails[0]!.html).toMatch(/overdue/i);

    expect(await ledgerFor(ids.eventId!)).toEqual(
      [
        `${ids.adaSlides}:UPCOMING_7D`,
        `${ids.adaSlides}:OVERDUE`,
        `${ids.adaBio}:UPCOMING_2D`,
        `${ids.adaBio}:OVERDUE`,
      ].sort(),
    );

    // ER5.1 — grace holds one link, not a growing pile: this reminder's link is
    // current, the last reminder's is in grace, and the invite's has fallen off.
    const access = await prisma.readinessPortalAccess.findUniqueOrThrow({
      where: { id: ids.adaAccessId! },
    });
    expect(access.tokenHash).not.toBe(adaFirstReminderTokenHash);
    expect(access.previousTokenHash).toBe(adaFirstReminderTokenHash);
    expect(access.previousTokenHash).not.toBe(adaOriginalTokenHash);

    // Overdue is the last word: a further sweep is silent.
    sendSpy.mockClear();
    await sweepReadinessReminders(new Date(afterBothDue.getTime() + 10 * DAY_MS));
    expect(mailsTo(ADA)).toHaveLength(0);
    expect(await ledgerFor(ids.eventId!)).toHaveLength(4);
  }, 120_000);

  it("never reminds a revoked portal, an uninvited speaker, or an archived event", async () => {
    await sweepReadinessReminders(afterBothDue);

    for (const address of [GRACE, IRIS, ZED]) {
      expect(mailsTo(address), address).toHaveLength(0);
    }
    expect(
      await prisma.readinessReminderSend.count({
        where: { assignmentId: { in: [ids.graceBio!, ids.irisBio!, ids.zedBio!] } },
      }),
    ).toBe(0);
    expect(await ledgerFor(ids.archivedEventId!)).toHaveLength(0);
  }, 120_000);

  it("does nothing at all when email delivery is not configured", async () => {
    const provider = getEmailProvider();
    const configured = vi.spyOn(provider, "isConfigured").mockReturnValue(false);
    try {
      const result = await sweepReadinessReminders(afterBothDue);
      expect(result).toEqual({ sent: 0, stagesRecorded: 0, skipped: "email_not_configured" });
      expect(fixtureMails()).toHaveLength(0);
    } finally {
      configured.mockReturnValue(true);
    }
  }, 120_000);
});
