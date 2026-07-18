/**
 * Skeleton drafts when the organizer has no program document.
 * All output is DRAFT / aiGenerated — humans publish.
 */

import type { SetupEventType, SetupCopilotFormState } from "@event-app/shared";
import { AI_GENERATED_CHIP_LABEL } from "@event-app/shared";

export type SkeletonSession = {
  title: string;
  description: string;
  dayOffset: number;
  startHm: string;
  endHm: string;
  blockKind: "welcome" | "keynote" | "break" | "meal" | "session" | "wrap";
  aiGenerated: true;
};

export type SkeletonTrack = {
  name: string;
  color: string;
  aiGenerated: true;
};

export type SkeletonIcebreaker = {
  title: string;
  body: string;
  aiGenerated: true;
};

export type SkeletonInviteEmail = {
  subject: string;
  body: string;
  aiGenerated: true;
};

export type SkeletonBundle = {
  sessions: SkeletonSession[];
  tracks: SkeletonTrack[];
  inviteEmail: SkeletonInviteEmail;
  icebreakers: SkeletonIcebreaker[];
  aiGenerated: true;
};

const TRACKS_BY_TYPE: Record<SetupEventType, SkeletonTrack[]> = {
  conference: [
    { name: "Main stage", color: "#0033A0", aiGenerated: true },
    { name: "Workshops", color: "#1E7A34", aiGenerated: true },
    { name: "Community", color: "#7A5A00", aiGenerated: true },
  ],
  academic_program: [
    { name: "Plenary", color: "#0033A0", aiGenerated: true },
    { name: "Paper sessions", color: "#1F3864", aiGenerated: true },
    { name: "Methods", color: "#1E7A34", aiGenerated: true },
  ],
  meetup: [
    { name: "Talks", color: "#0033A0", aiGenerated: true },
    { name: "Social", color: "#7A5A00", aiGenerated: true },
  ],
  internal: [
    { name: "All-hands", color: "#0033A0", aiGenerated: true },
    { name: "Breakouts", color: "#41506D", aiGenerated: true },
  ],
};

function dayCount(form: SetupCopilotFormState): number {
  if (!form.startDate || !form.endDate) return 1;
  const a = new Date(form.startDate + (form.startDate.includes("T") ? "" : "T12:00:00"));
  const b = new Date(form.endDate + (form.endDate.includes("T") ? "" : "T12:00:00"));
  const days = Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1);
  return Math.min(days, 5);
}

export function buildSkeleton(form: SetupCopilotFormState, icebreakersEnabled: boolean): SkeletonBundle {
  const type: SetupEventType = form.eventType || "conference";
  const days = dayCount(form);
  const sessions: SkeletonSession[] = [];

  for (let d = 0; d < days; d++) {
    const dayLabel = days > 1 ? `Day ${d + 1}: ` : "";
    sessions.push({
      title: `${dayLabel}Welcome`.trim(),
      description: `Opening welcome for ${form.name || "the event"}. ${AI_GENERATED_CHIP_LABEL}`,
      dayOffset: d,
      startHm: "09:00",
      endHm: "09:30",
      blockKind: "welcome",
      aiGenerated: true,
    });
    sessions.push({
      title: `${dayLabel}Keynote`.trim(),
      description: `Flagship keynote block. ${AI_GENERATED_CHIP_LABEL}`,
      dayOffset: d,
      startHm: "09:30",
      endHm: "10:30",
      blockKind: "keynote",
      aiGenerated: true,
    });
    sessions.push({
      title: `${dayLabel}Morning break`.trim(),
      description: `Coffee / networking break. ${AI_GENERATED_CHIP_LABEL}`,
      dayOffset: d,
      startHm: "10:30",
      endHm: "11:00",
      blockKind: "break",
      aiGenerated: true,
    });
    sessions.push({
      title: `${dayLabel}Lunch`.trim(),
      description: `Meal break. ${AI_GENERATED_CHIP_LABEL}`,
      dayOffset: d,
      startHm: "12:30",
      endHm: "13:30",
      blockKind: "meal",
      aiGenerated: true,
    });
    if (d === days - 1) {
      sessions.push({
        title: `${dayLabel}Wrap-up`.trim(),
        description: `Closing remarks and next steps. ${AI_GENERATED_CHIP_LABEL}`,
        dayOffset: d,
        startHm: "16:00",
        endHm: "16:30",
        blockKind: "wrap",
        aiGenerated: true,
      });
    }
  }

  const inviteEmail: SkeletonInviteEmail = {
    subject: `You're invited: ${form.name || "our event"}`,
    body: [
      `Hi there,`,
      ``,
      `You're invited to ${form.name || "our event"}.`,
      form.startDate && form.endDate
        ? `When: ${form.startDate} – ${form.endDate} (${form.timezone})`
        : `When: dates coming soon`,
      form.venueName
        ? `Where: ${form.venueName}${form.venueAddress ? `, ${form.venueAddress}` : ""}`
        : form.onlineUrl
          ? `Where: online — ${form.onlineUrl}`
          : `Where: details coming soon`,
      ``,
      `We'll share the full schedule soon. Looking forward to seeing you.`,
      ``,
      `— The organizers`,
      ``,
      `[${AI_GENERATED_CHIP_LABEL}]`,
    ].join("\n"),
    aiGenerated: true,
  };

  const icebreakers: SkeletonIcebreaker[] = icebreakersEnabled
    ? [
        {
          title: "Draft: Introduce yourself",
          body: `Share your name, where you're joining from, and one thing you hope to take away from ${form.name || "this event"}.\n\n[${AI_GENERATED_CHIP_LABEL}]`,
          aiGenerated: true,
        },
        {
          title: "Draft: First conversation starter",
          body: `What's a project or question you're excited to talk about this week? Drop a short note so others can find you.\n\n[${AI_GENERATED_CHIP_LABEL}]`,
          aiGenerated: true,
        },
      ]
    : [];

  return {
    sessions,
    tracks: TRACKS_BY_TYPE[type],
    inviteEmail,
    icebreakers,
    aiGenerated: true,
  };
}
