import { describe, expect, it } from "vitest";
import { emptySetupFormState, type SetupCopilotFormState, type SetupCopilotMessage } from "@event-app/shared";
import {
  SETUP_COPILOT_DRAFT_STORAGE_KEY,
  SETUP_COPILOT_DRAFT_VERSION,
  clearSetupCopilotDraft,
  clearSettingsSetupCopilotDraft,
  copilotFormToWizardFields,
  copilotStepFromForm,
  hasKnownHandoffFields,
  isEmptySetupCopilotDraft,
  loadSetupCopilotDraft,
  loadSettingsSetupCopilotDraft,
  parseSetupCopilotDraft,
  saveSetupCopilotDraft,
  saveSettingsSetupCopilotDraft,
  seededOpeningMessage,
  serializeSetupCopilotDraft,
  settingsSetupCopilotStorageKey,
  toDatetimeLocal,
  wizardFieldsToCopilotForm,
  formForSetupComplete,
  restoreAiFormWithWizardEdits,
  type SetupCopilotDraft,
  type StorageLike,
} from "../lib/setupCopilotDraft";

function memoryStorage(initial?: Record<string, string>): StorageLike {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function form(overrides: Partial<SetupCopilotFormState> = {}): SetupCopilotFormState {
  return {
    ...emptySetupFormState("America/Los_Angeles"),
    name: "Coastal Ecology Symposium",
    startDate: "2026-09-10",
    endDate: "2026-09-11",
    timezone: "America/Los_Angeles",
    timezoneExplicit: true,
    venueName: "Marine Lab",
    venueAddress: "1 Shore Dr",
    onlineUrl: "",
    estimatedSize: "200",
    eventType: "conference",
    ...overrides,
  };
}

function draft(overrides: Partial<SetupCopilotDraft> = {}): SetupCopilotDraft {
  return {
    v: SETUP_COPILOT_DRAFT_VERSION,
    form: form(),
    history: [
      { role: "assistant", content: "What's the event called?", aiGenerated: true },
      { role: "user", content: "Coastal Ecology Symposium" },
    ],
    savedAt: 1_700_000_000_000,
    step: "dates",
    ...overrides,
  };
}

describe("setupCopilotDraft save/load/clear", () => {
  it("round-trips form, history, step, and savedAt", () => {
    const original = draft();
    const store = memoryStorage();
    saveSetupCopilotDraft(original, store);
    const restored = loadSetupCopilotDraft(store);
    expect(restored).toEqual({
      v: SETUP_COPILOT_DRAFT_VERSION,
      form: original.form,
      history: original.history,
      savedAt: original.savedAt,
      step: original.step,
    });
    expect(store.getItem(SETUP_COPILOT_DRAFT_STORAGE_KEY)).toBeTruthy();
  });

  it("clear removes the key so a later load is null", () => {
    const store = memoryStorage();
    saveSetupCopilotDraft(draft(), store);
    expect(loadSetupCopilotDraft(store)).not.toBeNull();
    clearSetupCopilotDraft(store);
    expect(loadSetupCopilotDraft(store)).toBeNull();
    expect(store.getItem(SETUP_COPILOT_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("does not write an empty draft (opening greeting + blank form)", () => {
    const store = memoryStorage();
    const empty = {
      form: emptySetupFormState("UTC"),
      history: [{ role: "assistant" as const, content: "What's the event called?", aiGenerated: true as const }],
      savedAt: Date.now(),
    };
    expect(isEmptySetupCopilotDraft(empty)).toBe(true);
    saveSetupCopilotDraft(empty, store);
    expect(store.getItem(SETUP_COPILOT_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("writes a draft that has known form fields even without user turns", () => {
    const store = memoryStorage();
    saveSetupCopilotDraft(
      {
        form: form(),
        history: [{ role: "assistant", content: "I have Coastal Ecology Symposium…", aiGenerated: true }],
        savedAt: 1,
      },
      store,
    );
    expect(loadSetupCopilotDraft(store)?.form.name).toBe("Coastal Ecology Symposium");
  });
});

describe("setupCopilotDraft version guard", () => {
  it("returns null for a future or missing version", () => {
    const current = serializeSetupCopilotDraft(draft());
    const v2 = current.replace(`"v":${SETUP_COPILOT_DRAFT_VERSION}`, '"v":2');
    expect(parseSetupCopilotDraft(v2)).toBeNull();
    expect(parseSetupCopilotDraft(JSON.stringify({ form: form(), history: [], savedAt: 1 }))).toBeNull();
  });

  it("returns null for missing or malformed storage", () => {
    expect(parseSetupCopilotDraft(null)).toBeNull();
    expect(parseSetupCopilotDraft("")).toBeNull();
    expect(parseSetupCopilotDraft("not json {")).toBeNull();
    expect(parseSetupCopilotDraft('"a string"')).toBeNull();
    expect(parseSetupCopilotDraft("[1,2]")).toBeNull();
  });

  it("coerces wrong-typed form fields instead of crashing", () => {
    const raw = JSON.stringify({
      v: SETUP_COPILOT_DRAFT_VERSION,
      form: { name: "Kept", startDate: 42, timezoneExplicit: "yes", featureOverrides: [1], eventType: "nope" },
      history: [{ role: "user", content: "hi" }, { role: "system", content: "drop" }, "x"],
      savedAt: "nope",
      step: "not-a-step",
    });
    const restored = parseSetupCopilotDraft(raw);
    expect(restored).not.toBeNull();
    expect(restored?.form.name).toBe("Kept");
    expect(restored?.form.startDate).toBe("");
    expect(restored?.form.timezoneExplicit).toBe(false);
    expect(restored?.form.featureOverrides).toEqual({});
    expect(restored?.form.eventType).toBe("");
    expect(restored?.history).toEqual([{ role: "user", content: "hi" }]);
    expect(restored?.savedAt).toBe(0);
    expect(restored?.step).toBeUndefined();
  });
});

describe("manual ↔ AI field mapping", () => {
  it("maps copilot form onto wizard fields including dates, place, and description", () => {
    const mapped = copilotFormToWizardFields(form(), { description: "Two days of talks." });
    expect(mapped).toEqual({
      name: "Coastal Ecology Symposium",
      timezone: "America/Los_Angeles",
      startDate: "2026-09-10T09:00",
      endDate: "2026-09-11T17:00",
      venueName: "Marine Lab",
      venueAddress: "1 Shore Dr",
      onlineUrl: "",
      description: "Two days of talks.",
      featureOverrides: {},
    });
  });

  it("falls back to estimated size when the wizard has no description", () => {
    expect(copilotFormToWizardFields(form()).description).toBe("Estimated size: ~200");
  });

  it("does not drop a datetime-local already on the copilot form", () => {
    const mapped = copilotFormToWizardFields(
      form({ startDate: "2026-09-10T08:30:00", endDate: "2026-09-11T18:00:00" }),
    );
    expect(mapped.startDate).toBe("2026-09-10T08:30");
    expect(mapped.endDate).toBe("2026-09-11T18:00");
  });

  it("seeds the copilot form from wizard fields without clearing unknowns", () => {
    const base = form({
      name: "",
      startDate: "",
      endDate: "",
      estimatedSize: "80",
      eventType: "meetup",
      networkingChoice: "focused",
    });
    const seeded = wizardFieldsToCopilotForm(
      {
        name: "Harbor Meetup",
        timezone: "America/New_York",
        startDate: "2026-10-01T09:00",
        endDate: "2026-10-01T17:00",
        venueName: "Pier 4",
        venueAddress: "",
        onlineUrl: "https://meet.example",
      },
      base,
    );
    expect(seeded.name).toBe("Harbor Meetup");
    expect(seeded.timezone).toBe("America/New_York");
    expect(seeded.timezoneExplicit).toBe(true);
    expect(seeded.startDate).toBe("2026-10-01T09:00");
    expect(seeded.endDate).toBe("2026-10-01T17:00");
    expect(seeded.venueName).toBe("Pier 4");
    expect(seeded.onlineUrl).toBe("https://meet.example");
    expect(seeded.estimatedSize).toBe("80");
    expect(seeded.eventType).toBe("meetup");
    expect(seeded.networkingChoice).toBe("focused");
  });

  it("never overwrites a filled copilot field with a blank wizard value", () => {
    const seeded = wizardFieldsToCopilotForm({ name: "  ", venueName: "" }, form());
    expect(seeded.name).toBe("Coastal Ecology Symposium");
    expect(seeded.venueName).toBe("Marine Lab");
  });

  it("toDatetimeLocal pads a date-only value and trims a full ISO", () => {
    expect(toDatetimeLocal("2026-09-10")).toBe("2026-09-10T09:00");
    expect(toDatetimeLocal("2026-09-10", "17:00")).toBe("2026-09-10T17:00");
    expect(toDatetimeLocal("2026-09-10T14:05:33.000Z")).toBe("2026-09-10T14:05");
    expect(toDatetimeLocal("")).toBe("");
  });

  it("round-trips the shared handoff fields", () => {
    const original = form({ onlineUrl: "https://live.example" });
    const wizard = copilotFormToWizardFields(original, { description: "Keep me" });
    const back = wizardFieldsToCopilotForm(wizard, emptySetupFormState("UTC"));
    expect(back.name).toBe(original.name);
    expect(back.timezone).toBe(original.timezone);
    expect(back.startDate).toBe(wizard.startDate);
    expect(back.endDate).toBe(wizard.endDate);
    expect(back.venueName).toBe(original.venueName);
    expect(back.venueAddress).toBe(original.venueAddress);
    expect(back.onlineUrl).toBe(original.onlineUrl);
  });
});

describe("W-5 — field-wise wizard→AI restore", () => {
  it("keeps a wizard-edited field and leaves untouched AI fields alone", () => {
    const ai = form({
      name: "Coastal Ecology Symposium",
      venueName: "Marine Lab",
      startDate: "2026-09-10T08:30",
      endDate: "2026-09-11T18:00",
      confirmedFields: ["name", "venueName", "startDate", "endDate"],
    });
    const handoff = copilotFormToWizardFields(ai);
    const restored = restoreAiFormWithWizardEdits(
      ai,
      { ...handoff, name: "Harbor Symposium" },
      handoff,
    );
    expect(restored.name).toBe("Harbor Symposium");
    expect(restored.venueName).toBe("Marine Lab");
    expect(restored.startDate).toBe("2026-09-10T08:30");
    expect(restored.endDate).toBe("2026-09-11T18:00");
    expect(restored.confirmedFields).toContain("name");
  });

  it("does not let a leftover wizard without matching handoff values clobber AI via equal fields", () => {
    const ai = form({ name: "AI Draft Name", venueName: "Hall A" });
    const handoff = copilotFormToWizardFields(ai);
    // Same as the handoff — not an edit after the AI draft.
    const restored = restoreAiFormWithWizardEdits(ai, handoff, handoff);
    expect(restored.name).toBe("AI Draft Name");
    expect(restored.venueName).toBe("Hall A");
  });
});

describe("W-5 — day times survive completion", () => {
  it("does not slice extracted day start/end times off the complete payload", () => {
    const ai = form({
      name: "Doc Day",
      startDate: "2026-12-01T08:30",
      endDate: "2026-12-05T18:00",
    });
    const payload = formForSetupComplete(ai, {
      name: "",
      timezone: ai.timezone,
      startDate: "2026-12-01T08:30",
      endDate: "2026-12-05T18:00",
      venueName: ai.venueName,
      venueAddress: ai.venueAddress,
      onlineUrl: ai.onlineUrl,
      featureOverrides: ai.featureOverrides,
    });
    expect(payload.startDate).toBe("2026-12-01T08:30");
    expect(payload.endDate).toBe("2026-12-05T18:00");
    expect(payload.startDate).not.toBe(payload.startDate.slice(0, 10));
  });
});

describe("seeded opening + step", () => {
  it("greets with known fields and lists what is still needed", () => {
    const message = seededOpeningMessage(
      form({ estimatedSize: "", eventType: "", networkingChoice: null, hasProgramDocument: null }),
    );
    expect(message).toContain("I have Coastal Ecology Symposium, 2026-09-10–2026-09-11, America/Los_Angeles, Marine Lab");
    expect(message).toContain("still needed: size, type, networking, program document");
  });

  it("treats a wizard-only name as known so Manual → AI does not start from zero", () => {
    const partial = emptySetupFormState("UTC");
    partial.name = "Harbor Meetup";
    expect(hasKnownHandoffFields(partial)).toBe(true);
    expect(seededOpeningMessage(partial)).toMatch(/^I have Harbor Meetup… still needed:/);
    expect(copilotStepFromForm(partial)).toBe("dates");
  });

  it("hasKnownHandoffFields is false for a blank form", () => {
    expect(hasKnownHandoffFields(emptySetupFormState("UTC"))).toBe(false);
  });
});

describe("history typing", () => {
  it("keeps assistant and user messages and drops anything else", () => {
    const history: SetupCopilotMessage[] = [
      { role: "assistant", content: "Hello", aiGenerated: true },
      { role: "user", content: "Hi" },
    ];
    const restored = parseSetupCopilotDraft(serializeSetupCopilotDraft(draft({ history })));
    expect(restored?.history).toEqual(history);
  });
});

describe("AGENT-3.1 settings transcript keyed by eventId", () => {
  it("stores event A and event B under distinct keys; A is invisible when loading B", () => {
    const store = memoryStorage();
    const historyA: SetupCopilotMessage[] = [
      { role: "assistant", content: "How can I help with Test60Second?", aiGenerated: true },
      { role: "user", content: "What is left to go live?" },
      {
        role: "assistant",
        content: "Share /e/test60second once you publish.",
        aiGenerated: true,
      },
    ];
    const historyB: SetupCopilotMessage[] = [
      { role: "assistant", content: "How can I help with DocWeek?", aiGenerated: true },
      { role: "user", content: "What is left?" },
    ];
    saveSettingsSetupCopilotDraft(
      "evt_a",
      { form: form({ name: "Test60Second" }), history: historyA, savedAt: 1, step: "settings_chat" },
      store,
    );
    saveSettingsSetupCopilotDraft(
      "evt_b",
      { form: form({ name: "EDL DocWeek 2026" }), history: historyB, savedAt: 2, step: "settings_chat" },
      store,
    );

    expect(store.getItem(settingsSetupCopilotStorageKey("evt_a"))).toBeTruthy();
    expect(store.getItem(settingsSetupCopilotStorageKey("evt_b"))).toBeTruthy();
    expect(store.getItem(SETUP_COPILOT_DRAFT_STORAGE_KEY)).toBeNull();

    const loadedB = loadSettingsSetupCopilotDraft("evt_b", store);
    expect(loadedB?.history).toEqual(historyB);
    expect(loadedB?.history.some((m) => /test60second/i.test(m.content))).toBe(false);

    const loadedA = loadSettingsSetupCopilotDraft("evt_a", store);
    expect(loadedA?.history.some((m) => /test60second/i.test(m.content))).toBe(true);
  });

  it("does not touch the create-mode draft key", () => {
    const store = memoryStorage();
    saveSetupCopilotDraft(draft(), store);
    saveSettingsSetupCopilotDraft(
      "evt_x",
      {
        form: form({ name: "Settings Only" }),
        history: [
          { role: "assistant", content: "Hi", aiGenerated: true },
          { role: "user", content: "go live?" },
        ],
        savedAt: 1,
        step: "settings_chat",
      },
      store,
    );
    expect(loadSetupCopilotDraft(store)?.form.name).toBe("Coastal Ecology Symposium");
    clearSettingsSetupCopilotDraft("evt_x", store);
    expect(loadSetupCopilotDraft(store)?.form.name).toBe("Coastal Ecology Symposium");
    expect(loadSettingsSetupCopilotDraft("evt_x", store)).toBeNull();
  });

  it("skips persisting an opening-only settings transcript", () => {
    const store = memoryStorage();
    saveSettingsSetupCopilotDraft(
      "evt_empty",
      {
        form: form({ name: "DocWeek" }),
        history: [{ role: "assistant", content: "How can I help?", aiGenerated: true }],
        savedAt: 1,
        step: "settings_chat",
      },
      store,
    );
    expect(store.getItem(settingsSetupCopilotStorageKey("evt_empty"))).toBeNull();
  });
});
