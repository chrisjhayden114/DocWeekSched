import type { EventStatus } from "@prisma/client";

export type UiEventStatus = "Draft" | "Published" | "Archived" | "Past";

/** Map DB status + dates to organizer dashboard labels. ACTIVE = Published. */
export function uiEventStatus(event: {
  status: EventStatus;
  endDate: Date;
  now?: Date;
}): UiEventStatus {
  if (event.status === "ARCHIVED") return "Archived";
  if (event.status === "DRAFT") return "Draft";
  const now = event.now ?? new Date();
  if (event.status === "ACTIVE" && event.endDate.getTime() < now.getTime()) return "Past";
  return "Published";
}

/** Outsiders may only resolve slug/join for ACTIVE (Published) events. */
export function isPubliclyJoinable(status: EventStatus): boolean {
  return status === "ACTIVE";
}
