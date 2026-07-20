import { describe, expect, it } from "vitest";
import {
  applyMergeFields,
  assertCfpWindowOpen,
  parseRubric,
  redactSubmitter,
  weightedAverage,
} from "../lib/cfp";
import { CfpFormStatus } from "@prisma/client";
import { HttpError } from "../lib/authorization";
import { FEATURE_BY_KEY, resolveFeatureEnabled } from "@event-app/shared";

describe("CFP scoring & window (unit)", () => {
  const rubric = parseRubric([
    { id: "novelty", criterion: "Novelty", weight: 2 },
    { id: "clarity", criterion: "Clarity", weight: 1 },
  ]);

  it("registers cfp feature key", () => {
    expect(FEATURE_BY_KEY.cfp.key).toBe("cfp");
    expect(resolveFeatureEnabled("cfp", {})).toBe(false);
    expect(resolveFeatureEnabled("cfp", { cfp: true })).toBe(true);
  });

  it("computes weighted average across reviews", () => {
    const avg = weightedAverage(rubric, [
      { scores: { novelty: 5, clarity: 4 }, recusedAt: null },
      { scores: { novelty: 3, clarity: 3 }, recusedAt: null },
    ]);
    // ((5*2+4*1) + (3*2+3*1)) / (3+3) = (14+9)/6 = 3.833
    expect(avg).toBeCloseTo(3.833, 2);
  });

  it("ignores recused reviews", () => {
    const avg = weightedAverage(rubric, [
      { scores: { novelty: 5, clarity: 5 }, recusedAt: new Date() },
      { scores: { novelty: 2, clarity: 2 }, recusedAt: null },
    ]);
    expect(avg).toBe(2);
  });

  it("enforces close date server-side", () => {
    const form = {
      status: CfpFormStatus.OPEN,
      opensAt: new Date("2020-01-01T00:00:00Z"),
      closesAt: new Date("2020-01-02T00:00:00Z"),
    };
    expect(() => assertCfpWindowOpen(form, new Date("2020-01-03T00:00:00Z"))).toThrow(HttpError);
    expect(() => assertCfpWindowOpen(form, new Date("2020-01-01T12:00:00Z"))).not.toThrow();
  });

  it("redacts submitter identity in blind mode", () => {
    const row = { submitterName: "Ada", submitterEmail: "ada@example.com", title: "Paper" };
    const blinded = redactSubmitter(row, true);
    expect(blinded.submitterName).toBe("[hidden]");
    expect(blinded.submitterEmail).toBe("[hidden]");
    expect(redactSubmitter(row, false).submitterEmail).toBe("ada@example.com");
  });

  it("applies merge fields for decision emails", () => {
    expect(applyMergeFields("Hi {{submitterName}} — {{title}}", { submitterName: "Ada", title: "X" })).toBe(
      "Hi Ada — X",
    );
  });
});
