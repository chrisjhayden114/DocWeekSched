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
  runCreateTurn,
  runSettingsTurn,
  parseFeatureRequests,
  parseEventType,
  buildSkeleton,
} from "../lib/ai/setupCopilot";

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

  it("configureFeatures tool cannot set keys absent from the registry", () => {
    expect(() => assertRegistryKeys({ not_a_real_feature: false })).toThrow(UnknownFeatureKeyError);
    expect(() => assertRegistryKeys({ community_icebreakers: false })).not.toThrow();
  });

  it("academic type maps to Academic preset", () => {
    expect(parseEventType("academic program")).toBe("academic_program");
    expect(EVENT_TYPE_PRESET.academic_program).toBe("academic");
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
