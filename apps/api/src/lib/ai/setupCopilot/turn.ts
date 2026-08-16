/**
 * AGENT-2 — reply layer for the Setup assistant.
 *
 * The deterministic field layer (dialogue.ts) parses every answer and owns
 * form state; this wrapper sends [system + state block, last 6 history turns,
 * user message] through the A0 gateway (feature SETUP_COPILOT — metering and
 * caps exactly as before, one call per turn) and uses the model's text as the
 * assistant message. Gateway errors, empty replies, and load-bearing turns
 * (deterministicReply — the "ready" gate) keep the canned string. Writes
 * NEVER come from model output.
 */

import type { SetupCopilotMode } from "@event-app/shared";
import { gatewayChat } from "../gateway";
import type { GatewayCallContext } from "../types";
import {
  runCreateTurn,
  runSettingsTurn,
  type DialogueState,
  type TurnResult,
} from "./dialogue";
import { composeSetupTurnMessages } from "./prompt";

export async function runSetupCopilotTurn(params: {
  mode: SetupCopilotMode;
  state: DialogueState;
  userMessage: string;
  liveEvent: boolean;
  /** Null when no organization scope — deterministic reply, no model call. */
  gatewayCtx: GatewayCallContext | null;
}): Promise<TurnResult> {
  const { mode, state, userMessage, liveEvent, gatewayCtx } = params;

  const result =
    mode === "settings"
      ? runSettingsTurn(state, userMessage, liveEvent)
      : runCreateTurn(state, userMessage);

  if (!gatewayCtx) return result;

  // One gateway call per turn, always — metering/caps unchanged even when the
  // canned reply wins (deterministic gate turns).
  const gw = await gatewayChat(
    composeSetupTurnMessages({
      mode,
      form: result.form,
      history: state.messages,
      userMessage,
    }),
    gatewayCtx,
  );

  // The mock provider answers "{}" when no reply was injected — that is "no
  // answer", not an answer; treat it like an empty reply and keep the canned
  // fallback for this step.
  const modelText = gw.ok ? gw.text.trim() : "";
  if (result.deterministicReply || !modelText || modelText === "{}") return result;

  const messages = [...result.messages];
  messages[messages.length - 1] = { role: "assistant", content: modelText, aiGenerated: true };
  return { ...result, assistantMessage: modelText, messages };
}
