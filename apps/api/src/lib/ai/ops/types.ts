import type { OpsDetectorKind, OpsDraftActionType } from "@prisma/client";

export const OPS_DETECT_SWEEP_JOB = "ai.ops_detect_sweep";
export const OPS_DETECT_EVENT_JOB = "ai.ops_detect_event";

/** Ops Inbox is active from 48h before start through 24h after end. */
export const OPS_WINDOW_BEFORE_MS = 48 * 60 * 60 * 1000;
export const OPS_WINDOW_AFTER_MS = 24 * 60 * 60 * 1000;

export const QA_STALE_HOURS = 3;
export const LOW_CHECKIN_LEAD_MINUTES = 30;
export const LOW_CHECKIN_WINDOW_MINUTES = 10;
export const LOW_CHECKIN_THRESHOLD = 0.25;
export const CAPACITY_PRESSURE_THRESHOLD = 0.9;

export type OpsDraftResult = {
  title: string;
  body: string;
};

export type CreateOpsCardInput = {
  organizationId: string;
  eventId: string;
  detectorKind: OpsDetectorKind;
  triggerInstanceKey: string;
  triggerSummary: string;
  evidence: Record<string, unknown>;
  draftActionType: OpsDraftActionType;
  draftPayload: Record<string, unknown>;
  /** Seed for MOCK deterministic draft; also sent to the gateway. */
  draftHint: {
    title: string;
    body: string;
  };
};

export type DetectorRunResult = {
  detectorKind: OpsDetectorKind;
  created: number;
  skipped: number;
};
