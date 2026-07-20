/**
 * Feedback quote bank — real SessionFeedback comments only, PII-redacted, stable quoteIds.
 */

import { prisma } from "../../db";
import type { FeedbackQuote } from "./types";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;

export function redactPii(text: string, knownNames: string[] = []): string {
  let out = text.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
  const sorted = [...knownNames]
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "[name]");
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Stable id from SessionFeedback row — regen keeps the same quoteId for the same comment. */
export function quoteIdForFeedback(feedbackId: string): string {
  return `sf_${feedbackId}`;
}

export async function buildFeedbackQuoteBank(eventId: string): Promise<FeedbackQuote[]> {
  const rows = await prisma.sessionFeedback.findMany({
    where: {
      session: { eventId },
      comment: { not: null },
    },
    select: {
      id: true,
      sessionId: true,
      comment: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const bank: FeedbackQuote[] = [];
  for (const row of rows) {
    const raw = (row.comment ?? "").trim();
    if (!raw) continue;
    const names = [row.user.name, row.user.email.split("@")[0] ?? ""].filter(Boolean);
    const text = redactPii(raw, names);
    if (!text) continue;
    bank.push({
      quoteId: quoteIdForFeedback(row.id),
      sessionId: row.sessionId,
      text,
      source: "session_feedback",
      feedbackId: row.id,
    });
  }
  return bank;
}
