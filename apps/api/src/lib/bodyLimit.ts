import express, { type NextFunction, type Request, type Response } from "express";
import { AGENDA_INGEST_MAX_BYTES } from "./ai/ingest/constants";

/** Default for most mutating routes. */
export const DEFAULT_JSON_LIMIT = "1mb";

/**
 * Route-scoped JSON body limits for data-URL / large-payload endpoints.
 * Mounted as a single path-aware middleware so the global 1mb default never
 * breaks uploads mid-deploy.
 */
export function jsonLimitForPath(method: string, path: string): string {
  const m = method.toUpperCase();
  if (m !== "POST" && m !== "PUT" && m !== "PATCH") return DEFAULT_JSON_LIMIT;

  // Session create/update (optional data-URL fields) + resource uploads
  if (path === "/sessions" || path === "/sessions/") return "6mb";
  if (/^\/sessions\/[^/]+\/?$/.test(path)) return "6mb";
  if (/^\/sessions\/[^/]+\/resources\/?$/.test(path)) return "6mb";

  // Venue map images (~8MB binary → larger base64 envelope)
  if (path === "/event/maps" || /^\/event\/maps\/[^/]+\/?$/.test(path)) return "10mb";

  // Agenda ingest (AGENDA_INGEST_MAX_BYTES, often as data-URL)
  if (path === "/ai/ingest" || path === "/ai/ingest/") {
    const mb = Math.ceil((AGENDA_INGEST_MAX_BYTES * 1.4) / (1024 * 1024)) + 2;
    return `${mb}mb`;
  }

  // Certificate signature data-URL (schema max 500k chars)
  if (
    /^\/certificates\/event\/[^/]+\/templates\/?$/.test(path) ||
    /^\/certificates\/templates\/[^/]+\/?$/.test(path)
  ) {
    return "2mb";
  }

  // Other upload surfaces that would silently 413 under 1mb
  if (path === "/speakers" || /^\/speakers\/[^/]+\/?$/.test(path)) return "6mb";
  if (path === "/sponsors" || /^\/sponsors\/[^/]+\/?$/.test(path)) return "4mb";
  if (path === "/event" || path === "/event/") return "16mb"; // banner/logo fields
  if (/^\/cfp\/public\/[^/]+\/submit\/?$/.test(path)) return "12mb";
  // Attendee invite / profile photo data-URLs (schema allows up to ~12MB)
  if (path === "/attendees" || path === "/attendees/" || path === "/attendees/invite-bulk") return "16mb";
  if (path === "/attendees/me" || path === "/auth/me") return "16mb";

  return DEFAULT_JSON_LIMIT;
}

/**
 * Path-aware JSON parser. Must run before routers so `req.path` is the full path.
 * Oversized bodies yield Express's native 413 Payload Too Large.
 */
export function jsonBodyParser(req: Request, res: Response, next: NextFunction): void {
  const limit = jsonLimitForPath(req.method, req.path);
  express.json({ limit })(req, res, next);
}
