/**
 * SPX-1 — client helpers for the outreach composer.
 * Merge/mailto live in @event-app/shared; this is last-used CC per event.
 */

import type { SponsorProspectStatus } from "@event-app/shared";

export type SponsorProspect = {
  id: string;
  orgName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  websiteUrl?: string | null;
  notes?: string | null;
  status: SponsorProspectStatus;
  lastContactedAt?: string | null;
  sponsorId?: string | null;
};

const ccKey = (eventId: string) => `outreach-cc:${eventId}`;

export function readLastOutreachCc(eventId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(ccKey(eventId)) || "";
  } catch {
    return "";
  }
}

export function rememberLastOutreachCc(eventId: string, cc: string) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = cc.trim();
    if (trimmed) window.localStorage.setItem(ccKey(eventId), trimmed);
    else window.localStorage.removeItem(ccKey(eventId));
  } catch {
    /* quota / private mode */
  }
}

export function formatOutreachClipboard(subject: string, body: string): string {
  const sub = subject.trim();
  const text = body.trim();
  if (!sub) return text;
  if (!text) return sub;
  return `${sub}\n\n${text}`;
}
