/**
 * ORG-2 — the rules that hold without a database.
 *
 * The important one is the last describe block: it reads schema.prisma and
 * fails if any model gains organizationId beside an eventId without joining the
 * transfer. That check is the whole reason a draft-only transfer was allowed at
 * all — J-A refused a general one because seventeen models denormalize
 * organizationId and nothing in the database enforces that they agree. Two of
 * them have no foreign key at all, so a missed table would be a silent orphan
 * rather than a crash. "Miss none" has to be checked by the build.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVENT_TRANSFER_RECOMMENDATION,
  ORG_TRANSFER_TARGET_NOT_ADMIN_MESSAGE,
  ORG_TRANSFER_TARGET_ROLE,
  canCloseOrg,
  canTransferOrgOwnership,
  describeEventTransferBlockers,
  describeOrgCloseBlockers,
  isEligibleTransferTarget,
  orgCloseConfirmationMatches,
  typedConfirmationMatches,
} from "@event-app/shared";
import { EVENT_ORGANIZATION_CHILD_TABLES } from "../lib/orgLifecycle";
import { EVENT_ORGANIZATION_TRANSFER_ERROR } from "../lib/eventOrganization";

const schemaPath = join(__dirname, "..", "..", "prisma", "schema.prisma");
const routesDir = join(__dirname, "..", "routes");

describe("ORG-2 — who may act", () => {
  it("only an OWNER may transfer or close", () => {
    expect(canTransferOrgOwnership("OWNER")).toBe(true);
    expect(canCloseOrg("OWNER")).toBe(true);
    for (const role of ["ADMIN", "STAFF", null, undefined, ""]) {
      expect(canTransferOrgOwnership(role), String(role)).toBe(false);
      expect(canCloseOrg(role), String(role)).toBe(false);
    }
  });

  it("only an existing ADMIN can receive ownership — promote first, then transfer", () => {
    expect(ORG_TRANSFER_TARGET_ROLE).toBe("ADMIN");
    expect(isEligibleTransferTarget("ADMIN")).toBe(true);
    expect(isEligibleTransferTarget("STAFF")).toBe(false);
    // An OWNER is not a transfer target either: there is only ever one.
    expect(isEligibleTransferTarget("OWNER")).toBe(false);
    expect(ORG_TRANSFER_TARGET_NOT_ADMIN_MESSAGE).toMatch(/promote them to admin first/i);
  });
});

describe("ORG-2 — typed confirmation on close", () => {
  it("accepts the organization's name, forgiving case and spaces", () => {
    expect(orgCloseConfirmationMatches("Northbridge Schools", "Northbridge Schools")).toBe(true);
    expect(orgCloseConfirmationMatches("  northbridge schools  ", "Northbridge Schools")).toBe(true);
  });

  it("refuses a near miss, so muscle memory cannot close the wrong organization", () => {
    expect(orgCloseConfirmationMatches("Northbridge", "Northbridge Schools")).toBe(false);
    expect(orgCloseConfirmationMatches("", "Northbridge Schools")).toBe(false);
    expect(orgCloseConfirmationMatches("CLOSE", "Northbridge Schools")).toBe(false);
    // The dialog gate and the server check share this one rule.
    expect(typedConfirmationMatches("close", "CLOSE")).toBe(true);
  });
});

describe("ORG-2 — a refused close says exactly what is in the way", () => {
  it("names the published events rather than counting them silently", () => {
    const [line] = describeOrgCloseBlockers([
      { kind: "PUBLISHED_EVENTS", count: 2, names: ["Spring Institute", "Fall Summit"] },
    ]);
    expect(line).toContain("Spring Institute");
    expect(line).toContain("Fall Summit");
    expect(line).toMatch(/archive them first/i);
  });

  it("gives one line per blocker, each with a way forward", () => {
    const reasons = describeOrgCloseBlockers([
      { kind: "PUBLISHED_EVENTS", count: 1, names: ["Spring Institute"] },
      { kind: "PURCHASES", count: 3 },
      { kind: "CERTIFICATES", count: 12 },
      { kind: "AI_USAGE", count: 40 },
      { kind: "ACTIVE_SUBSCRIPTION", count: 1 },
    ]);
    expect(reasons).toHaveLength(5);
    for (const reason of reasons) expect(reason.trim()).not.toBe("");
    // Money, certificates and metering point at transfer or support — never a
    // dead end, which is the whole point of ORG-2.
    expect(reasons[1]).toMatch(/transfer it instead|write to support/i);
    expect(reasons[2]).toMatch(/verify/i);
    expect(reasons[4]).toMatch(/billing page/i);
  });

  it("reads as singular for one and plural for many", () => {
    expect(describeOrgCloseBlockers([{ kind: "PURCHASES", count: 1 }])[0]).toContain("payment is");
    expect(describeOrgCloseBlockers([{ kind: "PURCHASES", count: 2 }])[0]).toContain("payments are");
  });
});

describe("ORG-2 — a refused event transfer recommends the path that works", () => {
  it("explains each disqualifier from DESIGN_PHASE_J", () => {
    const reasons = describeEventTransferBlockers([
      { kind: "NOT_DRAFT", count: 1, detail: "published" },
      { kind: "PURCHASES", count: 2 },
      { kind: "CERTIFICATES", count: 5 },
      { kind: "AI_USAGE", count: 9 },
      { kind: "SERIES", count: 1, detail: "DocWeek" },
    ]);
    expect(reasons).toHaveLength(5);
    expect(reasons[0]).toMatch(/only a draft can move/i);
    expect(reasons[4]).toContain("DocWeek");
  });

  it("recommends recreate + re-import instead of leaving people stuck", () => {
    expect(EVENT_TRANSFER_RECOMMENDATION).toMatch(/re-import/i);
  });
});

describe("W-6 still refuses organizationId on a settings save", () => {
  it("keeps rejecting the field, and now points at the route that does work", () => {
    const src = readFileSync(join(routesDir, "event.ts"), "utf8");
    expect(src).toContain("eventUpdateIncludesOrganizationId(req.body)");
    expect(src).toContain("return res.status(400).json({ error: EVENT_ORGANIZATION_TRANSFER_ERROR })");
    expect(EVENT_ORGANIZATION_TRANSFER_ERROR).toMatch(/can't move to a different organization/);
    expect(EVENT_ORGANIZATION_TRANSFER_ERROR).toMatch(/Move to another organization/);
  });
});

describe("ORG-2 — the routes are gated the way the copy promises", () => {
  const orgs = readFileSync(join(routesDir, "organizations.ts"), "utf8");
  const events = readFileSync(join(routesDir, "event.ts"), "utf8");

  it("transfer and close are OWNER-only and CSRF-protected", () => {
    for (const path of ["/:orgId/transfer-ownership", "/:orgId/close"]) {
      const at = orgs.indexOf(`"${path}"`);
      expect(at, path).toBeGreaterThan(-1);
      const block = orgs.slice(at, at + 900);
      expect(block, path).toContain("OrgRole.OWNER");
    }
    expect(orgs).toContain("requireCsrf");
  });

  it("a closed organization is refused by every write path that could revive it", () => {
    expect(orgs).toContain("assertOrgOpen");
    // Creating an event must not resurrect a closed org through a stale
    // membership row, either by naming it or by falling back to it.
    expect(events).toContain("assertOrgOpen(organization)");
    expect(events).toContain("organization: { closedAt: null }");
  });

  it("closed organizations leave the list every console surface reads", () => {
    const at = orgs.indexOf('"/mine"');
    expect(at).toBeGreaterThan(-1);
    expect(orgs.slice(at, at + 600)).toContain("organization: { closedAt: null }");
  });

  it("the sole-owner deletion guard stops counting a closed organization", () => {
    const src = readFileSync(join(__dirname, "..", "lib", "accountDeletion", "index.ts"), "utf8");
    const at = src.indexOf("findSoleOwnerOrgIds");
    expect(src.slice(at, at + 500)).toContain("organization: { closedAt: null }");
    // The old copy told people to do two things the product could not do.
    expect(src).toContain("resolvePath");
    expect(src).toContain("/organizer/org/settings");
  });
});

/**
 * The J-A finding, enforced.
 */
describe("ORG-2 — every denormalized organizationId moves with the event", () => {
  const schema = readFileSync(schemaPath, "utf8");

  /** Models declaring an organizationId field, and whether they also have eventId. */
  function modelsWithOrganizationId(): Array<{ model: string; hasEventId: boolean }> {
    const found: Array<{ model: string; hasEventId: boolean }> = [];
    const blocks = schema.split(/^model /m).slice(1);
    for (const block of blocks) {
      const model = block.slice(0, block.search(/\s/));
      const body = block.slice(0, block.indexOf("\n}"));
      const hasOrg = /^\s*organizationId\s+String/m.test(body);
      if (!hasOrg) continue;
      found.push({ model, hasEventId: /^\s*eventId\s+String/m.test(body) });
    }
    return found;
  }

  it("finds the seventeen models J-A counted", () => {
    // If this number moves, the transfer surface moved with it — read the new
    // model and decide, rather than updating the number.
    expect(modelsWithOrganizationId()).toHaveLength(17);
  });

  it("every event-scoped table is in the transfer list, and nothing else is", () => {
    const eventScoped = modelsWithOrganizationId()
      .filter((m) => m.hasEventId)
      .map((m) => m.model)
      .sort();
    expect(eventScoped).toEqual([...EVENT_ORGANIZATION_CHILD_TABLES].sort());
  });

  it("leaves out exactly the three that must not follow an event", () => {
    const orgScoped = modelsWithOrganizationId()
      .filter((m) => !m.hasEventId)
      .map((m) => m.model)
      .sort();
    // Event moves itself; OrgMembership and EventSeries belong to the org, and
    // a series member can't transfer at all (the SERIES blocker).
    expect(orgScoped).toEqual(["Event", "EventSeries", "OrgMembership"]);
    for (const model of orgScoped) {
      expect(EVENT_ORGANIZATION_CHILD_TABLES as readonly string[]).not.toContain(model);
    }
  });

  it("includes the two tables that carry organizationId with no foreign key", () => {
    // These are the ones a database error would never have caught.
    for (const model of ["ReadinessAssignment", "ReadinessPortalAccess"]) {
      expect(EVENT_ORGANIZATION_CHILD_TABLES as readonly string[]).toContain(model);
      const block = schema.split(`model ${model} {`)[1]!.split("\n}")[0]!;
      expect(block).toMatch(/^\s*organizationId\s+String/m);
      expect(block).not.toMatch(/organization\s+Organization\s+@relation/);
    }
  });

  it("moves the event and its children in one transaction", () => {
    const src = readFileSync(join(__dirname, "..", "lib", "orgLifecycle.ts"), "utf8");
    expect(src).toContain("prisma.$transaction");
    // A move that finds the event already published must abort, not race.
    expect(src).toContain("fresh.status !== EventStatus.DRAFT");
    for (const table of EVENT_ORGANIZATION_CHILD_TABLES) {
      expect(src, table).toContain(`table: "${table}"`);
    }
  });
});
