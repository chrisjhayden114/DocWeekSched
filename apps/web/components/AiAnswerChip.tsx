import { ASSISTANT_COPY } from "@event-app/shared";

/**
 * E19.2 — attendee-facing AI label. Attendees publish nothing, so this chip
 * says what the answer is grounded in instead of implying a publishing
 * workflow. Organizer review surfaces keep AiGeneratedChip.
 */
export function AiAnswerChip({ className }: { className?: string }) {
  return (
    <span className={`chip ai-generated-chip${className ? ` ${className}` : ""}`} role="status">
      {ASSISTANT_COPY.attendee.answerChipLabel}
    </span>
  );
}
