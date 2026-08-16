/**
 * AGENT-2 — reply layer for the Setup assistant.
 *
 * SETUP-2: create-mode turns first extract every stated field (one extra
 * SETUP_COPILOT gateway call), merge non-null values, and fall back to the
 * regex parsers when extract returns nothing or the gateway fails. The
 * deterministic field layer still owns form state; this wrapper sends
 * [system + state block, last 6 history turns, user message] through the
 * A0 gateway and uses the model's text as the assistant message. Gateway
 * errors, empty replies, and load-bearing turns (deterministicReply — the
 * "ready" gate) keep the canned string. Writes NEVER come from model output.
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
import { hasExtractedFields, type SetupExtract } from "./extractTypes";
import { runSetupExtract } from "./extract";
import { linkifyOrganizerReply } from "./links";
import { composeSetupTurnMessages } from "./prompt";

export async function runSetupCopilotTurn(params: {
  mode: SetupCopilotMode;
  state: DialogueState;
  userMessage: string;
  liveEvent: boolean;
  /** Null when no organization scope — deterministic reply, no model call. */
  gatewayCtx: GatewayCallContext | null;
  /**
   * Precomputed extract (document upload). When set, the per-turn extract
   * call is skipped. `null` means "already tried, use regex fallback".
   */
  extracted?: SetupExtract | null;
  /**
   * AGENT-3 — EVENT STATE block (settings mode): the route resolves the
   * event and counts and serializes them via buildOrganizerStateText.
   */
  organizerStateText?: string | null;
}): Promise<TurnResult> {
  const { mode, state, userMessage, liveEvent, gatewayCtx } = params;

  let extracted: SetupExtract | null | undefined = params.extracted;
  if (mode === "create" && extracted === undefined && gatewayCtx) {
    const gw = await runSetupExtract({
      organizationId: gatewayCtx.organizationId,
      userId: gatewayCtx.userId,
      sourceText: userMessage,
      skipCap: gatewayCtx.skipCap,
      skipMetering: gatewayCtx.skipMetering,
      skipAudit: gatewayCtx.skipAudit,
      eventId: gatewayCtx.eventId,
    });
    extracted = gw.ok && hasExtractedFields(gw.data) ? gw.data : null;
  }

  const result =
    mode === "settings"
      ? runSettingsTurn(state, userMessage, liveEvent)
      : runCreateTurn(state, userMessage, extracted);

  if (!gatewayCtx) return result;

  // Reply-layer gateway call (extract already ran above in create mode).
  // Metering/caps unchanged even when the canned reply wins.
  const gw = await gatewayChat(
    composeSetupTurnMessages({
      mode,
      form: result.form,
      history: state.messages,
      userMessage,
      organizerStateText: params.organizerStateText,
    }),
    gatewayCtx,
  );

  // The mock provider answers "{}" when no reply was injected — that is "no
  // answer", not an answer; treat it like an empty reply and keep the canned
  // fallback for this step (settings mode: the old scope-decline string).
  const modelText = gw.ok ? gw.text.trim() : "";
  if (result.deterministicReply || !modelText || modelText === "{}") return result;

  // AGENT-3 — deterministic linkify (CHAT-2 pattern): Organizer Guide topics
  // that appear verbatim in the reply become in-app navigation offers.
  const links =
    mode === "settings" && gatewayCtx.eventId
      ? linkifyOrganizerReply(modelText, gatewayCtx.eventId)
      : [];

  const messages = [...result.messages];
  messages[messages.length - 1] = {
    role: "assistant",
    content: modelText,
    aiGenerated: true,
    ...(links.length ? { links } : {}),
  };
  return { ...result, assistantMessage: modelText, messages, links };
}
