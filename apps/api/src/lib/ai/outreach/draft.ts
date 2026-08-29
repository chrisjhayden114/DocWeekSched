/**
 * SPX-1 — metered OUTREACH_DRAFT. One subject+body in the house voice.
 * Lands in the editor for review. Never sent. Never saved as a template.
 */

import { z } from "zod";
import { brand } from "@event-app/config";
import { parseEventType, setupEventTypeLabel } from "@event-app/shared";
import { gatewayExtract } from "../gateway";
import type { GatewayCallContext } from "../types";

const draftSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
});

export type OutreachDraftInput = {
  organizationId: string;
  eventId: string;
  userId?: string | null;
  event: {
    name: string;
    slug: string;
    description: string | null;
    timezone: string;
    startDate: Date;
    endDate: Date;
    attendeeCap: number;
    participantLabelsJson: string | null;
  };
  prospect: {
    orgName: string;
    contactName: string | null;
    contactEmail: string | null;
    websiteUrl: string | null;
    notes: string | null;
  };
  skipCap?: boolean;
  skipMetering?: boolean;
  skipAudit?: boolean;
};

export type OutreachDraftResult = {
  subject: string;
  body: string;
  aiGenerated: true;
  usageId: string;
  metered: boolean;
};

function formatEventDates(start: Date, end: Date, timeZone: string): string {
  try {
    const part = (date: Date, opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).format(date);
    const sameDay =
      part(start, { year: "numeric", month: "short", day: "numeric" }) ===
      part(end, { year: "numeric", month: "short", day: "numeric" });
    if (sameDay) return part(start, { month: "long", day: "numeric", year: "numeric" });
    return `${part(start, { month: "long", day: "numeric", year: "numeric" })} – ${part(end, { month: "long", day: "numeric", year: "numeric" })}`;
  } catch {
    return `${start.toISOString().slice(0, 10)} – ${end.toISOString().slice(0, 10)}`;
  }
}

function labelsFrom(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
  } catch {
    return [];
  }
}

export function outreachEventContext(event: OutreachDraftInput["event"]): {
  name: string;
  dates: string;
  type: string;
  description: string;
  audience: string;
  url: string;
} {
  const guessed = parseEventType(`${event.name}\n${event.description || ""}`);
  const labels = labelsFrom(event.participantLabelsJson);
  const audienceParts = [
    event.attendeeCap > 0 ? `planned capacity ${event.attendeeCap}` : null,
    labels.length > 0 ? `participant labels: ${labels.join(", ")}` : null,
  ].filter((x): x is string => Boolean(x));
  return {
    name: event.name,
    dates: formatEventDates(event.startDate, event.endDate, event.timezone),
    type: guessed ? setupEventTypeLabel(guessed) : "not specified",
    description: event.description?.trim() || "not specified",
    audience: audienceParts.join("; ") || "not specified",
    url: `${brand.primaryUrl}/e/${event.slug}`,
  };
}

export const OUTREACH_DRAFT_SYSTEM =
  `You draft one short sponsor-outreach email for an event organizer using ${brand.productName}. ` +
  `House voice: calm, honest, first-person from the organizer, no hype, no invented facts, no pressure. ` +
  `Return JSON {subject, body}. Drafting only — never send, never imply the platform will send. ` +
  `Do not invent a contact name, dates, or audience. If a field is missing, write around it.`;

export async function draftOutreachEmail(
  input: OutreachDraftInput,
): Promise<
  | { ok: true; draft: OutreachDraftResult }
  | { ok: false; code: "CAP_EXCEEDED" | "PROVIDER_ERROR" | "SCHEMA_INVALID" | "PARSE_ERROR" | "TRUNCATED"; message: string; upgrade?: unknown }
> {
  const ctx: GatewayCallContext = {
    organizationId: input.organizationId,
    eventId: input.eventId,
    userId: input.userId,
    feature: "OUTREACH_DRAFT",
    skipCap: input.skipCap,
    skipMetering: input.skipMetering,
    skipAudit: input.skipAudit,
  };

  const event = outreachEventContext(input.event);
  const fallback = {
    subject: `Would ${input.prospect.orgName} consider supporting ${event.name}?`,
    body:
      `Hello${input.prospect.contactName ? ` ${input.prospect.contactName}` : ""},\n\n` +
      `I'm writing about ${event.name} (${event.dates}). We are looking for a small number of organizations to help make the gathering possible — a direct ask, not a blast.\n\n` +
      `The public page is ${event.url}. If this is something ${input.prospect.orgName} might consider, I would welcome a short conversation. If the timing is wrong, no need to reply.\n\n` +
      `Thank you for reading.`,
  };

  const extract = await gatewayExtract(draftSchema, [
    { role: "system", content: OUTREACH_DRAFT_SYSTEM },
    {
      role: "user",
      content:
        `Event name: ${event.name}\n` +
        `Event dates: ${event.dates}\n` +
        `Event type: ${event.type}\n` +
        `Event description: ${event.description}\n` +
        `Audience: ${event.audience}\n` +
        `Event URL: ${event.url}\n` +
        `Prospect organization: ${input.prospect.orgName}\n` +
        `Contact name: ${input.prospect.contactName || "(none)"}\n` +
        `Contact email: ${input.prospect.contactEmail || "(none)"}\n` +
        `Website: ${input.prospect.websiteUrl || "(none)"}\n` +
        `Organizer notes: ${input.prospect.notes || "(none)"}\n\n` +
        `__MOCK_JSON__:${JSON.stringify(fallback)}`,
    },
  ], ctx);

  if (!extract.ok) {
    return {
      ok: false,
      code: extract.code,
      message: extract.message,
      upgrade: extract.upgrade,
    };
  }

  return {
    ok: true,
    draft: {
      subject: extract.data.subject.trim(),
      body: extract.data.body.trim(),
      aiGenerated: true,
      usageId: extract.usageId,
      metered: !input.skipMetering,
    },
  };
}
