import type { AiChatMessage, AiProvider, AiProviderResult } from "../types";

/**
 * Real Anthropic provider. Only imported from lib/ai/** (ESLint enforced).
 * Requires ANTHROPIC_API_KEY when AI_PROVIDER=anthropic.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly name = "anthropic" as const;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts?: { apiKey?: string; model?: string }) {
    this.apiKey = (opts?.apiKey || process.env.ANTHROPIC_API_KEY || "").trim();
    this.model = (opts?.model || process.env.AI_MODEL || "claude-sonnet-4-20250514").trim();
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
      max_tokens: 4096,
      system: system || undefined,
      messages: rest.map((m) => {
        const parts: Array<
          | { type: "text"; text: string }
          | {
              type: "document";
              source: { type: "base64"; media_type: string; data: string };
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
              source: { type: "base64", media_type: att.mediaType, data: att.base64 },
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
    };
  }
}
