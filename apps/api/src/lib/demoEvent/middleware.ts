import { NextFunction, Request, Response } from "express";
import { brand } from "@event-app/config";
import { prisma } from "../db";
import { getDemoEventId } from "./reset";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Reject mutating requests that target the public demo event (by id or slug).
 * Demo is read-only for all clients — including authenticated founders using the API.
 */
export async function rejectDemoMutations(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  try {
    const demoId = await getDemoEventId();
    if (!demoId) {
      next();
      return;
    }

    const deny = () => {
      res.status(403).json({
        error: "The public demo event is read-only.",
        code: "DEMO_READ_ONLY",
      });
    };

    const headerId =
      typeof req.headers["x-event-id"] === "string" ? req.headers["x-event-id"].trim() : "";
    if (headerId && headerId === demoId) {
      deny();
      return;
    }

    const params = req.params as Record<string, string | undefined>;
    if (params.slug && params.slug.toLowerCase() === brand.demoEventSlug) {
      deny();
      return;
    }

    if (params.id === demoId || params.eventId === demoId) {
      deny();
      return;
    }

    const body = req.body as { eventId?: unknown } | undefined;
    if (body && typeof body.eventId === "string" && body.eventId === demoId) {
      deny();
      return;
    }

    // Session-scoped mutations: /sessions/:id...
    const path = req.originalUrl || req.url || "";
    if (path.startsWith("/sessions/") && params.id) {
      const session = await prisma.session.findUnique({
        where: { id: params.id },
        select: { eventId: true },
      });
      if (session?.eventId === demoId) {
        deny();
        return;
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}
