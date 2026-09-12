/**
 * AGENDA-3 — who may open a presenter's shared materials.
 *
 * The column on "Event" is a plain String, exactly like Session.format: the
 * vocabulary is closed HERE rather than in the database so widening it later
 * is a code deploy instead of a migration that locks the Event table, and so
 * an old pod mid-rolling-deploy can never reject a value a new pod just wrote.
 *
 * Two values, and the difference is who has to be signed in:
 *   ATTENDEES — logged-in members of the event. The default, and the safe one:
 *               a deck shared by a speaker reaches the room, not the internet.
 *   PUBLIC    — anyone who can already read the public event page. The choice
 *               an open conference makes so its program doubles as a proceedings.
 *
 * This is an event-wide ceiling, not a per-file switch. A submission still has
 * to be approved AND explicitly shared before this setting is consulted at all.
 */

export const MATERIALS_VISIBILITIES = ["ATTENDEES", "PUBLIC"] as const;

export type MaterialsVisibility = (typeof MATERIALS_VISIBILITIES)[number];

/** The safe default — every event starts here, including every existing row. */
export const DEFAULT_MATERIALS_VISIBILITY: MaterialsVisibility = "ATTENDEES";

/** Label for the organizer's select. */
export const MATERIALS_VISIBILITY_LABELS: Record<MaterialsVisibility, string> = {
  ATTENDEES: "People who joined this event",
  PUBLIC: "Anyone who can see the public event page",
};

/** Plain-language consequence, shown under the select. No jargon, no shorthand. */
export const MATERIALS_VISIBILITY_HELP: Record<MaterialsVisibility, string> = {
  ATTENDEES:
    "Someone has to sign in and be on your attendee list to open a shared deck. Visitors to your public page see that slides exist and a link to sign in.",
  PUBLIC:
    "Anyone with your public event link can open a shared deck, with no account and no sign-in. Choose this only if your presenters expect their slides to be on the open web.",
};

/**
 * Narrow an unknown value from the database or a request body. Anything the
 * app does not recognise returns null rather than passing through, so a
 * hand-edited row cannot widen access to a file by accident.
 */
export function asMaterialsVisibility(value: unknown): MaterialsVisibility | null {
  return typeof value === "string" && (MATERIALS_VISIBILITIES as readonly string[]).includes(value)
    ? (value as MaterialsVisibility)
    : null;
}

/**
 * The value to ACT on. Unrecognised and missing both collapse to ATTENDEES:
 * when we cannot tell what an event meant, we do not open the file up.
 */
export function materialsVisibilityOrDefault(value: unknown): MaterialsVisibility {
  return asMaterialsVisibility(value) ?? DEFAULT_MATERIALS_VISIBILITY;
}

/** True when a signed-out visitor may open this event's shared materials. */
export function materialsArePublic(value: unknown): boolean {
  return materialsVisibilityOrDefault(value) === "PUBLIC";
}

export function materialsVisibilityLabel(value: unknown): string {
  return MATERIALS_VISIBILITY_LABELS[materialsVisibilityOrDefault(value)];
}

/** Options for the organizer select, in the order they should read. */
export function materialsVisibilitySelectOptions(): Array<{
  value: MaterialsVisibility;
  label: string;
}> {
  return MATERIALS_VISIBILITIES.map((value) => ({
    value,
    label: MATERIALS_VISIBILITY_LABELS[value],
  }));
}