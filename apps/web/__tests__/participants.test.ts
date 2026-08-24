import { describe, expect, it } from "vitest";
import {
  canBeInvited,
  filterParticipants,
  inviteStatusChipStatus,
  inviteStatusLabel,
} from "../lib/participants";

/**
 * INV-1 — Participants tab helpers: roster status pills and the
 * client-side name/email filter.
 */
describe("INV-1 — inviteStatusLabel", () => {
  it("maps the roster statuses to customer copy", () => {
    expect(inviteStatusLabel("ACTIVE")).toBe("Active");
    expect(inviteStatusLabel("PENDING_SETUP")).toBe("Invite sent");
    expect(inviteStatusLabel("INVITE_EXPIRED")).toBe("Invite expired");
    // W-2 — added from a spreadsheet, never emailed.
    expect(inviteStatusLabel("NOT_INVITED")).toBe("Not invited");
  });

  it("falls back to an em dash when the status is missing", () => {
    expect(inviteStatusLabel(undefined)).toBe("—");
    expect(inviteStatusLabel(null)).toBe("—");
  });
});

describe("INV-1 — inviteStatusChipStatus", () => {
  it("joined reads green, in-flight and expired read warning", () => {
    expect(inviteStatusChipStatus("ACTIVE")).toBe("active");
    expect(inviteStatusChipStatus("PENDING_SETUP")).toBe("pending");
    expect(inviteStatusChipStatus("INVITE_EXPIRED")).toBe("archived");
    expect(inviteStatusChipStatus(undefined)).toBe("default");
  });

  it("W-2 — not-invited is a quiet resting state, not a fault", () => {
    expect(inviteStatusChipStatus("NOT_INVITED")).toBe("draft");
  });
});

describe("W-2 — canBeInvited", () => {
  it("everyone except people who already finished setup", () => {
    expect(canBeInvited("NOT_INVITED")).toBe(true);
    expect(canBeInvited("INVITE_EXPIRED")).toBe(true);
    expect(canBeInvited("PENDING_SETUP")).toBe(true);
    expect(canBeInvited("ACTIVE")).toBe(false);
    expect(canBeInvited(undefined)).toBe(false);
  });
});

describe("INV-1 — filterParticipants", () => {
  const rows = [
    { name: "Ada Lovelace", email: "ada@example.edu" },
    { name: "Grace Hopper", email: "grace@navy.mil" },
    { name: "Alan Turing", email: "alan@bletchley.uk" },
  ];

  it("matches name substrings case-insensitively", () => {
    expect(filterParticipants(rows, "ada")).toEqual([rows[0]]);
    expect(filterParticipants(rows, "HOPPER")).toEqual([rows[1]]);
  });

  it("matches email substrings", () => {
    expect(filterParticipants(rows, "navy.mil")).toEqual([rows[1]]);
    expect(filterParticipants(rows, "@bletchley")).toEqual([rows[2]]);
  });

  it("blank or whitespace query keeps every row", () => {
    expect(filterParticipants(rows, "")).toEqual(rows);
    expect(filterParticipants(rows, "   ")).toEqual(rows);
  });

  it("no match returns an empty list", () => {
    expect(filterParticipants(rows, "zzz")).toEqual([]);
  });
});
