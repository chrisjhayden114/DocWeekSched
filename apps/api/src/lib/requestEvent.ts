import type { Request } from "express";
import { prisma } from "./db";
import { HttpError } from "./authorization";

/**
 * Resolve the event from `x-event-id`. Invalid or missing → 404 (no silent default fallback).
 */
export async function resolveEventFromRequest(req: Request) {
  const requested = typeof req.headers["x-event-id"] === "string" ? req.headers["x-event-id"].trim() : "";
  if (!requested) {
    throw new HttpError(404, { error: "Event not found" });
  }
  const event = await prisma.event.findUnique({ where: { id: requested } });
  if (!event) {
    throw new HttpError(404, { error: "Event not found" });
  }
  return event;
}

export function getRequestedEventId(req: Request): string | null {
  const requested = typeof req.headers["x-event-id"] === "string" ? req.headers["x-event-id"].trim() : "";
  return requested || null;
}
