import { OPS_WINDOW_AFTER_MS, OPS_WINDOW_BEFORE_MS } from "./types";

export function isOpsInboxActive(
  event: { startDate: Date; endDate: Date },
  now = new Date(),
): boolean {
  const openAt = new Date(event.startDate.getTime() - OPS_WINDOW_BEFORE_MS);
  const closeAt = new Date(event.endDate.getTime() + OPS_WINDOW_AFTER_MS);
  return now >= openAt && now <= closeAt;
}

export function opsInboxWindow(event: { startDate: Date; endDate: Date }): {
  openAt: Date;
  closeAt: Date;
} {
  return {
    openAt: new Date(event.startDate.getTime() - OPS_WINDOW_BEFORE_MS),
    closeAt: new Date(event.endDate.getTime() + OPS_WINDOW_AFTER_MS),
  };
}
