import type { AiChatMessage, AiEmbedResult, AiProvider, AiProviderResult } from "../types";
import { MockAiProvider } from "./mock";

/**
 * Fallback when AI_MODEL is unset. "claude-sonnet-4-20250514" was retired and
 * 404'd in production (2026-07-31); the dateless alias tracks the current
 * Sonnet release.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

/**
 * Output-token ceiling. 4096 truncated every real conference programme
 * mid-JSON (E10, 2026-08-02) — Claude Sonnet supports far more. Overridable
 * via AI_MAX_OUTPUT_TOKENS; never silently capped below this default.
 */
export const DEFAULT_AI_MAX_OUTPUT_TOKENS = 16384;

export function resolveMaxOutputTokens(): number {
  const raw = (process.env.AI_MAX_OUTPUT_TOKENS || "").trim();
  if (!raw) return DEFAULT_AI_MAX_OUTPUT_TOKENS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[ai] AI_MAX_OUTPUT_TOKENS="${raw}" is not a positive integer — using default ${DEFAULT_AI_MAX_OUTPUT_TOKENS}.`,
    );
    return DEFAULT_AI_MAX_OUTPUT_TOKENS;
  }
  return parsed;
}

/**
 * Real Anthropic provider. Only imported from lib/ai/** (ESLint enforced).
 * Requires ANTHROPIC_API_KEY when AI_PROVIDER=anthropic.
 * Embeddings: Anthropic has no public embeddings API yet — fall back to deterministic mock vectors
 * so matchmaker still works when chat uses Anthropic.
 */
/**
 * Boot-time preflight: warn loudly (never throw) when AI_PROVIDER=anthropic
 * and the configured model does not exist — a retired/mistyped model otherwise
 * only surfaces as per-request 404s deep in ingest runs.
 */
export async function warnIfAnthropicModelUnavailable(): Promise<void> {
  const providerName = (process.env.AI_PROVIDER || "mock").trim().toLowerCase();
  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (providerName !== "anthropic" || !apiKey) return;
  const model = (process.env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL).trim();
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    await client.models.retrieve(model);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      console.warn(
        `[preflight] Anthropic model "${model}" not found (404) — AI features (ingest/concierge/etc.) will fail. Set AI_MODEL to a valid model (default: ${DEFAULT_ANTHROPIC_MODEL}).`,
      );
    } else if (status === 401 || status === 403) {
      console.warn(
        "[preflight] Anthropic API key was rejected — AI features will fail until ANTHROPIC_API_KEY is fixed.",
      );
    }
    // Network/transient errors: stay silent — this check must never block or noise boot.
  }
}

export class AnthropicAiProvider implements AiProvider {
  readonly name = "anthropic" as const;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly embedFallback = new MockAiProvider();

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.apiKey = (opts?.apiKey || process.env.ANTHROPIC_API_KEY || "").trim();
    this.model = (opts?.model || process.env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL).trim();
  }

  async embed(text: string): Promise<AiEmbedResult> {
    const result = await this.embedFallback.embed(text);
    return { ...result, provider: "anthropic", model: `anthropic-fallback:${result.model}` };
  }

  async chat(messages: AiChatMessage[]): Promise<AiProviderResult> {
    if (!this.apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic");
    }
    // Dynamic import keeps mock-path tests free of needing the key at load time,
    // but the static import path is still this file under lib/ai for lint.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });

    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const rest = messages.filter((m) => m.role !== "system");

    const response = await client.messages.create({
      model: this.model,
      max_tokens: resolveMaxOutputTokens(),
      system: system || undefined,
      messages: rest.map((m) => {
        const parts: Array<
          | { type: "text"; text: string }
          | {
              type: "document";
              source: { type: "base64"; media_type: "application/pdf"; data: string };
            }
          | {
              type: "image";
              source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };
            }
        > = [];
        for (const att of m.attachments || []) {
          if (att.type === "document") {
            parts.push({
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: att.base64,
              },
            });
          } else if (att.type === "image") {
            const mt = att.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
            parts.push({
              type: "image",
              source: { type: "base64", media_type: mt, data: att.base64 },
            });
          }
        }
        parts.push({ type: "text", text: m.content });
        return {
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: parts.length === 1 && parts[0].type === "text" ? m.content : parts,
        };
      }),
    });

    const text = response.content
      .map((b) => ("text" in b && typeof b.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n");

    return {
      text,
      tokensIn: response.usage?.input_tokens ?? 0,
      tokensOut: response.usage?.output_tokens ?? 0,
      model: this.model,
      provider: "anthropic",
      stopReason: response.stop_reason ?? undefined,
    };
  }
}
