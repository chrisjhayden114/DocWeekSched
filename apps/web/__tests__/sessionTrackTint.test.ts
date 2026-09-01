/**
 * UI-1 — attendee agenda session cards: a very light track wash (mixed
 * toward white), not a white card with only a colored edge. Untracked
 * rows stay the neutral card. Grid / by-room share the same mix strength.
 *
 * UI-1.1 — unchosen pick-one "Choose your session" rows get a warm amber
 * wash at the same strength; chosen "Your 10:00 AM" rows use the track tint.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../lib/eventAccent";
import {
  DECISION_AMBER_HEX,
  SESSION_DECISION_AMBER_CLASS,
  SESSION_TRACK_TINT_CLASS,
  TRACK_FILL_MIX,
  TRACK_FILL_MIX_HOVER,
  sessionDecisionAmberClass,
  sessionHasTrack,
  sessionTrackTintClass,
} from "../lib/trackColors";

const webRoot = join(__dirname, "..");
const tokensCss = readFileSync(join(webRoot, "styles", "tokens.css"), "utf8");
const globalsCss = readFileSync(join(webRoot, "styles", "globals.css"), "utf8");
const dashboardSrc = readFileSync(join(webRoot, "pages", "dashboard.tsx"), "utf8");
const publicSrc = readFileSync(join(webRoot, "pages", "e", "[slug].tsx"), "utf8");
const demoSrc = readFileSync(join(webRoot, "components", "marketing", "DemoScheduleFrame.tsx"), "utf8");
const breakoutSrc = readFileSync(join(webRoot, "components", "BreakoutSlotBoard.tsx"), "utf8");

const AA = 4.5;

/** Palette hexes from tokens.css — used to prove the 6% wash stays AA. */
const TRACK_HEX = [
  "#0960ab",
  "#07662b",
  "#892264",
  "#c55113",
  "#473bbd",
  "#990f0f",
  "#0f766e",
  "#673ab7",
  "#a16207",
  "#505158",
];

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

function ruleBody(css: string, selector: string): string {
  const needle = `\n${selector} {`;
  const start = css.indexOf(needle);
  expect(start).toBeGreaterThan(-1);
  return blockBody(css, start);
}

function mixTowardWhite(hex: string, amount: number): string {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c * amount + 255 * (1 - amount));
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(mix(r))}${h(mix(g))}${h(mix(b))}`;
}

describe("UI-1 — tinted vs neutral session card classes", () => {
  it("tracked sessions (or an explicit color) get the tint modifier", () => {
    expect(sessionHasTrack("track-1")).toBe(true);
    expect(sessionTrackTintClass("track-1")).toBe(SESSION_TRACK_TINT_CLASS);
    expect(sessionTrackTintClass(null, "#0960ab")).toBe(SESSION_TRACK_TINT_CLASS);
    expect(SESSION_TRACK_TINT_CLASS).toBe("schedule-event--tinted");
  });

  it("sessions with no track keep a neutral class list (no tint modifier)", () => {
    expect(sessionHasTrack(null)).toBe(false);
    expect(sessionHasTrack(undefined)).toBe(false);
    expect(sessionHasTrack("")).toBe(false);
    expect(sessionTrackTintClass(null)).toBe("");
    expect(sessionTrackTintClass(undefined, null)).toBe("");
  });
});

describe("UI-1 — list cards mix a 5–8% wash toward white", () => {
  it("the token layer pins the shared fill strength", () => {
    expect(tokensCss).toMatch(/--track-fill-mix:\s*6%/);
    expect(tokensCss).toMatch(/--track-fill-mix-hover:\s*8%/);
    expect(TRACK_FILL_MIX).toBe(0.06);
    expect(TRACK_FILL_MIX_HOVER).toBe(0.08);
  });

  it("untracked .schedule-event stays the white card", () => {
    const body = ruleBody(globalsCss, ".schedule-event");
    expect(body).toMatch(/background:\s*#ffffff/);
    expect(body).not.toMatch(/color-mix/);
  });

  it("tinted cards mix --track-color toward #ffffff at the shared token strength", () => {
    const body = ruleBody(globalsCss, ".schedule-event--tinted");
    expect(body).toMatch(/color-mix\(in srgb,\s*var\(--track-color\)\s*var\(--track-fill-mix/);
    expect(body).toMatch(/#ffffff/);
    expect(body).not.toMatch(/transparent|gray-25|gray-50|gray-100/);
  });

  it("the 3px left strip is unchanged", () => {
    const body = ruleBody(globalsCss, ".schedule-event::before");
    expect(body).toMatch(/width:\s*3px/);
    expect(body).toMatch(/background:\s*var\(--track-color,\s*var\(--gray-300\)\)/);
  });

  it("hover on a tinted card lifts the wash toward white, not gray", () => {
    const body = ruleBody(globalsCss, ".schedule-event--tinted:hover");
    expect(body).toMatch(/color-mix\(in srgb,\s*var\(--track-color\)\s*var\(--track-fill-mix-hover/);
    expect(body).toMatch(/#ffffff/);
    expect(body).not.toMatch(/gray-25|gray-50/);
  });

  it("hover on a neutral card still uses the quiet gray lift", () => {
    const body = ruleBody(globalsCss, ".schedule-event:hover");
    expect(body).toMatch(/background:\s*var\(--gray-25\)/);
  });
});

describe("UI-1 — grid / by-room fills match the list wash", () => {
  it("timetable blocks use the same --track-fill-mix toward white", () => {
    const body = ruleBody(globalsCss, ".schedule-grid-block");
    expect(body).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--track-color,\s*var\(--gray-300\)\)\s*var\(--track-fill-mix/,
    );
    expect(body).toMatch(/#ffffff/);
    expect(body).not.toMatch(/16%/);
  });

  it("grid ink is unchanged — only the fill strength moved down", () => {
    const body = ruleBody(globalsCss, ".schedule-grid-block");
    expect(body).toMatch(
      /color:\s*color-mix\(in srgb,\s*var\(--track-color,\s*var\(--gray-700\)\)\s*72%,\s*#161616\)/,
    );
  });
});

describe("UI-1 — list surfaces apply the tint class from track presence", () => {
  it("the signed-in agenda, public agenda, and breakout rows call sessionTrackTintClass", () => {
    expect(dashboardSrc).toContain("sessionTrackTintClass(s.trackId, s.track?.color)");
    expect(publicSrc).toContain("sessionTrackTintClass(s.trackName)");
    expect(breakoutSrc).toContain("sessionTrackTintClass(only.trackId, only.track?.color)");
    expect(breakoutSrc).toContain("sessionTrackTintClass(chosenSession.trackId, chosenSession.track?.color)");
  });

  it("the marketing demo rows are tinted (every demo session has a track)", () => {
    expect(demoSrc).toContain("schedule-event--tinted");
  });
});

describe("UI-1 — 6% wash keeps WCAG AA for card text", () => {
  const title = "#161616"; // --gray-900 titles / join label
  const meta = "#737373"; // --gray-500 venue line (already the muted token on white)

  it("every palette track mixed 6% toward white stays AA under title text", () => {
    for (const hex of TRACK_HEX) {
      const wash = mixTowardWhite(hex, TRACK_FILL_MIX);
      expect(contrastRatio(wash, title)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("the 8% hover wash also stays AA under title text", () => {
    for (const hex of TRACK_HEX) {
      const wash = mixTowardWhite(hex, TRACK_FILL_MIX_HOVER);
      expect(contrastRatio(wash, title)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("meta contrast stays in the same band as the white card (tint does not muddy it)", () => {
    const onWhite = contrastRatio("#ffffff", meta);
    for (const hex of TRACK_HEX) {
      const wash = mixTowardWhite(hex, TRACK_FILL_MIX);
      const onWash = contrastRatio(wash, meta);
      // gray-500 is the design-system muted line; the wash must not drop it off a cliff.
      expect(onWash).toBeGreaterThan(onWhite - 0.5);
      expect(onWash).toBeGreaterThanOrEqual(3);
    }
  });

  it("a near-black track hue still mixes toward white, not a muddy gray", () => {
    const wash = mixTowardWhite("#0a0a0a", TRACK_FILL_MIX);
    // 6% of #0a0a0a on white → #f0f0f0 (mix toward white, not alpha-over-gray).
    expect(wash).toBe("#f0f0f0");
    expect(contrastRatio(wash, title)).toBeGreaterThanOrEqual(AA);
  });
});

describe("UI-1.1 — pick-one open decisions use amber, not a track tint", () => {
  it("the helper puts the amber class only on an unchosen slot", () => {
    expect(sessionDecisionAmberClass(true)).toBe(SESSION_DECISION_AMBER_CLASS);
    expect(sessionDecisionAmberClass(false)).toBe("");
    expect(SESSION_DECISION_AMBER_CLASS).toBe("breakout-slot--decision");
    expect(SESSION_DECISION_AMBER_CLASS).not.toBe(SESSION_TRACK_TINT_CLASS);
  });

  it("the token layer pins a warm gold distinct from the track palette", () => {
    expect(tokensCss).toMatch(/--decision-amber:\s*#c9920a/);
    expect(DECISION_AMBER_HEX).toBe("#c9920a");
    expect(TRACK_HEX.map((h) => h.toLowerCase())).not.toContain(DECISION_AMBER_HEX.toLowerCase());
  });

  it("unchosen slot rows mix --decision-amber toward white at the shared token strength", () => {
    const body = ruleBody(globalsCss, ".breakout-slot--decision > .breakout-slot-header");
    expect(body).toMatch(/color-mix\(in srgb,\s*var\(--decision-amber\)\s*var\(--track-fill-mix/);
    expect(body).toMatch(/#ffffff/);
    expect(body).not.toMatch(/--track-color/);
  });

  it("the amber left strip matches track-strip geometry (3px)", () => {
    const body = ruleBody(globalsCss, ".breakout-slot--decision > .breakout-slot-header::before");
    expect(body).toMatch(/width:\s*3px/);
    expect(body).toMatch(/background:\s*var\(--decision-amber\)/);
  });

  it("hover on the amber row lifts at the same 8% pattern as UI-1", () => {
    const body = ruleBody(globalsCss, ".breakout-slot--decision > .breakout-slot-header:hover");
    expect(body).toMatch(/color-mix\(in srgb,\s*var\(--decision-amber\)\s*var\(--track-fill-mix-hover/);
    expect(body).toMatch(/#ffffff/);
  });

  it("unchosen slot rows get the amber class; chosen rows get the track tint, not amber", () => {
    expect(breakoutSrc).toContain("sessionDecisionAmberClass(!chosenSession)");
    expect(breakoutSrc).toContain("sessionTrackTintClass(chosenSession.trackId, chosenSession.track?.color)");
    expect(breakoutSrc).toMatch(/className=\{?\["breakout-choice"/);
    expect(breakoutSrc).not.toMatch(/sessionDecisionAmberClass\([^)]*chosenSession\.track/);
  });

  it("chosen collapsed rows reuse the UI-1 tint wash, not gray-25 or amber", () => {
    const tinted = ruleBody(globalsCss, ".breakout-choice.schedule-event--tinted");
    expect(tinted).toMatch(/color-mix\(in srgb,\s*var\(--track-color\)\s*var\(--track-fill-mix/);
    expect(tinted).toMatch(/#ffffff/);
    expect(tinted).not.toMatch(/decision-amber|gray-25/);
    const rest = ruleBody(globalsCss, ".breakout-choice");
    expect(rest).toMatch(/background:\s*#ffffff/);
    expect(rest).not.toMatch(/gray-25|decision-amber/);
  });

  it("grid / by-room do not render pick-one slot rows, so amber is list-only", () => {
    const timetableSrc = readFileSync(join(webRoot, "components", "ScheduleTimetable.tsx"), "utf8");
    expect(timetableSrc).not.toContain("breakout-slot");
    expect(timetableSrc).not.toContain("sessionDecisionAmberClass");
    expect(timetableSrc).not.toContain("Choose your session");
  });

  it("the 6% and 8% amber washes stay AA under title text", () => {
    const title = "#161616";
    const wash = mixTowardWhite(DECISION_AMBER_HEX, TRACK_FILL_MIX);
    const hover = mixTowardWhite(DECISION_AMBER_HEX, TRACK_FILL_MIX_HOVER);
    expect(contrastRatio(wash, title)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(hover, title)).toBeGreaterThanOrEqual(AA);
  });
});
