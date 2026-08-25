import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
  EVENT_TYPE_PRESET,
  FEATURE_PRESETS,
  SPEAKER_PACK_BUTTON_HELPER,
  SPEAKER_PACK_BUTTON_LABEL,
  SPEAKER_PACK_REQUIREMENTS,
  SPEAKER_PACK_TEMPLATE_NAME,
  applyPreset,
  parseEventType,
  resolveFeatureEnabled,
  setupEventTypeLabel,
  shouldOfferSpeakerPack,
} from "@event-app/shared";

describe("Talk showcase preset (TALK-1)", () => {
  it("is named Talk showcase and maps from the talk_showcase event type", () => {
    const preset = FEATURE_PRESETS.find((p) => p.id === "talk_showcase");
    expect(preset).toBeDefined();
    expect(preset!.name).toBe("Talk showcase");
    expect(preset!.plainDescription).toMatch(/TEDx-style showcases, storytelling nights, lightning-talk days/);
    expect(EVENT_TYPE_PRESET.talk_showcase).toBe("talk_showcase");
    expect(setupEventTypeLabel("talk_showcase")).toBe("Talk showcase");
  });

  it("turns off breakouts, CFP, session polls/Q&A, engagement, and timezone toggle", () => {
    const o = applyPreset("talk_showcase");
    expect(o.breakout_style).toBe(false);
    expect(o.cfp).toBe(false);
    expect(o.session_polls).toBe(false);
    expect(o.session_qa).toBe(false);
    expect(o.engagement_points).toBe(false);
    expect(o.public_leaderboard).toBe(false);
    expect(o.timezone_toggle).toBe(false);
    expect(resolveFeatureEnabled("session_qa", o)).toBe(false);
    expect(resolveFeatureEnabled("session_polls", o)).toBe(false);
  });

  it("keeps sponsors, check-in, certificates, paid attendance, and community on", () => {
    const o = applyPreset("talk_showcase");
    expect(o.sponsors).toBe(true);
    expect(o.checkin).toBe(true);
    expect(o.certificates).toBe(true);
    expect(o.paid_attendance).toBe(true);
    expect(o.community).toBe(true);
    expect(resolveFeatureEnabled("community", o)).toBe(true);
  });
});

describe("Talk showcase event-type routing (TALK-1)", () => {
  it("maps TEDx-style and short-talk wording to talk_showcase", () => {
    for (const phrase of [
      "tedx",
      "TEDx",
      "a TEDx event",
      "talk showcase",
      "storytelling night",
      "lightning talk",
      "lightning talks",
      "pecha kucha",
      "pecha-kucha",
      "speaker series",
    ]) {
      expect(parseEventType(phrase), phrase).toBe("talk_showcase");
    }
    expect(parseEventType("6")).toBe("talk_showcase");
    expect(parseEventType("f")).toBe("talk_showcase");
  });
});

describe("Speaker pack seeded template (TALK-1)", () => {
  it("is named Speaker pack and is offered, not implied as already created", () => {
    expect(SPEAKER_PACK_TEMPLATE_NAME).toBe("Speaker pack");
    expect(SPEAKER_PACK_BUTTON_LABEL).toBe("Start from the Speaker pack template");
    expect(SPEAKER_PACK_BUTTON_HELPER).toMatch(/rough outline/i);
    expect(SPEAKER_PACK_BUTTON_HELPER).toMatch(/final script/i);
  });

  it("seeds the design-doc requirements with no due dates", () => {
    const byLabel = Object.fromEntries(SPEAKER_PACK_REQUIREMENTS.map((r) => [r.label, r]));
    expect(byLabel["Headshot"]?.kind).toBe("file");
    expect(byLabel["Short bio ≤100 words"]?.kind).toBe("long_text");
    expect(byLabel["Talk title & one-line description"]?.kind).toBe("short_text");
    expect(byLabel["Rough outline"]?.kind).toBe("long_text");
    expect(byLabel["Draft 1 script"]?.kind).toBe("file");
    expect(byLabel["Draft 2 script"]?.kind).toBe("file");
    expect(byLabel["Final script"]?.kind).toBe("file");
    expect(byLabel["Slides 16:9"]?.kind).toBe("file");
    expect(byLabel["Signed speaker release"]?.kind).toBe("file");
    expect(byLabel["Signed speaker release"]?.helpText).toBe("upload the signed release PDF");
    expect(byLabel["Copyright clearance"]?.kind).toBe("confirm");
    expect(byLabel["AV needs"]?.kind).toBe("multi_select");
    expect(byLabel["AV needs"]?.config?.options).toEqual([
      "handheld mic",
      "headset",
      "clicker",
      "video in talk",
      "none",
    ]);
    expect(byLabel["Dress rehearsal confirmed"]?.kind).toBe("confirm");
    expect(byLabel["Coach assigned"]?.kind).toBe("internal_checklist");
    expect(byLabel["Rehearsal booked"]?.kind).toBe("internal_checklist");
    expect(byLabel["Intro written"]?.kind).toBe("internal_checklist");
    expect(SPEAKER_PACK_REQUIREMENTS).toHaveLength(15);
    expect(SPEAKER_PACK_REQUIREMENTS.every((r) => !("dueAt" in r))).toBe(true);
  });

  it("offers the pack only on a Talk showcase event with no templates", () => {
    const talk = applyPreset("talk_showcase");
    expect(
      shouldOfferSpeakerPack({ templateCount: 0, overrides: talk, setupEventType: "talk_showcase" }),
    ).toBe(true);
    expect(shouldOfferSpeakerPack({ templateCount: 0, overrides: talk })).toBe(true);
    expect(
      shouldOfferSpeakerPack({ templateCount: 1, overrides: talk, setupEventType: "talk_showcase" }),
    ).toBe(false);
    expect(
      shouldOfferSpeakerPack({
        templateCount: 0,
        overrides: applyPreset("pd_day"),
        setupEventType: "pd_day",
      }),
    ).toBe(false);
  });
});

describe("Talk showcase trademark copy (TALK-1)", () => {
  it("no product string says the forbidden preset name", () => {
    const root = join(__dirname, "../../..");
    const skipDir = new Set(["node_modules", "dist", ".next", "coverage", ".git"]);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skipDir.has(name)) continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx|md|json)$/.test(name)) files.push(full);
      }
    };
    walk(join(root, "apps"));
    walk(join(root, "packages"));

    const banned = new RegExp(`${"TED"}[xX]\\s+preset`);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (banned.test(text)) hits.push(file);
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
