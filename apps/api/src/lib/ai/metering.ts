import type { AiMeterFeature, Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { AiProviderName } from "./types";

export async function recordAiUsage(input: {
  organizationId: string;
  eventId?: string | null;
  userId?: string | null;
  feature: AiMeterFeature;
  provider: AiProviderName | string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costEstimateCents?: number;
  latencyMs: number;
  jobId?: string | null;
  requestId?: string | null;
}): Promise<{ id: string }> {
  const row = await prisma.aiUsageRecord.create({
    data: {
      organizationId: input.organizationId,
      eventId: input.eventId ?? null,
      userId: input.userId ?? null,
      feature: input.feature,
      provider: input.provider,
      model: input.model,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costEstimateCents: input.costEstimateCents ?? estimateCostCents(input.model, input.tokensIn, input.tokensOut),
      latencyMs: input.latencyMs,
      jobId: input.jobId ?? null,
      requestId: input.requestId ?? null,
    },
  });
  return { id: row.id };
}

/** Rough cents estimate; mock is always 0. */
export function estimateCostCents(model: string, tokensIn: number, tokensOut: number): number {
  if (model.startsWith("mock")) return 0;
  // ~$3/MTok in + $15/MTok out → cents
  const inCents = (tokensIn / 1_000_000) * 300;
  const outCents = (tokensOut / 1_000_000) * 1500;
  return Math.max(0, Math.round(inCents + outCents));
}

export async function countAiUsage(params: {
  organizationId: string;
  eventId: string;
  feature: AiMeterFeature;
}): Promise<number> {
  return prisma.aiUsageRecord.count({
    where: {
      organizationId: params.organizationId,
      eventId: params.eventId,
      feature: params.feature,
    },
  });
}

export type AiUsageSummaryRow = {
  feature: AiMeterFeature;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costEstimateCents: number;
};

export async function summarizeAiUsage(params: {
  organizationId: string;
  since: Date;
}): Promise<AiUsageSummaryRow[]> {
  const rows = await prisma.aiUsageRecord.groupBy({
    by: ["feature"],
    where: {
      organizationId: params.organizationId,
      createdAt: { gte: params.since },
    },
    _count: { _all: true },
    _sum: { tokensIn: true, tokensOut: true, costEstimateCents: true },
  });
  return rows.map((r) => ({
    feature: r.feature,
    calls: r._count._all,
    tokensIn: r._sum.tokensIn ?? 0,
    tokensOut: r._sum.tokensOut ?? 0,
    costEstimateCents: r._sum.costEstimateCents ?? 0,
  }));
}

export type { Prisma };
