/** Pure / dialogue surface — safe for unit tests (no Prisma on import).
 * The gateway-calling reply layer lives in ./turn (import directly). */
export {
  initialDialogue,
  looksLikeQuestion,
  runCreateTurn,
  runSettingsTurn,
  type DialogueState,
  type TurnResult,
} from "./dialogue";
export {
  SETUP_SYSTEM,
  ORGANIZER_SYSTEM,
  buildStatePrompt,
  buildFeatureRegistryPrompt,
  buildOrganizerGuidePrompt,
  buildCreateSystemPrompt,
  buildSettingsSystemPrompt,
  composeSetupTurnMessages,
  SETUP_HISTORY_TURNS,
} from "./prompt";
export {
  buildOrganizerChecklist,
  buildOrganizerStateText,
  EVENT_STATE_OPEN,
  EVENT_STATE_CLOSE,
  type OrganizerStateCounts,
  type OrganizerStateEvent,
} from "./organizerState";
export { buildOrganizerGuideAnchors, linkifyOrganizerReply } from "./links";
export { buildConfigDiffCard } from "./diffCard";
export { buildSkeleton } from "./skeleton";
export { assertRegistryKeys, UnknownFeatureKeyError } from "./keys";
export {
  parseFeatureRequests,
  parseEventType,
  parseDatesAndTimezone,
  parseEventName,
  parseNetworkingChoice,
} from "./parse";
export {
  mergeSetupExtract,
  hasExtractedFields,
  looksLikeProgramDocument,
  validateExtracted,
} from "./extractTypes";
