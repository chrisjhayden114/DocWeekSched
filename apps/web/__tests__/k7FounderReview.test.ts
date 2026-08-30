import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(webRoot, ...parts), "utf8");
const globalsCss = read("styles", "globals.css");

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

function rule(selector: string): string {
  const at = globalsCss.indexOf(`\n${selector} {`);
  expect(at, `${selector} must exist`).toBeGreaterThan(-1);
  return blockBody(globalsCss, at);
}

function hexLum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [hexLum(a), hexLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("K-7 — outreach a.button + organizer badge + guide panel stacking", () => {
  it("styles a.button like the primary button (white text, no link underline)", () => {
    const pinned = rule("a.button,\na.button:link,\na.button:visited,\na.button:hover,\na.button:active,\na.button:focus,\na.button:focus-visible");
    expect(pinned).toContain("color: var(--action-fg)");
    expect(pinned).toContain("text-decoration: none");
    expect(rule("a.button:hover:not(:disabled)")).toContain("background: var(--action-bg-hover)");
  });

  it("the guide SlideOver is portaled and stacks above the console topbar", () => {
    const slideOver = read("components", "kit", "SlideOver.tsx");
    expect(slideOver).toContain("Portal");
    expect(read("components", "kit", "GuidePanel.tsx")).toContain("SlideOver");
    expect(read("components", "FeatureConfigPanel.tsx")).toContain("GuidePanel");
    expect(read("components", "AppShell.tsx")).toContain("HoverInfo");
    const drawerZ = Number((rule(".drawer-panel").match(/z-index:\s*(\d+)/) || [])[1]);
    const topbarZ = Number((rule(".shell-topbar").match(/z-index:\s*(\d+)/) || [])[1]);
    expect(drawerZ).toBeGreaterThan(topbarZ);
  });

  it("the Organizer mode badge is a yellow highlight with dark text (WCAG AA)", () => {
    const shell = read("components", "AppShell.tsx");
    expect(shell).toContain("shell-mode-badge");
    expect(shell).toContain("{modeBadge}");
    expect(shell).not.toMatch(/StatusChip[\s\S]*modeBadge|modeBadge[\s\S]*StatusChip/);
    const badge = rule(".shell-mode-badge");
    expect(badge).toMatch(/background:\s*#f5c518/i);
    expect(badge).toMatch(/color:\s*#161616/i);
    expect(badge).toContain("13px/16px");
    expect(contrast("#f5c518", "#161616")).toBeGreaterThanOrEqual(4.5);
    expect(rule(".shell-topbar")).toContain("min-height: calc(56px + env(safe-area-inset-top, 0px))");
    expect(read("components", "OrganizerShell.tsx")).toContain('modeBadge="Organizer mode"');
  });
});
