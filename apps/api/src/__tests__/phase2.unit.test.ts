import { describe, expect, it } from "vitest";
import { isPubliclyJoinable, uiEventStatus } from "../lib/eventStatus";
import { dryRunCsvInvites, suggestCsvMapping } from "../lib/csvInviteDryRun";

describe("publish / draft visibility", () => {
  it("maps ACTIVE to Published and DRAFT to Draft", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    expect(
      uiEventStatus({
        status: "DRAFT",
        endDate: new Date("2026-07-01T00:00:00Z"),
        now,
      }),
    ).toBe("Draft");
    expect(
      uiEventStatus({
        status: "ACTIVE",
        endDate: new Date("2026-07-01T00:00:00Z"),
        now,
      }),
    ).toBe("Published");
    expect(
      uiEventStatus({
        status: "ACTIVE",
        endDate: new Date("2026-05-01T00:00:00Z"),
        now,
      }),
    ).toBe("Past");
    expect(
      uiEventStatus({
        status: "ARCHIVED",
        endDate: new Date("2026-07-01T00:00:00Z"),
        now,
      }),
    ).toBe("Archived");
  });

  it("only ACTIVE events are publicly joinable", () => {
    expect(isPubliclyJoinable("ACTIVE")).toBe(true);
    expect(isPubliclyJoinable("DRAFT")).toBe(false);
    expect(isPubliclyJoinable("ARCHIVED")).toBe(false);
  });
});

describe("CSV invite dry-run", () => {
  it("suggests column mapping from common headers", () => {
    const mapping = suggestCsvMapping(["Email", "Full Name", "description"]);
    expect(mapping.Email).toBe("email");
    expect(mapping["Full Name"]).toBe("name");
    expect(mapping.description).toBe("description");
  });

  it("reports invalid emails and preserves create order", () => {
    const result = dryRunCsvInvites({
      headers: ["email", "name"],
      rows: [
        { email: "ok@example.com", name: "Ada" },
        { email: "not-an-email", name: "Bad" },
        { email: "ok@example.com", name: "Dup" },
        { email: "two@example.com", name: "Grace" },
      ],
      existingEmails: [],
    });
    expect(result.summary.creates).toBe(2);
    expect(result.summary.errors).toBe(2);
    const creates = result.rows.filter((r) => r.kind === "create");
    expect(creates.map((c) => (c.kind === "create" ? c.email : ""))).toEqual([
      "ok@example.com",
      "two@example.com",
    ]);
  });

  it("flags roster collisions", () => {
    const result = dryRunCsvInvites({
      headers: ["email", "name"],
      rows: [{ email: "taken@example.com", name: "X" }],
      existingEmails: ["taken@example.com"],
    });
    expect(result.summary.creates).toBe(0);
    expect(result.rows[0]?.kind).toBe("error");
  });
});
