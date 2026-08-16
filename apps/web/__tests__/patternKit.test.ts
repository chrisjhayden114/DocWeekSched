import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initialsFor, nextPillIndex } from "../components/kit/kitHelpers";
import {
  composerCanSubmit,
  composerInitialState,
  composerReduce,
  type ComposerEvent,
  type ComposerState,
} from "../components/kit/composerState";

/**
 * Chunk F1 — the pattern kit. The two acceptance behaviors pinned here:
 * the Composer collapse/expand contract (the content-first heart) and
 * StatCard staying static under prefers-reduced-motion (structural, the
 * same way motionTokens.test.ts pins the E28 gate).
 */

const tokensCss = readFileSync(join(__dirname, "..", "styles", "tokens.css"), "utf8");
const globalsCss = readFileSync(join(__dirname, "..", "styles", "globals.css"), "utf8");
const statCardSrc = readFileSync(join(__dirname, "..", "components", "kit", "StatCard.tsx"), "utf8");
const countUpSrc = readFileSync(join(__dirname, "..", "components", "CountUp.tsx"), "utf8");

/** Extracts the body of a braced block starting at the first `{` at/after `start`. */
function blockBody(css: string, start: number): string {
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error("Unbalanced braces");
}

function run(events: ComposerEvent[], from: ComposerState = composerInitialState): ComposerState {
  return events.reduce(composerReduce, from);
}

describe("F1 — Composer collapse/expand contract", () => {
  it("starts collapsed and empty", () => {
    expect(composerInitialState).toEqual({ expanded: false, value: "", title: "" });
  });

  it("expands on invoke and accepts a draft", () => {
    const state = run([{ type: "expand" }, { type: "change", value: "Hello everyone" }]);
    expect(state.expanded).toBe(true);
    expect(state.value).toBe("Hello everyone");
  });

  it("Esc/Cancel collapses but KEEPS the draft — closing never destroys writing", () => {
    const state = run([{ type: "expand" }, { type: "change", value: "half-written post" }, { type: "collapse" }]);
    expect(state.expanded).toBe(false);
    expect(state.value).toBe("half-written post");
    // Re-expanding brings the draft back.
    const reopened = composerReduce(state, { type: "expand" });
    expect(reopened.value).toBe("half-written post");
  });

  it("a successful submit clears the draft and collapses", () => {
    const state = run([{ type: "expand" }, { type: "change", value: "posted!" }, { type: "submitted" }]);
    expect(state).toEqual({ expanded: false, value: "", title: "" });
  });

  it("submit is allowed only when expanded with a non-blank draft", () => {
    expect(composerCanSubmit(composerInitialState)).toBe(false);
    expect(composerCanSubmit({ expanded: true, value: "   ", title: "" })).toBe(false);
    expect(composerCanSubmit({ expanded: true, value: "hi", title: "" })).toBe(true);
    expect(composerCanSubmit({ expanded: false, value: "hi", title: "" })).toBe(false);
  });

  it("allowEmpty permits submit with an empty draft (photo-only Moments), still gated on expanded", () => {
    const empty: ComposerState = { expanded: true, value: "", title: "" };
    expect(composerCanSubmit(empty, { allowEmpty: true })).toBe(true);
    expect(composerCanSubmit(empty, { allowEmpty: false })).toBe(false);
  });

  it("F3: a title is required only when the screen renders a title field", () => {
    const drafted: ComposerState = { expanded: true, value: "body text", title: "  " };
    expect(composerCanSubmit(drafted)).toBe(true);
    expect(composerCanSubmit(drafted, { requireTitle: true })).toBe(false);
    expect(composerCanSubmit({ ...drafted, title: "A headline" }, { requireTitle: true })).toBe(true);
  });

  it("F3: the title rides the draft contract — kept on collapse, cleared on submit", () => {
    const collapsed = run([
      { type: "expand" },
      { type: "changeTitle", value: "Dinner plans" },
      { type: "change", value: "Anyone up for tapas?" },
      { type: "collapse" },
    ]);
    expect(collapsed.title).toBe("Dinner plans");
    const submitted = run([{ type: "expand" }, { type: "submitted" }], collapsed);
    expect(submitted).toEqual({ expanded: false, value: "", title: "" });
  });
});

describe("F1 — StatCard reduced-motion (structural chain)", () => {
  it("count-up is opt-in: StatCard renders CountUp only for the countUp variant", () => {
    expect(statCardSrc).toMatch(/countUp \? <CountUp/);
  });

  it("CountUp takes its duration from the --motion-countup token", () => {
    expect(countUpSrc).toContain("--motion-countup");
  });

  it("the reduced-motion block zeroes --motion-countup", () => {
    const mediaStart = tokensCss.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(mediaStart).toBeGreaterThan(-1);
    expect(blockBody(tokensCss, mediaStart)).toMatch(/--motion-countup:\s*0ms/);
  });

  it("CountUp renders the final value statically when the duration is zero", () => {
    // The guard that makes reduced-motion mean "no movement, final value now".
    expect(countUpSrc).toMatch(/duration <= 0/);
    expect(countUpSrc).toMatch(/setDisplay\(value\)/);
  });
});

describe("F1.1 — warmer tokens extend the scale (nothing replaced)", () => {
  it("adds the card and pill radii alongside the 4/6/10 scale", () => {
    expect(tokensCss).toMatch(/--radius-card:\s*14px/);
    expect(tokensCss).toMatch(/--radius-pill:\s*999px/);
    // The E28–E30 scale survives.
    expect(tokensCss).toMatch(/--radius-sm:\s*4px/);
    expect(tokensCss).toMatch(/--radius-md:\s*6px/);
    expect(tokensCss).toMatch(/--radius-lg:\s*10px/);
  });

  it("expresses the page → card → inner surface progression", () => {
    expect(tokensCss).toMatch(/--surface-page:/);
    expect(tokensCss).toMatch(/--surface-card:/);
    expect(tokensCss).toMatch(/--surface-inner:/);
  });

  it("kit surfaces are token-driven: cards and pills use the new radii", () => {
    expect(globalsCss).toMatch(/\.kit-feed-card {[^}]*border-radius: var\(--radius-card\)/s);
    expect(globalsCss).toMatch(/\.kit-stat-card {[^}]*border-radius: var\(--radius-card\)/s);
    expect(globalsCss).toMatch(/\.kit-pill {[^}]*border-radius: var\(--radius-pill\)/s);
  });
});

describe("F1 — small kit helpers", () => {
  it("initialsFor takes the first letters of the first two words", () => {
    expect(initialsFor("Priya Raman")).toBe("PR");
    expect(initialsFor("plato")).toBe("P");
    expect(initialsFor("  jane   van der Berg ")).toBe("JV");
  });

  it("the shell account button uses initialsFor when there is no photo", () => {
    const appShell = readFileSync(join(__dirname, "..", "components", "AppShell.tsx"), "utf8");
    const organizerShell = readFileSync(join(__dirname, "..", "components", "OrganizerShell.tsx"), "utf8");
    expect(appShell).toContain("initialsFor");
    expect(appShell).toMatch(/userPhotoUrl \? <img[^>]+> : initials/);
    expect(organizerShell).toContain('/auth/me');
    expect(organizerShell).toContain("userPhotoUrl");
  });

  it("nextPillIndex wraps in both directions", () => {
    expect(nextPillIndex(3, 2, 1)).toBe(0);
    expect(nextPillIndex(3, 0, -1)).toBe(2);
    expect(nextPillIndex(3, 1, 1)).toBe(2);
    expect(nextPillIndex(0, 0, 1)).toBe(-1);
  });
});
