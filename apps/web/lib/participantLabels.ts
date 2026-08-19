/**
 * PART-1 — attendee/organizer UI helpers for per-event participant labels.
 * Options come from the event, never the legacy account-global enum.
 */

export function participantLabelSelectOptions(
  labels: string[],
): { value: string; label: string }[] {
  return [
    { value: "", label: "Choose one (optional)" },
    ...labels.map((label) => ({ value: label, label })),
  ];
}

export function shouldShowParticipantLabelSelect(labels: string[] | null | undefined): boolean {
  return Array.isArray(labels) && labels.length > 0;
}

export const LEGACY_PARTICIPANT_TYPE_VALUES = [
  "GRAD_STUDENT",
  "EDD_STUDENT",
  "PHD_STUDENT",
  "EDL_ALUMNI",
  "PROFESSOR",
] as const;
