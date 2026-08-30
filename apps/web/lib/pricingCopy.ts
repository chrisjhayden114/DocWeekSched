/**
 * MKT-3 — pricing-page copy derived from the plan catalog.
 * Amounts stay in plans.ts / speakerReadinessService. This module only names
 * features the registry actually grants (or does not gate).
 */

import { speakerReadinessService } from "@event-app/config";
import {
  ASSISTANT_COPY,
  PRICE_LOCK,
  resolveEntitlement,
  type EntitlementKey,
  type PlanDefinition,
} from "@event-app/shared";

export const FULL_AI_SUITE_DETAIL =
  `program ingest, describe-your-event drafts, ${ASSISTANT_COPY.attendee.name} for attendees, ${ASSISTANT_COPY.organizer.name}, ops drafts and recap`;

export const FULL_AI_SUITE_BULLET = `Full AI suite (${FULL_AI_SUITE_DETAIL})`;

export const CONCIERGE_CROSS_LINK = {
  lead: "Running one big event and want it done with you?",
  linkLabel: "See the concierge rates",
  href: "/speaker-readiness",
} as const;

/** One sentence of "{scale} — {rate}" clauses, joined; amounts stay in config. */
function conciergeRateSentence(): string {
  return speakerReadinessService.tiers
    .map((tier) => `${tier.scale} — ${tier.price}${tier.priceNote ? ` (${tier.priceNote})` : ""}`)
    .join("; ");
}

function entitled(plan: PlanDefinition, key: EntitlementKey): boolean {
  return resolveEntitlement(plan, key);
}

/**
 * Buyer-facing bullets for a catalog plan. Gated keys follow
 * `resolveEntitlement`. CFP and announcements are organizer-visible and are
 * not differentially granted in the public catalog — listing them on every
 * public plan is the honest reading (do not invent Pro-only CFP).
 * `readiness` is granted on every tier (ER-GA, 2026-08-26); Free names its
 * presenter cap so the bullet cannot promise more than the API allows.
 */
export function planFeatureBullets(plan: PlanDefinition): string[] {
  const events =
    plan.limits.activeEvents == null ? "Unlimited active events" : `${plan.limits.activeEvents} active event`;
  const attendees =
    plan.limits.attendees == null
      ? "Unlimited attendees per event"
      : `Up to ${plan.limits.attendees.toLocaleString()} attendees per event`;
  const rows = [events, attendees];

  if (entitled(plan, "ai_ingest")) {
    rows.push("Agenda import (Excel, PDF, Word, paste, or describe)");
  }
  if (entitled(plan, "readiness")) {
    const presenters = plan.limits.readinessPresentersPerEvent;
    rows.push(
      presenters == null
        ? "Speaker Readiness"
        : `Speaker Readiness (up to ${presenters.toLocaleString()} presenters)`,
    );
  }
  // CFP is an event-level toggle (`defaultOn: false`) and is absent from every
  // public entitlements map — not a paid-tier gate in the catalog.
  rows.push("CFP with blind review");
  // paid_attendance is CORE (Free included). We publish price and instructions
  // and record who has paid — we do not process the payment.
  if (entitled(plan, "paid_attendance")) {
    rows.push("Registration fees — publish price and payment instructions, track who's paid");
  }
  if (entitled(plan, "certificates")) rows.push("Certificates");
  if (entitled(plan, "badges")) rows.push("Badges");
  if (entitled(plan, "checkin")) rows.push("QR check-in");
  if (entitled(plan, "sponsors")) rows.push("Sponsors and lead capture");
  // sponsor_outreach is CORE (Free included). Free names its prospect cap so
  // the bullet cannot promise more than the API allows; paid is uncapped.
  if (entitled(plan, "sponsor_outreach")) {
    const prospects = plan.limits.outreachProspectsPerEvent;
    rows.push(
      prospects == null
        ? "Sponsor outreach"
        : `Sponsor outreach (${prospects.toLocaleString()} prospects per event)`,
    );
  }
  if (entitled(plan, "analytics")) rows.push("Analytics");
  if (entitled(plan, "session_polls") && entitled(plan, "session_feedback")) {
    rows.push("Polls and surveys");
  } else {
    if (entitled(plan, "session_polls")) rows.push("Live polls");
    if (entitled(plan, "session_feedback")) rows.push("Session feedback");
  }
  if (entitled(plan, "venue_maps")) rows.push("Venue maps");
  rows.push("Announcements");
  if (entitled(plan, "ai_full_suite")) {
    rows.push(FULL_AI_SUITE_BULLET);
  } else {
    if (entitled(plan, "concierge")) {
      rows.push(`${ASSISTANT_COPY.attendee.name} for attendees`);
    }
    rows.push(ASSISTANT_COPY.organizer.name);
  }
  if (entitled(plan, "sso")) rows.push("SSO");
  if (entitled(plan, "white_label")) rows.push("White-label");
  if (entitled(plan, "priority_support")) rows.push("Priority support");
  if (plan.tier === "FREE") rows.push("Core agenda and community");
  if (entitled(plan, "hide_powered_by_badge")) rows.push("No “Powered by” badge");
  return rows;
}

export const PRICING_FAQ = [
  {
    q: "What counts as an attendee?",
    a: "Anyone invited to or joined into an event counts toward that event’s attendee cap on your plan.",
  },
  {
    q: "How do refunds work?",
    a: "Checkout, tax, and refunds are handled by Stripe (merchant of record). Contact support with your order ID.",
  },
  {
    q: "What happens when I archive an event?",
    a: "Archived events leave the active-event count. Attendee data remains available to organizers for export until you delete it.",
  },
  {
    q: "What is the recurring-event price lock?",
    a: PRICE_LOCK.body,
  },
  {
    q: "What happens to a published event if I cancel Pro?",
    a: "Your organization moves back to the Free plan when the cancellation takes effect. Published events stay published and attendees keep access — nothing is unpublished or deleted. Free limits apply going forward: one active event, up to 50 attendees per event for new joins, and Free-tier AI allowances.",
  },
  {
    q: "Do presenters need accounts?",
    a: "No. Speaker Readiness sends each presenter a personal link — they upload without creating an account. Presenters using the portal do not count toward the attendee cap.",
  },
  {
    q: "What happens when the program changes?",
    a: "Edit the session and publish. Attendees see the update in minutes — no new PDF.",
  },
  {
    q: "Is there a done-for-you option?",
    a: `Yes. Speaker Readiness itself is included in every plan, so this is a service, not a licence: we run the setup and stay hands-on through your event. Rates by scale — ${conciergeRateSentence()}.`,
    href: "/speaker-readiness",
    linkLabel: "See the concierge rates",
  },
] as const;
