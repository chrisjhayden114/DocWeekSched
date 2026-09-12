/**
 * AGENDA-3 — shared presenter materials, end to end against the real routes.
 * Does NOT set ALLOW_DESTRUCTIVE_DB.
 *
 * This suite is almost entirely about what must NOT happen. In order of how
 * much damage getting it wrong would do:
 *
 *  1) A submission nobody shared is invisible everywhere — not in the list,
 *     not by guessing its id on the file route. Approval is not publication.
 *  2) ATTENDEES means attendees. A signed-out visitor gets 403 on BOTH routes,
 *     and so does a signed-in stranger who never joined the event.
 *  3) PUBLIC means public: the same two routes serve a visitor with no account.
 *  4) A rejected or superseded submission is never served EVEN IF the shared
 *     flag is still set on the row. The flag is one of four conditions, not a
 *     master switch.
 *  5) The O10 MIME allowlist is enforced on the way out, not just on upload.
 *  6) The organizer-only readiness routes are exactly as locked as they were.
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
import { EventMemberRole, OrgRole, PrismaClient, SessionPublishStatus } from "@prisma/client";
import { hashPassword, signToken } from "../lib/auth";
import { upsertFeatureOverrides } from "../lib/features";
import { _resetRateLimitBucketsForTests } from "../lib/rateLimit";
import { materialsRouter } from "../routes/materials";
import { readinessRouter } from "../routes/readiness";
import { sessionsRouter } from "../routes/sessions";

/** A one-page PDF, small enough to live in the row as a data URL. */
const PDF_DATA_URL =
  "data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK";

describe("shared presenter materials (DB, AGENDA-3)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";

  const ids: {
    admin?: string;
    member?: string;
    stranger?: string;
    org?: string;
    event?: string;
    speaker?: string;
    session?: string;
    otherSession?: string;
    deckRequirement?: string;
    releaseRequirement?: string;
    deckAssignment?: string;
    releaseAssignment?: string;
    sharedDeck?: string;
    unsharedRelease?: string;
    rejectedDeck?: string;
    supersededDeck?: string;
    badMimeDeck?: string;
  } = {};

  async function setVisibility(value: "ATTENDEES" | "PUBLIC") {
    await prisma.event.update({
      where: { id: ids.event! },
      data: { materialsVisibility: value },
    });
  }

  function authHeaders(userId: string, role: "ADMIN" | "ATTENDEE" = "ATTENDEE") {
    return {
      authorization: `Bearer ${signToken({ userId, role })}`,
      "content-type": "application/json",
      "x-event-id": ids.event!,
    };
  }

  const anonHeaders = { accept: "application/json" };

  beforeAll(async () => {
    const stamp = Date.now();
    const passwordHash = await hashPassword("TestPass12!x");

    const admin = await prisma.user.create({
      data: { email: `ag3-admin-${stamp}@example.com`, name: "Materials Admin", passwordHash, role: "ADMIN" },
    });
    const member = await prisma.user.create({
      data: { email: `ag3-member-${stamp}@example.com`, name: "Materials Member", passwordHash, role: "ATTENDEE" },
    });
    const stranger = await prisma.user.create({
      data: { email: `ag3-stranger-${stamp}@example.com`, name: "Materials Stranger", passwordHash, role: "ATTENDEE" },
    });
    ids.admin = admin.id;
    ids.member = member.id;
    ids.stranger = stranger.id;

    const org = await prisma.organization.create({
      data: {
        name: `Materials Org ${stamp}`,
        slug: `ag3-org-${stamp}`,
        plan: "INTERNAL",
        memberships: { create: { userId: admin.id, role: OrgRole.OWNER } },
      },
    });
    ids.org = org.id;

    const event = await prisma.event.create({
      data: {
        name: `Materials Event ${stamp}`,
        slug: `ag3-evt-${stamp}`,
        timezone: "UTC",
        startDate: new Date("2027-03-01T12:00:00Z"),
        endDate: new Date("2027-03-03T12:00:00Z"),
        status: "ACTIVE",
        organizationId: org.id,
        createdById: admin.id,
        memberships: {
          create: [
            { userId: admin.id, role: EventMemberRole.ADMIN },
            { userId: member.id, role: EventMemberRole.ATTENDEE },
          ],
        },
      },
    });
    ids.event = event.id;

    const speaker = await prisma.speaker.create({
      data: { eventId: event.id, name: "Dr. Ada Keynote" },
    });
    ids.speaker = speaker.id;

    // The speaker presents this session; the deck assignment's subject is the
    // SPEAKER, so serving it here also exercises the speaker → sessions fan-out.
    const session = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Opening keynote",
        startsAt: new Date("2027-03-01T13:00:00Z"),
        endsAt: new Date("2027-03-01T14:00:00Z"),
        publishStatus: SessionPublishStatus.PUBLISHED,
        sessionSpeakers: { create: [{ speakerId: speaker.id, sortOrder: 0 }] },
      },
    });
    ids.session = session.id;

    // A session the speaker does NOT present, to prove materials do not leak
    // across a program.
    const otherSession = await prisma.session.create({
      data: {
        eventId: event.id,
        title: "Unrelated workshop",
        startsAt: new Date("2027-03-01T15:00:00Z"),
        endsAt: new Date("2027-03-01T16:00:00Z"),
        publishStatus: SessionPublishStatus.PUBLISHED,
      },
    });
    ids.otherSession = otherSession.id;

    const template = await prisma.readinessTemplate.create({
      data: { eventId: event.id, organizationId: org.id, name: "Speaker pack" },
    });
    const deckRequirement = await prisma.readinessRequirement.create({
      data: {
        templateId: template.id,
        eventId: event.id,
        label: "Slide deck",
        kind: "file",
        sortOrder: 0,
        config: { deck: true, shareByDefault: true },
      },
    });
    const releaseRequirement = await prisma.readinessRequirement.create({
      data: {
        templateId: template.id,
        eventId: event.id,
        label: "Signed speaker release",
        kind: "file",
        sortOrder: 1,
        config: {},
      },
    });
    ids.deckRequirement = deckRequirement.id;
    ids.releaseRequirement = releaseRequirement.id;

    const deckAssignment = await prisma.readinessAssignment.create({
      data: {
        organizationId: org.id,
        eventId: event.id,
        requirementId: deckRequirement.id,
        speakerId: speaker.id,
      },
    });
    const releaseAssignment = await prisma.readinessAssignment.create({
      data: {
        organizationId: org.id,
        eventId: event.id,
        requirementId: releaseRequirement.id,
        speakerId: speaker.id,
      },
    });
    ids.deckAssignment = deckAssignment.id;
    ids.releaseAssignment = releaseAssignment.id;

    const file = {
      fileName: "deck.pdf",
      fileMime: "application/pdf",
      fileSizeBytes: 1024,
      fileUrl: PDF_DATA_URL,
      submittedVia: "portal",
    };

    const sharedDeck = await prisma.readinessSubmission.create({
      data: {
        ...file,
        assignmentId: deckAssignment.id,
        eventId: event.id,
        approvedAt: new Date(),
        sharedWithAttendees: true,
      },
    });
    ids.sharedDeck = sharedDeck.id;

    // Approved, but the organizer never shared it — a signed legal document.
    const unsharedRelease = await prisma.readinessSubmission.create({
      data: {
        ...file,
        fileName: "release.pdf",
        assignmentId: releaseAssignment.id,
        eventId: event.id,
        approvedAt: new Date(),
        sharedWithAttendees: false,
      },
    });
    ids.unsharedRelease = unsharedRelease.id;

    // The three rows that carry sharedWithAttendees: true and must STILL never
    // be served. Each fails a different one of the other three conditions.
    const rejectedDeck = await prisma.readinessSubmission.create({
      data: {
        ...file,
        assignmentId: releaseAssignment.id,
        eventId: event.id,
        rejectedAt: new Date(),
        reviewNote: "Wrong file",
        sharedWithAttendees: true,
      },
    });
    ids.rejectedDeck = rejectedDeck.id;

    const supersededDeck = await prisma.readinessSubmission.create({
      data: {
        ...file,
        assignmentId: releaseAssignment.id,
        eventId: event.id,
        approvedAt: new Date(),
        supersededAt: new Date(),
        sharedWithAttendees: true,
      },
    });
    ids.supersededDeck = supersededDeck.id;

    // Shared, approved, current — and holding a type the allowlist refuses.
    const badMimeDeck = await prisma.readinessSubmission.create({
      data: {
        assignmentId: releaseAssignment.id,
        eventId: event.id,
        fileName: "payload.html",
        fileMime: "text/html",
        fileSizeBytes: 64,
        fileUrl: "data:text/html;base64,PGgxPmhpPC9oMT4=",
        submittedVia: "portal",
        approvedAt: new Date(),
        sharedWithAttendees: true,
      },
    });
    ids.badMimeDeck = badMimeDeck.id;

    await upsertFeatureOverrides(event.id, { readiness: true });

    const app = express();
    app.use(express.json({ limit: "30mb" }));
    app.use("/sessions", sessionsRouter);
    app.use("/materials", materialsRouter);
    app.use("/readiness", readinessRouter);
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
    if (ids.event) {
      await prisma.auditLog.deleteMany({ where: { eventId: ids.event } });
      await prisma.readinessSubmission.deleteMany({ where: { eventId: ids.event } });
      await prisma.readinessAssignment.deleteMany({ where: { eventId: ids.event } });
      await prisma.readinessRequirement.deleteMany({ where: { eventId: ids.event } });
      await prisma.readinessTemplate.deleteMany({ where: { eventId: ids.event } });
      await prisma.sessionSpeaker.deleteMany({ where: { session: { eventId: ids.event } } });
      await prisma.session.deleteMany({ where: { eventId: ids.event } });
      await prisma.speaker.deleteMany({ where: { eventId: ids.event } });
      await prisma.eventFeatureConfig.deleteMany({ where: { eventId: ids.event } });
      await prisma.eventMembership.deleteMany({ where: { eventId: ids.event } });
      await prisma.event.delete({ where: { id: ids.event } }).catch(() => undefined);
    }
    if (ids.org) {
      await prisma.orgMembership.deleteMany({ where: { organizationId: ids.org } });
      await prisma.organization.delete({ where: { id: ids.org } }).catch(() => undefined);
    }
    for (const userId of [ids.admin, ids.member, ids.stranger]) {
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }, 60_000);

  type MaterialRow = {
    id: string;
    title: string;
    kind: "file" | "link";
    mime: string | null;
    sizeBytes: number | null;
    url: string | null;
  };

  async function listMaterials(headers: Record<string, string>, sessionId = ids.session!) {
    const res = await fetch(`${base}/sessions/${sessionId}/materials`, { headers });
    return { status: res.status, body: (await res.json().catch(() => null)) as MaterialRow[] | null };
  }

  async function fetchFile(submissionId: string, headers: Record<string, string>) {
    return fetch(`${base}/materials/${submissionId}/file`, { headers });
  }

  describe("PUBLIC visibility", () => {
    beforeAll(() => setVisibility("PUBLIC"));

    it("serves the shared deck to a visitor with no account at all", async () => {
      const { status, body } = await listMaterials(anonHeaders);
      expect(status).toBe(200);
      expect(body!.map((m) => m.title)).toEqual(["Slide deck"]);
      expect(body![0]).toMatchObject({
        id: ids.sharedDeck,
        kind: "file",
        mime: "application/pdf",
        sizeBytes: 1024,
        // A file is fetched from the file route; the payload never carries a
        // URL that would bypass the gate.
        url: null,
      });
    });

    it("streams the file itself to the same anonymous visitor", async () => {
      const res = await fetchFile(ids.sharedDeck!, anonHeaders);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      // ER4.5 — a PDF may render in-tab.
      expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="deck\.pdf"$/);
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    });

    it("still refuses every submission that is not shared, approved and current", async () => {
      // All four of these carry a file and belong to this event. Three of them
      // even have sharedWithAttendees = true. None may be served.
      for (const id of [ids.unsharedRelease, ids.rejectedDeck, ids.supersededDeck]) {
        const res = await fetchFile(id!, anonHeaders);
        expect(res.status).toBe(404);
      }
    });

    it("refuses a shared file whose stored type is off the allowlist", async () => {
      // Shared, approved, current — and text/html. Serving this from the API
      // origin would be a stored-XSS delivery route.
      const res = await fetchFile(ids.badMimeDeck!, anonHeaders);
      expect(res.status).toBe(415);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not one this event can hand out/i);
    });

    it("does not put one speaker's deck on a session they are not presenting", async () => {
      const { status, body } = await listMaterials(anonHeaders, ids.otherSession);
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it("404s an id that is not a submission at all", async () => {
      expect((await fetchFile("not-a-real-id", anonHeaders)).status).toBe(404);
    });
  });

  describe("ATTENDEES visibility", () => {
    beforeAll(() => setVisibility("ATTENDEES"));

    it("403s an anonymous caller on BOTH routes, and says why", async () => {
      const list = await fetch(`${base}/sessions/${ids.session}/materials`, { headers: anonHeaders });
      expect(list.status).toBe(403);
      const listBody = (await list.json()) as { error: string; reason?: string };
      // The message names the real cause — this event's setting — rather than
      // pretending the session or the file does not exist.
      expect(listBody.reason).toBe("materials_attendees_only");
      expect(listBody.error).toMatch(/sign in/i);

      const file = await fetchFile(ids.sharedDeck!, anonHeaders);
      expect(file.status).toBe(403);
      expect(((await file.json()) as { reason?: string }).reason).toBe("materials_attendees_only");
    });

    it("403s a signed-in stranger who never joined this event", async () => {
      const headers = authHeaders(ids.stranger!);
      expect((await listMaterials(headers)).status).toBe(403);
      expect((await fetchFile(ids.sharedDeck!, headers)).status).toBe(403);
    });

    it("serves a member of the event", async () => {
      const headers = authHeaders(ids.member!);
      const { status, body } = await listMaterials(headers);
      expect(status).toBe(200);
      expect(body!.map((m) => m.id)).toEqual([ids.sharedDeck]);
      expect((await fetchFile(ids.sharedDeck!, headers)).status).toBe(200);
    });

    it("still hides the unshared release from a member who IS allowed in", async () => {
      // Passing the visibility gate is not the same as passing the share gate.
      const headers = authHeaders(ids.member!);
      expect((await fetchFile(ids.unsharedRelease!, headers)).status).toBe(404);
      const { body } = await listMaterials(headers);
      expect(body!.map((m) => m.id)).not.toContain(ids.unsharedRelease);
    });
  });

  describe("organizer review board", () => {
    beforeAll(() => setVisibility("ATTENDEES"));

    it("leaves the organizer-only readiness routes exactly as locked", async () => {
      // The member is an ATTENDEE on this event: no manage rights, so the
      // organizer file route and the overview stay shut. AGENDA-3 added an
      // attendee-facing door; it did not widen this one.
      const member = authHeaders(ids.member!);
      expect((await fetch(`${base}/readiness/overview`, { headers: member })).status).toBe(403);
      expect(
        (await fetch(`${base}/readiness/files/${ids.sharedDeck}`, { headers: member })).status,
      ).toBe(403);

      const anon = await fetch(`${base}/readiness/overview`, { headers: anonHeaders });
      expect(anon.status).toBe(401);
    });

    it("refuses a share toggle from anyone who cannot manage the event", async () => {
      const res = await fetch(`${base}/readiness/submissions/${ids.unsharedRelease}`, {
        method: "PATCH",
        headers: authHeaders(ids.member!),
        body: JSON.stringify({ action: "share" }),
      });
      expect(res.status).toBe(403);
      const row = await prisma.readinessSubmission.findUniqueOrThrow({
        where: { id: ids.unsharedRelease! },
      });
      expect(row.sharedWithAttendees).toBe(false);
    });

    it("shares and un-shares on the organizer's say-so", async () => {
      const share = await fetch(`${base}/readiness/submissions/${ids.unsharedRelease}`, {
        method: "PATCH",
        headers: authHeaders(ids.admin!, "ADMIN"),
        body: JSON.stringify({ action: "share" }),
      });
      expect(share.status).toBe(200);

      const member = authHeaders(ids.member!);
      expect((await listMaterials(member)).body!.map((m) => m.id)).toContain(ids.unsharedRelease);

      const unshare = await fetch(`${base}/readiness/submissions/${ids.unsharedRelease}`, {
        method: "PATCH",
        headers: authHeaders(ids.admin!, "ADMIN"),
        body: JSON.stringify({ action: "unshare" }),
      });
      expect(unshare.status).toBe(200);
      expect((await listMaterials(member)).body!.map((m) => m.id)).not.toContain(ids.unsharedRelease);
      expect((await fetchFile(ids.unsharedRelease!, member)).status).toBe(404);
    });

    it("refuses to share something an attendee could never open", async () => {
      const confirmRequirement = await prisma.readinessRequirement.create({
        data: {
          templateId: (
            await prisma.readinessRequirement.findUniqueOrThrow({
              where: { id: ids.deckRequirement! },
              select: { templateId: true },
            })
          ).templateId,
          eventId: ids.event!,
          label: "Copyright cleared",
          kind: "confirm",
          sortOrder: 9,
        },
      });
      const assignment = await prisma.readinessAssignment.create({
        data: {
          organizationId: ids.org!,
          eventId: ids.event!,
          requirementId: confirmRequirement.id,
          speakerId: ids.speaker!,
        },
      });
      const submission = await prisma.readinessSubmission.create({
        data: {
          assignmentId: assignment.id,
          eventId: ids.event!,
          valueText: "yes",
          submittedVia: "portal",
          approvedAt: new Date(),
        },
      });

      const res = await fetch(`${base}/readiness/submissions/${submission.id}`, {
        method: "PATCH",
        headers: authHeaders(ids.admin!, "ADMIN"),
        body: JSON.stringify({ action: "share" }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/uploaded file or a link/i);
    });

    it("refuses to share a submission that has not been approved", async () => {
      const pending = await prisma.readinessSubmission.create({
        data: {
          assignmentId: ids.releaseAssignment!,
          eventId: ids.event!,
          fileName: "draft.pdf",
          fileMime: "application/pdf",
          fileSizeBytes: 10,
          fileUrl: PDF_DATA_URL,
          submittedVia: "portal",
        },
      });
      const res = await fetch(`${base}/readiness/submissions/${pending.id}`, {
        method: "PATCH",
        headers: authHeaders(ids.admin!, "ADMIN"),
        body: JSON.stringify({ action: "share" }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/approve this submission/i);
      await prisma.readinessSubmission.delete({ where: { id: pending.id } });
    });

    it("a deck shares itself on approval, and un-shares when un-approved", async () => {
      const submission = await prisma.readinessSubmission.create({
        data: {
          assignmentId: ids.deckAssignment!,
          eventId: ids.event!,
          fileName: "deck-v2.pdf",
          fileMime: "application/pdf",
          fileSizeBytes: 2048,
          fileUrl: PDF_DATA_URL,
          submittedVia: "portal",
        },
      });

      const approve = await fetch(`${base}/readiness/submissions/${submission.id}`, {
        method: "PATCH",
        headers: authHeaders(ids.admin!, "ADMIN"),
        body: JSON.stringify({ action: "approve" }),
      });
      expect(approve.status).toBe(200);
      expect(
        (await prisma.readinessSubmission.findUniqueOrThrow({ where: { id: submission.id } }))
          .sharedWithAttendees,
      ).toBe(true);

      const reject = await fetch(`${base}/readiness/submissions/${submission.id}`, {
        method: "PATCH",
        headers: authHeaders(ids.admin!, "ADMIN"),
        body: JSON.stringify({ action: "reject", reason: "Please resend as 16:9" }),
      });
      expect(reject.status).toBe(200);
      const after = await prisma.readinessSubmission.findUniqueOrThrow({
        where: { id: submission.id },
      });
      expect(after.approvedAt).toBeNull();
      expect(after.sharedWithAttendees).toBe(false);

      const member = authHeaders(ids.member!);
      expect((await fetchFile(submission.id, member)).status).toBe(404);
      await prisma.readinessSubmission.delete({ where: { id: submission.id } });
    });

    it("does NOT auto-share a non-deck file requirement on approval", async () => {
      // The signed release is a file, and approving it is routine. It must not
      // land on the public agenda as a side effect.
      const submission = await prisma.readinessSubmission.create({
        data: {
          assignmentId: ids.releaseAssignment!,
          eventId: ids.event!,
          fileName: "release-v2.pdf",
          fileMime: "application/pdf",
          fileSizeBytes: 512,
          fileUrl: PDF_DATA_URL,
          submittedVia: "portal",
        },
      });
      const res = await fetch(`${base}/readiness/submissions/${submission.id}`, {
        method: "PATCH",
        headers: authHeaders(ids.admin!, "ADMIN"),
        body: JSON.stringify({ action: "approve" }),
      });
      expect(res.status).toBe(200);
      expect(
        (await prisma.readinessSubmission.findUniqueOrThrow({ where: { id: submission.id } }))
          .sharedWithAttendees,
      ).toBe(false);
      await prisma.readinessSubmission.delete({ where: { id: submission.id } });
    });
  });

  describe("the readiness feature switch", () => {
    it("empties the agenda's materials when the organizer turns readiness off", async () => {
      await setVisibility("PUBLIC");
      await upsertFeatureOverrides(ids.event!, { readiness: false });
      try {
        // A disabled feature disappears cleanly: no chip, AND no dead link —
        // a URL someone already copied stops working too.
        expect((await listMaterials(anonHeaders)).body).toEqual([]);
        expect((await fetchFile(ids.sharedDeck!, anonHeaders)).status).toBe(404);
      } finally {
        await upsertFeatureOverrides(ids.event!, { readiness: true });
      }
    });
  });
});
