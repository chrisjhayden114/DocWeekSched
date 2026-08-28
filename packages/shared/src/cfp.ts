/** Default organizer- and attendee-facing name when Event.cfpLabel is unset. */
export const DEFAULT_CFP_LABEL = "Call for Presentations";

/** Display name for the event's CFP — custom label, or the platform default. */
export function cfpDisplayLabel(event: { cfpLabel?: string | null } | null | undefined): string {
  const raw = event?.cfpLabel?.trim();
  return raw || DEFAULT_CFP_LABEL;
}
