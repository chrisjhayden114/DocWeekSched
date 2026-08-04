/**
 * E19.3 — the Setup assistant's checklist.
 *
 * Pure functions: read the event's current state, name what is still missing,
 * and deep-link to the tab/control that fixes it. The panel component
 * (components/SetupAssistantPanel.tsx) renders this; keeping the logic here
 * makes it unit-testable without a DOM.
 */

export type SetupChecklistInput = {
  eventId: string;
  /** Server status: DRAFT | ACTIVE | ARCHIVED */
  status: string;
  venueName: string | null | undefined;
  onlineUrl: string | null | undefined;
  sessionCount: number;
  /** Sessions still in DRAFT publish state (invisible to attendees). */
  draftSessionCount: number;
  roomCount: number;
  speakerCount: number;
};

export type SetupChecklistItem = {
  key: "sessions" | "rooms" | "speakers" | "venue" | "draft-sessions" | "publish";
  label: string;
  /** Why this matters / what "done" looks like — one line. */
  detail: string;
  done: boolean;
  /** In-app deep link to the tab and control that fixes it. */
  href: string;
  /** Link text, e.g. "Open Program". */
  linkLabel: string;
};

export function buildSetupChecklist(input: SetupChecklistInput): SetupChecklistItem[] {
  const base = `/organizer/events/${input.eventId}`;
  return [
    {
      key: "sessions",
      label: "Add sessions",
      detail:
        input.sessionCount > 0
          ? `${input.sessionCount} session${input.sessionCount === 1 ? "" : "s"} in the program.`
          : "The schedule is empty — add sessions by hand or via Agenda Ingest.",
      done: input.sessionCount > 0,
      href: `${base}?tab=program`,
      linkLabel: "Open Program",
    },
    {
      key: "rooms",
      label: "Add rooms",
      detail:
        input.roomCount > 0
          ? `${input.roomCount} room${input.roomCount === 1 ? "" : "s"} defined.`
          : "Without rooms, attendees can't see where sessions happen.",
      done: input.roomCount > 0,
      href: `${base}?tab=program`,
      linkLabel: "Open Program",
    },
    {
      key: "speakers",
      label: "Add speakers",
      detail:
        input.speakerCount > 0
          ? `${input.speakerCount} speaker${input.speakerCount === 1 ? "" : "s"} listed.`
          : "Speakers appear on the public schedule next to their sessions.",
      done: input.speakerCount > 0,
      href: `${base}?tab=people`,
      linkLabel: "Open Speakers",
    },
    {
      key: "venue",
      label: "Set a venue or online link",
      detail:
        input.venueName || input.onlineUrl
          ? "Attendees can see where the event happens."
          : "Set a venue name (or an online URL) so attendees know where to go.",
      done: Boolean(input.venueName || input.onlineUrl),
      href: `${base}?tab=overview`,
      linkLabel: "Open Settings",
    },
    {
      key: "draft-sessions",
      label: "Publish draft sessions",
      detail:
        input.draftSessionCount > 0
          ? `${input.draftSessionCount} session${input.draftSessionCount === 1 ? " is" : "s are"} still draft and invisible to attendees.`
          : "All sessions are visible to attendees.",
      // Vacuously done when the program is empty; the "sessions" item owns that gap.
      done: input.draftSessionCount === 0,
      href: `${base}?tab=program`,
      linkLabel: "Open Program",
    },
    {
      key: "publish",
      label: "Publish the event",
      detail:
        input.status === "ACTIVE"
          ? "The event is live — attendees can reach it."
          : "Draft events 404 for attendees. Publish when the program is ready.",
      done: input.status === "ACTIVE",
      href: `${base}?tab=overview`,
      linkLabel: "Open Publish",
    },
  ];
}

/** The next incomplete step, or null when setup is complete. */
export function nextSetupStep(items: SetupChecklistItem[]): SetupChecklistItem | null {
  return items.find((i) => !i.done) ?? null;
}
