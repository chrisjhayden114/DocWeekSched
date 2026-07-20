/**
 * Phase 6 Chunk C — onboarding checklist + sample event limits (DB).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import { OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { HttpError } from "../lib/authorization";
import { assertCanCreateEvent, applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { createSampleEventForOrg } from "../lib/demoEvent";
import {
  getPrimaryChecklistForUser,
  markEventChecklistDone,
} from "../lib/onboarding/checklist";
import { completeSetupCopilot } from "../lib/ai/setupCopilot/complete";
import { emptySetupFormState } from "@event-app/shared";

describe("Phase 6 onboarding (DB)", () => {
  const prisma = new PrismaClient();
  const ids: {
    userId?: string;
    orgId?: string;
    freeOrgId?: string;
    freeUserId?: string;
  } = {};
  let dbReady = false;
  const password = "TestPass12!x";

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.user.findFirst({
        select: { onboardingDismissedAt: true, sampleEventOfferedAt: true },
      });
      dbReady = true;
    } catch {
      console.warn(
        "[onboarding.db.test] DB unreachable or onboarding migration not applied — skipping",
      );
      return;
    }

    const passwordHash = await hashPassword(password);
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: {
        email: `onboard-${stamp}@example.com`,
        name: "Onboard Org",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: `Onboard Org ${stamp}`,
        slug: `onboard-org-${stamp}`,
        memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_monthly");

    const freeUser = await prisma.user.create({
      data: {
        email: `onboard-free-${stamp}@example.com`,
        name: "Free Cap",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.freeUserId = freeUser.id;
    const freeOrg = await prisma.organization.create({
      data: {
        name: `Free Cap ${stamp}`,
        slug: `free-cap-${stamp}`,
        plan: "FREE",
        eventAllowance: 1,
        memberships: { create: { userId: freeUser.id, role: OrgRole.OWNER } },
      },
    });
    ids.freeOrgId = freeOrg.id;
  });

  afterAll(async () => {
    if (dbReady) {
      for (const orgId of [ids.orgId, ids.freeOrgId]) {
        if (!orgId) continue;
        const events = await prisma.event.findMany({ where: { organizationId: orgId }, select: { id: true } });
        for (const e of events) {
          await prisma.sessionItemAuthor.deleteMany({
            where: { sessionItem: { session: { eventId: e.id } } },
          });
          await prisma.sessionItem.deleteMany({ where: { session: { eventId: e.id } } });
          await prisma.sessionSpeaker.deleteMany({ where: { session: { eventId: e.id } } });
          await prisma.session.deleteMany({ where: { eventId: e.id } });
          await prisma.speaker.deleteMany({ where: { eventId: e.id } });
          await prisma.sponsor.deleteMany({ where: { eventId: e.id } });
          await prisma.track.deleteMany({ where: { eventId: e.id } });
          await prisma.eventMembership.deleteMany({ where: { eventId: e.id } });
          await prisma.eventFeatureConfig.deleteMany({ where: { eventId: e.id } });
          await prisma.event.delete({ where: { id: e.id } }).catch(() => undefined);
        }
        await prisma.eventSeries.deleteMany({ where: { organizationId: orgId } });
        await prisma.orgMembership.deleteMany({ where: { organizationId: orgId } });
        await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
      }
      if (ids.userId) await prisma.user.delete({ where: { id: ids.userId } }).catch(() => undefined);
      if (ids.freeUserId) await prisma.user.delete({ where: { id: ids.freeUserId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("onboarding dismiss persists across reads", async () => {
    if (!dbReady) return;
    await prisma.user.update({
      where: { id: ids.userId! },
      data: { onboardingDismissedAt: null, sampleEventOfferedAt: null },
    });
    await prisma.user.update({
      where: { id: ids.userId! },
      data: { onboardingDismissedAt: new Date(), sampleEventOfferedAt: new Date() },
    });
    const again = await prisma.user.findUniqueOrThrow({
      where: { id: ids.userId! },
      select: { onboardingDismissedAt: true, sampleEventOfferedAt: true },
    });
    expect(again.onboardingDismissedAt).not.toBeNull();
    expect(again.sampleEventOfferedAt).not.toBeNull();
  });

  it("Setup Copilot marks steps 1–2; invite/publish mark 3–4", async () => {
    if (!dbReady) return;
    const form = emptySetupFormState("UTC");
    form.name = "Copilot Checklist Event";
    form.startDate = "2027-10-01";
    form.endDate = "2027-10-02";
    form.timezone = "UTC";
    form.estimatedSize = "50";
    form.eventType = "conference";
    form.hasProgramDocument = false;

    const result = await completeSetupCopilot({
      organizationId: ids.orgId!,
      actorUserId: ids.userId!,
      form,
      webBaseUrl: "http://localhost:3000",
    });

    const event = await prisma.event.findUniqueOrThrow({
      where: { id: result.eventId },
      select: { seriesId: true, series: { select: { setupChecklist: true } } },
    });
    const checklist = event.series!.setupChecklist as { key: string; done: boolean }[];
    expect(checklist.find((c) => c.key === "create_event")?.done).toBe(true);
    expect(checklist.find((c) => c.key === "add_sessions")?.done).toBe(true);
    expect(checklist.find((c) => c.key === "invite_attendees")?.done).toBe(false);
    expect(checklist.find((c) => c.key === "publish")?.done).toBe(false);

    await markEventChecklistDone(result.eventId, "invite_attendees");
    await markEventChecklistDone(result.eventId, "publish");

    const after = await prisma.eventSeries.findUniqueOrThrow({
      where: { id: event.seriesId! },
      select: { setupChecklist: true },
    });
    const list = after.setupChecklist as { key: string; done: boolean }[];
    expect(list.find((c) => c.key === "invite_attendees")?.done).toBe(true);
    expect(list.find((c) => c.key === "publish")?.done).toBe(true);

    const primary = await getPrimaryChecklistForUser(ids.userId!);
    expect(primary.eventId).toBe(result.eventId);
    expect(primary.checklist.every((c) => c.done)).toBe(true);
  });

  it("sample-event creation respects event limit entitlement", async () => {
    if (!dbReady) return;
    // Fill FREE allowance (1)
    await createSampleEventForOrg({
      organizationId: ids.freeOrgId!,
      actorUserId: ids.freeUserId!,
    });
    await expect(assertCanCreateEvent(ids.freeOrgId!)).rejects.toMatchObject({ status: 402 });
    try {
      await assertCanCreateEvent(ids.freeOrgId!);
      expect.fail("expected PLAN_LIMIT");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const body = (err as HttpError).body as { upgrade?: { code?: string } };
      expect(body.upgrade?.code).toBe("PLAN_LIMIT");
    }
  });
});
