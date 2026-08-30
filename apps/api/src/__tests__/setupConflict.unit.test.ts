/**
 * W-4 (SETUP-CONFLICT) — the Setup assistant may not overwrite an answer the
 * organizer confirmed. Root cause (DESIGN_PHASE_J, J-A #3): mergeSetupExtract
 * applied any validated extract over any confirmed field, silently, on the
 * chat path and the document-upload path, and file event-dates were never
 * reconciled against the dates already set.
 */

import { describe, expect, it } from "vitest";
import {
  SETUP_FIELD_LABEL,
  confirmedSetupFields,
  emptySetupFormState,
  type SetupConflictCard,
  type SetupCopilotFormState,
} from "@event-app/shared";
import {
  applySetupConflictChoices,
  buildCreateSystemPrompt,
  buildStatePrompt,
  diffExtractAgainstConfirmed,
  initialDialogue,
  runCreateTurn,
  SETUP_SYSTEM,
  type DialogueState,
  type TurnResult,
} from "../lib/ai/setupCopilot";
import { validateExtracted, type SetupExtract } from "../lib/ai/setupCopilot/extractTypes";
import { eventDateMismatchAssumption } from "../lib/ai/ingest/extract";

const next = (turn: TurnResult): DialogueState => ({
  step: turn.step,
  form: turn.form,
  messages: turn.messages,
});

/** Name + dates answered at their own steps: both are confirmed answers. */
function answeredNameAndDates(): DialogueState {
  let turn = runCreateTurn(initialDialogue("create", "UTC"), "DocWeek 2027");
  turn = runCreateTurn(next(turn), "2027-07-20 to 2027-07-22, America/New_York");
  return next(turn);
}

function entryFor(card: SetupConflictCard | null, field: string) {
  return card?.entries.find((e) => e.field === field);
}

describe("W-4 — confirmed answers are tracked, not guessed", () => {
  it("an answer typed at its own step is confirmed; a browser-default zone is not", () => {
    let turn = runCreateTurn(initialDialogue("create", "Asia/Shanghai"), "DocWeek 2027");
    expect(confirmedSetupFields(turn.form)).toEqual(["name"]);

    // No zone in the answer — the default stays unconfirmed.
    turn = runCreateTurn(next(turn), "2027-07-20 to 2027-07-22");
    expect(confirmedSetupFields(turn.form)).toEqual(["name", "startDate", "endDate"]);
    expect(turn.form.timezone).toBe("Asia/Shanghai");

    turn = runCreateTurn(next(turn), "Hilton Midtown");
    turn = runCreateTurn(next(turn), "about 200 people");
    turn = runCreateTurn(next(turn), "conference");
    turn = runCreateTurn(next(turn), "full networking");
    turn = runCreateTurn(next(turn), "no");
    expect(confirmedSetupFields(turn.form)).toEqual([
      "name",
      "startDate",
      "endDate",
      "venueName",
      "estimatedSize",
      "eventType",
      "networkingChoice",
      "hasProgramDocument",
    ]);
  });

  it("a stated zone is confirmed; a talk-showcase size prefill is not", () => {
    let turn = runCreateTurn(initialDialogue("create", "Asia/Shanghai"), "City Talks");
    turn = runCreateTurn(next(turn), "2027-03-12, Europe/London");
    expect(confirmedSetupFields(turn.form)).toContain("timezone");

    turn = runCreateTurn(next(turn), "Town Hall");
    turn = runCreateTurn(next(turn), "80");
    turn = runCreateTurn(next(turn), "talk showcase");
    // TALK-1 prefills the cap; a default is never an organizer answer.
    expect(turn.form.estimatedSize).toBe("80");
    expect(confirmedSetupFields(turn.form)).not.toContain("networkingChoice");
  });
});

describe("W-4 — PRE-MERGE DIFF (chat path)", () => {
  it("an extract over a confirmed field asks and does NOT merge that field", () => {
    const state = answeredNameAndDates();
    const turn = runCreateTurn(state, "it's at the Hilton", {
      startDate: "2027-08-10",
      endDate: "2027-08-12",
      venueName: "Hilton Midtown",
    });

    // The confirmed dates are untouched…
    expect(turn.form.startDate).toBe("2027-07-20");
    expect(turn.form.endDate).toBe("2027-07-22");
    // …and the clash is a card, per field, current → proposed.
    expect(turn.pendingConflict).not.toBeNull();
    expect(turn.pendingConflict!.entries.map((e) => e.field)).toEqual(["startDate", "endDate"]);
    expect(entryFor(turn.pendingConflict, "startDate")).toMatchObject({
      label: SETUP_FIELD_LABEL.startDate,
      current: "2027-07-20",
      proposed: "2027-08-10",
      source: "chat",
    });
    expect(turn.pendingConflict!.proposedFields.startDate).toBe("2027-08-10");
    expect(turn.pendingConflict!.aiGenerated).toBe(true);

    // Non-conflicting fields merge as today.
    expect(turn.form.venueName).toBe("Hilton Midtown");
  });

  it("the conflict question is deterministic — the model cannot restate it", () => {
    const turn = runCreateTurn(answeredNameAndDates(), "moved it", {
      startDate: "2027-08-10",
      endDate: "2027-08-12",
    });
    expect(turn.deterministicReply).toBe(true);
    expect(turn.assistantMessage).toContain("2027-07-20 → 2027-08-10");
    expect(turn.assistantMessage).toContain("Keep mine or Use new");
    expect(turn.assistantMessage).toMatch(/have not changed/i);
    expect(turn.assistantMessage).not.toMatch(/updated|changed it to|saved/i);
    expect(turn.messages[turn.messages.length - 1].content).toBe(turn.assistantMessage);
  });

  it("unconfirmed and empty fields still merge silently", () => {
    // Dates present but never confirmed (e.g. carried in from a document).
    const form: SetupCopilotFormState = {
      ...emptySetupFormState("UTC"),
      name: "DocWeek 2027",
      startDate: "2027-07-20",
      endDate: "2027-07-22",
      confirmedFields: ["name"],
    };
    const turn = runCreateTurn(
      { step: "venue", form, messages: [] },
      "actually the 10th to the 12th of August, at the Hilton",
      { startDate: "2027-08-10", endDate: "2027-08-12", venueName: "Hilton Midtown" },
    );
    expect(turn.pendingConflict).toBeNull();
    expect(turn.form.startDate).toBe("2027-08-10");
    expect(turn.form.endDate).toBe("2027-08-12");
    expect(turn.form.venueName).toBe("Hilton Midtown");
  });

  it("an identical value is not a conflict, and never drops confirmed day hours", () => {
    const form: SetupCopilotFormState = {
      ...emptySetupFormState("UTC"),
      name: "DocWeek 2027",
      startDate: "2027-07-20T09:00",
      endDate: "2027-07-22T17:00",
      confirmedFields: ["name", "startDate", "endDate"],
    };
    const turn = runCreateTurn({ step: "venue", form, messages: [] }, "same dates, at the Hilton", {
      startDate: "2027-07-20",
      endDate: "2027-07-22",
      venueName: "Hilton Midtown",
    });
    expect(turn.pendingConflict).toBeNull();
    expect(turn.form.startDate).toBe("2027-07-20T09:00");
    expect(turn.form.endDate).toBe("2027-07-22T17:00");
  });

  it("a confirmed field that is empty has nothing to protect", () => {
    const form: SetupCopilotFormState = {
      ...emptySetupFormState("UTC"),
      name: "DocWeek 2027",
      confirmedFields: ["name", "venueName", "onlineUrl"],
    };
    const turn = runCreateTurn({ step: "venue", form, messages: [] }, "at the Hilton", {
      venueName: "Hilton Midtown",
    });
    expect(turn.pendingConflict).toBeNull();
    expect(turn.form.venueName).toBe("Hilton Midtown");
  });

  it("case and spacing alone are not a conflict", () => {
    const form: SetupCopilotFormState = {
      ...emptySetupFormState("UTC"),
      name: "DocWeek 2027",
      confirmedFields: ["name"],
    };
    const turn = runCreateTurn({ step: "venue", form, messages: [] }, "the venue is Town Hall", {
      name: "docweek  2027",
      venueName: "Town Hall",
    });
    expect(turn.pendingConflict).toBeNull();
    expect(turn.form.name).toBe("DocWeek 2027");
  });
});

describe("W-4 — date reconciliation from an ingested file", () => {
  /** The founder case: a file's event dates disagree with the event settings. */
  function uploadWithDates(): TurnResult {
    return runCreateTurn(
      answeredNameAndDates(),
      "Uploaded program.pdf",
      {
        startDate: "2027-09-01",
        endDate: "2027-09-02",
        estimatedSize: 300,
        hasProgramDocument: true,
      },
      { extractSource: "document" },
    );
  }

  it("surfaces the mismatch as a conflict instead of ignoring it", () => {
    const turn = uploadWithDates();
    expect(turn.form.startDate).toBe("2027-07-20");
    expect(turn.form.endDate).toBe("2027-07-22");
    expect(turn.pendingConflict!.entries.map((e) => e.field)).toEqual(["startDate", "endDate"]);
    expect(turn.pendingConflict!.entries[0].source).toBe("document");
    expect(turn.pendingConflict!.summary).toContain("the file you uploaded");
    // Everything the file said that does not clash still lands.
    expect(turn.form.estimatedSize).toBe("300");
    expect(turn.form.hasProgramDocument).toBe(true);
  });

  it("a file's values are proposals — they never confirm a field themselves", () => {
    const turn = uploadWithDates();
    expect(confirmedSetupFields(turn.form)).not.toContain("estimatedSize");

    // …so a second file may still refine them without an interrogation.
    const second = runCreateTurn(
      next(turn),
      "Uploaded revised.pdf",
      { estimatedSize: 320 },
      { extractSource: "document" },
    );
    expect(second.pendingConflict).toBeNull();
    expect(second.form.estimatedSize).toBe("320");
  });
});

describe("W-4 — resolution applies only what the organizer chose", () => {
  const card = (): SetupConflictCard =>
    runCreateTurn(answeredNameAndDates(), "moved it", {
      startDate: "2027-08-10",
      endDate: "2027-08-12",
    }).pendingConflict!;

  it("per-field choices apply correctly", () => {
    const state = answeredNameAndDates();
    const conflict = card();
    const { form, changes } = applySetupConflictChoices({
      form: state.form,
      card: conflict,
      choices: { startDate: "use_new", endDate: "keep" },
    });

    expect(form.startDate).toBe("2027-08-10");
    expect(form.endDate).toBe("2027-07-22");
    expect(changes).toEqual([
      {
        field: "startDate",
        label: SETUP_FIELD_LABEL.startDate,
        from: "2027-07-20",
        to: "2027-08-10",
      },
    ]);
    // The organizer picked it, so it is now their answer.
    expect(confirmedSetupFields(form)).toContain("startDate");
  });

  it("a field with no choice is kept — silence never overwrites", () => {
    const state = answeredNameAndDates();
    const { form, changes } = applySetupConflictChoices({
      form: state.form,
      card: card(),
      choices: {},
    });
    expect(form.startDate).toBe("2027-07-20");
    expect(form.endDate).toBe("2027-07-22");
    expect(changes).toEqual([]);
  });

  it("accept-all applies every row", () => {
    const state = answeredNameAndDates();
    const { form, changes } = applySetupConflictChoices({
      form: state.form,
      card: card(),
      choices: { startDate: "use_new", endDate: "use_new" },
    });
    expect(form.startDate).toBe("2027-08-10");
    expect(form.endDate).toBe("2027-08-12");
    expect(changes.map((c) => c.field)).toEqual(["startDate", "endDate"]);
  });

  it("a chosen event type brings its feature preset, as a merge would", () => {
    const base: SetupCopilotFormState = {
      ...emptySetupFormState("UTC"),
      name: "Quiet Days",
      eventType: "internal",
      estimatedSize: "120",
      confirmedFields: ["name", "eventType", "estimatedSize"],
    };
    const diff = diffExtractAgainstConfirmed({
      form: base,
      extract: validateExtracted({ eventType: "conference" } as SetupExtract),
      source: "chat",
    });
    const { form } = applySetupConflictChoices({
      form: base,
      card: diff.card!,
      choices: { eventType: "use_new" },
    });
    expect(form.eventType).toBe("conference");
    expect(form.suggestedPreset).toBe("everything");
    expect(diff.card!.entries[0]).toMatchObject({ current: "Internal", proposed: "Conference" });
  });

  it("a chosen timezone is explicit from then on", () => {
    const base: SetupCopilotFormState = {
      ...emptySetupFormState("UTC"),
      timezone: "America/New_York",
      timezoneExplicit: true,
      confirmedFields: ["timezone"],
    };
    const diff = diffExtractAgainstConfirmed({
      form: base,
      extract: validateExtracted({ timezone: "Europe/London" } as SetupExtract),
      source: "document",
    });
    const { form } = applySetupConflictChoices({
      form: base,
      card: diff.card!,
      choices: { timezone: "use_new" },
    });
    expect(form.timezone).toBe("Europe/London");
    expect(form.timezoneExplicit).toBe(true);
  });
});

describe("W-4 — agenda ingest reconciles a source's event dates", () => {
  const settings = { start: "2027-07-20", end: "2027-07-22" };

  it("a source that disagrees is surfaced, and the event's dates are kept", () => {
    const note = eventDateMismatchAssumption(
      { startDate: "2027-09-01", endDate: "2027-09-02T09:00:00Z" },
      settings,
    );
    expect(note).not.toBeNull();
    expect(note!.id).toBe("event-dates-mismatch");
    expect(note!.question).toContain("starts 2027-09-01, not 2027-07-20");
    expect(note!.question).toContain("ends 2027-09-02, not 2027-07-22");
    expect(note!.question).toContain("left as they are");
    expect(note!.appliesTo).toBe("event dates");
  });

  it("agreeing, partial, or unparsable dates raise nothing", () => {
    expect(eventDateMismatchAssumption({ startDate: "2027-07-20", endDate: "2027-07-22" }, settings)).toBeNull();
    expect(eventDateMismatchAssumption({ name: "DocWeek" }, settings)).toBeNull();
    expect(eventDateMismatchAssumption({ startDate: "next summer" }, settings)).toBeNull();
    expect(eventDateMismatchAssumption(undefined, settings)).toBeNull();
    // No event span to compare against (e.g. a source-only extract).
    expect(eventDateMismatchAssumption({ startDate: "2027-09-01" }, undefined)).toBeNull();
  });

  it("only the end date differing is reported on its own", () => {
    const note = eventDateMismatchAssumption({ startDate: "2027-07-20", endDate: "2027-07-25" }, settings);
    expect(note!.question).toContain("ends 2027-07-25, not 2027-07-22");
    expect(note!.question).not.toContain("starts");
  });
});

describe("W-4 — the assistant may not claim a withheld field was updated", () => {
  it("the system prompt forbids it and the state block lists the conflicts", () => {
    expect(SETUP_SYSTEM).toContain("Never say a conflicted field was updated");

    const turn = runCreateTurn(answeredNameAndDates(), "moved it", {
      startDate: "2027-08-10",
      endDate: "2027-08-12",
    });
    const block = buildStatePrompt(turn.form, turn.pendingConflict);
    expect(block).toContain("PENDING CONFLICTS (NOT changed — awaiting the organizer's choice):");
    expect(block).toContain("Start date: stays 2027-07-20 unless they choose 2027-08-10");
    // KNOWN SO FAR still reports the organizer's own dates.
    expect(block).toContain("Dates: 2027-07-20 to 2027-07-22");

    expect(buildCreateSystemPrompt(turn.form, turn.pendingConflict)).toContain("PENDING CONFLICTS");
    // No conflict, no block.
    expect(buildStatePrompt(turn.form, null)).not.toContain("PENDING CONFLICTS");
  });
});
