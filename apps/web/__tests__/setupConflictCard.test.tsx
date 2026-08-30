/**
 * @vitest-environment jsdom
 *
 * W-4 (SETUP-CONFLICT) — the organizer's side of the conflict: a per-field
 * "current → proposed" card that keeps their answer unless they choose the new
 * value, and a summary panel that highlights whatever the choice changed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SETUP_CONFIRMABLE_FIELDS,
  emptySetupFormState,
  formatSetupFieldValue,
  type SetupConflictCard,
  type SetupConflictChoices,
  type SetupFieldChange,
} from "@event-app/shared";
import { SetupConflictCardView } from "../components/SetupConflictCardView";
import {
  fieldChangeMap,
  mergeFieldChanges,
  parseSetupCopilotDraft,
  serializeSetupCopilotDraft,
  wizardFieldsToCopilotForm,
} from "../lib/setupCopilotDraft";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const webRoot = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(webRoot, ...parts), "utf8");

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

const card: SetupConflictCard = {
  title: "These answers don't match",
  summary: "2 answers you already gave disagree with the file you uploaded.",
  entries: [
    {
      field: "startDate",
      label: "Start date",
      current: "2027-07-20",
      proposed: "2027-09-01",
      source: "document",
    },
    {
      field: "estimatedSize",
      label: "Expected size",
      current: "about 200 people",
      proposed: "about 300 people",
      source: "document",
    },
  ],
  proposedFields: { startDate: "2027-09-01", estimatedSize: "300" },
  aiGenerated: true,
};

const buttons = () => [...container.querySelectorAll("button")];
const button = (label: string) => buttons().find((b) => b.textContent === label)!;
const radio = (field: string, value: string) =>
  container.querySelector<HTMLInputElement>(
    `input[name="setup-conflict-${field}"][value="${value}"]`,
  )!;

function mount(onApply: (choices: SetupConflictChoices) => void = () => {}) {
  render(<SetupConflictCardView card={card} onApply={onApply} onDismiss={() => {}} />);
}

describe("W-4 — the conflict card", () => {
  it("lists every conflict as current → proposed, with the AI label", () => {
    mount();
    expect(container.textContent).toContain("These answers don't match");
    expect(container.textContent).toContain("Start date");
    expect(container.textContent).toContain("2027-07-20 → 2027-09-01");
    expect(container.textContent).toContain("about 200 people → about 300 people");
    expect(container.querySelector(".ai-generated-chip")).not.toBeNull();
    expect(container.querySelectorAll("fieldset").length).toBe(2);
  });

  it("defaults to Keep mine on every field — nothing is pre-accepted", () => {
    let applied: SetupConflictChoices | null = null;
    mount((choices) => {
      applied = choices;
    });
    expect(radio("startDate", "keep").checked).toBe(true);
    expect(radio("startDate", "use_new").checked).toBe(false);
    expect(button("Keep my answers")).toBeDefined();

    act(() => button("Keep my answers").click());
    // Nothing chosen: the server keeps everything.
    expect(applied).toEqual({});
  });

  it("applies exactly the per-field choices the organizer made", () => {
    let applied: SetupConflictChoices | null = null;
    mount((choices) => {
      applied = choices;
    });
    act(() => radio("startDate", "use_new").click());
    expect(button("Apply 1 change")).toBeDefined();

    act(() => button("Apply 1 change").click());
    expect(applied).toEqual({ startDate: "use_new" });
  });

  it("accept-all and keep-all set every row at once", () => {
    let applied: SetupConflictChoices | null = null;
    mount((choices) => {
      applied = choices;
    });
    act(() => button("Use all new").click());
    expect(radio("estimatedSize", "use_new").checked).toBe(true);
    act(() => button("Apply 2 changes").click());
    expect(applied).toEqual({ startDate: "use_new", estimatedSize: "use_new" });

    act(() => button("Keep all mine").click());
    expect(radio("startDate", "keep").checked).toBe(true);
    act(() => button("Keep my answers").click());
    expect(applied).toEqual({ startDate: "keep", estimatedSize: "keep" });
  });
});

describe("W-4 — the assistant surfaces the card, the panel highlights the change", () => {
  it("the chat renders the conflict card and posts the choices to resolve-conflict", () => {
    const chat = read("components", "SetupCopilotChat.tsx");
    expect(chat).toContain("<SetupConflictCardView");
    expect(chat).toContain("/ai/setup-copilot/resolve-conflict");
    expect(chat).toContain("setPendingConflict(res.pendingConflict ?? null)");
    expect(chat).toContain("onFieldChanges?.(res.changes)");
  });

  it("the summary panel shows old→new for every changed field", () => {
    const page = read("pages", "organizer", "events", "new.tsx");
    expect(page).toContain("{change.label}: {change.from} → <strong>{change.to}</strong>");
    for (const field of SETUP_CONFIRMABLE_FIELDS) {
      expect(page, field).toContain(`<FieldChangeNote change={changed.${field}} />`);
    }
    expect(page).toContain("mergeFieldChanges(prev, changes)");
  });

  it("a field changed twice keeps its original old value", () => {
    const first: SetupFieldChange[] = [
      { field: "startDate", label: "Start date", from: "2027-07-20", to: "2027-09-01" },
    ];
    const second: SetupFieldChange[] = [
      { field: "startDate", label: "Start date", from: "2027-09-01", to: "2027-10-05" },
      { field: "name", label: "Event name", from: "DocWeek", to: "DocWeek 2027" },
    ];
    const merged = mergeFieldChanges(mergeFieldChanges([], first), second);
    expect(merged).toEqual([
      { field: "startDate", label: "Start date", from: "2027-07-20", to: "2027-10-05" },
      { field: "name", label: "Event name", from: "DocWeek", to: "DocWeek 2027" },
    ]);
    expect(fieldChangeMap(merged).startDate?.to).toBe("2027-10-05");
  });

  it("a change that lands back on the old value is not a change", () => {
    const there: SetupFieldChange[] = [
      { field: "name", label: "Event name", from: "A", to: "B" },
    ];
    const back: SetupFieldChange[] = [{ field: "name", label: "Event name", from: "B", to: "A" }];
    expect(mergeFieldChanges(mergeFieldChanges([], there), back)).toEqual([]);
  });
});

describe("W-4 — confirmations survive a restore", () => {
  it("keeps known confirmed fields and drops junk", () => {
    const form = {
      ...emptySetupFormState("UTC"),
      name: "DocWeek 2027",
      startDate: "2027-07-20",
      confirmedFields: ["startDate", "name"] as const,
    };
    const restored = parseSetupCopilotDraft(
      serializeSetupCopilotDraft({
        form: { ...form, confirmedFields: [...form.confirmedFields, "nonsense" as never] },
        history: [{ role: "user", content: "DocWeek 2027" }],
        savedAt: 1,
      }),
    );
    // Stored in registry order, junk dropped.
    expect(restored?.form.confirmedFields).toEqual(["name", "startDate"]);
  });

  it("what the organizer typed in the manual wizard counts as confirmed", () => {
    const seeded = wizardFieldsToCopilotForm(
      {
        name: "Harbor Meetup",
        timezone: "America/New_York",
        startDate: "2026-10-01T09:00",
        endDate: "2026-10-01T17:00",
        venueName: "Pier 4",
      },
      emptySetupFormState("UTC"),
    );
    expect(seeded.confirmedFields).toEqual([
      "name",
      "startDate",
      "endDate",
      "timezone",
      "venueName",
    ]);

    // A zone with no dates is still just the browser default.
    const zoneOnly = wizardFieldsToCopilotForm(
      { timezone: "America/New_York" },
      emptySetupFormState("UTC"),
    );
    expect(zoneOnly.confirmedFields).toEqual([]);
  });

  it("a draft saved before W-4 restores as nothing confirmed", () => {
    const restored = parseSetupCopilotDraft(
      JSON.stringify({
        v: 1,
        form: { name: "Legacy", timezone: "UTC" },
        history: [{ role: "user", content: "Legacy" }],
        savedAt: 1,
      }),
    );
    expect(restored?.form.confirmedFields).toEqual([]);
  });

  it("field values are shown, never raw enum tokens", () => {
    expect(formatSetupFieldValue("eventType", "talk_showcase")).toBe("Talk showcase");
    expect(formatSetupFieldValue("hasProgramDocument", false)).toBe("No");
    expect(formatSetupFieldValue("hasProgramDocument", null)).toBe("—");
    expect(formatSetupFieldValue("estimatedSize", "300")).toBe("about 300 people");
    expect(formatSetupFieldValue("startDate", "2027-07-20T09:00")).toBe("2027-07-20 09:00");
    expect(formatSetupFieldValue("venueName", "")).toBe("—");
  });
});
