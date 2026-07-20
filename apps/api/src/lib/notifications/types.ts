import {
  NotificationClass,
  NotificationKind,
  type NotificationDelivery,
} from "@prisma/client";

/** Mute category keys stored on NotificationPreference.mutedCategories. */
export type MuteCategory =
  | "community"
  | "messages"
  | "announcements"
  | "meetings"
  | "session_alerts";

const INTERRUPT_KINDS = new Set<NotificationKind>([
  NotificationKind.MESSAGE,
  NotificationKind.ADMIN_REQUEST,
  NotificationKind.WAITLIST_PROMOTED,
  NotificationKind.ANNOUNCEMENT,
  NotificationKind.MEETING_REQUEST,
  NotificationKind.MEETING_ACCEPTED,
  NotificationKind.SESSION_CHANGED,
  NotificationKind.SESSION_STARTING_SOON,
  NotificationKind.USER_REPORT,
]);

export function classForKind(kind: NotificationKind): NotificationClass {
  return INTERRUPT_KINDS.has(kind) ? NotificationClass.INTERRUPT : NotificationClass.DIGEST;
}

export function muteCategoryForKind(kind: NotificationKind): MuteCategory | null {
  switch (kind) {
    case NotificationKind.COMMUNITY_THREAD:
    case NotificationKind.COMMUNITY_REPLY:
      return "community";
    case NotificationKind.MESSAGE:
      return "messages";
    case NotificationKind.ANNOUNCEMENT:
      return "announcements";
    case NotificationKind.MEETING_REQUEST:
    case NotificationKind.MEETING_ACCEPTED:
      return "meetings";
    case NotificationKind.SESSION_CHANGED:
    case NotificationKind.SESSION_STARTING_SOON:
    case NotificationKind.WAITLIST_PROMOTED:
      return "session_alerts";
    default:
      return null;
  }
}

export function dailyPushBudgetCeiling(): number {
  const n = Number(process.env.NOTIFICATION_DAILY_PUSH_BUDGET || 5);
  if (!Number.isFinite(n) || n < 0) return 5;
  return Math.floor(n);
}

export type ResolvedPrefs = {
  quietHoursStart: string;
  quietHoursEnd: string;
  digestLocalTime: string;
  digestEmail: boolean;
  mutedCategories: string[];
  timezone: string;
};

export const DEFAULT_PREFS: Omit<ResolvedPrefs, "timezone"> = {
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  digestLocalTime: "07:30",
  digestEmail: false,
  mutedCategories: [],
};

export type DeliverInput = {
  userId: string;
  eventId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  threadId?: string | null;
  conversationId?: string | null;
  announcementId?: string | null;
  meetingRequestId?: string | null;
  sessionId?: string | null;
  /** Safety channel — bypasses budget and quiet hours. */
  emergency?: boolean;
  /** Same-day session time/room change — bypasses quiet hours only. */
  sameDaySessionChange?: boolean;
  pushDedupKey?: string | null;
};

export type DeliverResult = {
  notificationId: string;
  class: NotificationClass;
  delivery: NotificationDelivery;
  budgetCharged: boolean;
  /** INTERRUPT over budget → degraded to digest. */
  degradedToDigest: boolean;
  suppressed: boolean;
};
