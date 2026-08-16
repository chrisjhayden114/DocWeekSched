/**
 * CHAT-2 — the Event assistant's mark: a compass needle in a ring (the
 * "event guide" metaphor). Two triangles on a circle, currentColor only —
 * no gradients, reads at 16–20px. Used in the assistant FAB and the
 * panel/sheet header; keep it out of unrelated surfaces so it stays a mark.
 */

export function AssistantMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      {/* North half of the needle — filled, points where to go. */}
      <path d="M12 5.6 L14.6 12 L9.4 12 Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      {/* South half — outline only, the counterweight. */}
      <path d="M12 18.4 L9.4 12 L14.6 12 Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}
