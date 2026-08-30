/**
 * SHOT-CI.1 — `/dashboard?tab=Meet` used to land on Agenda.
 *
 * The dashboard corrects an active tab the event has switched off, but the
 * overrides arrive a fetch after mount, so until they land every tab is judged
 * against the registry defaults. Meet is the one deep-linkable tab whose
 * default is off, so the correction fired on it every time — the in-app guide
 * link went to the wrong place, and the capture run timed out waiting for a
 * panel that had already been unmounted.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_GUIDE, FEATURE_BY_KEY } from "@event-app/shared";
import { SCREENSHOT_MANIFEST } from "../screenshot-manifest";

const dashboardSrc = readFileSync(join(__dirname, "..", "pages", "dashboard.tsx"), "utf8");

describe("dashboard tab correction waits for the event's own features", () => {
  it("gates the fallback to Agenda on the overrides for the active event", () => {
    const gate = dashboardSrc.indexOf("featuresLoadedFor !== activeEventId) return;");
    const bounce = dashboardSrc.indexOf('setActive("Agenda");');
    expect(gate, "the tab-correction effect must wait for /event/features").toBeGreaterThan(-1);
    expect(bounce).toBeGreaterThan(gate);
    expect(bounce - gate, "the gate belongs in the effect that corrects the tab").toBeLessThan(300);
  });

  it("releases the gate even when /event/features fails", () => {
    // Otherwise one failed fetch would freeze the correction for the session,
    // leaving a switched-off tab open on a surface with nothing behind it.
    const releases = dashboardSrc.match(/setFeaturesLoadedFor\(activeEventId\)/g) ?? [];
    expect(releases.length, "resolve and reject both have to release it").toBe(2);
  });
});

describe("the tabs a deep link can land on", () => {
  it("Meet is default-off, which is what made the race visible there", () => {
    expect(FEATURE_BY_KEY.matchmaker!.defaultOn).toBe(false);
  });

  it("is reachable from the in-app guide and from the screenshot manifest", () => {
    const guideHrefs = APP_GUIDE.map((entry) => entry.href);
    expect(guideHrefs).toContain("/dashboard?tab=Meet");
    expect(SCREENSHOT_MANIFEST.matchmaker!.path).toBe("/dashboard?tab=Meet");
  });
});
