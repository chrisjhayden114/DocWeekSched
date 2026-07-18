/** Pure / dialogue surface — safe for unit tests (no Prisma on import). */
export { initialDialogue, runCreateTurn, runSettingsTurn, type DialogueState, type TurnResult } from "./dialogue";
export { buildConfigDiffCard } from "./diffCard";
export { buildSkeleton } from "./skeleton";
export { assertRegistryKeys, UnknownFeatureKeyError } from "./keys";
export {
  parseFeatureRequests,
  parseEventType,
  parseDatesAndTimezone,
  parseNetworkingChoice,
} from "./parse";
