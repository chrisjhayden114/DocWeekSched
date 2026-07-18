import type { AiProvider } from "../types";
import { AnthropicAiProvider } from "./anthropic";
import { MockAiProvider } from "./mock";

let cached: AiProvider | null = null;

export function resolveAiProviderName(): "mock" | "anthropic" {
  const raw = (process.env.AI_PROVIDER || "mock").trim().toLowerCase();
  return raw === "anthropic" ? "anthropic" : "mock";
}

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  cached = resolveAiProviderName() === "anthropic" ? new AnthropicAiProvider() : new MockAiProvider();
  return cached;
}

/** Tests only — swap provider mid-suite. */
export function resetAiProviderForTests(provider?: AiProvider): void {
  cached = provider ?? null;
}

export { MockAiProvider, AnthropicAiProvider };
