import { describe, expect, it } from "vitest";
import { publicEventUrl } from "../lib/organizerLinks";

/** H1 — pure URL helper; openAttendeeApp is window.location and stays untested. */
describe("H1 — publicEventUrl", () => {
  it("returns the relative /e/{slug} path", () => {
    expect(publicEventUrl("ib-dunia-2025")).toBe("/e/ib-dunia-2025");
  });

  it("preserves the slug as given (no encoding)", () => {
    expect(publicEventUrl("my-event")).toBe("/e/my-event");
  });
});
