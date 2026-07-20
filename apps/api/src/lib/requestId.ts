import { randomBytes } from "crypto";
import type { NextFunction, Request, Response } from "express";

export type RequestWithId = Request & { requestId?: string };

const INBOUND_RE = /^[\w.-]{8,128}$/;

/** Accept inbound X-Request-Id when well-formed; otherwise mint one. Echo on every response. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header("x-request-id")?.trim();
  const id = inbound && INBOUND_RE.test(inbound) ? inbound : randomBytes(16).toString("hex");
  (req as RequestWithId).requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}

export function getRequestId(req: Request): string | undefined {
  return (req as RequestWithId).requestId;
}
