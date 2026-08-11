/**
 * Messages, phase 1 (Chunk E18) — pure view logic for the Messages surface.
 *
 * Design source: ux-audit-capture/RESEARCH_MESSAGING.md. The governing rules:
 * - Messages owns exactly one job: 1:1 and small named-group correspondence.
 *   Event-wide chat is gone (Community owns event-wide posting).
 * - Unread is counted by CONVERSATION, never by message.
 * - Grouping: consecutive messages from one sender within 5 minutes share one
 *   metadata line; day dividers between calendar days.
 */

import { DELETED_PARTICIPANT_LABEL } from "@event-app/shared";

/** Sender-run grouping window (research §5.3). */
const GROUP_WINDOW_MS = 5 * 60_000;

export type ConversationMemberView = {
  user: {
    id: string;
    name: string;
    role: string;
    affiliation?: string | null;
    photoUrl?: string | null;
  };
};

export type ConversationView = {
  id: string;
  name?: string | null;
  type: "EVENT" | "DIRECT" | "GROUP" | "SESSION";
  createdAt?: string;
  members: ConversationMemberView[];
  messages: { id: string; body: string; createdAt: string; user: { id: string; name: string } | null }[];
  unread?: boolean;
  muted?: boolean;
};

export type MessageView = {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string | null; name: string; role?: string | null; deleted?: boolean } | null;
  /** Client-only optimistic-send state; server rows have neither field. */
  localStatus?: "sending" | "failed";
  clientId?: string;
};

/** Only DIRECT and GROUP conversations belong on the Messages surface (E18.1). */
export function isMessagingConversation(c: Pick<ConversationView, "type">): boolean {
  return c.type === "DIRECT" || c.type === "GROUP";
}

export function otherMember(
  c: ConversationView,
  currentUserId: string,
): ConversationMemberView["user"] | null {
  if (c.type !== "DIRECT") return null;
  return c.members.find((m) => m.user.id !== currentUserId)?.user ?? null;
}

export function conversationTitle(c: ConversationView, currentUserId: string): string {
  if (c.type === "GROUP") {
    if (c.name) return c.name;
    const others = c.members.filter((m) => m.user.id !== currentUserId).map((m) => m.user.name);
    return others.length > 0 ? others.join(", ") : "Group conversation";
  }
  const other = otherMember(c, currentUserId);
  return other?.name ?? DELETED_PARTICIPANT_LABEL;
}

/** Role chip only for Speaker / Organizer — everyone else gets nothing (research §5.3). */
export function roleLabel(role: string | null | undefined): string | null {
  if (role === "SPEAKER") return "Speaker";
  if (role === "ADMIN") return "Organizer";
  return null;
}

/**
 * Secondary line under the name: "Affiliation · Role" for direct conversations,
 * participant count for groups. Null when there is nothing worth saying.
 */
export function conversationSecondaryLine(c: ConversationView, currentUserId: string): string | null {
  if (c.type === "GROUP") {
    const count = c.members.length;
    return count > 0 ? `${count} people` : null;
  }
  const other = otherMember(c, currentUserId);
  if (!other) return null;
  const parts = [other.affiliation?.trim() || null, roleLabel(other.role)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** One-line preview of the last message, "You: " prefixed when it is yours. */
export function conversationPreview(c: ConversationView, currentUserId: string): string | null {
  const last = c.messages?.[0];
  if (!last) return null;
  const body = last.body.replace(/\s+/g, " ").trim();
  return last.user?.id === currentUserId ? `You: ${body}` : body;
}

export function initialsFor(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase();
  return (words[0]!.slice(0, 1) + words[words.length - 1]!.slice(0, 1)).toUpperCase();
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function daysApart(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * List-row timestamp: "11:04" today, "Tue" within the last week, "Sep 3" older
 * (adds the year when it differs from the current one).
 */
export function conversationTimestamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (sameLocalDay(date, now)) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const apart = daysApart(date, now);
  if (apart > 0 && apart < 7) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Day-divider heading: "Today", "Yesterday", then "Wednesday, September 3". */
export function dayDividerLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (sameLocalDay(date, now)) return "Today";
  const apart = daysApart(date, now);
  if (apart === 1) return "Yesterday";
  const base = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return date.getFullYear() === now.getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

/** Per-group metadata time: "11:04 AM". */
export function messageGroupTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export type MessageGroup = {
  senderId: string | null;
  senderName: string;
  isSelf: boolean;
  messages: MessageView[];
  /** Timestamp of the last message in the run — shown on the metadata line. */
  lastAt: string;
};

export type MessageDayGroup = {
  dayKey: string;
  label: string;
  groups: MessageGroup[];
};

/**
 * Sender/day grouping (E18.3): day dividers between calendar days; consecutive
 * messages from the same sender within 5 minutes collapse into one group.
 */
export function groupMessagesForThread(
  messages: MessageView[],
  currentUserId: string,
  now: Date = new Date(),
): MessageDayGroup[] {
  const days: MessageDayGroup[] = [];
  let currentDay: MessageDayGroup | null = null;
  let currentGroup: MessageGroup | null = null;

  for (const message of messages) {
    const date = new Date(message.createdAt);
    const dayKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

    if (!currentDay || currentDay.dayKey !== dayKey) {
      currentDay = { dayKey, label: dayDividerLabel(message.createdAt, now), groups: [] };
      days.push(currentDay);
      currentGroup = null;
    }

    const senderId = message.user?.id ?? null;
    const sameSender = currentGroup !== null && currentGroup.senderId === senderId && senderId !== null;
    const withinWindow =
      currentGroup !== null &&
      date.getTime() - new Date(currentGroup.lastAt).getTime() <= GROUP_WINDOW_MS;

    if (currentGroup && sameSender && withinWindow) {
      currentGroup.messages.push(message);
      currentGroup.lastAt = message.createdAt;
    } else {
      currentGroup = {
        senderId,
        senderName: message.user?.name ?? DELETED_PARTICIPANT_LABEL,
        isSelf: senderId != null && senderId === currentUserId,
        messages: [message],
        lastAt: message.createdAt,
      };
      currentDay.groups.push(currentGroup);
    }
  }

  return days;
}

/** Most recent activity first: last message time, falling back to creation time. */
export function sortConversationsByActivity(conversations: ConversationView[]): ConversationView[] {
  const activityOf = (c: ConversationView) => {
    const last = c.messages?.[0]?.createdAt ?? c.createdAt ?? "";
    return new Date(last).getTime() || 0;
  };
  return [...conversations].sort((a, b) => activityOf(b) - activityOf(a));
}

/** Search names, affiliations, and last-message text (E18.5 rename of "Filter chats"). */
export function filterConversations(
  conversations: ConversationView[],
  query: string,
  currentUserId: string,
): ConversationView[] {
  const q = query.trim().toLowerCase();
  if (!q) return conversations;
  return conversations.filter((c) => {
    if (conversationTitle(c, currentUserId).toLowerCase().includes(q)) return true;
    if (
      c.members.some(
        (m) =>
          m.user.name.toLowerCase().includes(q) ||
          (m.user.affiliation ?? "").toLowerCase().includes(q),
      )
    ) {
      return true;
    }
    const last = c.messages?.[0]?.body ?? "";
    return last.toLowerCase().includes(q);
  });
}

/**
 * Unread is counted by conversation, never by message (Whova's documented
 * failure — research §1.1). Input is the notification list; output is the set
 * of conversations with any unread MESSAGE notification.
 */
export function unreadConversationIdSet(
  notifications: { kind: string; readAt: string | null; conversationId: string | null }[],
): Set<string> {
  const ids = new Set<string>();
  for (const n of notifications) {
    if (n.kind === "MESSAGE" && !n.readAt && n.conversationId) ids.add(n.conversationId);
  }
  return ids;
}

/** localStorage key for the per-conversation unsent draft (E18.4). */
export function draftStorageKey(conversationId: string): string {
  return `messageDraft:${conversationId}`;
}

/**
 * Merge a fresh server page into local state, preserving optimistic rows that
 * the server does not know about yet (sending/failed). Server order wins for
 * persisted rows; local pending rows stay appended at the end.
 */
export function mergeServerMessages(local: MessageView[], server: MessageView[]): MessageView[] {
  const pending = local.filter((m) => m.localStatus);
  const serverBodies = new Set(server.map((m) => `${m.user?.id ?? ""}\n${m.body}`));
  // Drop optimistic rows the server has since persisted (same sender + body).
  const stillPending = pending.filter(
    (m) => m.localStatus === "failed" || !serverBodies.has(`${m.user?.id ?? ""}\n${m.body}`),
  );
  return [...server, ...stillPending];
}
