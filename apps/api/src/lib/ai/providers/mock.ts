import type { AiChatMessage, AiEmbedResult, AiProvider, AiProviderResult } from "../types";

export const MOCK_EMBED_DIMENSIONS = 32;

/** Deterministic FNV-1a style hash → unit-ish float in [0,1). */
function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/**
 * Deterministic mock provider — no API key.
 * For structured extraction tests: if the user message contains
 * `__MOCK_JSON__:` followed by JSON, return that; otherwise return {}.
 * `failNextExtracts` forces invalid JSON for the next N completeJson calls.
 * `embed(text)` returns a stable bag-of-tokens vector for cosine tests.
 */
export class MockAiProvider implements AiProvider {
  readonly name = "mock" as const;
  model = process.env.AI_MODEL?.trim() || "mock-extract-v1";
  embedModel = process.env.AI_EMBED_MODEL?.trim() || "mock-embed-v1";
  /** Next N chat/extract responses return invalid JSON (for retry tests). */
  failNextExtracts = 0;

  async chat(messages: AiChatMessage[]): Promise<AiProviderResult> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    let text: string;

    if (this.failNextExtracts > 0) {
      this.failNextExtracts -= 1;
      text = "{ not valid json";
    } else {
      const marker = "__MOCK_JSON__:";
      const idx = lastUser.indexOf(marker);
      if (idx >= 0) {
        text = lastUser.slice(idx + marker.length).trim();
      } else if (lastUser.includes("__MOCK_CHAT__")) {
        text = "Mock assistant reply.";
      } else if (lastUser.includes("__MOCK_MATCH_RANK__")) {
        // Matchmaker ranking path without an injected payload — empty matches.
        text = JSON.stringify({ matches: [] });
      } else {
        text = "{}";
      }
    }

    return {
      text,
      tokensIn: Math.max(1, Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4)),
      tokensOut: Math.max(1, Math.ceil(text.length / 4)),
      model: this.model,
      provider: "mock",
    };
  }

  async embed(text: string): Promise<AiEmbedResult> {
    const dims = MOCK_EMBED_DIMENSIONS;
    const vector = new Array<number>(dims).fill(0);
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length > 1);
    for (const token of tokens) {
      const idx = Math.floor(hashToken(token) * dims) % dims;
      vector[idx] += 1 + hashToken(token + "#w");
    }
    // L2-normalize for stable cosine
    let norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    if (norm < 1e-9) {
      vector[0] = 1;
      norm = 1;
    }
    for (let i = 0; i < dims; i += 1) vector[i] /= norm;

    return {
      vector,
      dimensions: dims,
      tokensIn: Math.max(1, Math.ceil(text.length / 4)),
      model: this.embedModel,
      provider: "mock",
    };
  }
}
