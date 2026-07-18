import type { AiChatMessage, AiProvider, AiProviderResult } from "../types";

/**
 * Deterministic mock provider — no API key.
 * For structured extraction tests: if the user message contains
 * `__MOCK_JSON__:` followed by JSON, return that; otherwise return {}.
 * `failNextExtracts` forces invalid JSON for the next N completeJson calls.
 */
export class MockAiProvider implements AiProvider {
  readonly name = "mock" as const;
  model = process.env.AI_MODEL?.trim() || "mock-extract-v1";
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
}
