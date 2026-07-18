import { createHash } from "crypto";
import { prisma } from "../../db";
import { gatewayEmbed } from "../gateway";
import type { GatewayCallContext } from "../types";

export function buildProfileSourceText(user: {
  name?: string | null;
  title?: string | null;
  affiliation?: string | null;
  bio?: string | null;
  researchInterests?: string | null;
}): string {
  return [
    user.name?.trim(),
    user.title?.trim(),
    user.affiliation?.trim(),
    user.bio?.trim(),
    user.researchInterests?.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

export function hashSourceText(sourceText: string): string {
  return createHash("sha256").update(sourceText).digest("hex");
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na < 1e-12 || nb < 1e-12) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function asNumberArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
}

/**
 * Return cached embedding if sourceHash matches; otherwise embed via gateway and upsert.
 */
export async function ensureProfileEmbedding(
  userId: string,
  ctx: Pick<GatewayCallContext, "organizationId" | "eventId" | "userId" | "skipCap" | "skipMetering" | "skipAudit">,
): Promise<{
  vector: number[];
  sourceText: string;
  sourceHash: string;
  recomputed: boolean;
  usageId: string | null;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      title: true,
      affiliation: true,
      bio: true,
      researchInterests: true,
    },
  });
  if (!user) {
    throw new Error(`User not found for embedding: ${userId}`);
  }

  const sourceText = buildProfileSourceText(user) || "(empty profile)";
  const sourceHash = hashSourceText(sourceText);

  const existing = await prisma.matchProfileEmbedding.findUnique({ where: { userId } });
  if (existing && existing.sourceHash === sourceHash) {
    return {
      vector: asNumberArray(existing.embedding),
      sourceText: existing.sourceText,
      sourceHash: existing.sourceHash,
      recomputed: false,
      usageId: null,
    };
  }

  const embedded = await gatewayEmbed(sourceText, {
    organizationId: ctx.organizationId,
    eventId: ctx.eventId,
    userId: ctx.userId ?? userId,
    feature: "MATCHMAKER",
    skipCap: ctx.skipCap,
    skipMetering: ctx.skipMetering,
    skipAudit: ctx.skipAudit,
  });
  if (!embedded.ok) {
    throw new Error(embedded.message || "Embedding failed");
  }

  await prisma.matchProfileEmbedding.upsert({
    where: { userId },
    create: {
      userId,
      sourceText,
      sourceHash,
      embedding: embedded.vector,
      dimensions: embedded.dimensions,
      model: embedded.model,
      provider: embedded.provider,
    },
    update: {
      sourceText,
      sourceHash,
      embedding: embedded.vector,
      dimensions: embedded.dimensions,
      model: embedded.model,
      provider: embedded.provider,
    },
  });

  return {
    vector: embedded.vector,
    sourceText,
    sourceHash,
    recomputed: true,
    usageId: embedded.usageId,
  };
}
