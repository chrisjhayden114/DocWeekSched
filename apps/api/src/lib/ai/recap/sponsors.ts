/**
 * Sponsor one-pagers — leads + tier from live Sponsor rows (no impression counter in schema).
 */

import { prisma } from "../../db";

export type SponsorOnePager = {
  sponsorId: string;
  title: string;
  bodyMarkdown: string;
  structured: {
    sponsorId: string;
    name: string;
    tier: string;
    leadCount: number;
    boothLabel: string | null;
  };
};

export async function buildSponsorOnePagers(eventId: string): Promise<SponsorOnePager[]> {
  const sponsors = await prisma.sponsor.findMany({
    where: { eventId },
    select: {
      id: true,
      name: true,
      tier: true,
      boothLabel: true,
      description: true,
      _count: { select: { leads: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return sponsors.map((s) => {
    const leadCount = s._count.leads;
    const bodyMarkdown = [
      `# ${s.name}`,
      ``,
      `**Tier:** ${s.tier}`,
      s.boothLabel ? `**Booth:** ${s.boothLabel}` : null,
      ``,
      `**Leads captured:** ${leadCount}`,
      ``,
      s.description?.trim() || `_No sponsor description on file._`,
      ``,
      `_Impression tracking is not stored in this edition — lead count is the verified figure._`,
    ]
      .filter((line) => line != null)
      .join("\n");

    return {
      sponsorId: s.id,
      title: `${s.name} — Sponsor one-pager`,
      bodyMarkdown,
      structured: {
        sponsorId: s.id,
        name: s.name,
        tier: s.tier,
        leadCount,
        boothLabel: s.boothLabel,
      },
    };
  });
}
