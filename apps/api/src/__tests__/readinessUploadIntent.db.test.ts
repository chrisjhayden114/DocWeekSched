/**
 * ER4.3 — upload-intent / fileRef confirm with injectable storage provider.
 * Uses the real portal router + a mock object store (no R2).
 *
 * Does NOT set ALLOW_DESTRUCTIVE_DB.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { Readable } from "stream";
import { EventMemberRole, OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
import { upsertFeatureOverrides } from "../lib/features";
import { _resetRateLimitBucketsForTests } from "../lib/rateLimit";
import { newPortalToken } from "../lib/readiness/portalTokens";
import { DataUrlStorageProvider } from "../lib/storage/dataUrl";
import { setStorageProviderForTests } from "../lib/storage";
import type {
  StorageGetResult,
  StorageHeadResult,
  StoragePresignPutInput,
  StoragePresignPutResult,
  StorageProvider,
  StoragePutInput,
  StoragePutResult,
  StorageAcceptInput,
} from "../lib/storage/types";
import { portalRouter } from "../routes/portal";

class MockObjectStore implements StorageProvider {
  readonly name = "mock-object-store";
  objects = new Map<string, { body: Buffer; contentType: string }>();
  deleted: string[] = [];

  isObjectStore(): boolean {
    return true;
  }

  async put(input: StoragePutInput): Promise<StoragePutResult> {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType });
    return { url: `mock://${input.key}`, storageKey: input.key };
  }

  async acceptUpload(input: StorageAcceptInput): Promise<StoragePutResult> {
    const m = /^data:([^;,]+)?;base64,(.+)$/i.exec(input.url.trim());
    if (!m) throw new Error("Upload must be a data URL or https URL");
    const mime = (m[1] || "application/octet-stream").toLowerCase();
    const buffer = Buffer.from(m[2], "base64");
    const key = `${input.keyPrefix || "uploads"}/mock.bin`;
    return this.put({ key, body: buffer, contentType: mime });
  }

  async presignPut(input: StoragePresignPutInput): Promise<StoragePresignPutResult> {
    return {
      uploadUrl: `https://mock-upload.example/${encodeURIComponent(input.key)}`,
      headers: { "Content-Type": input.contentType },
    };
  }

  async head(key: string): Promise<StorageHeadResult | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return { contentLength: obj.body.length, contentType: obj.contentType };
  }

  async deleteObject(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
  }

  urlForKey(key: string): string {
    return `mock://${key}`;
  }

  async get(key: string): Promise<StorageGetResult | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return {
      body: Readable.from(obj.body),
      contentType: obj.contentType,
      contentLength: obj.body.length,
    };
  }

  putClientObject(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, { body, contentType });
  }
}

describe("ER4.3 portal direct upload (harness)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const ids: {
    adminA?: string;
    orgA?: string;
    eventA?: string;
    speaker1?: string;
    fileAssignment1?: string;
    accessId?: string;
  } = {};
  let rawToken = "";
  let mockStore: MockObjectStore;

  beforeAll(async () => {
    const stamp = Date.now();
    const passwordHash = await hashPassword("TestPass12!x");
    const adminA = await prisma.user.create({
      data: { email: `rdy43-admin-${stamp}@example.com`, name: "ER43 Admin", passwordHash, role: "ADMIN" },
    });
    ids.adminA = adminA.id;
    const orgA = await prisma.organization.create({
      data: {
        name: `ER43 Org ${stamp}`,
        slug: `rdy43-org-${stamp}`,
        plan: "INTERNAL",
        memberships: { create: { userId: adminA.id, role: OrgRole.OWNER } },
      },
    });
    ids.orgA = orgA.id;
    const eventA = await prisma.event.create({
      data: {
        name: `ER43 Event ${stamp}`,
        slug: `rdy43-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-04-01T12:00:00Z"),
        endDate: new Date("2027-04-03T12:00:00Z"),
        organizationId: orgA.id,
        createdById: adminA.id,
        memberships: { create: { userId: adminA.id, role: EventMemberRole.ADMIN } },
      },
    });
    ids.eventA = eventA.id;
    await upsertFeatureOverrides(eventA.id, { readiness: true });
    const speaker1 = await prisma.speaker.create({
      data: { eventId: eventA.id, name: "Direct Upload Speaker" },
    });
    ids.speaker1 = speaker1.id;
    const template = await prisma.readinessTemplate.create({
      data: { eventId: eventA.id, organizationId: orgA.id, name: "Deck pack" },
    });
    const reqFile = await prisma.readinessRequirement.create({
      data: {
        templateId: template.id,
        eventId: eventA.id,
        label: "Slides",
        kind: "file",
        required: true,
        sortOrder: 0,
        config: { maxBytes: 500 },
      },
    });
    const a1 = await prisma.readinessAssignment.create({
      data: {
        organizationId: orgA.id,
        eventId: eventA.id,
        requirementId: reqFile.id,
        speakerId: speaker1.id,
      },
    });
    ids.fileAssignment1 = a1.id;

    const token = newPortalToken();
    rawToken = token.raw;
    const access = await prisma.readinessPortalAccess.create({
      data: {
        organizationId: orgA.id,
        eventId: eventA.id,
        speakerId: speaker1.id,
        email: "speaker@example.com",
        tokenHash: token.hash,
        expiresAt: token.expiresAt,
      },
    });
    ids.accessId = access.id;

    const app = express();
    app.use(express.json({ limit: "30mb" }));
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

  beforeEach(() => {
    _resetRateLimitBucketsForTests();
    mockStore = new MockObjectStore();
    setStorageProviderForTests(mockStore);
  });

  afterAll(async () => {
    setStorageProviderForTests(null);
    if (ids.eventA) {
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
    if (ids.adminA) await prisma.user.delete({ where: { id: ids.adminA } }).catch(() => undefined);
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  it("mock/dev provider without presign returns fallback; data-URL submit still works", async () => {
    setStorageProviderForTests(new DataUrlStorageProvider());
    const intent = await fetch(
      `${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/upload-intent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: "tiny.png", mime: "image/png", size: 68 }),
      },
    );
    expect(intent.status).toBe(200);
    expect(await intent.json()).toEqual({ fallback: true });

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
          fileName: "tiny.png",
          mime: "image/png",
        }),
      },
    );
    expect(uploaded.status).toBe(201);
  }, 60_000);

  it("confirm-step rejects when the object is missing", async () => {
    const intentRes = await fetch(
      `${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/upload-intent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: "deck.pdf", mime: "application/pdf", size: 100 }),
      },
    );
    expect(intentRes.status).toBe(200);
    const intent = (await intentRes.json()) as { fileRef: string; uploadUrl: string };
    expect(intent.fileRef).toMatch(/^events\/.+\/readiness\/.+\//);
    expect(intent.uploadUrl).toBeTruthy();

    const confirm = await fetch(
      `${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/submission`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileRef: intent.fileRef,
          fileName: "deck.pdf",
          mime: "application/pdf",
          size: 100,
        }),
      },
    );
    expect(confirm.status).toBe(400);
    const body = (await confirm.json()) as { reason?: string };
    expect(body.reason).toBe("missing_object");
  }, 60_000);

  it("oversized HeadObject is deleted and rejected honestly", async () => {
    const intentRes = await fetch(
      `${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/upload-intent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: "big.pdf", mime: "application/pdf", size: 400 }),
      },
    );
    expect(intentRes.status).toBe(200);
    const intent = (await intentRes.json()) as { fileRef: string };
    mockStore.putClientObject(intent.fileRef, Buffer.alloc(600, 1), "application/pdf");

    const confirm = await fetch(
      `${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/submission`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileRef: intent.fileRef,
          fileName: "big.pdf",
          mime: "application/pdf",
          size: 400,
        }),
      },
    );
    expect(confirm.status).toBe(400);
    const body = (await confirm.json()) as { reason?: string };
    expect(body.reason).toBe("too_large");
    expect(mockStore.deleted).toContain(intent.fileRef);
    expect(mockStore.objects.has(intent.fileRef)).toBe(false);
  }, 60_000);

  it("happy path: intent → client PUT → confirm with fileRef", async () => {
    const bytes = Buffer.alloc(120, 2);
    const intentRes = await fetch(
      `${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/upload-intent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: "ok.pdf", mime: "application/pdf", size: bytes.length }),
      },
    );
    const intent = (await intentRes.json()) as { fileRef: string };
    mockStore.putClientObject(intent.fileRef, bytes, "application/pdf");

    const confirm = await fetch(
      `${base}/portal/${rawToken}/assignments/${ids.fileAssignment1}/submission`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileRef: intent.fileRef,
          fileName: "ok.pdf",
          mime: "application/pdf",
          size: bytes.length,
        }),
      },
    );
    expect(confirm.status).toBe(201);
    const created = (await confirm.json()) as { id: string };
    const row = await prisma.readinessSubmission.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.fileStorageKey).toBe(intent.fileRef);
    expect(row.fileSizeBytes).toBe(bytes.length);
    expect(row.fileName).toBe("ok.pdf");
  }, 60_000);
});
