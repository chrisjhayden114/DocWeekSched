import { describe, expect, it } from "vitest";
import {
  FEATURE_BY_KEY,
  FEATURE_PRESETS,
  getOrganizerVisibleFeatures,
  resolveFeatureEnabled,
} from "../lib/features/registry";
import {
  PLAN_CATALOG,
  PLAN_BY_SKU,
  resolveEntitlement,
} from "@event-app/shared";
import {
  deriveAssignmentState,
  rollupSubject,
  type AssignmentForDerivation,
  type StoredReadinessStatus,
} from "../lib/readiness/status";

/**
 * ER-GA (founder decision 2026-08-26) — Speaker Readiness is generally
 * available: a normal organizer toggle, entitled on every tier, still off
 * until the organizer switches it on. Free is capped by presenter count.
 */
describe("readiness feature key (ER-GA)", () => {
  it("is registered, off by default, and no longer phase-gated", () => {
    const def = FEATURE_BY_KEY.readiness;
    expect(def).toBeDefined();
    expect(def.defaultOn).toBe(false);
    expect(def.plannedPhase).toBeUndefined();
    expect(def.retired).toBeUndefined();
  });

  it("is a normal toggle on the organizer Features tab and wizard", () => {
    const visible = getOrganizerVisibleFeatures();
    expect(visible.some((f) => f.key === "readiness")).toBe(true);
  });

  it("resolves off until the organizer enables it, and honors the plan gate", () => {
    expect(resolveFeatureEnabled("readiness", {})).toBe(false);
    // Organizer override alone is not enough: effective = plan AND override.
    expect(resolveFeatureEnabled("readiness", { readiness: true }, { planAllows: false })).toBe(false);
    expect(resolveFeatureEnabled("readiness", { readiness: true }, { planAllows: true })).toBe(true);
    // Entitled but not enabled: still off (defaultOn false).
    expect(resolveFeatureEnabled("readiness", {}, { planAllows: true })).toBe(false);
  });

  it("is granted on every tier, Free included", () => {
    for (const plan of PLAN_CATALOG) {
      expect(resolveEntitlement(plan, "readiness"), `tier ${plan.sku}`).toBe(true);
    }
  });

  it("caps Free at 10 presenters per event and leaves paid tiers uncapped", () => {
    expect(PLAN_BY_SKU.free.limits.readinessPresentersPerEvent).toBe(10);
    for (const sku of [
      "per_event_250",
      "per_event_500",
      "per_event_1000",
      "pro_monthly",
      "pro_annual",
      "enterprise",
      "internal",
    ] as const) {
      expect(PLAN_BY_SKU[sku].limits.readinessPresentersPerEvent, sku).toBeNull();
    }
  });

  it("is not flipped on by any wizard preset", () => {
    for (const preset of FEATURE_PRESETS) {
      expect(preset.overrides.readiness, `preset ${preset.id}`).toBeUndefined();
    }
  });
});

/**
 * ER2 — derived status. LATE is never stored: it is a pure function of the
 * stored status, the effective due date (override beats requirement), and
 * the caller-supplied clock. Rollups are counts only — no stored percentage
 * (plan §6.1.D).
 */
describe("readiness derived status (ER2)", () => {
  const now = new Date("2026-08-16T12:00:00Z");
  const past = new Date("2026-08-15T12:00:00Z");
  const future = new Date("2026-08-17T12:00:00Z");

  const ALL_STATUSES: StoredReadinessStatus[] = [
    "NOT_STARTED",
    "IN_PROGRESS",
    "SUBMITTED",
    "NEEDS_REVIEW",
    "READY",
    "WAIVED",
    "NOT_APPLICABLE",
  ];
  const SETTLED: StoredReadinessStatus[] = ["READY", "WAIVED", "NOT_APPLICABLE"];

  const make = (
    status: StoredReadinessStatus,
    dueAt: Date | null,
    dueAtOverride: Date | null = null,
  ): AssignmentForDerivation => ({ status, dueAtOverride, requirement: { dueAt } });

  it("derives late for every open status past due — and never for settled ones", () => {
    for (const status of ALL_STATUSES) {
      const expectLate = !SETTLED.includes(status);
      expect(deriveAssignmentState(make(status, past), now).late, `${status} past due`).toBe(
        expectLate,
      );
      expect(deriveAssignmentState(make(status, future), now).late, `${status} future due`).toBe(
        false,
      );
      expect(deriveAssignmentState(make(status, null), now).late, `${status} no due`).toBe(false);
    }
  });

  it("uses dueAtOverride over the requirement dueAt in both directions", () => {
    // Requirement overdue, override pushes it out: not late.
    const extended = deriveAssignmentState(make("NOT_STARTED", past, future), now);
    expect(extended.late).toBe(false);
    expect(extended.effectiveDueAt).toEqual(future);
    // Requirement fine, override pulls it in: late.
    const tightened = deriveAssignmentState(make("NOT_STARTED", future, past), now);
    expect(tightened.late).toBe(true);
    expect(tightened.effectiveDueAt).toEqual(past);
    // No override: requirement dueAt is the effective one.
    expect(deriveAssignmentState(make("NOT_STARTED", future), now).effectiveDueAt).toEqual(future);
  });

  it("a due date exactly at now is not late (strictly past only)", () => {
    expect(deriveAssignmentState(make("NOT_STARTED", now), now).late).toBe(false);
  });

  it("rolls up a mixed subject deterministically", () => {
    const assignments = [
      make("READY", past), // ready, settled → not late
      make("WAIVED", past), // waived (excused) → not late
      make("NOT_APPLICABLE", past), // counted as waived
      make("NOT_STARTED", past), // open + late
      make("SUBMITTED", future), // open, on time
    ];
    const rollup = rollupSubject(assignments, now);
    expect(rollup).toEqual({ total: 5, ready: 1, waived: 2, open: 2, late: 1, complete: false });
    expect(rollup.total).toBe(rollup.ready + rollup.waived + rollup.open);
  });

  it("marks a subject complete only when nothing remains open", () => {
    expect(rollupSubject([make("READY", past), make("WAIVED", null)], now).complete).toBe(true);
    expect(rollupSubject([make("READY", past), make("NOT_STARTED", null)], now).complete).toBe(
      false,
    );
  });

  it("an empty subject rolls up to zeros and is not complete", () => {
    expect(rollupSubject([], now)).toEqual({
      total: 0,
      ready: 0,
      waived: 0,
      open: 0,
      late: 0,
      complete: false,
    });
  });

  it("is deterministic: same input, same output, input not mutated", () => {
    const assignments = [
      make("NOT_STARTED", past),
      make("READY", future),
      make("NEEDS_REVIEW", null, past),
    ];
    const snapshot = JSON.parse(JSON.stringify(assignments));
    const first = rollupSubject(assignments, now);
    const second = rollupSubject(assignments, now);
    expect(second).toEqual(first);
    expect(
      assignments.map((a) => deriveAssignmentState(a, now)),
    ).toEqual(assignments.map((a) => deriveAssignmentState(a, now)));
    expect(JSON.parse(JSON.stringify(assignments))).toEqual(snapshot);
  });
});
