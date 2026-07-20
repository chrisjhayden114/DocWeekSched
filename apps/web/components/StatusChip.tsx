/**
 * Semantic status chip for organizer console (DESIGN_PHASE_D.md D3).
 * Uses success/danger/warning/live tokens — never the track palette.
 */

type StatusTone = "published" | "draft" | "past" | "archived" | "pending" | "default";

function toneFor(status: string): StatusTone {
  const s = status.trim().toLowerCase();
  if (s === "published" || s === "active" || s === "live") return "published";
  if (s === "draft") return "draft";
  if (s === "past") return "past";
  if (s === "archived") return "archived";
  if (s === "pending" || s === "review" || s === "submitted") return "pending";
  return "default";
}

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const tone = toneFor(status);
  return <span className={`status-chip status-chip--${tone}`}>{label ?? status}</span>;
}
