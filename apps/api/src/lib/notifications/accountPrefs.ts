import { z } from "zod";
import { prisma } from "../db";
import { DEFAULT_PREFS } from "./types";

export const notificationPrefsSchema = z.object({
  quietHoursStart: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  quietHoursEnd: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  digestLocalTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  digestEmail: z.boolean().optional(),
  messageEmail: z.boolean().optional(),
  readReceipts: z.boolean().optional(),
  mutedCategories: z.array(z.string()).optional(),
  timezone: z.string().nullable().optional(),
});

export type NotificationPrefsPatch = z.infer<typeof notificationPrefsSchema>;

/** Only the fields the client sent — used by both event and account-level PUTs. */
export function preferenceWriteData(parsed: NotificationPrefsPatch) {
  return {
    ...(parsed.quietHoursStart !== undefined ? { quietHoursStart: parsed.quietHoursStart } : {}),
    ...(parsed.quietHoursEnd !== undefined ? { quietHoursEnd: parsed.quietHoursEnd } : {}),
    ...(parsed.digestLocalTime !== undefined ? { digestLocalTime: parsed.digestLocalTime } : {}),
    ...(parsed.digestEmail !== undefined ? { digestEmail: parsed.digestEmail } : {}),
    ...(parsed.messageEmail !== undefined ? { messageEmail: parsed.messageEmail } : {}),
    ...(parsed.readReceipts !== undefined ? { readReceipts: parsed.readReceipts } : {}),
    ...(parsed.mutedCategories !== undefined ? { mutedCategories: parsed.mutedCategories } : {}),
    ...(parsed.timezone !== undefined ? { timezone: parsed.timezone } : {}),
  };
}

export function resolvedPrefs(
  row: {
    quietHoursStart: string;
    quietHoursEnd: string;
    digestLocalTime: string;
    digestEmail: boolean;
    messageEmail?: boolean;
    readReceipts?: boolean;
    mutedCategories: string[];
    timezone: string | null;
  } | null,
  eventTimezone: string,
) {
  return {
    quietHoursStart: row?.quietHoursStart ?? DEFAULT_PREFS.quietHoursStart,
    quietHoursEnd: row?.quietHoursEnd ?? DEFAULT_PREFS.quietHoursEnd,
    digestLocalTime: row?.digestLocalTime ?? DEFAULT_PREFS.digestLocalTime,
    digestEmail: row?.digestEmail ?? DEFAULT_PREFS.digestEmail,
    messageEmail: row?.messageEmail ?? true,
    readReceipts: row?.readReceipts ?? false,
    mutedCategories: row?.mutedCategories ?? DEFAULT_PREFS.mutedCategories,
    timezone: row?.timezone || eventTimezone || "UTC",
  };
}

export async function getAccountNotificationPreference(userId: string) {
  const row = await prisma.notificationPreference.findFirst({
    where: { userId, eventId: null },
  });
  return resolvedPrefs(row, row?.timezone || "UTC");
}

/**
 * Upsert the global (eventId IS NULL) NotificationPreference row.
 * Additive — does not touch per-event rows. GET /notifications/preferences
 * already falls back to this row when no event override exists.
 */
export async function upsertAccountNotificationPreference(
  userId: string,
  parsed: NotificationPrefsPatch,
) {
  const existing = await prisma.notificationPreference.findFirst({
    where: { userId, eventId: null },
  });
  const data = preferenceWriteData(parsed);
  const row = existing
    ? await prisma.notificationPreference.update({ where: { id: existing.id }, data })
    : await prisma.notificationPreference.create({
        data: { userId, eventId: null, ...data },
      });
  return resolvedPrefs(row, row.timezone || "UTC");
}
