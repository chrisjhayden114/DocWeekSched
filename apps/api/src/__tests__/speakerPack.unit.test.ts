import { describe, expect, it } from "vitest";
import {
  SPEAKER_PACK_REQUIREMENTS,
  SPEAKER_PACK_TEMPLATE_NAME,
  applyPreset,
  shouldOfferSpeakerPack,
} from "@event-app/shared";

describe("Speaker pack seed (TALK-1)", () => {
  it("creates Speaker pack contents matching the design-doc list", () => {
    expect(SPEAKER_PACK_TEMPLATE_NAME).toBe("Speaker pack");
    expect(SPEAKER_PACK_REQUIREMENTS.map((r) => r.label)).toEqual([
      "Headshot",
      "Short bio ≤100 words",
      "Talk title & one-line description",
      "Rough outline",
      "Draft 1 script",
      "Draft 2 script",
      "Final script",
      "Slides 16:9",
      "Signed speaker release",
      "Copyright clearance",
      "AV needs",
      "Dress rehearsal confirmed",
      "Coach assigned",
      "Rehearsal booked",
      "Intro written",
    ]);
    expect(SPEAKER_PACK_REQUIREMENTS.find((r) => r.label === "Signed speaker release")?.helpText).toBe(
      "upload the signed release PDF",
    );
    expect(SPEAKER_PACK_REQUIREMENTS.find((r) => r.label === "AV needs")?.config?.options).toEqual([
      "handheld mic",
      "headset",
      "clicker",
      "video in talk",
      "none",
    ]);
    expect(SPEAKER_PACK_REQUIREMENTS.filter((r) => r.kind === "internal_checklist").map((r) => r.label)).toEqual([
      "Coach assigned",
      "Rehearsal booked",
      "Intro written",
    ]);
    expect(SPEAKER_PACK_REQUIREMENTS.every((r) => !("dueAt" in r))).toBe(true);
  });

  it("does not auto-offer when templates already exist", () => {
    expect(
      shouldOfferSpeakerPack({
        templateCount: 0,
        overrides: applyPreset("talk_showcase"),
      }),
    ).toBe(true);
    expect(
      shouldOfferSpeakerPack({
        templateCount: 2,
        overrides: applyPreset("talk_showcase"),
        setupEventType: "talk_showcase",
      }),
    ).toBe(false);
  });
});
