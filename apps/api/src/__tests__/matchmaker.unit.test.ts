import { describe, expect, it } from "vitest";
import { MockAiProvider } from "../lib/ai/providers/mock";
import {
  buildProfileSourceText,
  cosineSimilarity,
  hashSourceText,
} from "../lib/ai/matchmaker/embedding";
import { intervalsOverlap, pickMutuallyFreeSlots } from "../lib/ai/matchmaker/freeSlots";
import { weeklyBatchKey } from "../lib/ai/matchmaker/batch";
import { resolveEntitlement, planDefinitionForTier } from "@event-app/shared";
import { FEATURE_BY_KEY, getOrganizerVisibleFeatures } from "@event-app/shared";

describe("matchmaker unit", () => {
  it("MOCK embed is deterministic for the same text", async () => {
    const p = new MockAiProvider();
    const a = await p.embed("Bayesian causal inference in education");
    const b = await p.embed("Bayesian causal inference in education");
    expect(a.vector).toEqual(b.vector);
    expect(a.dimensions).toBe(32);
    expect(a.provider).toBe("mock");
  });

  it("cosine ranks similar interests higher than unrelated", async () => {
    const p = new MockAiProvider();
    const me = await p.embed("qualitative research methods doctoral education leadership");
    const similar = await p.embed("qualitative methods in doctoral education programs");
    const unrelated = await p.embed("satellite orbital mechanics and thruster design");
    expect(cosineSimilarity(me.vector, similar.vector)).toBeGreaterThan(
      cosineSimilarity(me.vector, unrelated.vector),
    );
  });

  it("sourceHash changes when profile text changes", () => {
    const a = buildProfileSourceText({ researchInterests: "NLP" });
    const b = buildProfileSourceText({ researchInterests: "computer vision" });
    expect(hashSourceText(a)).not.toBe(hashSourceText(b));
  });

  it("pickMutuallyFreeSlots only returns slots free for both", () => {
    const windowStart = new Date("2027-06-01T14:00:00Z");
    const windowEnd = new Date("2027-06-01T18:00:00Z");
    const busyA = [{ startsAt: new Date("2027-06-01T14:00:00Z"), endsAt: new Date("2027-06-01T15:00:00Z") }];
    const busyB = [{ startsAt: new Date("2027-06-01T15:30:00Z"), endsAt: new Date("2027-06-01T16:30:00Z") }];
    const slots = pickMutuallyFreeSlots({
      windowStart,
      windowEnd,
      busyA,
      busyB,
      count: 2,
      slotMinutes: 30,
    });
    expect(slots.length).toBe(2);
    for (const s of slots) {
      expect(intervalsOverlap(s.startsAt, s.endsAt, busyA[0]!.startsAt, busyA[0]!.endsAt)).toBe(false);
      expect(intervalsOverlap(s.startsAt, s.endsAt, busyB[0]!.startsAt, busyB[0]!.endsAt)).toBe(false);
    }
  });

  it("weeklyBatchKey is stable within the same ISO week", () => {
    expect(weeklyBatchKey(new Date("2026-07-15T12:00:00Z"))).toBe(
      weeklyBatchKey(new Date("2026-07-16T12:00:00Z")),
    );
  });

  it("matchmaker is paid-tier entitled (PER_EVENT/PRO) and visible in registry", () => {
    expect(resolveEntitlement(planDefinitionForTier("FREE"), "matchmaker")).toBe(false);
    expect(resolveEntitlement(planDefinitionForTier("PER_EVENT"), "matchmaker")).toBe(true);
    expect(resolveEntitlement(planDefinitionForTier("PRO"), "matchmaker")).toBe(true);
    expect(FEATURE_BY_KEY.matchmaker.plannedPhase).toBeUndefined();
    expect(getOrganizerVisibleFeatures().some((f) => f.key === "matchmaker")).toBe(true);
  });
});
