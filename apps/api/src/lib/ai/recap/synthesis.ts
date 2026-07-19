/**
 * Feedback synthesis — themes cite quoteIds from the bank; commentCount from code.
 */

import { z } from "zod";
import { gatewayExtract } from "../gateway";
import type { FeedbackQuote, FeedbackTheme, FixNextYearItem } from "./types";
import { RecapSectionError } from "./types";

const synthesisSchema = z.object({
  themes: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        quoteIds: z.array(z.string().min(1).max(80)).max(50),
      }),
    )
    .max(30),
  fixNextYear: z
    .array(
      z.object({
        key: z.string().min(1).max(80).optional(),
        label: z.string().min(1).max(300),
      }),
    )
    .max(30),
});

export type SynthesisResult = {
  themes: FeedbackTheme[];
  fixNextYear: FixNextYearItem[];
  bodyMarkdown: string;
  title: string;
  metered: boolean;
  usageId: string | null;
};

export function stableFixSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "item";
}

/**
 * Resolve model themes against the quote bank.
 * Unknown quoteIds are dropped. commentCount = resolved quoteIds length (never from model).
 * Invented quote text cannot reach storage — quotes resolved by id from the bank.
 */
export function resolveSynthesisThemes(
  rawThemes: Array<{ label: string; quoteIds: string[] }>,
  bank: FeedbackQuote[],
): FeedbackTheme[] {
  const byId = new Map(bank.map((q) => [q.quoteId, q]));
  const themes: FeedbackTheme[] = [];
  for (const t of rawThemes) {
    const seen = new Set<string>();
    const quotes: FeedbackTheme["quotes"] = [];
    for (const id of t.quoteIds) {
      if (seen.has(id)) continue;
      const q = byId.get(id);
      if (!q) continue; // drop unknown
      seen.add(id);
      quotes.push({ quoteId: q.quoteId, text: q.text, sessionId: q.sessionId });
    }
    if (!quotes.length && !t.label.trim()) continue;
    themes.push({
      label: t.label.trim(),
      quoteIds: quotes.map((q) => q.quoteId),
      commentCount: quotes.length,
      quotes,
    });
  }
  return themes;
}

export function resolveFixNextYear(
  raw: Array<{ key?: string; label: string }>,
): FixNextYearItem[] {
  const out: FixNextYearItem[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const label = item.label.trim();
    if (!label) continue;
    const key = `recap_fix:${(item.key?.trim() || stableFixSlug(label)).replace(/^recap_fix:/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label });
  }
  return out;
}

function themesToMarkdown(themes: FeedbackTheme[], fix: FixNextYearItem[]): string {
  const lines: string[] = ["# Feedback synthesis", ""];
  for (const t of themes) {
    lines.push(`## ${t.label} (${t.commentCount})`);
    for (const q of t.quotes) {
      lines.push(`> ${q.text}`);
      lines.push("");
    }
  }
  if (fix.length) {
    lines.push("## Fix next year");
    for (const f of fix) {
      lines.push(`- ${f.label}`);
    }
  }
  return lines.join("\n");
}

export async function draftFeedbackSynthesis(input: {
  organizationId: string;
  eventId: string;
  userId?: string | null;
  jobId?: string | null;
  eventName: string;
  quoteBank: FeedbackQuote[];
}): Promise<SynthesisResult> {
  const bankForModel = input.quoteBank.map((q) => ({
    quoteId: q.quoteId,
    sessionId: q.sessionId,
    text: q.text,
  }));

  const fallbackThemes =
    input.quoteBank.length === 0
      ? []
      : [
          {
            label: "Attendee comments",
            quoteIds: input.quoteBank.slice(0, 5).map((q) => q.quoteId),
          },
        ];
  const fallbackFix =
    input.quoteBank.length === 0
      ? [{ label: "Review session feedback before next edition" }]
      : [{ label: "Address themes raised in session feedback" }];

  const mockPayload = JSON.stringify({
    themes: fallbackThemes,
    fixNextYear: fallbackFix,
  });

  const extract = await gatewayExtract(synthesisSchema, [
    {
      role: "system",
      content:
        "You synthesize session feedback themes. Return JSON {themes:[{label,quoteIds}], fixNextYear:[{key?,label}]}. " +
        "quoteIds MUST be chosen from the provided bank only. Do not invent quote text. " +
        "Do not include commentCount — the server computes it. Drafting only.",
    },
    {
      role: "user",
      content:
        `Event: ${input.eventName}\n` +
        `quoteBank:\n${JSON.stringify(bankForModel)}\n\n` +
        `__MOCK_JSON__:${mockPayload}`,
    },
  ], {
    organizationId: input.organizationId,
    eventId: input.eventId,
    userId: input.userId,
    feature: "RECAP",
    jobId: input.jobId,
  });

  if (!extract.ok) {
    throw new RecapSectionError(
      extract.code === "CAP_EXCEEDED" ? "AI_CAP_EXCEEDED" : "AI_PROVIDER_ERROR",
      extract.message || "RECAP feedback synthesis failed",
    );
  }

  const themes = resolveSynthesisThemes(extract.data.themes, input.quoteBank);
  const fixNextYear = resolveFixNextYear(extract.data.fixNextYear);
  const bodyMarkdown = themesToMarkdown(themes, fixNextYear);

  return {
    themes,
    fixNextYear,
    bodyMarkdown,
    title: `${input.eventName} — Feedback synthesis`,
    metered: true,
    usageId: extract.usageId,
  };
}
