/**
 * SETUP-2 — POST /ai/setup-copilot/document (DB harness).
 *
 * Attendees get 403; an xlsx upload merges extracted fields into form
 * state; oversized payloads are rejected. Does NOT set ALLOW_DESTRUCTIVE_DB.
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
import ExcelJS from "exceljs";
import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { emptySetupFormState } from "@event-app/shared";
import { hashPassword, signToken } from "../lib/auth";
import { MockAiProvider, resetAiProviderForTests } from "../lib/ai";
import { applyPlanSkuToOrg } from "../lib/billing/entitlements";
import { AGENDA_INGEST_MAX_BYTES, XLSX_MIME } from "../lib/ai/ingest";
import { setupCopilotRouter } from "../routes/setupCopilot";

type DocBody = {
  step: string;
  form: ReturnType<typeof emptySetupFormState>;
  messages: Array<{ role: string; content: string }>;
  assistantMessage: string;
};

describe("SETUP-2 document upload (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    orgId?: string;
    eventId?: string;
    managerId?: string;
    attendeeId?: string;
  } = {};

  beforeAll(async () => {
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());

    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const manager = await prisma.user.create({
      data: {
        email: `s2-mgr-${stamp}@example.com`,
        name: "S2 Manager",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    ids.managerId = manager.id;

    const attendee = await prisma.user.create({
      data: {
        email: `s2-att-${stamp}@example.com`,
        name: "S2 Attendee",
        passwordHash,
        role: "ATTENDEE",
      },
    });
    ids.attendeeId = attendee.id;

    const org = await prisma.organization.create({
      data: {
        name: `S2 Org ${stamp}`,
        slug: `s2-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 10,
        memberships: { create: { userId: manager.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;
    await applyPlanSkuToOrg(org.id, "pro_annual");

    const event = await prisma.event.create({
      data: {
        name: `S2 Event ${stamp}`,
        slug: `s2-event-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-05-20T00:00:00Z"),
        endDate: new Date("2027-05-20T23:59:59Z"),
        status: EventStatus.DRAFT,
        organizationId: org.id,
        createdById: manager.id,
        memberships: {
          create: [
            { userId: manager.id, role: EventMemberRole.ADMIN },
            { userId: attendee.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    ids.eventId = event.id;

    const app = express();
    app.use(express.json({ limit: "30mb" }));
    app.use("/ai/setup-copilot", setupCopilotRouter);
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
  }, 60_000);

  afterAll(async () => {
    if (ids.eventId) {
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.auditLog.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.aiUsageRecord.deleteMany({ where: { eventId: ids.eventId } });
      await prisma.event.delete({ where: { id: ids.eventId } }).catch(() => undefined);
    }
    if (ids.orgId) {
      await prisma.auditLog.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.aiUsageRecord.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } });
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => undefined);
    }
    for (const userId of [ids.managerId, ids.attendeeId]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  function headers(userId: string) {
    return {
      authorization: `Bearer ${signToken({ userId, role: "ATTENDEE" })}`,
      "content-type": "application/json",
    };
  }

  function sessionBody(extra: Record<string, unknown>) {
    return {
      organizationId: ids.orgId,
      step: "name",
      form: emptySetupFormState("UTC"),
      messages: [{ role: "assistant", content: "What's the event called?", aiGenerated: true }],
      ...extra,
    };
  }

  it("attendee role gets 403 from POST /document", async () => {
    const res = await fetch(`${base}/ai/setup-copilot/document`, {
      method: "POST",
      headers: headers(ids.attendeeId!),
      body: JSON.stringify(
        sessionBody({
          fileUrl: "data:application/pdf;base64,AA==",
          fileName: "program.pdf",
          mime: "application/pdf",
        }),
      ),
    });
    expect(res.status).toBe(403);
  }, 60_000);

  it("xlsx upload merges extracted fields and records Uploaded <fileName>", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Program");
    ws.addRow(["Event", "Time to Fly"]);
    ws.addRow(["Dates", "1st - 5th December 2026"]);
    ws.addRow(["Venue", "Shanghai"]);
    ws.addRow(["09:00-10:00", "Welcome"]);
    ws.addRow(["10:15-11:15", "Workshop A"]);
    ws.addRow(["11:30-12:30", "Workshop B"]);
    ws.addRow(["13:30-14:30", "Closing"]);
    ws.addRow([
      "__MOCK_JSON__:" +
        JSON.stringify({
          name: "Time to Fly",
          startDate: "2026-12-01",
          endDate: "2026-12-05",
          venueName: "Shanghai",
          estimatedSize: 120,
          eventType: "conference",
        }),
    ]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const fileUrl = `data:${XLSX_MIME};base64,${buf.toString("base64")}`;

    const res = await fetch(`${base}/ai/setup-copilot/document`, {
      method: "POST",
      headers: headers(ids.managerId!),
      body: JSON.stringify(
        sessionBody({
          fileUrl,
          fileName: "time-to-fly.xlsx",
          mime: XLSX_MIME,
        }),
      ),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DocBody;
    expect(body.form.name).toBe("Time to Fly");
    expect(body.form.startDate).toBe("2026-12-01");
    expect(body.form.endDate).toBe("2026-12-05");
    expect(body.form.venueName).toBe("Shanghai");
    expect(body.form.estimatedSize).toBe("120");
    expect(body.form.eventType).toBe("conference");
    expect(body.form.hasProgramDocument).toBe(true);
    expect(body.messages.some((m) => m.role === "user" && m.content === "Uploaded time-to-fly.xlsx")).toBe(
      true,
    );
    expect(body.assistantMessage.toLowerCase()).toMatch(/agenda ingest|program document|create/);
  }, 60_000);

  it("oversized upload is rejected", async () => {
    const over = Buffer.alloc(AGENDA_INGEST_MAX_BYTES + 1, 65);
    const fileUrl = `data:application/pdf;base64,${over.toString("base64")}`;
    const res = await fetch(`${base}/ai/setup-copilot/document`, {
      method: "POST",
      headers: headers(ids.managerId!),
      body: JSON.stringify(
        sessionBody({
          fileUrl,
          fileName: "huge.pdf",
          mime: "application/pdf",
        }),
      ),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/exceeds max size/i);
  }, 60_000);
});
