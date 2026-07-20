import { NotificationClass, NotificationDelivery, NotificationKind } from "@prisma/client";
import { deliverNotification } from "../notifications/deliver";

/**
 * Agent-generated attendee touches — DIGEST class only, never push.
 * Kind AGENT_ATTENDEE_TOUCH is routed to DIGEST via classForKind (not in INTERRUPT set).
 */
export async function notifyAgentAttendeeTouch(input: {
  userId: string;
  eventId: string;
  title: string;
  body?: string | null;
  sessionId?: string | null;
}): Promise<{
  notificationId: string;
  class: NotificationClass;
  delivery: NotificationDelivery;
}> {
  const result = await deliverNotification({
    userId: input.userId,
    eventId: input.eventId,
    kind: NotificationKind.AGENT_ATTENDEE_TOUCH,
    title: input.title,
    body: input.body ?? null,
    sessionId: input.sessionId ?? null,
  });

  if (result.class !== NotificationClass.DIGEST) {
    throw new Error("Agent attendee touches must be DIGEST class");
  }
  if (
    result.delivery === NotificationDelivery.PUSHED ||
    result.delivery === NotificationDelivery.QUEUED_PUSH
  ) {
    throw new Error("Agent attendee touches must never push");
  }

  return {
    notificationId: result.notificationId,
    class: result.class,
    delivery: result.delivery,
  };
}
