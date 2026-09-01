import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const panel = readFileSync(join(__dirname, "../components/MatchmakerPanel.tsx"), "utf8");

describe("MatchmakerPanel — person chips", () => {
  it("uses the directory initials fallback, never a bare gray box", () => {
    expect(panel).toContain("attendee-avatar-placeholder");
    expect(panel).toContain("matchmaker-avatar");
    expect(panel).toContain("name.trim().charAt(0)");
    expect(panel).not.toMatch(/borderRadius:\s*8[\s\S]{0,80}event-accent-tint/);
  });
});
