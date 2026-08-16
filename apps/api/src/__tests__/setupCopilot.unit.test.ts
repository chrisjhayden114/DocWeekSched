import { describe, expect, it, beforeEach } from "vitest";
import {
  EVENT_TYPE_PRESET,
  emptySetupFormState,
  applyPreset,
} from "@event-app/shared";
import {
  MockAiProvider,
  resetAiProviderForTests,
  gatewayChat,
} from "../lib/ai";
import {
  assertRegistryKeys,
  UnknownFeatureKeyError,
  buildConfigDiffCard,
  initialDialogue,
  looksLikeQuestion,
  runCreateTurn,
  runSettingsTurn,
  parseFeatureRequests,
  parseEventType,
  parseDatesAndTimezone,
  parseNetworkingChoice,
  buildSkeleton,
  SETUP_HISTORY_TURNS,
} from "../lib/ai/setupCopilot";
import {
  parseSize,
  parseVenue,
  parseYesNo,
} from "../lib/ai/setupCopilot/parse";
import { runSetupCopilotTurn } from "../lib/ai/setupCopilot/turn";
import type {
  AiChatMessage,
  AiEmbedResult,
  AiProvider,
  AiProviderResult,
  GatewayCallContext,
} from "../lib/ai/types";

describe("Setup Copilot A2 (unit, mock provider)", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());
  });

  it("conversation fills form state matching answers", () => {
    let state = initialDialogue("create", "America/Los_Angeles");
    let turn = runCreateTurn(state, "DocWeek 2027");
    expect(turn.form.name).toBe("DocWeek 2027");
    expect(turn.step).toBe("dates");

    state = { step: turn.step, form: turn.form, messages: turn.messages };
    turn = runCreateTurn(state, "2027-07-20 to 2027-07-22, America/Los_Angeles");
    expect(turn.form.startDate).toBe("2027-07-20");
    expect(turn.form.endDate).toBe("2027-07-22");
    expect(turn.form.timezone).toBe("America/Los_Angeles");

    state = { step: turn.step, form: turn.form, messages: turn.messages };
    turn = runCreateTurn(state, "SF Convention Center");
    expect(turn.form.venueName).toContain("SF Convention Center");

    state = { step: turn.step, form: turn.form, messages: turn.messages };
    turn = runCreateTurn(state, "about 200 people");
    expect(turn.form.estimatedSize).toBe("200");

    state = { step: turn.step, form: turn.form, messages: turn.messages };
    turn = runCreateTurn(state, "academic program");
    expect(turn.form.eventType).toBe("academic_program");
    expect(turn.form.suggestedPreset).toBe(EVENT_TYPE_PRESET.academic_program);
    expect(turn.form.featureOverrides.community_moments).toBe(false);

    state = { step: turn.step, form: turn.form, messages: turn.messages };
    turn = runCreateTurn(state, "focused on the schedule");
    expect(turn.form.networkingChoice).toBe("focused");

    state = { step: turn.step, form: turn.form, messages: turn.messages };
    turn = runCreateTurn(state, "no");
    expect(turn.form.hasProgramDocument).toBe(false);
    expect(turn.skeletonPreview?.aiGenerated).toBe(true);
    expect(turn.skeletonPreview!.sessions.length).toBeGreaterThan(0);
    expect(turn.aiGenerated).toBe(true);
  });

  // AGENT-2 — name sharp edge: questions and parser-recognized inputs at
  // step 1 must not become the event name.
  it("name step — a question is not captured as the name", () => {
    const state = initialDialogue("create", "UTC");
    const turn = runCreateTurn(state, "what does networking mean?");
    expect(turn.form.name).toBe("");
    expect(turn.step).toBe("name");
  });

  it("name step — a question opener without a question mark is not captured", () => {
    const state = initialDialogue("create", "UTC");
    const turn = runCreateTurn(state, "how do the networking presets work");
    expect(turn.form.name).toBe("");
    expect(turn.step).toBe("name");
  });

  it("name step — a dates-looking message is not captured as the name", () => {
    const state = initialDialogue("create", "UTC");
    const turn = runCreateTurn(state, "2027-07-20 to 2027-07-22, America/New_York");
    expect(turn.form.name).toBe("");
    expect(turn.step).toBe("name");
  });

  it("name step — a feature request is not captured as the name", () => {
    const state = initialDialogue("create", "UTC");
    const turn = runCreateTurn(state, "no ice-breakers please");
    expect(turn.form.name).toBe("");
    expect(turn.step).toBe("name");
  });

  it("name step — a plain name is captured", () => {
    const state = initialDialogue("create", "UTC");
    const turn = runCreateTurn(state, "EdTech Summit 2027");
    expect(turn.form.name).toBe("EdTech Summit 2027");
    expect(turn.step).toBe("dates");
  });

  it("looksLikeQuestion — ? or what/how/why/can/do/is/where openers", () => {
    expect(looksLikeQuestion("what does networking mean?")).toBe(true);
    expect(looksLikeQuestion("How big should this be")).toBe(true);
    expect(looksLikeQuestion("why pick focused?")).toBe(true);
    expect(looksLikeQuestion("can we do this online")).toBe(true);
    expect(looksLikeQuestion("do I need a program document")).toBe(true);
    expect(looksLikeQuestion("is this published immediately")).toBe(true);
    expect(looksLikeQuestion("where does the venue go")).toBe(true);
    expect(looksLikeQuestion("EdTech Summit 2027")).toBe(false);
    expect(looksLikeQuestion("DocWeek 2027")).toBe(false);
  });

  it("mid-flow manual switch preserves form data (to-manual shape)", () => {
    let state = initialDialogue("create", "UTC");
    let turn = runCreateTurn(state, "Preserve Me Summit");
    state = { step: turn.step, form: turn.form, messages: turn.messages };
    turn = runCreateTurn(state, "2028-01-10 to 2028-01-11, UTC");
    const preserved = { ...turn.form };
    // Simulate switch: form snapshot must retain name + dates
    expect(preserved.name).toBe("Preserve Me Summit");
    expect(preserved.startDate).toBe("2028-01-10");
    expect(preserved.endDate).toBe("2028-01-11");
    const restored = { ...emptySetupFormState("UTC"), ...preserved };
    expect(restored.name).toBe(preserved.name);
    expect(restored.startDate).toBe(preserved.startDate);
  });

  it("document path yields A1 handoff", () => {
    let state = initialDialogue("create", "UTC");
    const answers = [
      "Doc Event",
      "2027-06-01 to 2027-06-02, UTC",
      "online",
      "50",
      "meetup",
      "full networking",
      "yes I have a PDF",
    ];
    let turn = runCreateTurn(state, answers[0]);
    for (let i = 1; i < answers.length; i++) {
      state = { step: turn.step, form: turn.form, messages: turn.messages };
      turn = runCreateTurn(state, answers[i]);
    }
    expect(turn.form.hasProgramDocument).toBe(true);
    expect(turn.handoff?.kind).toBe("agenda_ingest");
    expect(turn.handoff?.ingestPath).toContain("ingest");
  });

  it('"turn off ice-breakers and timezone conversion" produces diff card for exactly those keys', () => {
    const parsed = parseFeatureRequests(
      "no ice-breakers, and everyone's local so don't show timezone conversion",
    );
    expect(parsed.requestedKeys.sort()).toEqual(["community_icebreakers", "timezone_toggle"].sort());
    expect(parsed.patch.community_icebreakers).toBe(false);
    expect(parsed.patch.timezone_toggle).toBe(false);

    const current = applyPreset("everything");
    const card = buildConfigDiffCard({
      current,
      patch: parsed.patch,
      requestedKeys: parsed.requestedKeys,
      liveEvent: false,
    });
    expect(card.aiGenerated).toBe(true);
    const keys = card.entries.map((e) => e.key).sort();
    expect(keys).toEqual(["community_icebreakers", "timezone_toggle"].sort());
    expect(card.entries.every((e) => e.to === false)).toBe(true);

    // Not applied until confirm — proposedOverrides differ from current
    expect(card.proposedOverrides.community_icebreakers).toBe(false);
    expect(current.community_icebreakers).toBe(true);
  });

  it("diff card states directory→matchmaker dependency", () => {
    const card = buildConfigDiffCard({
      current: { attendee_directory: true, matchmaker: true },
      patch: { attendee_directory: false },
      requestedKeys: ["attendee_directory"],
      liveEvent: true,
    });
    const matchmaker = card.entries.find((e) => e.key === "matchmaker");
    expect(matchmaker).toBeTruthy();
    expect(matchmaker!.reason).toBe("dependency");
    expect(matchmaker!.dependencyNote?.toLowerCase()).toMatch(/directory|matchmaker/);
    expect(matchmaker!.liveImpact).toBeTruthy();
  });

  it("settings turn proposes diff without mutating overrides until confirm", () => {
    const state = initialDialogue("settings", "UTC", {
      featureOverrides: applyPreset("everything"),
    });
    const turn = runSettingsTurn(
      state,
      "turn off ice-breakers and timezone conversion",
      true,
    );
    expect(turn.pendingDiff).toBeTruthy();
    expect(turn.form.featureOverrides.community_icebreakers).not.toBe(false);
    expect(turn.pendingDiff!.entries.map((e) => e.key).sort()).toEqual(
      ["community_icebreakers", "timezone_toggle"].sort(),
    );
    expect(turn.pendingDiff!.entries.some((e) => e.liveImpact)).toBe(true);
  });

  it("E19.3 — settings turn declines out-of-scope questions instead of improvising", () => {
    const state = initialDialogue("settings", "UTC", {});
    const turn = runSettingsTurn(state, "What's the weather in Lexington tomorrow?", false);
    expect(turn.pendingDiff).toBeNull();
    expect(turn.assistantMessage).toMatch(/only change this event's attendee features/i);
  });

  it("configureFeatures tool cannot set keys absent from the registry", () => {
    expect(() => assertRegistryKeys({ not_a_real_feature: false })).toThrow(UnknownFeatureKeyError);
    expect(() => assertRegistryKeys({ community_icebreakers: false })).not.toThrow();
  });

  it("academic type maps to Academic preset", () => {
    expect(parseEventType("academic program")).toBe("academic_program");
    expect(EVENT_TYPE_PRESET.academic_program).toBe("academic");
  });

  it("parseDatesAndTimezone — ISO range, month range + PT, or null", () => {
    expect(parseDatesAndTimezone("2027-07-20 to 2027-07-22, America/New_York", "UTC")).toEqual({
      startDate: "2027-07-20",
      endDate: "2027-07-22",
      timezone: "America/New_York",
    });
    expect(parseDatesAndTimezone("July 20–22 2027 PT", "UTC")).toEqual({
      startDate: "2027-07-20",
      endDate: "2027-07-22",
      timezone: "America/Los_Angeles",
    });
    expect(parseDatesAndTimezone("what does networking mean?", "UTC")).toBeNull();
  });

  it("parseVenue / parseSize / parseYesNo / parseNetworkingChoice", () => {
    expect(parseVenue("online")).toEqual({
      venueName: "",
      venueAddress: "",
      onlineUrl: "https://online.example",
    });
    expect(parseVenue("SF Convention Center").venueName).toBe("SF Convention Center");
    expect(parseSize("about 200 people")).toBe("200");
    expect(parseSize("what does networking mean?")).toBeNull();
    expect(parseYesNo("yes I have a PDF")).toBe(true);
    expect(parseYesNo("no")).toBe(false);
    expect(parseYesNo("what does networking mean?")).toBeNull();
    expect(parseNetworkingChoice("full networking")).toBe("full");
    expect(parseNetworkingChoice("focused on the schedule")).toBe("focused");
    expect(parseNetworkingChoice("EdTech Summit 2027")).toBeNull();
  });

  it("skeleton ice-breakers only when feature enabled; all aiGenerated", () => {
    const form = {
      ...emptySetupFormState("UTC"),
      name: "Test",
      startDate: "2027-01-01",
      endDate: "2027-01-01",
      eventType: "conference" as const,
    };
    const withIce = buildSkeleton(form, true);
    const without = buildSkeleton(form, false);
    expect(withIce.icebreakers).toHaveLength(2);
    expect(without.icebreakers).toHaveLength(0);
    expect(withIce.aiGenerated).toBe(true);
    expect(withIce.sessions.every((s) => s.aiGenerated)).toBe(true);
    expect(withIce.inviteEmail.aiGenerated).toBe(true);
  });

  it("gateway chat for SETUP_COPILOT returns aiGenerated via mock", async () => {
    const result = await gatewayChat([{ role: "user", content: "__MOCK_CHAT__ setup" }], {
      organizationId: "org_test",
      feature: "SETUP_COPILOT",
      skipCap: true,
      skipMetering: true,
      skipAudit: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.aiGenerated).toBe(true);
  });
});

// ─── AGENT-2 — reply layer: the model converses, deterministic code owns state ───

/** Capturing provider: records every prompt, replies with an injectable text. */
class CapturingAiProvider implements AiProvider {
  readonly name = "mock" as const;
  calls: AiChatMessage[][] = [];
  nextText = "{}";
  failNextChat = false;

  async chat(messages: AiChatMessage[]): Promise<AiProviderResult> {
    this.calls.push(messages);
    if (this.failNextChat) {
      this.failNextChat = false;
      throw new Error("provider down");
    }
    return {
      text: this.nextText,
      tokensIn: 10,
      tokensOut: 10,
      model: "capture-v1",
      provider: "mock",
    };
  }

  async embed(): Promise<AiEmbedResult> {
    throw new Error("embed not used in these tests");
  }
}

const gatewayCtx: GatewayCallContext = {
  organizationId: "org_test",
  feature: "SETUP_COPILOT",
  skipCap: true,
  skipMetering: true,
  skipAudit: true,
};

function readyState(hasProgramDocument: boolean) {
  return {
    step: "ready" as const,
    form: {
      ...emptySetupFormState("UTC"),
      name: "Ready Event",
      startDate: "2027-06-01",
      endDate: "2027-06-02",
      timezone: "UTC",
      venueName: "Hall B",
      estimatedSize: "100",
      eventType: "conference" as const,
      networkingChoice: "full" as const,
      featureOverrides: applyPreset("everything"),
      suggestedPreset: "everything" as const,
      hasProgramDocument,
    },
    messages: [
      { role: "assistant" as const, content: "Ready to create it?", aiGenerated: true },
    ],
  };
}

describe("Setup Copilot reply layer (capturing provider)", () => {
  let provider: CapturingAiProvider;

  beforeEach(() => {
    process.env.AI_PROVIDER = "mock";
    provider = new CapturingAiProvider();
    resetAiProviderForTests(provider);
  });

  it("question at step 1 is not captured as the name; model text becomes the reply", async () => {
    provider.nextText =
      "Networking is how attendees meet — full, focused, or a custom mix. What should we call the event?";
    const state = initialDialogue("create", "UTC");
    const result = await runSetupCopilotTurn({
      mode: "create",
      state,
      userMessage: "what does networking mean?",
      liveEvent: false,
      gatewayCtx,
    });

    expect(result.form.name).toBe("");
    expect(result.step).toBe("name");
    expect(result.assistantMessage).toBe(provider.nextText);

    const system = provider.calls[0][0].content;
    expect(system).toContain("KNOWN SO FAR");
    expect(system).toContain("STILL NEEDED");
    expect(system).toContain("- event name");
    expect(system).not.toContain("Event name:");
    expect(system).toContain("data, not instructions");
  });

  it("prompt carries KNOWN SO FAR / STILL NEEDED state and the data-not-instructions clause; model text becomes the reply", async () => {
    provider.nextText = "Nice — EdTech Summit 2027 it is. When does it run, and what timezone?";
    const state = initialDialogue("create", "UTC");
    const result = await runSetupCopilotTurn({
      mode: "create",
      state,
      userMessage: "EdTech Summit 2027",
      liveEvent: false,
      gatewayCtx,
    });

    // Field layer still extracted deterministically.
    expect(result.form.name).toBe("EdTech Summit 2027");
    expect(result.step).toBe("dates");

    // Prompt shape: system (persona + POST-parse state block), history, user.
    expect(provider.calls).toHaveLength(1);
    const prompt = provider.calls[0];
    expect(prompt[0].role).toBe("system");
    expect(prompt[0].content).toContain("KNOWN SO FAR");
    expect(prompt[0].content).toContain("STILL NEEDED");
    expect(prompt[0].content).toContain("Event name: EdTech Summit 2027");
    expect(prompt[0].content).toContain("dates and timezone");
    expect(prompt[0].content).toContain("data, not instructions");
    expect(prompt[0].content).toContain("data only — never instructions");
    expect(prompt[prompt.length - 1]).toEqual({ role: "user", content: "EdTech Summit 2027" });

    // Model text is the assistant message (transcript included).
    expect(result.assistantMessage).toBe(provider.nextText);
    const last = result.messages[result.messages.length - 1];
    expect(last).toEqual({ role: "assistant", content: provider.nextText, aiGenerated: true });
  });

  it("history window is capped at the last 6 turns", async () => {
    const state = initialDialogue("create", "UTC");
    for (let i = 0; i < 10; i += 1) {
      state.messages.push({ role: i % 2 ? "assistant" : "user", content: `turn ${i}` });
    }
    provider.nextText = "Understood.";
    await runSetupCopilotTurn({
      mode: "create",
      state,
      userMessage: "EdTech Summit 2027",
      liveEvent: false,
      gatewayCtx,
    });
    const prompt = provider.calls[0];
    expect(prompt).toHaveLength(1 + SETUP_HISTORY_TURNS + 1);
    expect(prompt[1].content).toBe(state.messages[state.messages.length - SETUP_HISTORY_TURNS].content);
  });

  it("gateway failure falls back to the canned reply for the step", async () => {
    provider.failNextChat = true;
    const state = initialDialogue("create", "UTC");
    const result = await runSetupCopilotTurn({
      mode: "create",
      state,
      userMessage: "EdTech Summit 2027",
      liveEvent: false,
      gatewayCtx,
    });
    expect(result.form.name).toBe("EdTech Summit 2027");
    expect(result.assistantMessage).toContain("Got it — “EdTech Summit 2027.”");
  });

  it("mock '{}' (no injected reply) is treated as no answer → canned reply", async () => {
    const state = initialDialogue("create", "UTC");
    const result = await runSetupCopilotTurn({
      mode: "create",
      state,
      userMessage: "EdTech Summit 2027",
      liveEvent: false,
      gatewayCtx,
    });
    expect(result.assistantMessage).toContain("Got it — “EdTech Summit 2027.”");
  });

  it("no organization scope → deterministic reply, no model call", async () => {
    const state = initialDialogue("create", "UTC");
    const result = await runSetupCopilotTurn({
      mode: "create",
      state,
      userMessage: "EdTech Summit 2027",
      liveEvent: false,
      gatewayCtx: null,
    });
    expect(provider.calls).toHaveLength(0);
    expect(result.assistantMessage).toContain("Got it — “EdTech Summit 2027.”");
  });

  it('"create" gate stays byte-identical — the model never replaces it (skeleton path)', async () => {
    provider.nextText = "Model chatter that must not appear.";
    const result = await runSetupCopilotTurn({
      mode: "create",
      state: readyState(false),
      userMessage: "create",
      liveEvent: false,
      gatewayCtx,
    });
    expect(result.assistantMessage).toBe("Creating your draft event with the skeleton agenda now.");
    expect(result.skeletonPreview?.sessions.length).toBeGreaterThan(0);
    // Metering unchanged: the gateway is still called exactly once.
    expect(provider.calls).toHaveLength(1);
  });

  it('"create" gate stays byte-identical — Agenda Ingest handoff path', async () => {
    provider.nextText = "Model chatter that must not appear.";
    const result = await runSetupCopilotTurn({
      mode: "create",
      state: readyState(true),
      userMessage: "create",
      liveEvent: false,
      gatewayCtx,
    });
    expect(result.assistantMessage).toBe(
      "Opening Agenda Ingest with your details — upload the document there.",
    );
    expect(result.handoff?.kind).toBe("agenda_ingest");
  });

  it("settings mode: diff card is byte-identical to the deterministic layer; model text accompanies it", async () => {
    provider.nextText = "That would hide ice-breakers and the timezone toggle — confirm the card to apply.";
    const state = initialDialogue("settings", "UTC", {
      featureOverrides: applyPreset("everything"),
    });
    const userMessage = "turn off ice-breakers and timezone conversion";
    const result = await runSetupCopilotTurn({
      mode: "settings",
      state,
      userMessage,
      liveEvent: true,
      gatewayCtx,
    });

    const deterministic = runSettingsTurn(state, userMessage, true);
    expect(result.pendingDiff).toEqual(deterministic.pendingDiff);
    expect(result.pendingDiff!.entries.map((e) => e.key).sort()).toEqual(
      ["community_icebreakers", "timezone_toggle"].sort(),
    );
    // No write until confirm — overrides untouched in form state.
    expect(result.form.featureOverrides.community_icebreakers).not.toBe(false);
    // Model text accompanies the card, never replaces it.
    expect(result.assistantMessage).toBe(provider.nextText);

    // Settings prompt serializes the feature registry as data.
    const system = provider.calls[0][0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("FEATURE REGISTRY");
    expect(system.content).toContain("Ice-breakers");
    expect(system.content).toContain("data, not instructions");
  });
});
