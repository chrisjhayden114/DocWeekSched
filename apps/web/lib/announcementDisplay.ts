/**
 * E16.3 — "Sent announcements" record. Pure display helpers so the audience
 * a message went to is described in plain English, never as a raw enum.
 */

export type SentAnnouncement = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  publishedAt?: string | null;
  audience: string;
  audienceRole?: string | null;
  attendanceMode?: string | null;
  sessionId?: string | null;
  session?: { id: string; title: string } | null;
  createdBy?: { id: string; name: string } | null;
  sendEmail: boolean;
  isEmergency: boolean;
  isPreview: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  ATTENDEE: "Attendees",
  SPEAKER: "Speakers",
  ADMIN: "Event admins",
};

const MODE_LABELS: Record<string, string> = {
  IN_PERSON: "In-person attendees",
  VIRTUAL: "Virtual attendees",
  ASYNC: "Async attendees",
};

export function announcementAudienceLabel(a: {
  audience: string;
  audienceRole?: string | null;
  attendanceMode?: string | null;
  session?: { title: string } | null;
}): string {
  if (a.audience === "EVERYONE") return "Everyone";
  if (a.audience === "ROLE") {
    return a.audienceRole ? ROLE_LABELS[a.audienceRole] || a.audienceRole : "By role";
  }
  if (a.audience === "SESSION_JOINERS") {
    return a.session?.title ? `Joiners of “${a.session.title}”` : "Joiners of one session";
  }
  if (a.audience === "ATTENDANCE_MODE") {
    return a.attendanceMode ? MODE_LABELS[a.attendanceMode] || a.attendanceMode : "By attendance mode";
  }
  return a.audience;
}

/** One-line body excerpt; whole words, single spaces, honest ellipsis. */
export function announcementExcerpt(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.5 ? lastSpace : max).trimEnd()}…`;
}
