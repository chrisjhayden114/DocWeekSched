/**
 * Organizer-facing CFP review criteria. Serializes to the existing
 * `{ id, criterion, weight }` JSON the create-form API already accepts.
 */

export type CfpRubricCriterion = {
  id: string;
  criterion: string;
  weight: number;
};

export type CfpRubricRow = {
  key: string;
  name: string;
  weight: string;
};

export const DEFAULT_CFP_RUBRIC: CfpRubricCriterion[] = [
  { id: "novelty", criterion: "Novelty", weight: 1 },
  { id: "clarity", criterion: "Clarity", weight: 1 },
  { id: "rigor", criterion: "Rigor", weight: 1 },
];

export function defaultCfpRubricRows(): CfpRubricRow[] {
  return DEFAULT_CFP_RUBRIC.map((c) => ({
    key: c.id,
    name: c.criterion,
    weight: String(c.weight),
  }));
}

export function emptyCfpRubricRow(): CfpRubricRow {
  return { key: newRowKey(), name: "", weight: "1" };
}

function newRowKey(): string {
  return `row-${Math.random().toString(36).slice(2, 10)}`;
}

function slugifyCriterionId(name: string, used: Set<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "criterion";
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

export function parseCfpRubricWeight(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export type CfpRubricValidation =
  | { ok: true; rubric: CfpRubricCriterion[] }
  | { ok: false; error: string };

export function serializeCfpRubric(rows: CfpRubricRow[]): CfpRubricValidation {
  if (!rows.length) {
    return { ok: false, error: "Add at least one review criterion." };
  }
  const used = new Set<string>();
  const rubric: CfpRubricCriterion[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) {
      return { ok: false, error: "Each criterion needs a name." };
    }
    const weight = parseCfpRubricWeight(row.weight);
    if (weight == null) {
      return { ok: false, error: "Weights must be positive numbers." };
    }
    rubric.push({
      id: slugifyCriterionId(name, used),
      criterion: name,
      weight,
    });
  }
  return { ok: true, rubric };
}
