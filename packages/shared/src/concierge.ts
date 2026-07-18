/** Phase A3 — Attendee Concierge shared types. */

export const CONCIERGE_STARTER_CHIPS = [
  { id: "morning", label: "What's on this morning?" },
  { id: "topic", label: "Build me a schedule around a topic" },
  { id: "meet", label: "Who should I meet?", handoff: "A4" as const },
] as const;

export type ConciergeStarterChipId = (typeof CONCIERGE_STARTER_CHIPS)[number]["id"];

export type ConciergeToolName =
  | "searchSessions"
  | "getMyAgenda"
  | "addToMyAgenda"
  | "removeFromMyAgenda"
  | "exportICS"
  | "showOnMap"
  | "proposeMeeting"
  | "joinWaitlist";

/** Tools that write state — must mint ConciergePendingAction + confirm. */
export const CONCIERGE_MUTATING_TOOLS: readonly ConciergeToolName[] = [
  "addToMyAgenda",
  "removeFromMyAgenda",
  "exportICS",
  "proposeMeeting",
  "joinWaitlist",
] as const;

export function isConciergeMutatingTool(tool: string): tool is ConciergeToolName {
  return (CONCIERGE_MUTATING_TOOLS as readonly string[]).includes(tool);
}

export type ConciergePendingPreview = {
  title: string;
  body: string;
  overlaps?: Array<{ sessionId: string; title: string }>;
  capacityNote?: string | null;
};

export type ConciergeActionCard = {
  pendingActionId: string;
  tool: ConciergeToolName;
  preview: ConciergePendingPreview;
  expiresAt: string;
};

export type ConciergeMapHint = {
  roomId: string;
  mapId?: string | null;
  label: string;
};

export type ConciergeHandoffStub = {
  agent: "A4";
  message: string;
};
