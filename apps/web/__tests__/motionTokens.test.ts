import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Chunk E28 — motion foundation.
 *
 * The acceptance that matters most is that EVERY animation is gated behind
 * prefers-reduced-motion. That guarantee is structural: (1) every duration in
 * the stylesheets comes from the motion tokens, (2) the reduced-motion media
 * block zeroes those tokens, and (3) a universal override forces any stray
 * animation/transition to finish in one imperceptible frame. These tests pin
 * all three, plus the no-layout-shift rule (keyframes may only touch
 * opacity/transform/paint — never width/height/top).
 */

const tokensCss = readFileSync(join(__dirname, "..", "styles", "tokens.css"), "utf8");
const globalsCss = readFileSync(join(__dirname, "..", "styles", "globals.css"), "utf8");

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

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("E28.1 — motion tokens", () => {
  it("defines the motion durations and eases in the token layer", () => {
    expect(tokensCss).toMatch(/--motion-fast:\s*120ms/);
    expect(tokensCss).toMatch(/--motion:\s*200ms/);
    expect(tokensCss).toMatch(/--motion-slow:\s*320ms/);
    expect(tokensCss).toMatch(/--motion-stagger-step:\s*40ms/);
    expect(tokensCss).toMatch(/--ease-out:\s*cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/);
    expect(tokensCss).toMatch(/--ease-in-out:\s*cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\)/);
  });

  it("keeps the pre-E28 hover transition", () => {
    expect(tokensCss).toMatch(/--transition:\s*all 0\.15s ease/);
  });
});

describe("E28 — prefers-reduced-motion gate (the acceptance that matters most)", () => {
  const mediaStart = tokensCss.indexOf("@media (prefers-reduced-motion: reduce)");

  it("has a reduced-motion block in the token layer", () => {
    expect(mediaStart).toBeGreaterThan(-1);
  });

  it("zeroes every motion duration token under reduced motion", () => {
    const body = blockBody(tokensCss, mediaStart);
    // Every --motion* token declared in :root must be re-declared to 0ms here.
    const declared = [...stripComments(tokensCss.slice(0, mediaStart)).matchAll(/(--motion[a-z-]*):/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThanOrEqual(5);
    for (const token of new Set(declared)) {
      expect(body).toMatch(new RegExp(`${token}:\\s*0ms`));
    }
    expect(body).toMatch(/--transition:\s*none/);
  });

  it("universally forces animations and transitions to complete instantly", () => {
    const body = blockBody(tokensCss, mediaStart);
    // The `*` override is the backstop that catches anything not built on the
    // tokens. 0.01ms (not 0) so animationend/transitionend still fire and
    // fill-mode animations land on their end state (content fully visible).
    expect(body).toContain("animation-duration: 0.01ms !important");
    expect(body).toContain("animation-delay: 0ms !important");
    expect(body).toContain("animation-iteration-count: 1 !important");
    expect(body).toContain("transition-duration: 0.01ms !important");
  });

  it("renders skeletons static (no shimmer) under reduced motion", () => {
    const mediaBlocks = [...globalsCss.matchAll(/@media \(prefers-reduced-motion: reduce\)/g)].map((m) =>
      blockBody(globalsCss, m.index ?? 0),
    );
    const skeletonRule = mediaBlocks.find((b) => b.includes(".skeleton-row"));
    expect(skeletonRule).toBeDefined();
    expect(skeletonRule).toMatch(/animation:\s*none/);
  });
});

describe("E28 — no hardcoded durations outside the token layer", () => {
  it("every animation/transition in globals.css takes its duration from a token", () => {
    const offenders = [...stripComments(globalsCss).matchAll(/(?:animation|transition):[^;]*\d+(?:\.\d+)?m?s[^;]*;/g)].map(
      (m) => m[0],
    );
    expect(offenders).toEqual([]);
  });

  it("no inline animation/transition durations in components or pages", () => {
    // Inline styles bypass the stylesheet; motion belongs in the token-driven
    // CSS layer where the reduced-motion gate provably covers it.
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync(
      `grep -rn --include='*.tsx' -E '(transition|animation):\\s*["\`][^"\`]*[0-9]m?s' components pages || true`,
      { cwd: join(__dirname, ".."), encoding: "utf8" },
    );
    expect(out.trim()).toBe("");
  });
});

describe("E28 — animations are transform/opacity only (no layout shift)", () => {
  it("keyframes never animate layout properties (width/height/top/left/margin...)", () => {
    // background-position is allowed: the skeleton shimmer moves a gradient,
    // which is paint-only and cannot shift layout.
    const allowed = new Set(["opacity", "transform", "background-position"]);
    const banned: string[] = [];
    for (const match of globalsCss.matchAll(/@keyframes\s+([a-z-]+)/g)) {
      const body = stripComments(blockBody(globalsCss, match.index ?? 0));
      for (const decl of body.matchAll(/([a-z-]+)\s*:/g)) {
        const prop = decl[1];
        if (prop === "from" || prop === "to") continue;
        if (!allowed.has(prop)) banned.push(`@keyframes ${match[1]} animates "${prop}"`);
      }
    }
    expect(banned).toEqual([]);
  });

  it("the segmented-control indicator only ever transitions transform", () => {
    const segRule = globalsCss.slice(globalsCss.indexOf(".seg-slide {"));
    const transition = /transition:([^;]+);/.exec(segRule)?.[1] ?? "";
    expect(transition).toContain("transform var(--motion-fast)");
    expect(transition).not.toMatch(/width|height|left|top/);
  });
});
