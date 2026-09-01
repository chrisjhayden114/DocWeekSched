import { describe, expect, it } from "vitest";
import { stripAssistantEmphasis } from "../lib/assistantText";
import { prepareAssistantBody } from "../lib/chatLinks";

describe("stripAssistantEmphasis", () => {
  it("strips markdown bold", () => {
    expect(stripAssistantEmphasis("See **Agenda** for the morning.")).toBe(
      "See Agenda for the morning.",
    );
    expect(stripAssistantEmphasis("**Opening keynote** is at 09:00.")).toBe(
      "Opening keynote is at 09:00.",
    );
  });

  it("strips underscore bold", () => {
    expect(stripAssistantEmphasis("The __Maps__ tab has the plan.")).toBe(
      "The Maps tab has the plan.",
    );
  });

  it("strips italics when the asterisks wrap words", () => {
    expect(stripAssistantEmphasis("Ask *Priya* at the desk.")).toBe("Ask Priya at the desk.");
    expect(stripAssistantEmphasis("*My Schedule* is the list you saved.")).toBe(
      "My Schedule is the list you saved.",
    );
  });

  it("strips mixed emphasis in one reply", () => {
    expect(
      stripAssistantEmphasis("Open **Agenda** and check *My Schedule* or __Maps__."),
    ).toBe("Open Agenda and check My Schedule or Maps.");
  });

  it("leaves code-like text alone", () => {
    expect(stripAssistantEmphasis("Use `**keep**` in the field.")).toBe(
      "Use `**keep**` in the field.",
    );
    expect(stripAssistantEmphasis("Capacity is 2 * 3 seats per table.")).toBe(
      "Capacity is 2 * 3 seats per table.",
    );
    expect(stripAssistantEmphasis("The file is speaker_notes.md.")).toBe(
      "The file is speaker_notes.md.",
    );
    expect(stripAssistantEmphasis("A lone * is not emphasis.")).toBe("A lone * is not emphasis.");
  });
});

describe("prepareAssistantBody — shared render path", () => {
  it("strips emphasis before link splitting so labels still match", () => {
    const { segments } = prepareAssistantBody("Open **Agenda** next.", [
      { label: "Agenda", href: "/dashboard?tab=Agenda" },
    ]);
    expect(segments).toEqual([
      { type: "text", text: "Open " },
      { type: "link", text: "Agenda", href: "/dashboard?tab=Agenda" },
      { type: "text", text: " next." },
    ]);
  });
});
