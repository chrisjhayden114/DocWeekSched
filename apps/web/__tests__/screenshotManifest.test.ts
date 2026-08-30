/**
 * SHOT-CI — the manifest is the only thing standing between "we shipped a
 * feature" and "its hover card silently falls back to line art forever". These
 * assertions fail when the registry gains a shipped key nobody photographed.
 */

import { describe, expect, it } from "vitest";
import { FEATURE_BY_KEY, FEATURE_REGISTRY, type FeatureKey } from "@event-app/shared";
import {
  KNOWN_TOKENS,
  SCREENSHOT_MANIFEST,
  SCREENSHOT_MAX_HEIGHT,
  SCREENSHOT_MIN_HEIGHT,
  SCREENSHOT_MIN_PASS_RATIO,
  SCREENSHOT_VIEWPORT,
  SCREENSHOT_WIDTH,
  captureRunPassed,
  eligibleScreenshotKeys,
  tokensInPath,
} from "../screenshot-manifest";

const eligible = eligibleScreenshotKeys();
const entries = Object.entries(SCREENSHOT_MANIFEST) as Array<[FeatureKey, (typeof SCREENSHOT_MANIFEST)[string]]>;

describe("screenshot manifest coverage", () => {
  it("covers every shipped feature key with a surface", () => {
    const missing = eligible.filter((key) => !SCREENSHOT_MANIFEST[key]);
    expect(missing, `add a manifest entry (or retire the key) for: ${missing.join(", ")}`).toEqual([]);
  });

  it("photographs nothing that is retired or still planned", () => {
    const extra = Object.keys(SCREENSHOT_MANIFEST).filter((key) => !eligible.includes(key as FeatureKey));
    expect(extra).toEqual([]);
    expect(SCREENSHOT_MANIFEST.messaging_event_chat).toBeUndefined();
    expect(SCREENSHOT_MANIFEST.public_leaderboard).toBeUndefined();
  });

  it("skips exactly the keys the registry marks retired or planned", () => {
    const skipped = FEATURE_REGISTRY.filter((f) => f.retired || f.plannedPhase).map((f) => f.key);
    expect(skipped.sort()).toEqual(["messaging_event_chat", "public_leaderboard"]);
    expect(eligible).toHaveLength(FEATURE_REGISTRY.length - skipped.length);
  });
});

describe("screenshot manifest entries", () => {
  it("only interpolates tokens the seed is contracted to provide", () => {
    for (const [key, shot] of entries) {
      for (const token of tokensInPath(shot.path)) {
        expect(KNOWN_TOKENS, `${key} uses unknown token {${token}}`).toContain(token);
      }
    }
  });

  it("targets an element, never the whole document", () => {
    for (const [key, shot] of entries) {
      expect(shot.selector.trim(), key).not.toBe("");
      expect(["body", "html", ":root", "#__next"], key).not.toContain(shot.selector.trim());
    }
  });

  it("signs in as a seeded account and explains the choice of surface", () => {
    for (const [key, shot] of entries) {
      expect(["attendee", "organizer"], key).toContain(shot.as);
      expect(shot.note.trim().length, `${key} needs a note saying why this surface`).toBeGreaterThan(20);
      expect(shot.path.startsWith("/"), key).toBe(true);
    }
  });

  it("keeps every viewport wide enough for the fixed-width clip", () => {
    expect(SCREENSHOT_VIEWPORT.width).toBeGreaterThanOrEqual(SCREENSHOT_WIDTH);
    for (const [key, shot] of entries) {
      if (!shot.viewport) continue;
      expect(shot.viewport.width, key).toBeGreaterThanOrEqual(SCREENSHOT_WIDTH);
    }
  });

  it("puts only pick-one breakouts on the second seeded event", () => {
    const onBreakouts = entries.filter(([, shot]) => shot.event === "breakouts").map(([key]) => key);
    expect(onBreakouts).toEqual(["breakout_style"]);
  });

  it("shoots organizer-only features as the organizer", () => {
    // A card claiming "organizers use it on…" must not be photographed from an
    // attendee session, where the surface does not exist. Check-in is not on
    // this list: it has an attendee half (the personal QR), and that half
    // photographs honestly where the staff scanner's fake camera does not.
    for (const key of ["sponsor_outreach", "ops_agent", "recap_agent", "readiness", "paid_attendance"] as const) {
      expect(SCREENSHOT_MANIFEST[key]!.as, key).toBe("organizer");
    }
  });

  it("shoots every community channel from its own filtered feed", () => {
    const channels = FEATURE_REGISTRY.filter((f) => f.dependsOn?.includes("community")).map((f) => f.key);
    for (const key of channels) {
      const shot = SCREENSHOT_MANIFEST[key]!;
      expect(shot.as, key).toBe("attendee");
      expect(shot.clicks?.length, `${key} must click its channel pill first`).toBe(1);
      expect(shot.path, key).toContain("tab=Community");
    }
    // The parent card is the unfiltered board, so it clicks nothing.
    expect(SCREENSHOT_MANIFEST.community!.clicks).toBeUndefined();
  });

  it("uses a finished session for feedback and a live one for polls and Q&A", () => {
    expect(SCREENSHOT_MANIFEST.session_feedback!.path).toContain("{endedSessionId}");
    expect(SCREENSHOT_MANIFEST.session_polls!.path).toContain("{liveSessionId}");
    expect(SCREENSHOT_MANIFEST.session_qa!.path).toContain("{liveSessionId}");
    expect(SCREENSHOT_MANIFEST.waitlist_visibility!.path).toContain("{fullSessionId}");
  });

  it("keeps the clip height band sane", () => {
    expect(SCREENSHOT_MIN_HEIGHT).toBeGreaterThan(0);
    expect(SCREENSHOT_MAX_HEIGHT).toBeGreaterThan(SCREENSHOT_MIN_HEIGHT);
  });

  it("names every eligible key in the registry, so notes stay reviewable", () => {
    for (const [key] of entries) {
      expect(FEATURE_BY_KEY[key], `${key} is not a real feature key`).toBeDefined();
    }
  });
});

/**
 * A run used to exit 1 on the first failed shot, which skipped the index and
 * commit steps and threw away every image that had come out fine.
 */
describe("capture run pass floor", () => {
  it("lets a shot or two fail without discarding the rest of the set", () => {
    const almost = eligible.length - 1;
    expect(captureRunPassed(almost, eligible.length)).toBe(true);
    expect(captureRunPassed(eligible.length, eligible.length)).toBe(true);
  });

  it("still fails a run that captured too little to be worth committing", () => {
    expect(captureRunPassed(Math.floor(eligible.length / 2), eligible.length)).toBe(false);
    expect(captureRunPassed(0, eligible.length)).toBe(false);
    // Debugging one selector with --only: that shot is the whole run.
    expect(captureRunPassed(0, 1)).toBe(false);
    expect(captureRunPassed(1, 1)).toBe(true);
  });

  it("treats an empty selection as a no-op rather than a broken set", () => {
    expect(captureRunPassed(0, 0)).toBe(true);
  });

  it("keeps the floor tight enough that a rotting manifest cannot hide behind it", () => {
    expect(SCREENSHOT_MIN_PASS_RATIO).toBeGreaterThanOrEqual(0.9);
    expect(SCREENSHOT_MIN_PASS_RATIO).toBeLessThanOrEqual(1);
    const tolerated = eligible.length - Math.ceil(eligible.length * SCREENSHOT_MIN_PASS_RATIO);
    expect(tolerated, "the floor should forgive a shot, not a category").toBeLessThanOrEqual(3);
  });
});
