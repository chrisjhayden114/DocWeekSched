export const MESSAGE_EMAIL_MIN_AGE_MS = 15 * 60 * 1000;

export type UnreadDm = {
  conversationId: string;
  senderName: string;
  preview: string;
  createdAt: Date;
  conversationStatus: string;
  muted: boolean;
  fromSelf: boolean;
};

/** Which unread DMs qualify for the email. */
export function emailEligibleDms(rows: UnreadDm[], now: Date): UnreadDm[] {
  return rows.filter(
    (r) =>
      !r.fromSelf &&
      !r.muted &&
      r.conversationStatus !== "REQUESTED" &&
      now.getTime() - r.createdAt.getTime() >= MESSAGE_EMAIL_MIN_AGE_MS,
  );
}

/** Daily dedup key (one message-email per user/event/local day). */
export function messageEmailDedupKey(userId: string, eventId: string, dayKey: string): string {
  return `msgmail:${userId}:${eventId}:${dayKey}`;
}
