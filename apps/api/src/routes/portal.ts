import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/authorization";
import { validationErrorBody } from "../lib/errors";
import { authRateLimit } from "../lib/rateLimit";
import {
  getPortalView,
  streamPortalFile,
  submitPortalAssignment,
} from "../lib/readiness/portal";

/**
 * ER4 — public presenter portal. Token IS the auth; no login, no event ids
 * from the client. Rate-limited like auth routes (token-guessing surface).
 */
export const portalRouter = Router();

const portalRateLimit = authRateLimit({ windowMs: 60_000, max: 20, name: "portal" });

portalRouter.get(
  "/:token",
  portalRateLimit,
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(404).json({ error: "This link is not valid — contact the event organizer for a fresh one.", reason: "unknown" });
    const view = await getPortalView(token);
    return res.json(view);
  }),
);

const submissionSchema = z.object({
  value: z.unknown().optional(),
  fileUrl: z.string().max(40_000_000).optional(),
  fileName: z.string().max(260).optional(),
  mime: z.string().max(200).optional(),
});

portalRouter.post(
  "/:token/assignments/:assignmentId/submission",
  portalRateLimit,
  asyncHandler(async (req, res) => {
    const parsed = submissionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(validationErrorBody(parsed.error));
    const token = String(req.params.token || "").trim();
    const result = await submitPortalAssignment(token, req.params.assignmentId, parsed.data);
    return res.status(201).json(result);
  }),
);

portalRouter.get(
  "/:token/files/:submissionId",
  portalRateLimit,
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || "").trim();
    const file = await streamPortalFile(token, req.params.submissionId);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", file.contentDisposition);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(file.body);
  }),
);
