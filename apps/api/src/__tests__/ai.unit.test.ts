import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { NotificationClass, NotificationKind } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { classForKind } from "../lib/notifications/types";
import {
  MockAiProvider,
  resetAiProviderForTests,
  gatewayExtract,
  gatewayChat,
  assertGroundedIds,
  GroundingError,
  AI_GENERATED_CHIP_LABEL,
} from "../lib/ai";
import type { GroundingContext } from "../lib/ai/types";
import {
  DEFAULT_AI_MAX_OUTPUT_TOKENS,
  resolveMaxOutputTokens,
} from "../lib/ai/providers/anthropic";
import { PLAN_BY_SKU } from "@event-app/shared";

describe("plan AI caps (catalog)", () => {
  it("FREE has 1 ingest and 50 concierge per event", () => {
    expect(PLAN_BY_SKU.free.limits.aiIngestPerEvent).toBe(1);
    expect(PLAN_BY_SKU.free.limits.aiConciergePerEvent).toBe(50);
  });

  it("PRO has generous soft concierge cap", () => {
    expect(PLAN_BY_SKU.pro_annual.limits.aiConciergePerEvent).toBe(5000);
    expect(PLAN_BY_SKU.pro_annual.limits.aiIngestPerEvent).toBeNull();
  });
});

describe("output-token ceiling (E10)", () => {
  const saved = process.env.AI_MAX_OUTPUT_TOKENS;
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_MAX_OUTPUT_TOKENS;
    else process.env.AI_MAX_OUTPUT_TOKENS = saved;
  });

  it("defaults to 16384", () => {
    delete process.env.AI_MAX_OUTPUT_TOKENS;
    expect(DEFAULT_AI_MAX_OUTPUT_TOKENS).toBe(16384);
    expect(resolveMaxOutputTokens()).toBe(16384);
  });

  it("honours AI_MAX_OUTPUT_TOKENS", () => {
    process.env.AI_MAX_OUTPUT_TOKENS = "32000";
    expect(resolveMaxOutputTokens()).toBe(32000);
  });

  it("falls back to the default on a non-numeric value", () => {
    process.env.AI_MAX_OUTPUT_TOKENS = "lots";
    expect(resolveMaxOutputTokens()).toBe(DEFAULT_AI_MAX_OUTPUT_TOKENS);
  });
});

describe("AI gateway (mock provider, no DB)", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());
  });

  it("retries once on schema violation then succeeds", async () => {
    const mock = new MockAiProvider();
    let calls = 0;
    mock.chat = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          text: JSON.stringify({ title: 123 }),
          tokensIn: 10,
          tokensOut: 5,
          model: "mock-extract-v1",
          provider: "mock",
        };
      }
      return {
        text: JSON.stringify({ title: "Opening keynote" }),
        tokensIn: 12,
        tokensOut: 8,
        model: "mock-extract-v1",
        provider: "mock",
      };
    };
    resetAiProviderForTests(mock);

    const schema = z.object({ title: z.string().min(1) });
    const result = await gatewayExtract(schema, [{ role: "user", content: "Extract session" }], {
      organizationId: "org_test",
      eventId: "evt_test",
      feature: "AGENDA_INGEST",
      skipCap: true,
      skipMetering: true,
      skipAudit: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe("Opening keynote");
      expect(result.retried).toBe(true);
      expect(result.aiGenerated).toBe(true);
    }
    expect(calls).toBe(2);
  });

  it("returns TRUNCATED without retrying when the reply hit the output-token ceiling (E10)", async () => {
    const mock = new MockAiProvider();
    let calls = 0;
    mock.chat = async () => {
      calls += 1;
      return {
        text: '{"title": "Opening keyn', // cut off mid-object
        tokensIn: 500,
        tokensOut: 16384,
        model: "mock-extract-v1",
        provider: "mock",
        stopReason: "max_tokens",
      };
    };
    resetAiProviderForTests(mock);

    const schema = z.object({ title: z.string().min(1) });
    const result = await gatewayExtract(schema, [{ role: "user", content: "Extract session" }], {
      organizationId: "org_test",
      eventId: "evt_test",
      feature: "AGENDA_INGEST",
      skipCap: true,
      skipMetering: true,
      skipAudit: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("TRUNCATED");
      expect(result.message).toMatch(/too long/i);
      expect(result.message).not.toMatch(/JSON/i);
    }
    expect(calls).toBe(1);
  });

  it("chat returns aiGenerated text via mock", async () => {
    const mock = new MockAiProvider();
    mock.chat = async () => ({
      text: "Hello from mock",
      tokensIn: 3,
      tokensOut: 4,
      model: "mock-extract-v1",
      provider: "mock",
    });
    resetAiProviderForTests(mock);
    const result = await gatewayChat([{ role: "user", content: "__MOCK_CHAT__" }], {
      organizationId: "org_test",
      feature: "OTHER",
      skipCap: true,
      skipMetering: true,
      skipAudit: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("Hello from mock");
      expect(result.aiGenerated).toBe(true);
    }
  });

  it("maps AGENT_ATTENDEE_TOUCH to DIGEST (never INTERRUPT)", () => {
    expect(classForKind(NotificationKind.AGENT_ATTENDEE_TOUCH)).toBe(NotificationClass.DIGEST);
    expect(classForKind(NotificationKind.MESSAGE)).toBe(NotificationClass.DIGEST);
    expect(classForKind(NotificationKind.ANNOUNCEMENT)).toBe(NotificationClass.INTERRUPT);
  });

  it("rejects foreign IDs in grounding assert", () => {
    const grounding: GroundingContext = {
      eventId: "evt_a",
      organizationId: "org_a",
      event: {
        id: "evt_a",
        name: "Test",
        timezone: "UTC",
        startDate: new Date(),
        endDate: new Date(),
        description: null,
      },
      sessionIds: new Set(["sess_1"]),
      speakerIds: new Set(["spk_1"]),
      roomIds: new Set(["room_1"]),
      trackIds: new Set(["trk_1"]),
      mapIds: new Set(),
      faqIds: new Set(),
      sessions: [],
      faq: [],
      maps: [],
      announcements: [],
      rooms: [],
      tracks: [],
      myAgendaSessionIds: new Set(),
      textBlob: "",
    };
    expect(() => assertGroundedIds(grounding, { sessionIds: ["sess_1"] })).not.toThrow();
    expect(() => assertGroundedIds(grounding, { sessionIds: ["sess_foreign"] })).toThrow(GroundingError);
    expect(() => assertGroundedIds(grounding, { eventId: "evt_other" })).toThrow(/Foreign eventId/);
  });

  it("exposes the AI-generated chip label", () => {
    expect(AI_GENERATED_CHIP_LABEL).toMatch(/AI-generated/i);
  });

  it("ESLint config blocks @anthropic-ai outside lib/ai", () => {
    const cfgPath = join(__dirname, "../../eslint.config.cjs");
    const raw = readFileSync(cfgPath, "utf8");
    expect(raw).toContain("@anthropic-ai");
    expect(raw).toContain("no-restricted-imports");
    expect(raw).toContain("src/lib/ai/**");
  });
});
