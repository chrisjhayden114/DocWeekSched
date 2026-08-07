import { describe, expect, it } from "vitest";
import { invoiceStatusLabel, subscriptionStatusLine } from "@event-app/config";

const RAW_ENUM_VALUES = ["NONE", "TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"];

function line(overrides: Partial<Parameters<typeof subscriptionStatusLine>[0]> = {}) {
  return subscriptionStatusLine({
    subscriptionStatus: "ACTIVE",
    planTier: "PRO",
    planName: "Pro",
    ...overrides,
  });
}

describe("subscriptionStatusLine (E24)", () => {
  it("NONE (brand-new free org) shows no status line", () => {
    expect(line({ subscriptionStatus: "NONE", planTier: "FREE", planName: "Free" })).toBeNull();
  });

  it("ACTIVE (paying customer) shows no status line", () => {
    expect(line({ subscriptionStatus: "ACTIVE" })).toBeNull();
  });

  it("a downgraded org (CANCELED on Free) never shows a cancellation beside Free", () => {
    expect(line({ subscriptionStatus: "CANCELED", planTier: "FREE", planName: "Free" })).toBeNull();
  });

  it("CANCELED while still on a paid tier says access continues", () => {
    const result = line({ subscriptionStatus: "CANCELED" });
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Cancelled");
    expect(result!.text).toContain("Pro");
    expect(result!.tone).toBe("warning");
  });

  it("CANCELED with a known end date names it", () => {
    const result = line({ subscriptionStatus: "CANCELED", paidAccessEndsOn: "September 6, 2026" });
    expect(result!.text).toBe("Cancelled — Pro access ends September 6, 2026.");
  });

  it("PAST_DUE says what failed and what to do about it", () => {
    const result = line({ subscriptionStatus: "PAST_DUE" });
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Payment failed — update your card to keep Pro.");
    expect(result!.tone).toBe("danger");
  });

  it("TRIALING reads as a free trial, with the end date when known", () => {
    expect(line({ subscriptionStatus: "TRIALING" })!.text).toBe("Free trial");
    expect(line({ subscriptionStatus: "TRIALING", trialEndsOn: "August 20, 2026" })!.text).toBe(
      "Free trial — ends August 20, 2026",
    );
  });

  it("an unknown status value never leaks to the customer", () => {
    expect(line({ subscriptionStatus: "SOME_FUTURE_STATE" })).toBeNull();
  });

  it("no output ever equals or contains a raw SubscriptionStatus enum value", () => {
    for (const status of RAW_ENUM_VALUES) {
      for (const planTier of ["FREE", "PER_EVENT", "PRO"]) {
        const result = line({ subscriptionStatus: status, planTier });
        if (!result) continue;
        for (const raw of RAW_ENUM_VALUES) {
          expect(result.text).not.toContain(raw);
        }
      }
    }
  });
});

describe("invoiceStatusLabel (E24)", () => {
  it("maps provider statuses to friendly labels", () => {
    expect(invoiceStatusLabel("paid")).toBe("Paid");
    expect(invoiceStatusLabel("open")).toBe("Awaiting payment");
    expect(invoiceStatusLabel("refunded")).toBe("Refunded");
  });

  it("falls back to a capitalised word, never the raw lowercase value", () => {
    expect(invoiceStatusLabel("some_new_status")).toBe("Some new status");
    expect(invoiceStatusLabel("")).toBe("");
  });
});
