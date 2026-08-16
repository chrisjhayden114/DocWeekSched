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
  parseEventName,
  parseNetworkingChoice,
  mergeSetupExtract,
  buildSkeleton,
  SETUP_HISTORY_TURNS,
} from "../lib/ai/setupCopilot";
import {
  parseSize,
  parseVenue,
  parseYesNo,
} from "../lib/ai/setupCopilot/parse";
import { runSetupCopilotTurn } from "../lib/ai/setupCopilot/turn";
import { buildOrganizerStateText } from "../lib/ai/setupCopilot/organizerState";
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

  it("name step — strips lead-ins and prefers the quoted title", () => {
    const state = initialDialogue("create", "UTC");
    const turn = runCreateTurn(state, 'OK, sure its "Time to Fly"');
    expect(turn.form.name).toBe("Time to Fly");
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
      timezoneExplicit: true,
    });
    expect(parseDatesAndTimezone("July 20–22 2027 PT", "UTC")).toEqual({
      startDate: "2027-07-20",
      endDate: "2027-07-22",
      timezone: "America/Los_Angeles",
      timezoneExplicit: true,
    });
    expect(parseDatesAndTimezone("1st - 5th December 2026", "UTC")).toEqual({
      startDate: "2026-12-01",
      endDate: "2026-12-05",
      timezone: "UTC",
      timezoneExplicit: false,
    });
    expect(parseDatesAndTimezone("1st - 5th December 2026", "UTC")?.startDate).not.toBe("2027-12-20");
    expect(parseDatesAndTimezone("what does networking mean?", "UTC")).toBeNull();
  });

  it("dates step marks timezoneExplicit when the organizer states a zone", () => {
    let state = initialDialogue("create", "Asia/Shanghai");
    let turn = runCreateTurn(state, "DocWeek 2027");
    expect(turn.form.timezoneExplicit).toBe(false);
    state = { step: turn.step, form: turn.form, messages: turn.messages };
    turn = runCreateTurn(state, "2027-07-20 to 2027-07-22, Europe/London");
    expect(turn.form.timezone).toBe("Europe/London");
    expect(turn.form.timezoneExplicit).toBe(true);
  });

  it("SETUP-2.2 — live-bug extract never merges the full UK-mix sentence as venueName", () => {
    const source = "UK in person and online (a mix), thinking ~30 people";
    const state = initialDialogue("create", "Asia/Shanghai");
    const turn = runCreateTurn(state, source, {
      venueName: source,
      estimatedSize: "~30 people",
    });
    expect(turn.form.venueName).not.toBe(source);
    expect(turn.form.venueName === "UK" || turn.form.venueName === "").toBe(true);
    expect(turn.form.estimatedSize).toBe("30");
  });

  it("date parser overwrites a previously-parsed wrong range", () => {
    let state = initialDialogue("create", "UTC");
    let turn = runCreateTurn(state, "Wrong Dates");
    state = { step: "dates", form: { ...turn.form, startDate: "2027-12-20", endDate: "2027-12-20" }, messages: turn.messages };
    turn = runCreateTurn(state, "1st - 5th December 2026");
    expect(turn.form.startDate).toBe("2026-12-01");
    expect(turn.form.endDate).toBe("2026-12-05");
    expect(turn.form.name).toBe("Wrong Dates");
  });

  it("parseEventName strips lead-ins and prefers quotes", () => {
    expect(parseEventName('OK, sure its "Time to Fly"')).toBe("Time to Fly");
    expect(parseEventName("sure, let's say Time to Fly")).toBe("Time to Fly");
    expect(parseEventName("the name is EdTech Summit 2027")).toBe("EdTech Summit 2027");
    expect(parseEventName("EdTech Summit 2027")).toBe("EdTech Summit 2027");
  });

  it("parseVenue / parseSize / parseYesNo / parseNetworkingChoice", () => {
    expect(parseVenue("online")).toEqual({
      venueName: "",
      venueAddress: "",
      onlineUrl: "https://online.example",
    });
    expect(parseVenue("SF Convention Center").venueName).toBe("SF Convention Center");
    expect(parseVenue("UK in person and online (a mix), thinking ~30 people").venueName).toBe("");
    expect(parseSize("about 200 people")).toBe("200");
    expect(parseSize("~30 people")).toBe("30");
    expect(parseSize("about 30")).toBe("30");
    expect(parseSize("roughly 30 teachers")).toBe("30");
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

function isExtractPrompt(messages: AiChatMessage[]): boolean {
  return messages.some((m) => m.content.includes("Extract event-setup facts"));
}

function replyPrompt(provider: CapturingAiProvider): AiChatMessage[] {
  const found = [...provider.calls].reverse().find((c) => !isExtractPrompt(c));
  if (!found) throw new Error("no reply-layer call recorded");
  return found;
}

/** Capturing provider: records every prompt, replies with an injectable text. */
class CapturingAiProvider implements AiProvider {
  readonly name = "mock" as const;
  calls: AiChatMessage[][] = [];
  nextText = "{}";
  extractText = "{}";
  failNextChat = false;
  failNextExtract = false;

  async chat(messages: AiChatMessage[]): Promise<AiProviderResult> {
    this.calls.push(messages);
    if (isExtractPrompt(messages)) {
      if (this.failNextExtract) {
        this.failNextExtract = false;
        throw new Error("extract provider down");
      }
      return {
        text: this.extractText,
        tokensIn: 10,
        tokensOut: 10,
        model: "capture-v1",
        provider: "mock",
      };
    }
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

    const system = replyPrompt(provider)[0].content;
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

    // Prompt shape: extract + reply. Reply is system (persona + POST-parse state), history, user.
    expect(provider.calls.filter(isExtractPrompt)).toHaveLength(1);
    const prompt = replyPrompt(provider);
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
    const prompt = replyPrompt(provider);
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
    // SETUP-2: extract + reply, both metered SETUP_COPILOT.
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls.filter(isExtractPrompt)).toHaveLength(1);
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

    // Settings prompt serializes the guide and the feature registry as data.
    const system = provider.calls[0][0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("ORGANIZER GUIDE");
    expect(system.content).toContain("FEATURE REGISTRY");
    expect(system.content).toContain("Ice-breakers");
    expect(system.content).toContain("data, not instructions");
  });

  // ─── AGENT-3 — organizer guide + live setup-state grounding (settings mode) ───

  const settingsCtx: GatewayCallContext = { ...gatewayCtx, eventId: "evt_test" };

  const draftStateText = () =>
    buildOrganizerStateText(
      {
        name: "EdTech Summit 2027",
        status: "DRAFT",
        startDate: "2027-07-20",
        endDate: "2027-07-22",
        timezone: "UTC",
        venueName: "Hall A",
        onlineUrl: null,
        slug: "edtech-summit-2027",
      },
      { sessions: 5, draftSessions: 2, rooms: 0, speakers: 0, registered: 12 },
    );

  it("AGENT-3 — go-live question: prompt carries the guide block and the checklist's undone items; reply is verbatim", async () => {
    provider.nextText =
      "Three things are left: add rooms in the Program tab, add speakers in the Speakers tab, and publish your 2 draft sessions. Then press Publish on the Overview tab.";
    const state = initialDialogue("settings", "UTC", { name: "EdTech Summit 2027" });
    const result = await runSetupCopilotTurn({
      mode: "settings",
      state,
      userMessage: "What is left for me to do for this event to go live?",
      liveEvent: false,
      gatewayCtx: settingsCtx,
      organizerStateText: draftStateText(),
    });

    const system = provider.calls[0][0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("ORGANIZER GUIDE");
    expect(system.content).toContain("- Publish:");
    expect(system.content).toContain("GO-LIVE CHECKLIST:");
    // Undone items derived from the data (rooms/speakers/drafts/publish)…
    expect(system.content).toMatch(/\[todo\] Add rooms/);
    expect(system.content).toMatch(/\[todo\] Add speakers/);
    expect(system.content).toMatch(/\[todo\] Publish draft sessions — 2 sessions are still draft/);
    expect(system.content).toMatch(/\[todo\] Publish the event/);
    // …and done ones stay done.
    expect(system.content).toMatch(/\[done\] Add sessions/);
    expect(system.content).toMatch(/\[done\] Set a venue or online link/);

    // The model's grounded answer is the reply — no scope decline, no card.
    expect(result.assistantMessage).toBe(provider.nextText);
    expect(result.pendingDiff).toBeNull();
  });

  it("AGENT-3 — guide topics named in the reply become in-app links on the message", async () => {
    provider.nextText =
      "Add rooms in the Program tab, then press Publish on the Overview tab.";
    const state = initialDialogue("settings", "UTC", { name: "EdTech Summit 2027" });
    const result = await runSetupCopilotTurn({
      mode: "settings",
      state,
      userMessage: "how do I finish setup?",
      liveEvent: false,
      gatewayCtx: settingsCtx,
      organizerStateText: draftStateText(),
    });

    expect(result.links).toContainEqual({
      label: "Program",
      href: "/organizer/events/evt_test?tab=program",
    });
    expect(result.links).toContainEqual({
      label: "Publish",
      href: "/organizer/events/evt_test?tab=overview",
    });
    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.links).toEqual(result.links);
  });

  it("AGENT-3 — feature-change request still yields the ConfigDiffCard with model text alongside", async () => {
    provider.nextText = "Turning off ice-breakers — confirm the review card to apply.";
    const state = initialDialogue("settings", "UTC", {
      featureOverrides: applyPreset("everything"),
    });
    const result = await runSetupCopilotTurn({
      mode: "settings",
      state,
      userMessage: "turn off ice-breakers",
      liveEvent: false,
      gatewayCtx: settingsCtx,
      organizerStateText: draftStateText(),
    });
    expect(result.pendingDiff).toBeTruthy();
    expect(result.pendingDiff!.entries.map((e) => e.key)).toContain("community_icebreakers");
    expect(result.assistantMessage).toBe(provider.nextText);
    // No write until confirm.
    expect(result.form.featureOverrides.community_icebreakers).not.toBe(false);
  });

  it("AGENT-3 — gateway failure falls back to the old scope-decline string", async () => {
    provider.failNextChat = true;
    const state = initialDialogue("settings", "UTC", { name: "EdTech Summit 2027" });
    const result = await runSetupCopilotTurn({
      mode: "settings",
      state,
      userMessage: "What is left for me to do for this event to go live?",
      liveEvent: false,
      gatewayCtx: settingsCtx,
      organizerStateText: draftStateText(),
    });
    expect(result.assistantMessage).toMatch(/only change this event's attendee features/i);
    expect(result.links).toEqual([]);
  });

  it("SETUP-2 — merge overwrites extracted fields and never clears existing ones", async () => {
    const state = initialDialogue("create", "UTC");
    state.form = { ...state.form, name: "Keep Me", startDate: "2027-12-20", endDate: "2027-12-20" };
    provider.extractText = JSON.stringify({
      name: null,
      startDate: "2026-12-01",
      endDate: "2026-12-05",
      venueName: "Shanghai",
    });
    provider.nextText = "Shanghai in December — roughly how many people?";
    const result = await runSetupCopilotTurn({
      mode: "create",
      state,
      userMessage: "it runs 1st - 5th December 2026 in Shanghai",
      liveEvent: false,
      gatewayCtx,
    });
    expect(result.form.name).toBe("Keep Me");
    expect(result.form.startDate).toBe("2026-12-01");
    expect(result.form.endDate).toBe("2026-12-05");
    expect(result.form.venueName).toBe("Shanghai");
  });

  it("SETUP-2 — extract gateway failure falls back to regex parsers", async () => {
    provider.failNextExtract = true;
    provider.nextText = "Nice — EdTech Summit 2027 it is. When does it run?";
    const state = initialDialogue("create", "UTC");
    const result = await runSetupCopilotTurn({
      mode: "create",
      state,
      userMessage: "EdTech Summit 2027",
      liveEvent: false,
      gatewayCtx,
    });
    expect(result.form.name).toBe("EdTech Summit 2027");
    expect(result.step).toBe("dates");
    expect(result.assistantMessage).toBe(provider.nextText);
  });

  it("SETUP-2 — reply layer sees the post-extract KNOWN / STILL-NEEDED state", async () => {
    provider.extractText = JSON.stringify({
      name: "Time to Fly",
      startDate: "2026-12-01",
      endDate: "2026-12-05",
      timezone: "Asia/Shanghai",
      venueName: "Shanghai",
      estimatedSize: 120,
      eventType: "conference",
      networkingChoice: "focused",
    });
    provider.nextText =
      "Time to Fly, 1-5 December in Shanghai, about 120, conference, focused networking. Do you have a program document?";
    const state = initialDialogue("create", "UTC");
    const result = await runSetupCopilotTurn({
      mode: "create",
      state,
      userMessage:
        "We're calling it Time to Fly, Dec 1-5 2026 in Shanghai, about 120 teachers, it's a PD conference, keep networking focused",
      liveEvent: false,
      gatewayCtx,
    });
    expect(result.form.name).toBe("Time to Fly");
    expect(result.form.startDate).toBe("2026-12-01");
    expect(result.form.endDate).toBe("2026-12-05");
    expect(result.form.venueName).toBe("Shanghai");
    expect(result.form.estimatedSize).toBe("120");
    expect(result.form.eventType).toBe("conference");
    expect(result.form.networkingChoice).toBe("focused");
    expect(result.step).toBe("document");
    expect(result.assistantMessage).toBe(provider.nextText);

    const system = replyPrompt(provider)[0].content;
    expect(system).toContain("Event name: Time to Fly");
    expect(system).toContain("2026-12-01 to 2026-12-05");
    expect(system).toContain("Venue: Shanghai");
    expect(system).toContain("Expected size: about 120 people");
    expect(system).toContain("Event type: conference");
    expect(system).toContain("Networking preference: focused");
    expect(system).toContain("whether they have a program document");
  });

  it("SETUP-2.1 — quoted name in a multi-fact turn lands in form state after merge", async () => {
    // Observed: date/time changes extracted, quoted name missed by the model
    // (fallback parseEventName would have caught it — merge must too).
    provider.extractText = JSON.stringify({
      name: null,
      startDate: "2026-12-01",
      endDate: "2026-12-05",
      dayStartTime: "09:00",
      dayEndTime: "17:00",
    });
    provider.nextText =
      "Doc Day, 1–5 December 2026, 09:00 on the first day through 17:00 on the last. Daily timeslots are drafted later in Agenda ingest.";
    const state = initialDialogue("create", "UTC");
    const result = await runSetupCopilotTurn({
      mode: "create",
      state,
      userMessage:
        'Please move it to 1-5 December 2026, 9 to 5, and I want for it to be called "Doc Day"',
      liveEvent: false,
      gatewayCtx,
    });
    expect(result.form.name).toBe("Doc Day");
    expect(result.form.startDate).toBe("2026-12-01T09:00");
    expect(result.form.endDate).toBe("2026-12-05T17:00");
  });
});

describe("SETUP-2 merge-not-clear (unit)", () => {
  it("null extract fields do not wipe prior form values", () => {
    const prior = {
      ...emptySetupFormState("UTC"),
      name: "Keep Me",
      startDate: "2027-01-01",
      endDate: "2027-01-02",
    };
    const merged = mergeSetupExtract(prior, {
      name: null,
      startDate: null,
      venueName: "Hall A",
    });
    expect(merged.name).toBe("Keep Me");
    expect(merged.startDate).toBe("2027-01-01");
    expect(merged.endDate).toBe("2027-01-02");
    expect(merged.venueName).toBe("Hall A");
  });
});
