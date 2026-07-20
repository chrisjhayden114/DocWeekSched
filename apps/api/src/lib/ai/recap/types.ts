import type { SessionJoinMode } from "@prisma/client";

/** Join-mode keys used in metrics (includes explicit null bucket as "UNKNOWN"). */
export type RecapJoinModeKey = SessionJoinMode | "UNKNOWN";

export type ModeCounts = Partial<Record<RecapJoinModeKey, number>>;

export type RecapSessionMetrics = {
  sessionId: string;
  title: string;
  startsAt: string;
  /** SessionAttendance JOINING rows grouped by joinMode. */
  joinedByMode: ModeCounts;
  joinedTotal: number;
  /**
   * Event-level CheckIn attributed via the seat's joinMode — NOT a per-session door scan.
   * Count of JOINING rows whose user has a CheckIn for this event, grouped by that row's joinMode.
   */
  checkedInAttributedByMode: ModeCounts;
  checkedInAttributedTotal: number;
  /** JOINING with no event-level CheckIn. */
  noShowTotal: number;
  noShowByMode: ModeCounts;
  likes: number;
  qaThreads: number;
  pollVotes: number;
  feedbackCount: number;
  avgFeedback: number | null;
};

export type RecapMetricsSnapshot = {
  eventId: string;
  /** Event identity for narrative placeholders ({{event.name}}, {{event.id}}). */
  event: {
    id: string;
    name: string;
  };
  computedAt: string;
  headline: {
    registrants: number;
    checkIns: number;
    /** checkIns / registrants (0 when no registrants). */
    checkInRate: number;
    adoptionCount: number;
    /** adoptionCount / registrants (0 when no registrants). */
    adoptionRate: number;
  };
  engagement: {
    qaThreads: number;
    qaUpvotes: number;
    pollVotes: number;
    communityThreads: number;
    communityReplies: number;
    /** Sum of memberships' user.engagementPoints (Phase 5 spirit — ingest, don't invent). */
    engagementPoints: number;
  };
  sessions: RecapSessionMetrics[];
  /** Top sessions by fixed sort keys in code (see TOP_SESSION_SORT). */
  topSessions: Array<{
    sessionId: string;
    title: string;
    joinedTotal: number;
    feedbackCount: number;
    avgFeedback: number | null;
    likes: number;
    qaThreads: number;
  }>;
  /** Human labels for attribution semantics (frozen into snapshot for report copy). */
  labels: {
    checkedInAttributedByMode:
      "Event check-in attributed via session join mode (not a per-session door scan)";
  };
};

export type FeedbackQuote = {
  quoteId: string;
  sessionId: string;
  text: string;
  source: "session_feedback";
  /** Original SessionFeedback.id — for tests / lineage; not shown to LLM as author. */
  feedbackId: string;
};

export type FeedbackTheme = {
  label: string;
  quoteIds: string[];
  /** Computed in code from resolved quoteIds — never from the model. */
  commentCount: number;
  quotes: Array<{ quoteId: string; text: string; sessionId: string }>;
};

export type FixNextYearItem = {
  key: string;
  label: string;
};

export type SeriesChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  sourceEventId?: string;
  sourceRecapId?: string;
};

export class RecapSectionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RecapSectionError";
    this.code = code;
  }
}
