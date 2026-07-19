import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../lib/authorization";
import { exportAccountForUser } from "../lib/accountExport";
import {
  cancelAccountDeletion,
  requestAccountDeletion,
} from "../lib/accountDeletion";
import { authRateLimit } from "../lib/rateLimit";
import { AuthedRequest, requireAuth, requireCsrf } from "../lib/middleware";
import { clearSessionCookies } from "../lib/cookies";
import { prisma } from "../lib/db";

export const accountRouter = Router();

const deleteRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * GDPR self-service JSON export — authenticated, self-only, rate-limited.
 */
accountRouter.get(
  "/export",
  requireAuth,
  authRateLimit({ windowMs: 60_000, max: 5 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const payload = await exportAccountForUser(userId);
    if (!payload) {
      return res.status(404).json({ error: "Account not found" });
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="account-export-${userId.slice(0, 8)}.json"`,
    );
    return res.status(200).json(payload);
  }),
);

accountRouter.get(
  "/deletion",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const row = await prisma.accountDeletionRequest.findUnique({
      where: { userId: req.user!.id },
    });
    if (!row || row.status !== "PENDING") {
      return res.json({ pending: false });
    }
    return res.json({
      pending: true,
      scheduledFor: row.scheduledFor.toISOString(),
      requestedAt: row.requestedAt.toISOString(),
    });
  }),
);

/**
 * Request account deletion (7-day grace). Requires email + password re-auth.
 * Immediately deactivates; clears session cookies on success.
 */
accountRouter.post(
  "/deletion",
  requireAuth,
  requireCsrf,
  authRateLimit({ windowMs: 60_000, max: 3 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = deleteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    try {
      const result = await requestAccountDeletion({
        userId: req.user!.id,
        email: parsed.data.email,
        password: parsed.data.password,
      });
      clearSessionCookies(res);
      return res.status(202).json({
        ok: true,
        scheduledFor: result.scheduledFor.toISOString(),
        requestId: result.requestId,
        message:
          "Your account is deactivated. It will be permanently deleted in 7 days unless you cancel by signing in again.",
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json(err.body);
      }
      throw err;
    }
  }),
);

accountRouter.post(
  "/deletion/cancel",
  requireAuth,
  requireCsrf,
  authRateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    try {
      await cancelAccountDeletion(req.user!.id);
      return res.json({ ok: true, message: "Account deletion cancelled. Your account is active again." });
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json(err.body);
      }
      throw err;
    }
  }),
);
