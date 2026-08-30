import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CFP_RUBRIC,
  defaultCfpRubricRows,
  emptyCfpRubricRow,
  serializeCfpRubric,
} from "../lib/cfpRubric";

const webRoot = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(webRoot, ...parts), "utf8");

describe("K-7 — CFP review criteria", () => {
  it("defaults to the Novelty / Clarity / Rigor trio the API already uses", () => {
    expect(DEFAULT_CFP_RUBRIC).toEqual([
      { id: "novelty", criterion: "Novelty", weight: 1 },
      { id: "clarity", criterion: "Clarity", weight: 1 },
      { id: "rigor", criterion: "Rigor", weight: 1 },
    ]);
    expect(serializeCfpRubric(defaultCfpRubricRows())).toEqual({
      ok: true,
      rubric: DEFAULT_CFP_RUBRIC,
    });
  });

  it("rejects an empty list and non-positive weights", () => {
    expect(serializeCfpRubric([])).toEqual({
      ok: false,
      error: "Add at least one review criterion.",
    });
    expect(
      serializeCfpRubric([{ key: "a", name: "Novelty", weight: "0" }]),
    ).toEqual({ ok: false, error: "Weights must be positive numbers." });
    expect(
      serializeCfpRubric([{ key: "a", name: "Novelty", weight: "-2" }]),
    ).toEqual({ ok: false, error: "Weights must be positive numbers." });
    expect(
      serializeCfpRubric([{ key: "a", name: "Novelty", weight: "n/a" }]),
    ).toEqual({ ok: false, error: "Weights must be positive numbers." });
    expect(serializeCfpRubric([{ key: "a", name: "   ", weight: "1" }])).toEqual({
      ok: false,
      error: "Each criterion needs a name.",
    });
  });

  it("serializes custom rows to the existing { id, criterion, weight } shape", () => {
    const extra = emptyCfpRubricRow();
    const result = serializeCfpRubric([
      { key: "1", name: "Impact", weight: "2.5" },
      { ...extra, name: "Fit", weight: "1" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rubric).toEqual([
      { id: "impact", criterion: "Impact", weight: 2.5 },
      { id: "fit", criterion: "Fit", weight: 1 },
    ]);
  });

  it("the organizer create form has no JSON field", () => {
    const page = read("pages", "organizer", "events", "[eventId]", "cfp", "index.tsx");
    const editor = read("components", "organizer", "CfpRubricEditor.tsx");
    expect(page).toContain("CfpRubricEditor");
    expect(page).toContain("serializeCfpRubric");
    expect(page).not.toMatch(/Rubric JSON/i);
    expect(page).not.toMatch(/rubricJson/);
    expect(page).not.toMatch(/JSON\.parse/);
    expect(editor).toContain("Review criteria");
    expect(editor).toContain("Add criterion");
    expect(editor).not.toMatch(/Rubric JSON/i);
    expect(editor).not.toMatch(/textarea/i);
  });
});
