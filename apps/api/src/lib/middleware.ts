import { NextFunction, Request, Response } from "express";
import { verifyToken } from "./auth";
import { env } from "./env";
import { tokensEqual } from "./auth";

export type AuthedRequest = Request & {
  user?: { id: string; role: "ADMIN" | "ATTENDEE" | "SPEAKER" };
};

function readSessionToken(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[env.sessionCookieName];
  if (typeof fromCookie === "string" && fromCookie.length > 0) return fromCookie;

  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() || null;
  }
  return null;
}

export const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
  const token = readSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.userId, role: payload.role };
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
};

/**
 * CSRF protection for cookie-authenticated mutating requests.
 * Bearer-only requests (no session cookie) skip CSRF (legacy/mobile).
 * Required when SameSite=None interim mode is active; also enabled for Lax defense-in-depth.
 */
export const requireCsrf = (req: AuthedRequest, res: Response, next: NextFunction) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }

  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const sessionCookie = cookies?.[env.sessionCookieName];
  if (!sessionCookie) {
    // Authorization: Bearer without cookie — no CSRF cookie to check.
    return next();
  }

  const headerToken = req.headers["x-csrf-token"];
  const csrfHeader = typeof headerToken === "string" ? headerToken : "";
  const csrfCookie = cookies?.[env.csrfCookieName] || "";
  if (!csrfHeader || !csrfCookie || !tokensEqual(csrfHeader, csrfCookie)) {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  return next();
};

/** @deprecated Prefer requireEventAccess / requireOrgRole — kept only for gradual migration typing. */
export const requireRole = (roles: Array<"ADMIN" | "ATTENDEE" | "SPEAKER">) => {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
};
