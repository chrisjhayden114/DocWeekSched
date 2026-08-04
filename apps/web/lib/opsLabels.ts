/**
 * E16.4 — human labels for Ops Inbox cards. The raw enum pair
 * ("DAILY_DIGEST · DIGEST_NOTE") is an internal identifier and must never be
 * shown to the organizer; the label must name what the card actually is.
 */

const DETECTOR_LABELS: Record<string, string> = {
  SESSION_CHANGED: "Schedule change",
  QA_STALE: "Unanswered questions",
  LOW_CHECKIN: "Low check-in",
  CAPACITY_PRESSURE: "Session near capacity",
  MODERATION: "Moderation",
  DAILY_DIGEST: "Daily digest",
};

const ACTION_LABELS: Record<string, string> = {
  ANNOUNCEMENT: "Announcement draft",
  DM: "Direct message draft",
  SPEAKER_NUDGE: "Speaker nudge",
  ROOM_MOVE: "Room move suggestion",
  OPEN_VIRTUAL: "Open virtual seats",
  MODERATION_REVIEW: "Moderation review",
  DIGEST_NOTE: "Digest note",
};

function fallbackLabel(raw: string): string {
  const words = raw.toLowerCase().replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function opsDetectorLabel(kind: string): string {
  return DETECTOR_LABELS[kind] || fallbackLabel(kind);
}

export function opsActionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] || fallbackLabel(actionType);
}
