import { describe, expect, it } from "vitest";
import {
  emailEligibleDms,
  messageEmailDedupKey,
  MESSAGE_EMAIL_MIN_AGE_MS,
  type UnreadDm,
} from "../lib/notifications/messageEmailRules";

const now = new Date("2027-06-15T16:00:00Z");
const olderThanMin = new Date(now.getTime() - MESSAGE_EMAIL_MIN_AGE_MS - 60_000);
const youngerThanMin = new Date(now.getTime() - MESSAGE_EMAIL_MIN_AGE_MS + 60_000);

function dm(over: Partial<UnreadDm> = {}): UnreadDm {
  return {
    conversationId: "c1",
    senderName: "Sam",
    preview: "hello",
    createdAt: olderThanMin,
    conversationStatus: "ACTIVE",
    muted: false,
    fromSelf: false,
    ...over,
  };
}

describe("emailEligibleDms", () => {
  it("excludes fromSelf", () => {
    expect(emailEligibleDms([dm({ fromSelf: true })], now)).toEqual([]);
  });

  it("excludes muted", () => {
    expect(emailEligibleDms([dm({ muted: true })], now)).toEqual([]);
  });

  it("excludes REQUESTED conversations", () => {
    expect(emailEligibleDms([dm({ conversationStatus: "REQUESTED" })], now)).toEqual([]);
  });

  it("excludes DMs younger than 15 minutes", () => {
    expect(emailEligibleDms([dm({ createdAt: youngerThanMin })], now)).toEqual([]);
  });

  it("includes ACTIVE DMs older than 15 minutes", () => {
    const row = dm();
    expect(emailEligibleDms([row], now)).toEqual([row]);
  });
});

describe("messageEmailDedupKey", () => {
  it("shapes as msgmail:user:event:day", () => {
    expect(messageEmailDedupKey("u1", "e1", "2027-06-15")).toBe("msgmail:u1:e1:2027-06-15");
  });
});
