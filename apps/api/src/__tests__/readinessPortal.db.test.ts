/**
 * ER4 — presenter portal (DB harness).
 *
 * Mint → GET returns only own assignments; submit text → SUBMITTED + supersede
 * on resubmit; oversized/wrong-type file rejected; approve → READY + audit;
 * reject stores reason → IN_PROGRESS; expired and revoked tokens 404;
 * cross-speaker assignmentId 404; organizer file route 403 for attendees.
 *
 * Does NOT set ALLOW_DESTRUCTIVE_DB.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { EventMemberRole, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword, hashToken, signToken } from "../lib/auth";
import { upsertFeatureOverrides } from "../lib/features";
import { _resetRateLimitBucketsForTests } from "../lib/rateLimit";
import { portalRouter } from "../routes/portal";
import { readinessRouter } from "../routes/readiness";

describe("readiness presenter portal (DB, ER4)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    adminA?: string;
    attendeeA?: string;
    orgA?: string;
    eventA?: string;
    speaker1?: string;
    speaker2?: string;
    textAssignment1?: string;
    fileAssignment1?: string;
    textAssignment2?: string;
    accessId?: string;
    submissionId?: string;
    fileSubmissionId?: string;
  } = {};
  let rawToken = "";
  let supersededId = "";

  beforeAll(async () => {
    const stamp = Date.now();
    const passwordHash = await hashPassword("TestPass12!x");

    const adminA = await prisma.user.create({
      data: { email: `rdy4-admin-${stamp}@example.com`, name: "Portal Admin", passwordHash, role: "ADMIN" },
    });
    const attendeeA = await prisma.user.create({
      data: { email: `rdy4-att-${stamp}@example.com`, name: "Portal Attendee", passwordHash, role: "ATTENDEE" },
    });
    ids.adminA = adminA.id;
    ids.attendeeA = attendeeA.id;

    const orgA = await prisma.organization.create({
      data: {
        name: `Portal Org ${stamp}`,
        slug: `rdy4-org-${stamp}`,
        plan: "INTERNAL",
        memberships: { create: { userId: adminA.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgA = orgA.id;

    const eventA = await prisma.event.create({
      data: {
        name: `Portal Event ${stamp}`,
        slug: `rdy4-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-03-01T12:00:00Z"),
        endDate: new Date("2027-03-03T12:00:00Z"),
        organizationId: orgA.id,
        createdById: adminA.id,
        brandColor: "#334155",
        memberships: {
          create: [
            { userId: adminA.id, role: EventMemberRole.ADMIN },
            { userId: attendeeA.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    ids.eventA = eventA.id;

    const speaker1 = await prisma.speaker.create({
      data: { eventId: eventA.id, name: "Dr. Ada Keynote" },
    });
    const speaker2 = await prisma.speaker.create({
      data: { eventId: eventA.id, name: "Prof. Grace Panelist" },
    });
    ids.speaker1 = speaker1.id;
    ids.speaker2 = speaker2.id;

    const template = await prisma.readinessTemplate.create({
      data: {
        eventId: eventA.id,
        organizationId: orgA.id,
        name: "Presenter pack",
      },
    });
    const reqText = await prisma.readinessRequirement.create({
      data: {
        templateId: template.id,
        eventId: eventA.id,
        label: "Short bio",
        kind: "short_text",
        required: true,
        sortOrder: 0,
      },
    });
    const reqFile = await prisma.readinessRequirement.create({
      data: {
        templateId: template.id,
        eventId: eventA.id,
        label: "Headshot",
        kind: "file",
        required: true,
        sortOrder: 1,
        config: { maxBytes: 200 },
      },
    });
    const reqInternal = await prisma.readinessRequirement.create({
      data: {
        templateId: template.id,
        eventId: eventA.id,
        label: "AV booked",
        kind: "internal_checklist",
        required: true,
        sortOrder: 2,
      },
    });

    const a1text = await prisma.readinessAssignment.create({
      data: {
        organizationId: orgA.id,
        eventId: eventA.id,
        requirementId: reqText.id,
        speakerId: speaker1.id,
      },
    });
    const a1file = await prisma.readinessAssignment.create({
      data: {
        organizationId: orgA.id,
        eventId: eventA.id,
        requirementId: reqFile.id,
        speakerId: speaker1.id,
      },
    });
    await prisma.readinessAssignment.create({
      data: {
        organizationId: orgA.id,
        eventId: eventA.id,
        requirementId: reqInternal.id,
        speakerId: speaker1.id,
      },
    });
    const a2text = await prisma.readinessAssignment.create({
      data: {
        organizationId: orgA.id,
        eventId: eventA.id,
        requirementId: reqText.id,
        speakerId: speaker2.id,
      },
    });
    ids.textAssignment1 = a1text.id;
    ids.fileAssignment1 = a1file.id;
    ids.textAssignment2 = a2text.id;

    await upsertFeatureOverrides(eventA.id, { readiness: true });

    const app = express();
    app.use(express.json({ limit: "30mb" }));
    app.use("/readiness", readinessRouter);
    app.use("/portal", portalRouter);
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const httpErr = err as { status?: number; body?: Record<string, unknown> };
        if (typeof httpErr?.status === "number" && httpErr.body) {
          return res.status(httpErr.status).json(httpErr.body);
        }
        return res.status(500).json({ error: "Internal server error" });
      },
    );
    await new Promise<void>((resolveListen) => {
      server = app.listen(0, "127.0.0.1", resolveListen);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    _resetRateLimitBucketsForTests();
  }, 60_000);

  afterAll(async () => {
    if (ids.eventA) {
      await prisma.auditLog.deleteMany({ where: { eventId: ids.eventA } });
      await prisma.readinessSubmission.deleteMany({ where: { eventId: ids.eventA } });
      await prisma.readinessAssignment.deleteMany({ where: { eventId: ids.eventA } });
      await prisma.readinessRequirement.deleteMany({ where: { eventId: ids.eventA } });
      await prisma.readinessTemplate.deleteMany({ where: { eventId: ids.eventA } });
      await prisma.readinessPortalAccess.deleteMany({ where: { eventId: ids.eventA } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId: ids.eventA } });
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventA } });
      await prisma.speaker.deleteMany({ where: { eventId: ids.eventA } });
      await prisma.event.delete({ where: { id: ids.eventA } }).catch(() => undefined);
    }
    if (ids.orgA) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgA } });
      await prisma.organization.delete({ where: { id: ids.orgA } }).catch(() => undefined);
    }
    for (const userId of [ids.adminA, ids.attendeeA]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  function adminHeaders() {
    return {
      authorization: `Bearer ${signToken({ userId: ids.adminA!, role: "ADMIN" })}`,
      "content-type": "application/json",
      "x-event-id": ids.eventA!,
    };
  }

  function attendeeHeaders() {
    return {
      authorization: `Bearer ${signToken({ userId: ids.attendeeA!, role: "ATTENDEE" })}`,
      "content-type": "application/json",
      "x-event-id": ids.eventA!,
    };
  }

  it("mints a portal invite and GET returns only this speaker's assignments (no internal checklist)", async () => {
    const mint = await fetch(`${base}/readiness/portal-access`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ speakerId: ids.speaker1, email: "ada@example.com" }),
    });
    expect(mint.status).toBe(201);
    const minted = (await mint.json()) as { url: string; access: { id: string; email: string } };
    expect(minted.access.email).toBe("ada@example.com");
    expect(minted.url).toMatch(/\/r\/[0-9a-f]{64}$/);
    rawToken = minted.url.split("/r/")[1]!;
    ids.accessId = minted.access.id;

    const stored = await prisma.readinessPortalAccess.findUniqueOrThrow({
      where: { id: minted.access.id },
    });
    expect(stored.tokenHash).toBe(hashToken(rawToken));
    expect(stored.tokenHash).not.toBe(rawToken);

    const viewRes = await fetch(`${base}/portal/${rawToken}`);
    expect(viewRes.status).toBe(200);
    const view = (await viewRes.json()) as {
      speakerName: string;
      assignments: Array<{ id: string; requirement: { kind: string; label: string } }>;
    };
    expect(view.speakerName).toBe("Dr. Ada Keynote");
    expect(view.assignments.map((a) => a.requirement.kind).sort()).toEqual(["file", "short_text"]);
    expect(view.assignments.some((a) => a.requirement.kind === "internal_checklist")).toBe(false);
    expect(view.assignments.some((a) => a.id === ids.textAssignment2)).toBe(false);
    expect(JSON.stringify(view)).not.toContain(ids.speaker2);
  }, 60_000);

  it("submits text → SUBMITTED, and a resubmit supersedes the previous row", async () => {
    const first = await fetch(`${base}/portal/${rawToken}/assignments/${ids.textAssignment1}/submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "Ada writes programs." }),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: string; status: string };
    expect(firstBody.status).toBe("SUBMITTED");
    supersededId = firstBody.id;

    const assignment = await prisma.readinessAssignment.findUniqueOrThrow({
      where: { id: ids.textAssignment1! },
    });
    expect(assignment.status).toBe("SUBMITTED");

    const second = await fetch(`${base}/portal/${rawToken}/assignments/${ids.textAssignment1}/submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "Ada writes programs for the Analytical Engine." }),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { id: string };
    ids.submissionId = secondBody.id;
    expect(secondBody.id).not.toBe(supersededId);

    const old = await prisma.readinessSubmission.findUniqueOrThrow({ where: { id: supersededId } });
    expect(old.supersededAt).toBeInstanceOf(Date);
    const current = await prisma.readinessSubmission.findUniqueOrThrow({
      where: { id: secondBody.id },
    });
    expect(current.supersededAt).toBeNull();
    expect(current.valueText).toContain("Analytical Engine");
  }, 60_000);

  it("rejects oversized and wrong-type files before storage", async () => {
    const over = Buffer.alloc(250, 1);
    const oversized = await fetch(
      `${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/submission`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileUrl: `data:image/png;base64,${over.toString("base64")}`,
          fileName: "big.png",
          mime: "image/png",
        }),
      },
    );
    expect(oversized.status).toBe(400);
    const overBody = (await oversized.json()) as { reason?: string };
    expect(overBody.reason).toBe("too_large");

    const wrong = await fetch(`${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileUrl: "data:text/plain;base64,aGVsbG8=",
        fileName: "notes.txt",
        mime: "text/plain",
      }),
    });
    expect(wrong.status).toBe(400);
    const wrongBody = (await wrong.json()) as { reason?: string };
    expect(wrongBody.reason).toBe("wrong_type");

    expect(
      await prisma.readinessSubmission.count({ where: { assignmentId: ids.fileAssignment1 } }),
    ).toBe(0);
  }, 60_000);

  it("ER4.2 — link satisfies a file requirement; junk URL rejected; file path still works", async () => {
    const junk = await fetch(`${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "not-a-url" }),
    });
    expect(junk.status).toBe(400);
    expect(
      await prisma.readinessSubmission.count({ where: { assignmentId: ids.fileAssignment1 } }),
    ).toBe(0);

    const linked = await fetch(`${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "https://docs.google.com/presentation/d/abc123" }),
    });
    expect(linked.status).toBe(201);
    const linkBody = (await linked.json()) as { id: string; status: string };
    expect(linkBody.status).toBe("SUBMITTED");
    const linkRow = await prisma.readinessSubmission.findUniqueOrThrow({ where: { id: linkBody.id } });
    expect(linkRow.valueText).toBe("https://docs.google.com/presentation/d/abc123");
    expect(linkRow.fileUrl).toBeNull();
    expect(linkRow.fileStorageKey).toBeNull();
    expect(linkRow.fileName).toBeNull();
    expect(
      (await prisma.readinessAssignment.findUniqueOrThrow({ where: { id: ids.fileAssignment1! } })).status,
    ).toBe("SUBMITTED");

    // File path unchanged — uploading a file supersedes the link submission.
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const uploaded = await fetch(
      `${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/submission`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileUrl: `data:image/png;base64,${tinyPng.toString("base64")}`,
          fileName: "after-link.png",
          mime: "image/png",
        }),
      },
    );
    expect(uploaded.status).toBe(201);
    const fileBody = (await uploaded.json()) as { id: string };
    const supersededLink = await prisma.readinessSubmission.findUniqueOrThrow({
      where: { id: linkBody.id },
    });
    expect(supersededLink.supersededAt).toBeInstanceOf(Date);
    const fileRow = await prisma.readinessSubmission.findUniqueOrThrow({ where: { id: fileBody.id } });
    expect(fileRow.fileName).toBe("after-link.png");
    expect(fileRow.fileUrl).toBeTruthy();
    expect(fileRow.valueText).toBeNull();
  }, 60_000);

  it("approve → READY + audit; reject stores the reason and returns IN_PROGRESS", async () => {
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const uploaded = await fetch(
      `${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/submission`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileUrl: `data:image/png;base64,${tinyPng.toString("base64")}`,
          fileName: "headshot.png",
          mime: "image/png",
        }),
      },
    );
    expect(uploaded.status).toBe(201);
    const fileBody = (await uploaded.json()) as { id: string };
    ids.fileSubmissionId = fileBody.id;

    const approve = await fetch(`${base}/readiness/submissions/${ids.submissionId}`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ action: "approve" }),
    });
    expect(approve.status).toBe(200);
    const textAssignment = await prisma.readinessAssignment.findUniqueOrThrow({
      where: { id: ids.textAssignment1! },
    });
    expect(textAssignment.status).toBe("READY");
    const approveAudit = await prisma.auditLog.findFirst({
      where: {
        eventId: ids.eventA,
        entityType: "ReadinessAssignment",
        entityId: ids.textAssignment1,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(approveAudit?.payload).toMatchObject({ action: "approve" });

    const reject = await fetch(`${base}/readiness/submissions/${ids.fileSubmissionId}`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ action: "reject", reason: "Please use a higher-resolution photo." }),
    });
    expect(reject.status).toBe(200);
    const fileAssignment = await prisma.readinessAssignment.findUniqueOrThrow({
      where: { id: ids.fileAssignment1! },
    });
    expect(fileAssignment.status).toBe("IN_PROGRESS");
    const rejected = await prisma.readinessSubmission.findUniqueOrThrow({
      where: { id: ids.fileSubmissionId! },
    });
    expect(rejected.reviewNote).toBe("Please use a higher-resolution photo.");
    expect(rejected.rejectedAt).toBeInstanceOf(Date);
  }, 60_000);

  it("expired and revoked tokens 404 with an honest reason; a remint after revoke never revives the revoked link", async () => {
    await prisma.readinessPortalAccess.update({
      where: { id: ids.accessId! },
      data: { expiresAt: new Date("2020-01-01T00:00:00Z") },
    });
    const expired = await fetch(`${base}/portal/${rawToken}`);
    expect(expired.status).toBe(404);
    expect(await expired.json()).toMatchObject({ reason: "expired" });

    await prisma.readinessPortalAccess.update({
      where: { id: ids.accessId! },
      data: { expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), revokedAt: null },
    });

    const revoke = await fetch(`${base}/readiness/portal-access/${ids.accessId}/revoke`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(revoke.status).toBe(200);
    const revoked = await fetch(`${base}/portal/${rawToken}`);
    expect(revoked.status).toBe(404);
    expect(await revoked.json()).toMatchObject({ reason: "revoked" });

    // Reminting clears revokedAt, but the revoked token must not ride back in
    // on the ER5.1 grace slot — revocation is the one absolute answer.
    const remint = await fetch(`${base}/readiness/portal-access/${ids.accessId}/remint`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(remint.status).toBe(200);
    const reminted = (await remint.json()) as { url: string };
    const newRaw = reminted.url.split("/r/")[1]!;
    expect(newRaw).not.toBe(rawToken);
    const oldAfterRemint = await fetch(`${base}/portal/${rawToken}`);
    expect(oldAfterRemint.status).toBe(404);
    const graceless = await prisma.readinessPortalAccess.findUniqueOrThrow({
      where: { id: ids.accessId! },
    });
    expect(graceless.previousTokenHash).toBeNull();
    expect(graceless.previousExpiresAt).toBeNull();
    const fresh = await fetch(`${base}/portal/${newRaw}`);
    expect(fresh.status).toBe(200);
    rawToken = newRaw;
  }, 60_000);

  it("ER5.1 — a remint keeps the older link alive on its own expiry; a second remint retires the oldest; revoke kills both", async () => {
    const oldest = rawToken;
    const before = await prisma.readinessPortalAccess.findUniqueOrThrow({
      where: { id: ids.accessId! },
    });

    const remint = async () => {
      const res = await fetch(`${base}/readiness/portal-access/${ids.accessId}/remint`, {
        method: "POST",
        headers: adminHeaders(),
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { url: string }).url.split("/r/")[1]!;
    };

    // One remint: the presenter's bookmarked invite link still opens the portal.
    const middle = await remint();
    expect((await fetch(`${base}/portal/${oldest}`)).status).toBe(200);
    expect((await fetch(`${base}/portal/${middle}`)).status).toBe(200);

    const afterOne = await prisma.readinessPortalAccess.findUniqueOrThrow({
      where: { id: ids.accessId! },
    });
    expect(afterOne.previousTokenHash).toBe(hashToken(oldest));
    // Grace runs down the OLD clock: the carried expiry is the one it had.
    expect(afterOne.previousExpiresAt?.getTime()).toBe(before.expiresAt.getTime());
    expect(afterOne.previousExpiresAt!.getTime()).toBeLessThan(afterOne.expiresAt.getTime());

    // Using the older link is still using the portal — lastUsedAt moves either way.
    await prisma.readinessPortalAccess.update({
      where: { id: ids.accessId! },
      data: { lastUsedAt: null },
    });
    expect((await fetch(`${base}/portal/${oldest}`)).status).toBe(200);
    expect(
      (await prisma.readinessPortalAccess.findUniqueOrThrow({ where: { id: ids.accessId! } }))
        .lastUsedAt,
    ).toBeInstanceOf(Date);

    // Two remints: only one older link is ever kept, so the oldest goes dark.
    const newest = await remint();
    const oldestNow = await fetch(`${base}/portal/${oldest}`);
    expect(oldestNow.status).toBe(404);
    expect(await oldestNow.json()).toMatchObject({ reason: "unknown" });
    expect((await fetch(`${base}/portal/${middle}`)).status).toBe(200);
    expect((await fetch(`${base}/portal/${newest}`)).status).toBe(200);

    // The grace link dies on its own schedule while the current one lives on.
    await prisma.readinessPortalAccess.update({
      where: { id: ids.accessId! },
      data: { previousExpiresAt: new Date("2020-01-01T00:00:00Z") },
    });
    const staleGrace = await fetch(`${base}/portal/${middle}`);
    expect(staleGrace.status).toBe(404);
    expect(await staleGrace.json()).toMatchObject({ reason: "expired" });
    expect((await fetch(`${base}/portal/${newest}`)).status).toBe(200);

    // Revoke is absolute: current and grace links both stop, and the slot empties.
    await prisma.readinessPortalAccess.update({
      where: { id: ids.accessId! },
      data: { previousExpiresAt: afterOne.expiresAt },
    });
    expect((await fetch(`${base}/portal/${middle}`)).status).toBe(200);
    const revoke = await fetch(`${base}/readiness/portal-access/${ids.accessId}/revoke`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(revoke.status).toBe(200);
    for (const raw of [middle, newest]) {
      const res = await fetch(`${base}/portal/${raw}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ reason: "revoked" });
    }
    const cleared = await prisma.readinessPortalAccess.findUniqueOrThrow({
      where: { id: ids.accessId! },
    });
    expect(cleared.previousTokenHash).toBeNull();
    expect(cleared.previousExpiresAt).toBeNull();

    // Leave the fixture with one working link for the remaining tests.
    rawToken = await remint();
    expect((await fetch(`${base}/portal/${rawToken}`)).status).toBe(200);
  }, 60_000);

  it("cross-speaker assignmentId 404s; organizer file route 403s for attendees", async () => {
    const cross = await fetch(`${base}/portal/${rawToken}/assignments/${ids.textAssignment2}/submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "should not land" }),
    });
    expect(cross.status).toBe(404);
    expect(
      await prisma.readinessSubmission.count({ where: { assignmentId: ids.textAssignment2 } }),
    ).toBe(0);

    const attendeeFile = await fetch(`${base}/readiness/files/${ids.fileSubmissionId}`, {
      headers: attendeeHeaders(),
    });
    expect(attendeeFile.status).toBe(403);

    const adminFile = await fetch(`${base}/readiness/files/${ids.fileSubmissionId}`, {
      headers: adminHeaders(),
    });
    expect(adminFile.status).toBe(200);
    expect(adminFile.headers.get("content-type")).toMatch(/image\/png/);
  }, 60_000);
});
