/**
 * INV-1 — pure helpers for the organizer console's Participants tab.
 * Maps the roster's inviteStatus (GET /attendees) to customer-facing copy
 * and StatusChip tones, and backs the client-side roster filter.
 */

export type InviteStatus = "ACTIVE" | "PENDING_SETUP" | "INVITE_EXPIRED";

/** Status pill label. Rows without inviteStatus (shouldn't happen for managers) get an em dash. */
export function inviteStatusLabel(status?: InviteStatus | null): string {
  if (status === "ACTIVE") return "Active";
  if (status === "PENDING_SETUP") return "Invite sent";
  if (status === "INVITE_EXPIRED") return "Invite expired";
  return "—";
}

/**
 * The `status` string handed to StatusChip so its toneFor() picks the right
 * token: green for joined, warning for anything still needing action.
 */
export function inviteStatusChipStatus(status?: InviteStatus | null): string {
  if (status === "ACTIVE") return "active";
  if (status === "PENDING_SETUP") return "pending";
  if (status === "INVITE_EXPIRED") return "archived";
  return "default";
}

/** Case-insensitive substring filter over name and email. Blank query keeps everything. */
export function filterParticipants<T extends { name: string; email: string }>(
  rows: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
  );
}
