import { CfpFormStatus, type CfpForm } from "@prisma/client";
import { HttpError } from "../authorization";

export type RubricCriterion = { id: string; criterion: string; weight: number };

export function parseRubric(raw: unknown): RubricCriterion[] {
  if (!Array.isArray(raw)) return [];
  const out: RubricCriterion[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : typeof r.criterion === "string" ? r.criterion : "";
    const criterion = typeof r.criterion === "string" ? r.criterion : "";
    const weight = typeof r.weight === "number" && Number.isFinite(r.weight) ? r.weight : 0;
    if (!id || !criterion || weight <= 0) continue;
    out.push({ id, criterion, weight });
  }
  return out;
}

/** Weighted average 1–5 across non-recused reviews; null if no scores. */
export function weightedAverage(
  rubric: RubricCriterion[],
  reviews: Array<{ scores: unknown; recusedAt: Date | null }>,
): number | null {
  if (!rubric.length) return null;
  const active = reviews.filter((r) => !r.recusedAt);
  if (!active.length) return null;
  let totalWeight = 0;
  let sum = 0;
  let any = false;
  for (const rev of active) {
    const scores = (rev.scores && typeof rev.scores === "object" ? rev.scores : {}) as Record<
      string,
      unknown
    >;
    for (const c of rubric) {
      const v = scores[c.id];
      if (typeof v !== "number" || v < 1 || v > 5) continue;
      sum += v * c.weight;
      totalWeight += c.weight;
      any = true;
    }
  }
  if (!any || totalWeight <= 0) return null;
  return Math.round((sum / totalWeight) * 1000) / 1000;
}

export function assertCfpWindowOpen(form: Pick<CfpForm, "status" | "opensAt" | "closesAt">, now = new Date()) {
  if (form.status !== CfpFormStatus.OPEN) {
    throw new HttpError(403, { error: "This call for papers is not open for submissions" });
  }
  if (now < form.opensAt) {
    throw new HttpError(403, { error: "Submissions are not open yet" });
  }
  if (now > form.closesAt) {
    throw new HttpError(403, { error: "The submission deadline has passed" });
  }
}

export function assertScoreMap(rubric: RubricCriterion[], scores: Record<string, unknown>) {
  for (const c of rubric) {
    const v = scores[c.id];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) {
      throw new HttpError(400, { error: `Score for “${c.criterion}” must be an integer from 1 to 5` });
    }
  }
}

/** Strip submitter identity for blind review responses. */
export function redactSubmitter<T extends { submitterName?: string; submitterEmail?: string }>(
  row: T,
  blind: boolean,
): T {
  if (!blind) return row;
  return { ...row, submitterName: "[hidden]", submitterEmail: "[hidden]" };
}
