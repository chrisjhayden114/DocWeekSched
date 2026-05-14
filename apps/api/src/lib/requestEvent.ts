import type { Request } from "express";
import { prisma } from "./db";
import { getDefaultEventWhenUnspecified } from "./event";

export async function resolveEventFromRequest(req: Request) {
  const requested = typeof req.headers["x-event-id"] === "string" ? req.headers["x-event-id"] : undefined;
  if (requested) {
    const event = await prisma.event.findUnique({ where: { id: requested } });
    if (event) return event;
  }
  return getDefaultEventWhenUnspecified();
}
