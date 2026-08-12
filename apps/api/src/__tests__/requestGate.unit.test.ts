/**
 * M4b — request gate pure logic. ACTIVE conversations are never gated; in a
 * REQUESTED conversation the initiator gets exactly one (capped) message and
 * any non-initiator send promotes the request.
 */

import { describe, expect, it } from "vitest";
import {
  firstMessageTooLong,
  promotesOnSend,
  REQUEST_FIRST_MESSAGE_MAX,
  requestSendDecision,
  withinRequestCaps,
  type GateConversation,
} from "../lib/requestGate";

const INITIATOR = "user-a";
const RECIPIENT = "user-b";

const requested: GateConversation = { status: "REQUESTED", initiatedById: INITIATOR };
const active: GateConversation = { status: "ACTIVE", initiatedById: INITIATOR };

describe("requestSendDecision", () => {
  it("always allows sends in an ACTIVE conversation", () => {
    expect(requestSendDecision(active, INITIATOR, 0)).toEqual({ allowed: true });
    expect(requestSendDecision(active, INITIATOR, 5)).toEqual({ allowed: true });
    expect(requestSendDecision(active, RECIPIENT, 0)).toEqual({ allowed: true });
    expect(requestSendDecision(active, RECIPIENT, 5)).toEqual({ allowed: true });
  });

  it("allows the initiator's very first message in a REQUESTED conversation", () => {
    expect(requestSendDecision(requested, INITIATOR, 0)).toEqual({ allowed: true });
  });

  it("blocks the initiator once they have sent a message (WAIT_FOR_REPLY)", () => {
    expect(requestSendDecision(requested, INITIATOR, 1)).toEqual({
      allowed: false,
      reason: "WAIT_FOR_REPLY",
    });
    expect(requestSendDecision(requested, INITIATOR, 3)).toEqual({
      allowed: false,
      reason: "WAIT_FOR_REPLY",
    });
  });

  it("always allows the recipient, regardless of their message count", () => {
    expect(requestSendDecision(requested, RECIPIENT, 0)).toEqual({ allowed: true });
    expect(requestSendDecision(requested, RECIPIENT, 4)).toEqual({ allowed: true });
  });

  it("allows everyone when initiatedById is missing (legacy rows)", () => {
    const legacy: GateConversation = { status: "REQUESTED", initiatedById: null };
    expect(requestSendDecision(legacy, INITIATOR, 5)).toEqual({ allowed: true });
    expect(requestSendDecision(legacy, RECIPIENT, 5)).toEqual({ allowed: true });
  });
});

describe("promotesOnSend", () => {
  it("promotes only when a non-initiator sends into a REQUESTED conversation", () => {
    expect(promotesOnSend(requested, RECIPIENT)).toBe(true);
  });

  it("never promotes for the initiator", () => {
    expect(promotesOnSend(requested, INITIATOR)).toBe(false);
  });

  it("never promotes ACTIVE conversations", () => {
    expect(promotesOnSend(active, RECIPIENT)).toBe(false);
    expect(promotesOnSend(active, INITIATOR)).toBe(false);
  });

  it("never promotes when initiatedById is missing", () => {
    expect(promotesOnSend({ status: "REQUESTED", initiatedById: null }, RECIPIENT)).toBe(false);
  });
});

describe("firstMessageTooLong", () => {
  const short = "x".repeat(REQUEST_FIRST_MESSAGE_MAX);
  const long = "x".repeat(REQUEST_FIRST_MESSAGE_MAX + 1);

  it("caps only the initiator's first message in a REQUESTED conversation", () => {
    expect(firstMessageTooLong(requested, INITIATOR, 0, long)).toBe(true);
  });

  it("allows exactly the max length", () => {
    expect(firstMessageTooLong(requested, INITIATOR, 0, short)).toBe(false);
  });

  it("does not cap the initiator's later messages", () => {
    expect(firstMessageTooLong(requested, INITIATOR, 1, long)).toBe(false);
  });

  it("does not cap the recipient", () => {
    expect(firstMessageTooLong(requested, RECIPIENT, 0, long)).toBe(false);
  });

  it("does not cap ACTIVE conversations", () => {
    expect(firstMessageTooLong(active, INITIATOR, 0, long)).toBe(false);
  });

  it("does not cap when initiatedById is missing", () => {
    expect(firstMessageTooLong({ status: "REQUESTED", initiatedById: null }, INITIATOR, 0, long)).toBe(false);
  });
});

describe("withinRequestCaps", () => {
  it("allows below both caps", () => {
    expect(withinRequestCaps({ today: 0, event: 0 })).toBe(true);
    expect(withinRequestCaps({ today: 9, event: 24 })).toBe(true);
  });

  it("blocks at exactly 10 requests today", () => {
    expect(withinRequestCaps({ today: 10, event: 10 })).toBe(false);
    expect(withinRequestCaps({ today: 11, event: 11 })).toBe(false);
  });

  it("blocks at exactly 25 requests for the event", () => {
    expect(withinRequestCaps({ today: 0, event: 25 })).toBe(false);
    expect(withinRequestCaps({ today: 0, event: 26 })).toBe(false);
  });
});
