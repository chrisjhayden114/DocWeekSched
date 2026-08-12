/**
 * M4b — message request gate (flag: messaging_requests). Pure decisions over
 * the M4a Conversation columns (status, initiatedById); no DB access here.
 * A stranger's first DM lands as a silent REQUEST: one message until the
 * recipient replies; replying accepts (promotes to ACTIVE).
 */

export const REQUEST_FIRST_MESSAGE_MAX = 1000;
export const REQUESTS_PER_DAY = 10;
export const REQUESTS_PER_EVENT = 25;

export type GateConversation = { status: string; initiatedById: string | null };

/** Whether `senderId` may send now, and why not if they can't. */
export function requestSendDecision(
  c: GateConversation,
  senderId: string,
  senderMessageCount: number,
): { allowed: boolean; reason?: "WAIT_FOR_REPLY" } {
  if (c.status !== "REQUESTED") return { allowed: true };
  if (c.initiatedById && senderId === c.initiatedById && senderMessageCount >= 1) {
    return { allowed: false, reason: "WAIT_FOR_REPLY" };
  }
  return { allowed: true };
}

/** A reply from anyone other than the initiator accepts the request. */
export function promotesOnSend(c: GateConversation, senderId: string): boolean {
  return c.status === "REQUESTED" && !!c.initiatedById && senderId !== c.initiatedById;
}

/** First message in a REQUESTED conversation is capped. */
export function firstMessageTooLong(
  c: GateConversation,
  senderId: string,
  senderMessageCount: number,
  body: string,
): boolean {
  return (
    c.status === "REQUESTED" &&
    !!c.initiatedById &&
    senderId === c.initiatedById &&
    senderMessageCount === 0 &&
    body.length > REQUEST_FIRST_MESSAGE_MAX
  );
}

export function withinRequestCaps(counts: { today: number; event: number }): boolean {
  return counts.today < REQUESTS_PER_DAY && counts.event < REQUESTS_PER_EVENT;
}
