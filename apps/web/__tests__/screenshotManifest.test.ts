/**
 * SHOT-CI — the manifest is the only thing standing between "we shipped a
 * feature" and "its hover card silently falls back to line art forever". These
 * assertions fail when the registry gains a shipped key nobody photographed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_BY_KEY, FEATURE_REGISTRY, type FeatureKey } from "@event-app/shared";
import {
  KNOWN_TOKENS,
  SCREENSHOT_CARD_HEIGHT,
  SCREENSHOT_MANIFEST,
  SCREENSHOT_MAX_HEIGHT,
  SCREENSHOT_MIN_HEIGHT,
  SCREENSHOT_MIN_PASS_RATIO,
  SCREENSHOT_VIEWPORT,
  SCREENSHOT_WIDTH,
  captureRunPassed,
  eligibleScreenshotKeys,
  isPageShot,
  isPdfShot,
  tokensInPath,
  type FeatureShot,
  type PageFeatureShot,
} from "../screenshot-manifest";
import { highlightCss } from "../screenshot-frame";
import { HOVER_INFO_ART_HEIGHT } from "../components/kit/HoverInfo";

const eligible = eligibleScreenshotKeys();
const entries = Object.entries(SCREENSHOT_MANIFEST) as Array<[FeatureKey, FeatureShot]>;
const pageEntries = entries.filter((entry): entry is [FeatureKey, PageFeatureShot] =>
  isPageShot(entry[1]),
);

function pageShot(key: FeatureKey): PageFeatureShot {
  const shot = SCREENSHOT_MANIFEST[key]!;
  if (!isPageShot(shot)) throw new Error(`${key} is not a page shot`);
  return shot;
}

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
    for (const [key, shot] of pageEntries) {
      for (const token of tokensInPath(shot.path)) {
        expect(KNOWN_TOKENS, `${key} uses unknown token {${token}}`).toContain(token);
      }
    }
  });

  it("targets an element, never the whole document", () => {
    for (const [key, shot] of pageEntries) {
      expect(shot.selector.trim(), key).not.toBe("");
      expect(["body", "html", ":root", "#__next"], key).not.toContain(shot.selector.trim());
    }
  });

  it("signs in as a seeded account and explains the choice of surface", () => {
    for (const [key, shot] of entries) {
      expect(["attendee", "organizer"], key).toContain(shot.as);
      expect(shot.note.trim().length, `${key} needs a note saying why this surface`).toBeGreaterThan(20);
      if (isPageShot(shot)) expect(shot.path.startsWith("/"), key).toBe(true);
    }
  });

  it("keeps every viewport wide enough for the fixed-width clip", () => {
    expect(SCREENSHOT_VIEWPORT.width).toBeGreaterThanOrEqual(SCREENSHOT_WIDTH);
    for (const [key, shot] of pageEntries) {
      if (!shot.viewport) continue;
      expect(shot.viewport.width, key).toBeGreaterThanOrEqual(SCREENSHOT_WIDTH);
    }
  });

  it("waits for the decoded bytes wherever a shot is a picture of an image", () => {
    // A visible <img> whose data URL was rejected is still visible, which is how
    // the floor plan and the sponsor strip photographed as empty boxes.
    for (const key of ["venue_maps", "sponsors"] as const) {
      expect(pageShot(key).waitForImage, key).toBeTruthy();
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

  it("frames console tabs from the first heading, not mid-row", () => {
    for (const key of ["readiness", "ops_agent", "recap_agent"] as const) {
      expect(pageShot(key).alignTop, key).toBe(true);
    }
  });

  it("fills the CFP form and clips it to the shape a card shows whole", () => {
    const shot = pageShot("cfp");
    expect(shot.selector).toBe("main.page");
    expect(shot.alignTop).toBe(true);
    // A 760-tall frame is centre-cropped by the card, which threw the h1 away.
    expect(shot.clipHeight).toBe(SCREENSHOT_CARD_HEIGHT);
    expect(shot.fills?.map((f) => f.value).join(" ")).toContain("Priya Raghunathan");
    expect(shot.fills).toHaveLength(4);
  });

  it("clips the concierge empty state to the header, chips, and input", () => {
    const shot = pageShot("concierge");
    expect(shot.clipHeight).toBe(420);
    expect(shot.stageCss).toContain(".concierge-messages");
    expect(shot.clicks?.[0]).toContain("concierge-fab");
  });

  it("photographs the certificate PDF itself, not a page that describes one", () => {
    const shot = SCREENSHOT_MANIFEST.certificates!;
    expect(isPdfShot(shot)).toBe(true);
    if (!isPdfShot(shot)) return;
    expect(shot.page).toBe(1);
    expect(shot.dpi).toBeGreaterThanOrEqual(150);
    // The verify card was the stand-in; nothing should point back at it.
    expect(JSON.stringify(shot)).not.toContain("/verify/");
  });

  it("photographs the floor plan itself, unfocused, so more than one pin is on it", () => {
    const shot = pageShot("venue_maps");
    expect(shot.selector).toBe(".floor-plan-viewport");
    // A deep-linked pin zooms the canvas to 2.2x and centres it on that pin,
    // which photographed as one marker on the empty inside of a room.
    expect(shot.path).not.toContain("pinId");
    expect(shot.path).toContain("mapId");
  });

  it("magnifies the engagement pill rather than filing it as a speck", () => {
    const shot = pageShot("engagement_points");
    expect(shot.selector).toBe(".points-gem");
    expect(shot.magnify).toBeGreaterThan(1);
    // Geometry and stage only — the pill's own styling is the product's.
    expect(shot.stageCss).toContain(".shell-topbar");
    expect(shot.stageCss).not.toMatch(/color:|background:/);
  });

  it("shoots every community channel from its own filtered feed", () => {
    const channels = FEATURE_REGISTRY.filter((f) => f.dependsOn?.includes("community")).map((f) => f.key);
    for (const key of channels) {
      const shot = pageShot(key);
      expect(shot.as, key).toBe("attendee");
      expect(shot.clicks?.length, `${key} must click its channel pill first`).toBe(1);
      expect(shot.path, key).toContain("tab=Community");
    }
    // The parent card is the unfiltered board, so it clicks nothing.
    expect(pageShot("community").clicks).toBeUndefined();
  });

  it("uses a finished session for feedback and a live one for polls and Q&A", () => {
    expect(pageShot("session_feedback").path).toContain("{endedSessionId}");
    expect(pageShot("session_polls").path).toContain("{liveSessionId}");
    expect(pageShot("session_qa").path).toContain("{liveSessionId}");
    expect(pageShot("waitlist_visibility").path).toContain("{fullSessionId}");
  });

  it("keeps the clip height band sane, with the card's own shape inside it", () => {
    expect(SCREENSHOT_MIN_HEIGHT).toBeGreaterThan(0);
    expect(SCREENSHOT_MAX_HEIGHT).toBeGreaterThan(SCREENSHOT_MIN_HEIGHT);
    expect(SCREENSHOT_CARD_HEIGHT).toBeGreaterThanOrEqual(SCREENSHOT_MIN_HEIGHT);
    expect(SCREENSHOT_CARD_HEIGHT).toBeLessThanOrEqual(SCREENSHOT_MAX_HEIGHT);
    // 1200 x 510 is the 400 x 170 art slot's own aspect ratio, which is the
    // only shape a hover card shows without cropping a band off it.
    expect(SCREENSHOT_WIDTH / SCREENSHOT_CARD_HEIGHT).toBeCloseTo(400 / HOVER_INFO_ART_HEIGHT, 2);
  });

  it("boxes the control inside three busy surfaces without changing the shot context", () => {
    expect(pageShot("timezone_toggle").highlight).toBe(".agenda-timezone-toggle--desktop");
    expect(pageShot("session_likes").highlight).toBe("button.session-like-btn");
    expect(pageShot("waitlist_visibility").highlight).toBe(".session-waitlist-chip");
    expect(pageShot("timezone_toggle").selector).toBe(".agenda-context-bar");
    expect(pageShot("session_likes").selector).toBe(".schedule-list");
    expect(pageShot("waitlist_visibility").selector).toBe(".card.session-page-header");
    for (const key of ["timezone_toggle", "session_likes", "waitlist_visibility"] as const) {
      const sel = pageShot(key).highlight!;
      expect(sel).not.toMatch(/:text-is|:has-text/);
      expect(highlightCss(sel)).toContain("#c9920a");
      expect(highlightCss(sel)).toContain("outline-offset: 4px");
      expect(highlightCss(sel)).toContain("0 0 0 6px #ffffff");
    }
  });

  it("hugs the session feedback card so the frame is the card, not dead white", () => {
    const shot = pageShot("session_feedback");
    expect(shot.selector).toBe(".session-feedback-card");
    expect(shot.hug).toBe(true);
    expect(shot.magnify).toBe(2);
  });

  it("widens the Schedule toolbar clips so By room stays in frame", () => {
    for (const key of ["timezone_toggle", "breakout_style"] as const) {
      const shot = pageShot(key);
      expect(shot.trueBounds, key).toBe(true);
      expect(shot.clipPad, key).toBeGreaterThanOrEqual(12);
    }
  });

  it("wires highlight CSS into the capture script and the live controls", () => {
    const web = join(__dirname, "..");
    const read = (...parts: string[]) => readFileSync(join(web, ...parts), "utf8");
    expect(read("scripts", "capture-screenshots.ts")).toContain("highlightCss(shot.highlight)");
    expect(read("pages", "dashboard.tsx")).toContain("session-like-btn");
    expect(read("pages", "dashboard.tsx")).toContain("session-waitlist-chip");
    expect(read("pages", "session", "[sessionId].tsx")).toContain("session-waitlist-chip");
    expect(read("pages", "session", "[sessionId].tsx")).toContain("session-feedback-card");
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
