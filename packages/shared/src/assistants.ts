/**
 * Chunk E19 — the two assistants, named once, here.
 *
 * The product has exactly two assistants and they must never be confused:
 *
 * - The ORGANIZER-side "Setup assistant" (components/SetupCopilotChat.tsx,
 *   lib/ai/setupCopilot): knows the state of an event's setup and drives it
 *   forward. Agents draft, humans publish.
 * - The ATTENDEE-side "Event assistant" (components/ConciergeChat.tsx,
 *   lib/ai/concierge): a wayfinder grounded strictly in the event's published
 *   schedule, rooms, maps and FAQ. It answers from published data and never
 *   publishes anything itself.
 *
 * All user-visible names and labels for both come from this module — never
 * hardcode them in components, routes, or help articles.
 */

export const ASSISTANT_COPY = {
  organizer: {
    name: "Setup assistant",
    /** One-line purpose, shown next to the entry point. */
    description:
      "Reads your event's setup state, names the next incomplete step, and links straight to it.",
  },
  attendee: {
    name: "Event assistant",
    /** One-line purpose, shown in the chat header. */
    description: "Schedule, rooms, maps, and FAQ for this event.",
    /**
     * E19.2 — the attendee-facing AI label. Attendees publish nothing, so the
     * organizer chip ("AI-generated — review before publishing",
     * AI_GENERATED_CHIP_LABEL) must never appear on attendee surfaces.
     */
    answerChipLabel: "AI answer — based on this event's schedule",
  },
  /**
   * Matchmaker suggestions are attendee-facing too (E19.2 audit): honest
   * label without publish language — the attendee reviews the draft intro
   * before anything sends.
   */
  matchmakerChipLabel: "AI suggestion — nothing sends until you do",
} as const;
