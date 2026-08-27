import { describe, expect, it } from "vitest";
import {
  notificationPrefsSchema,
  preferenceWriteData,
  resolvedPrefs,
} from "../lib/notifications/accountPrefs";
import { DEFAULT_PREFS } from "../lib/notifications/types";

describe("account-level notification preference PUT (unit)", () => {
  it("accepts the account-defaults fields (digest, unread-DM email, quiet hours)", () => {
    const parsed = notificationPrefsSchema.safeParse({
      digestEmail: true,
      messageEmail: false,
      quietHoursStart: "21:00",
      quietHoursEnd: "7:30",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(preferenceWriteData(parsed.data)).toEqual({
        digestEmail: true,
        messageEmail: false,
        quietHoursStart: "21:00",
        quietHoursEnd: "7:30",
      });
    }
  });

  it("writes only the fields the client sent (partial PATCH-like PUT)", () => {
    expect(preferenceWriteData({ digestEmail: true })).toEqual({ digestEmail: true });
    expect(preferenceWriteData({})).toEqual({});
  });

  it("rejects malformed quiet-hours times", () => {
    expect(notificationPrefsSchema.safeParse({ quietHoursStart: "10pm" }).success).toBe(false);
    expect(notificationPrefsSchema.safeParse({ quietHoursEnd: "25:00" }).success).toBe(true);
    // regex is HH:mm-shaped, not a clock check — "25:00" matches \d{1,2}:\d{2}
    expect(notificationPrefsSchema.safeParse({ quietHoursEnd: "7" }).success).toBe(false);
    expect(notificationPrefsSchema.safeParse({ digestEmail: "yes" }).success).toBe(false);
  });

  it("resolvedPrefs falls back to defaults when no row exists (GET fallback source)", () => {
    const resolved = resolvedPrefs(null, "America/New_York");
    expect(resolved.digestEmail).toBe(DEFAULT_PREFS.digestEmail);
    expect(resolved.quietHoursStart).toBe(DEFAULT_PREFS.quietHoursStart);
    expect(resolved.quietHoursEnd).toBe(DEFAULT_PREFS.quietHoursEnd);
    expect(resolved.messageEmail).toBe(true);
    expect(resolved.timezone).toBe("America/New_York");
  });
});
