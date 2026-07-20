import { z } from "zod";
import { prisma } from "../../db";
import { featureEnabled } from "../../features";
import { gatewayExtract } from "../gateway";
import { notifyAgentAttendeeTouch } from "../notify";
import { cosineSimilarity, ensureProfileEmbedding } from "./embedding";
import { findMutuallyFreeSlots } from "./freeSlots";
import { listDirectChatPartnerIds } from "./partners";

const rankSchema = z.object({
  matches: z
    .array(
      z.object({
        userId: z.string().min(1),
        why: z.string().min(1).max(280),
        draftIntro: z.string().min(1).max(500),
      }),
    )
    .max(5),
});

export type RankedMatch = {
  suggestedUserId: string;
  rank: number;
  whyLine: string;
  draftIntro: string;
  proposedSlots: Array<{ startsAt: string; endsAt: string }> | null;
  name: string | null;
  affiliation: string | null;
  researchInterests: string | null;
  photoUrl: string | null;
  aiGenerated: true;
};

export type MatchBatchResult = {
  skipped: boolean;
  reason?: string;
  batchKey: string;
  suggestions: RankedMatch[];
  notificationId?: string;
};

export function weeklyBatchKey(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `week:${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export async function getMatchMeState(eventId: string, userId: string) {
  const m = await prisma.eventMembership.findFirst({
    where: { eventId, userId, deletedAt: null },
    select: { directoryOptIn: true, matchMeEnabled: true },
  });
  return {
    directoryOptIn: m?.directoryOptIn ?? false,
    matchMeEnabled: m?.matchMeEnabled ?? true,
  };
}

export async function setMatchMeEnabled(eventId: string, userId: string, enabled: boolean) {
  const m = await prisma.eventMembership.updateMany({
    where: { eventId, userId, deletedAt: null },
    data: { matchMeEnabled: enabled },
  });
  if (m.count === 0) {
    throw new Error("Membership not found");
  }
  return { matchMeEnabled: enabled };
}

export async function listSuggestionsForUser(eventId: string, userId: string, batchKey?: string) {
  const where = {
    eventId,
    forUserId: userId,
    ...(batchKey ? { batchKey } : {}),
  };
  const rows = await prisma.matchSuggestion.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { rank: "asc" }],
    include: {
      suggestedUser: {
        select: {
          id: true,
          name: true,
          affiliation: true,
          researchInterests: true,
          photoUrl: true,
          title: true,
        },
      },
    },
    take: 20,
  });

  // Prefer latest batch only when batchKey not specified
  if (!batchKey && rows.length) {
    const latest = rows[0]!.batchKey;
    return rows.filter((r) => r.batchKey === latest);
  }
  return rows;
}

function deterministicFallbackRank(
  shortlist: Array<{
    userId: string;
    name: string | null;
    researchInterests: string | null;
    score: number;
  }>,
  forInterests: string,
): z.infer<typeof rankSchema>["matches"] {
  return shortlist.slice(0, 5).map((c) => {
    const shared =
      extractSharedPhrase(forInterests, c.researchInterests || "") ||
      (c.researchInterests || "shared research interests").slice(0, 80);
    return {
      userId: c.userId,
      why: `You both work on ${shared}.`,
      draftIntro: `Hi${c.name ? ` ${c.name.split(" ")[0]}` : ""} — I noticed we both focus on ${shared}. Would you be open to a quick chat during the event?`,
    };
  });
}

function extractSharedPhrase(a: string, b: string): string | null {
  const tokensA = new Set(
    a
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length > 3),
  );
  const shared = b
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 3 && tokensA.has(t));
  if (!shared.length) return null;
  return [...new Set(shared)].slice(0, 4).join(" ");
}

/**
 * Run a match batch for one attendee. Idempotent per (event, user, batchKey).
 * Never sends DMs — only writes MatchSuggestion rows + DIGEST notification.
 */
export async function runMatchBatch(input: {
  eventId: string;
  organizationId: string;
  forUserId: string;
  batchKey: string;
  deliverNotification?: boolean;
  includeMeetingSlots?: boolean;
  skipCap?: boolean;
}): Promise<MatchBatchResult> {
  const deliver = input.deliverNotification !== false;
  const includeSlots = input.includeMeetingSlots !== false;

  if (!(await featureEnabled(input.eventId, "matchmaker"))) {
    return { skipped: true, reason: "feature_disabled", batchKey: input.batchKey, suggestions: [] };
  }

  const forMembership = await prisma.eventMembership.findFirst({
    where: { eventId: input.eventId, userId: input.forUserId, deletedAt: null },
    select: { directoryOptIn: true, matchMeEnabled: true },
  });
  if (!forMembership?.directoryOptIn) {
    return { skipped: true, reason: "not_directory_opted_in", batchKey: input.batchKey, suggestions: [] };
  }
  if (!forMembership.matchMeEnabled) {
    return { skipped: true, reason: "match_muted", batchKey: input.batchKey, suggestions: [] };
  }

  const existingCount = await prisma.matchSuggestion.count({
    where: {
      eventId: input.eventId,
      forUserId: input.forUserId,
      batchKey: input.batchKey,
    },
  });
  if (existingCount > 0) {
    const rows = await listSuggestionsForUser(input.eventId, input.forUserId, input.batchKey);
    return {
      skipped: true,
      reason: "already_batched",
      batchKey: input.batchKey,
      suggestions: rows.map((r) => ({
        suggestedUserId: r.suggestedUserId,
        rank: r.rank,
        whyLine: r.whyLine,
        draftIntro: r.draftIntro,
        proposedSlots: (r.proposedSlots as Array<{ startsAt: string; endsAt: string }> | null) ?? null,
        name: r.suggestedUser.name,
        affiliation: r.suggestedUser.affiliation,
        researchInterests: r.suggestedUser.researchInterests,
        photoUrl: r.suggestedUser.photoUrl,
        aiGenerated: true as const,
      })),
    };
  }

  const partners = await listDirectChatPartnerIds(input.eventId, input.forUserId);

  const candidates = await prisma.eventMembership.findMany({
    where: {
      eventId: input.eventId,
      deletedAt: null,
      directoryOptIn: true,
      matchMeEnabled: true,
      userId: { not: input.forUserId },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          title: true,
          affiliation: true,
          bio: true,
          researchInterests: true,
          photoUrl: true,
        },
      },
    },
  });

  const eligible = candidates.filter((c) => !partners.has(c.userId));
  if (!eligible.length) {
    return { skipped: false, batchKey: input.batchKey, suggestions: [] };
  }

  const forEmbed = await ensureProfileEmbedding(input.forUserId, {
    organizationId: input.organizationId,
    eventId: input.eventId,
    userId: input.forUserId,
    skipCap: input.skipCap,
  });

  const scored: Array<{
    userId: string;
    name: string | null;
    affiliation: string | null;
    researchInterests: string | null;
    photoUrl: string | null;
    bio: string | null;
    score: number;
  }> = [];

  for (const c of eligible) {
    const emb = await ensureProfileEmbedding(c.userId, {
      organizationId: input.organizationId,
      eventId: input.eventId,
      userId: input.forUserId,
      skipCap: input.skipCap,
    });
    scored.push({
      userId: c.userId,
      name: c.user.name,
      affiliation: c.user.affiliation,
      researchInterests: c.user.researchInterests,
      photoUrl: c.user.photoUrl,
      bio: c.user.bio,
      score: cosineSimilarity(forEmbed.vector, emb.vector),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const shortlist = scored.slice(0, 20);
  if (!shortlist.length) {
    return { skipped: false, batchKey: input.batchKey, suggestions: [] };
  }

  const forUser = await prisma.user.findUnique({
    where: { id: input.forUserId },
    select: { name: true, researchInterests: true, bio: true, title: true, affiliation: true },
  });

  const candidatePayload = shortlist.map((c) => ({
    userId: c.userId,
    name: c.name,
    interests: c.researchInterests,
    bio: c.bio,
    score: Number(c.score.toFixed(4)),
  }));

  const mockRank = deterministicFallbackRank(
    shortlist.map((c) => ({
      userId: c.userId,
      name: c.name,
      researchInterests: c.researchInterests,
      score: c.score,
    })),
    forUser?.researchInterests || forUser?.bio || "",
  );

  const extract = await gatewayExtract(rankSchema, [
    {
      role: "system",
      content:
        "Rank the best people to meet. Return JSON {matches:[{userId,why,draftIntro}]} with at most 5. " +
        "why must be one grounded sentence citing shared interest text. " +
        "draftIntro must be ≤2 sentences, reference the shared interest, no flattery inflation. " +
        "Only use userIds from the shortlist.",
    },
    {
      role: "user",
      content:
        `Requester interests:\n${forUser?.researchInterests || forUser?.bio || "(none)"}\n\n` +
        `Shortlist (cosine top 20):\n${JSON.stringify(candidatePayload)}\n\n` +
        `__MOCK_JSON__:${JSON.stringify({ matches: mockRank })}\n` +
        `__MOCK_MATCH_RANK__`,
    },
  ], {
    organizationId: input.organizationId,
    eventId: input.eventId,
    userId: input.forUserId,
    feature: "MATCHMAKER",
    skipCap: input.skipCap,
  });

  const ranked =
    extract.ok && extract.data.matches.length
      ? extract.data.matches.filter((m) => shortlist.some((s) => s.userId === m.userId)).slice(0, 5)
      : mockRank;

  const usageId = extract.ok ? extract.usageId : null;
  const suggestions: RankedMatch[] = [];

  for (let i = 0; i < ranked.length; i += 1) {
    const m = ranked[i]!;
    const meta = shortlist.find((s) => s.userId === m.userId);
    if (!meta) continue;

    let proposedSlots: Array<{ startsAt: string; endsAt: string }> | null = null;
    if (includeSlots) {
      proposedSlots = await findMutuallyFreeSlots({
        eventId: input.eventId,
        userAId: input.forUserId,
        userBId: m.userId,
        count: 2,
      });
      if (!proposedSlots.length) proposedSlots = null;
    }

    const draftIntro = m.draftIntro.trim();
    const whyLine = m.why.trim();

    await prisma.matchSuggestion.create({
      data: {
        eventId: input.eventId,
        forUserId: input.forUserId,
        suggestedUserId: m.userId,
        rank: i + 1,
        whyLine,
        draftIntro,
        proposedSlots: proposedSlots ?? undefined,
        batchKey: input.batchKey,
        aiGenerated: true,
        usageId,
      },
    });

    suggestions.push({
      suggestedUserId: m.userId,
      rank: i + 1,
      whyLine,
      draftIntro,
      proposedSlots,
      name: meta.name,
      affiliation: meta.affiliation,
      researchInterests: meta.researchInterests,
      photoUrl: meta.photoUrl,
      aiGenerated: true,
    });
  }

  let notificationId: string | undefined;
  if (deliver && suggestions.length) {
    const names = suggestions
      .map((s) => s.name || "someone")
      .slice(0, 3)
      .join(", ");
    const notified = await notifyAgentAttendeeTouch({
      userId: input.forUserId,
      eventId: input.eventId,
      title: "People you should meet",
      body: `Based on your interests: ${names}${suggestions.length > 3 ? ` and ${suggestions.length - 3} more` : ""}. Open Matchmaker to view profiles or draft an intro — nothing is sent until you press send.`,
    });
    notificationId = notified.notificationId;
  }

  return {
    skipped: false,
    batchKey: input.batchKey,
    suggestions,
    notificationId,
  };
}
