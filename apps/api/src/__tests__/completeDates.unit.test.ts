import { describe, expect, it } from "vitest";
import { emptySetupFormState } from "@event-app/shared";
import { eventBoundsFromSetupForm } from "../lib/ai/setupCopilot/completeDates";

describe("W-5 — extracted day times become the event bounds", () => {
  it("keeps HH:mm from startDate/endDate instead of defaulting 09:00–17:00", () => {
    const form = {
      ...emptySetupFormState("UTC"),
      name: "Doc Day",
      startDate: "2026-12-01T08:30",
      endDate: "2026-12-05T18:00",
    };
    const { start, end } = eventBoundsFromSetupForm(form);
    expect(start.getHours()).toBe(8);
    expect(start.getMinutes()).toBe(30);
    expect(end.getHours()).toBe(18);
    expect(end.getMinutes()).toBe(0);
    expect(start.getDate()).toBe(1);
    expect(end.getDate()).toBe(5);
  });

  it("date-only values still default to 09:00 / 17:00", () => {
    const form = {
      ...emptySetupFormState("UTC"),
      startDate: "2026-12-01",
      endDate: "2026-12-05",
    };
    const { start, end } = eventBoundsFromSetupForm(form);
    expect(start.getHours()).toBe(9);
    expect(end.getHours()).toBe(17);
  });
});
