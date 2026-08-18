/**
 * BRAND-2 (1 + 2) — PUT /event branding is partial-save safe and hex-validated.
 *
 * The defect this pins: PUT built its update with `brandColor: data.brandColor
 * ?.trim() || null` for every branding field, so ANY save that didn't resend
 * branding — a name-only settings save, a future partial caller — silently
 * wiped the organizer's color, logo, and banner. The contract is now:
 * absent = untouched, explicit null = clear.
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
import { EventMemberRole, EventStatus, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { BRAND_COLOR_MESSAGE } from "../lib/brandColor";
import { eventRouter } from "../routes/event";

type EventBody = {
  name: string;
  brandColor: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
};

type ErrorBody = { error: string; details?: Record<string, string[]> };

const LOGO = "https://cdn.example.com/logo.png";
const BANNER = "https://cdn.example.com/banner.jpg";

describe("PUT /event branding hygiene (DB)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: { orgId?: string; eventId?: string; adminId?: string } = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword("TestPass12!x");
    const stamp = Date.now();

    const admin = await prisma.user.create({
      data: {
        email: `brand2-admin-${stamp}@example.com`,
        name: "Brand Admin",
        role: "ADMIN",
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.adminId = admin.id;

    const org = await prisma.organization.create({
      data: {
        name: `Brand Org ${stamp}`,
        slug: `brand2-org-${stamp}`,
        plan: "PRO",
        eventAllowance: 5,
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgId = org.id;

    const event = await prisma.event.create({
      data: {
        name: `Brand Event ${stamp}`,
        slug: `brand2-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-05-04T09:00:00Z"),
        endDate: new Date("2027-05-05T17:00:00Z"),
        status: EventStatus.DRAFT,
        organizationId: org.id,
        createdById: admin.id,
        brandColor: "#0f766e",
        logoUrl: LOGO,
        bannerUrl: BANNER,
        memberships: { create: [{ userId: admin.id, role: EventMemberRole.ADMIN }] },
      },
    });
    ids.eventId = event.id;

    const app = express();
    app.use(express.json());
    app.use("/event", eventRouter);
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
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.eventId } }).catch(() => null);
      await prisma.event.delete({ where: { id: ids.eventId } }).catch(() => null);
    }
    if (ids.orgId) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.orgId } }).catch(() => null);
      await prisma.organization.delete({ where: { id: ids.orgId } }).catch(() => null);
    }
    if (ids.adminId) await prisma.user.delete({ where: { id: ids.adminId } }).catch(() => null);
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  /** The required non-branding fields every PUT must carry. */
  function baseFields(name: string) {
    return {
      name,
      timezone: "UTC",
      startDate: "2027-05-04T09:00:00.000Z",
      endDate: "2027-05-05T17:00:00.000Z",
    };
  }

  async function put(body: Record<string, unknown>) {
    const res = await fetch(`${base}/event/`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${signToken({ userId: ids.adminId!, role: "ADMIN" })}`,
        "content-type": "application/json",
        "x-event-id": ids.eventId!,
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as EventBody & ErrorBody };
  }

  async function stored() {
    const row = await prisma.event.findUniqueOrThrow({
      where: { id: ids.eventId! },
      select: { name: true, brandColor: true, logoUrl: true, bannerUrl: true },
    });
    return row;
  }

  /** Restore the fully branded starting point so each case stands alone. */
  async function seedBranding() {
    await prisma.event.update({
      where: { id: ids.eventId! },
      data: { name: "Brand Event", brandColor: "#0f766e", logoUrl: LOGO, bannerUrl: BANNER },
    });
  }

  it("a name-only save leaves brand color, logo, and banner intact", async () => {
    await seedBranding();

    const res = await put(baseFields("Renamed By Settings Save"));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed By Settings Save");

    // The response and the row must agree — a caller that trusts the response
    // would otherwise re-save the nulls it was handed.
    expect(res.body.brandColor).toBe("#0f766e");
    expect(res.body.logoUrl).toBe(LOGO);
    expect(res.body.bannerUrl).toBe(BANNER);
    expect(await stored()).toEqual({
      name: "Renamed By Settings Save",
      brandColor: "#0f766e",
      logoUrl: LOGO,
      bannerUrl: BANNER,
    });
  }, 60_000);

  it("an explicit null clears exactly the field it names", async () => {
    await seedBranding();

    const one = await put({ ...baseFields("Brand Event"), brandColor: null });
    expect(one.status).toBe(200);
    expect(await stored()).toMatchObject({ brandColor: null, logoUrl: LOGO, bannerUrl: BANNER });

    const rest = await put({ ...baseFields("Brand Event"), logoUrl: null, bannerUrl: null });
    expect(rest.status).toBe(200);
    expect(await stored()).toMatchObject({ brandColor: null, logoUrl: null, bannerUrl: null });
  }, 60_000);

  it("an empty string also clears — a wiped text field means no color", async () => {
    await seedBranding();

    const res = await put({ ...baseFields("Brand Event"), brandColor: "   ", logoUrl: "" });
    expect(res.status).toBe(200);
    expect(await stored()).toMatchObject({ brandColor: null, logoUrl: null, bannerUrl: BANNER });
  }, 60_000);

  it("stores a valid color normalized to lowercase #rrggbb, shorthand expanded", async () => {
    await seedBranding();

    await put({ ...baseFields("Brand Event"), brandColor: "  #0A7 " });
    expect((await stored()).brandColor).toBe("#00aa77");

    await put({ ...baseFields("Brand Event"), brandColor: "#1F6FEB" });
    expect((await stored()).brandColor).toBe("#1f6feb");
  }, 60_000);

  it("rejects a non-hex color with an honest 400 and changes nothing", async () => {
    await seedBranding();

    const res = await put({ ...baseFields("Should Not Land"), brandColor: "cornflower" });
    expect(res.status).toBe(400);
    expect(res.body.details?.brandColor).toEqual([BRAND_COLOR_MESSAGE]);
    expect(await stored()).toEqual({
      name: "Brand Event",
      brandColor: "#0f766e",
      logoUrl: LOGO,
      bannerUrl: BANNER,
    });
  }, 60_000);
});
