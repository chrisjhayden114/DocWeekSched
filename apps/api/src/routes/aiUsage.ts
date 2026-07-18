import { Router } from "express";
import { OrgRole } from "@prisma/client";
import { z } from "zod";
import { asyncHandler, requireOrgRole } from "../lib/authorization";
import { summarizeAiUsage } from "../lib/ai";
import { prisma } from "../lib/db";
import { AuthedRequest, requireAuth } from "../lib/middleware";

export const aiUsageRouter = Router();

aiUsageRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        organizationId: z.string().min(1),
        days: z.coerce.number().int().min(1).max(90).optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const orgId = parsed.data.organizationId;
    await requireOrgRole(req.user!.id, orgId, OrgRole.STAFF);

    const days = parsed.data.days ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const byFeature = await summarizeAiUsage({ organizationId: orgId, since });

    const recent = await prisma.aiUsageRecord.findMany({
      where: { organizationId: orgId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        feature: true,
        provider: true,
        model: true,
        tokensIn: true,
        tokensOut: true,
        costEstimateCents: true,
        latencyMs: true,
        eventId: true,
        createdAt: true,
      },
    });

    const totals = byFeature.reduce(
      (acc, row) => {
        acc.calls += row.calls;
        acc.tokensIn += row.tokensIn;
        acc.tokensOut += row.tokensOut;
        acc.costEstimateCents += row.costEstimateCents;
        return acc;
      },
      { calls: 0, tokensIn: 0, tokensOut: 0, costEstimateCents: 0 },
    );

    return res.json({
      organizationId: orgId,
      since: since.toISOString(),
      days,
      totals,
      byFeature,
      recent,
    });
  }),
);
