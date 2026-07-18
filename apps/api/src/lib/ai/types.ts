import type { AiMeterFeature } from "@prisma/client";
import type { z } from "zod";
import { AI_GENERATED_CHIP_LABEL } from "@event-app/shared";

export { AI_GENERATED_CHIP_LABEL };

export type AiProviderName = "mock" | "anthropic";

export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiProviderResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  provider: AiProviderName;
};

export type AiProvider = {
  readonly name: AiProviderName;
  chat(messages: AiChatMessage[]): Promise<AiProviderResult>;
};

export type GatewayCallContext = {
  organizationId: string;
  eventId?: string | null;
  userId?: string | null;
  feature: AiMeterFeature;
  jobId?: string | null;
  requestId?: string | null;
  /** Skip cap check (internal/tests only). */
  skipCap?: boolean;
  /** Skip AiUsageRecord write (unit tests of extract/chat logic). */
  skipMetering?: boolean;
  /** Skip AuditLog write (unit tests). */
  skipAudit?: boolean;
};

export type ChatSuccess = {
  ok: true;
  text: string;
  aiGenerated: true;
  usageId: string;
  model: string;
  provider: AiProviderName;
};

export type ExtractSuccess<T> = {
  ok: true;
  data: T;
  aiGenerated: true;
  usageId: string;
  model: string;
  provider: AiProviderName;
  retried: boolean;
};

export type GatewayFailure = {
  ok: false;
  code: "SCHEMA_INVALID" | "PROVIDER_ERROR" | "CAP_EXCEEDED" | "PARSE_ERROR";
  message: string;
  issues?: z.ZodIssue[];
  upgrade?: unknown;
};

export type GroundingContext = {
  eventId: string;
  organizationId: string;
  event: {
    id: string;
    name: string;
    timezone: string;
    startDate: Date;
    endDate: Date;
    description: string | null;
  };
  sessionIds: Set<string>;
  speakerIds: Set<string>;
  roomIds: Set<string>;
  trackIds: Set<string>;
  sessions: Array<{
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    roomId: string | null;
    trackId: string | null;
  }>;
  textBlob: string;
};
