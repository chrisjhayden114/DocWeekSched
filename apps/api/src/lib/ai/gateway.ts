import type { z } from "zod";
import { AI_GENERATED_CHIP_LABEL } from "@event-app/shared";
import { HttpError } from "../authorization";
import { writeAuditLog } from "./audit";
import { assertAiCap } from "./caps";
import { recordAiUsage } from "./metering";
import { getAiProvider } from "./providers";
import type {
  AiChatMessage,
  ChatSuccess,
  EmbedSuccess,
  ExtractSuccess,
  GatewayCallContext,
  GatewayFailure,
} from "./types";
import type { Prisma } from "@prisma/client";

export { AI_GENERATED_CHIP_LABEL };

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1].trim() : trimmed;
  return JSON.parse(raw);
}

async function runProviderChat(messages: AiChatMessage[]) {
  const provider = getAiProvider();
  const started = Date.now();
  const result = await provider.chat(messages);
  return { result, latencyMs: Date.now() - started };
}

async function meterAndAudit(
  ctx: GatewayCallContext,
  opts: {
    action: "AI_CHAT" | "AI_EXTRACT" | "AI_DRAFT";
    result: { provider: string; model: string; tokensIn: number; tokensOut: number; text?: string };
    latencyMs: number;
    payload: Prisma.InputJsonValue;
  },
): Promise<string> {
  if (ctx.skipMetering) return "usage_skipped";
  const usage = await recordAiUsage({
    organizationId: ctx.organizationId,
    eventId: ctx.eventId,
    userId: ctx.userId,
    feature: ctx.feature,
    provider: opts.result.provider,
    model: opts.result.model,
    tokensIn: opts.result.tokensIn,
    tokensOut: opts.result.tokensOut,
    latencyMs: opts.latencyMs,
    jobId: ctx.jobId,
    requestId: ctx.requestId,
  });
  if (!ctx.skipAudit) {
    await writeAuditLog({
      organizationId: ctx.organizationId,
      eventId: ctx.eventId,
      actorUserId: ctx.userId,
      action: opts.action,
      entityType: "ai_usage",
      entityId: usage.id,
      aiGenerated: true,
      payload: opts.payload,
    });
  }
  return usage.id;
}

/**
 * Provider-agnostic embedding through the AI gateway (Matchmaker / future agents).
 */
export async function gatewayEmbed(
  text: string,
  ctx: GatewayCallContext,
): Promise<EmbedSuccess | GatewayFailure> {
  try {
    if (!ctx.skipCap && ctx.eventId) {
      await assertAiCap(ctx.organizationId, ctx.eventId, ctx.feature);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      return {
        ok: false,
        code: "CAP_EXCEEDED",
        message: String((err.body as { error?: string })?.error || err.message),
        upgrade: (err.body as { upgrade?: unknown })?.upgrade,
      };
    }
    throw err;
  }

  try {
    const provider = getAiProvider();
    const started = Date.now();
    const result = await provider.embed(text);
    const latencyMs = Date.now() - started;
    const usageId = await meterAndAudit(ctx, {
      action: "AI_DRAFT",
      result: {
        provider: result.provider,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: 0,
      },
      latencyMs,
      payload: {
        feature: ctx.feature,
        model: result.model,
        kind: "embed",
        dimensions: result.dimensions,
        chip: AI_GENERATED_CHIP_LABEL,
      },
    });
    return {
      ok: true,
      vector: result.vector,
      dimensions: result.dimensions,
      aiGenerated: true,
      usageId,
      model: result.model,
      provider: result.provider,
    };
  } catch (err) {
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: err instanceof Error ? err.message : "Provider error",
    };
  }
}

/**
 * Provider-agnostic chat through the AI gateway.
 * Meters + audits unless skip flags set. Caps enforced unless skipCap.
 */
export async function gatewayChat(
  messages: AiChatMessage[],
  ctx: GatewayCallContext,
): Promise<ChatSuccess | GatewayFailure> {
  try {
    if (!ctx.skipCap && ctx.eventId) {
      await assertAiCap(ctx.organizationId, ctx.eventId, ctx.feature);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      return {
        ok: false,
        code: "CAP_EXCEEDED",
        message: String((err.body as { error?: string })?.error || err.message),
        upgrade: (err.body as { upgrade?: unknown })?.upgrade,
      };
    }
    throw err;
  }

  try {
    const { result, latencyMs } = await runProviderChat(messages);
    const usageId = await meterAndAudit(ctx, {
      action: "AI_CHAT",
      result,
      latencyMs,
      payload: {
        feature: ctx.feature,
        model: result.model,
        chip: AI_GENERATED_CHIP_LABEL,
        preview: result.text.slice(0, 500),
      },
    });
    return {
      ok: true,
      text: result.text,
      aiGenerated: true,
      usageId,
      model: result.model,
      provider: result.provider,
    };
  } catch (err) {
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: err instanceof Error ? err.message : "Provider error",
    };
  }
}

/**
 * Structured extraction with Zod validation; retries once on schema violation
 * with validator errors fed back to the model.
 */
export async function gatewayExtract<T>(
  schema: z.ZodType<T>,
  messages: AiChatMessage[],
  ctx: GatewayCallContext,
): Promise<ExtractSuccess<T> | GatewayFailure> {
  try {
    if (!ctx.skipCap && ctx.eventId) {
      await assertAiCap(ctx.organizationId, ctx.eventId, ctx.feature);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      return {
        ok: false,
        code: "CAP_EXCEEDED",
        message: String((err.body as { error?: string })?.error || err.message),
        upgrade: (err.body as { upgrade?: unknown })?.upgrade,
      };
    }
    throw err;
  }

  const systemExtra =
    "Respond with a single JSON object only (no markdown unless required). Match the requested schema exactly.";

  async function attempt(msgs: AiChatMessage[], retried: boolean): Promise<ExtractSuccess<T> | GatewayFailure> {
    let result;
    let latencyMs: number;
    try {
      ({ result, latencyMs } = await runProviderChat([
        { role: "system", content: systemExtra },
        ...msgs,
      ]));
    } catch (err) {
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        message: err instanceof Error ? err.message : "Provider error",
      };
    }

    let parsed: unknown;
    try {
      parsed = parseJsonObject(result.text);
    } catch {
      await meterAndAudit(ctx, {
        action: "AI_EXTRACT",
        result,
        latencyMs,
        payload: { ok: false, code: "PARSE_ERROR", preview: result.text.slice(0, 500), retried },
      });
      if (!retried) {
        return attempt(
          [
            ...msgs,
            { role: "assistant", content: result.text },
            {
              role: "user",
              content: "Your previous reply was not valid JSON. Reply again with a single JSON object only.",
            },
          ],
          true,
        );
      }
      return { ok: false, code: "PARSE_ERROR", message: "Model did not return valid JSON" };
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      await meterAndAudit(ctx, {
        action: "AI_EXTRACT",
        result,
        latencyMs,
        payload: {
          ok: false,
          code: "SCHEMA_INVALID",
          issues: JSON.parse(JSON.stringify(validated.error.issues)),
          retried,
        },
      });
      if (!retried) {
        return attempt(
          [
            ...msgs,
            { role: "assistant", content: result.text },
            {
              role: "user",
              content: `Schema validation failed. Fix these issues and return JSON only:\n${JSON.stringify(validated.error.issues)}`,
            },
          ],
          true,
        );
      }
      return {
        ok: false,
        code: "SCHEMA_INVALID",
        message: "Extracted JSON failed schema validation after retry",
        issues: validated.error.issues,
      };
    }

    const usageId = await meterAndAudit(ctx, {
      action: "AI_EXTRACT",
      result,
      latencyMs,
      payload: {
        ok: true,
        retried,
        chip: AI_GENERATED_CHIP_LABEL,
        feature: ctx.feature,
      },
    });

    return {
      ok: true,
      data: validated.data,
      aiGenerated: true,
      usageId,
      model: result.model,
      provider: result.provider,
      retried,
    };
  }

  return attempt(messages, false);
}
