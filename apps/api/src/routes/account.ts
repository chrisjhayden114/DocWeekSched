import { Router } from "express";
import { asyncHandler } from "../lib/authorization";
import { exportAccountForUser } from "../lib/accountExport";
import { authRateLimit } from "../lib/rateLimit";
import { AuthedRequest, requireAuth } from "../lib/middleware";

export const accountRouter = Router();

/**
 * GDPR self-service JSON export — authenticated, self-only, rate-limited.
 * No account deletion in this route (awaiting cascade design approval).
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
