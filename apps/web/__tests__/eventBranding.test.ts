import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NEUTRAL_EVENT_ACCENT, accentFromBrand } from "../lib/eventAccent";

/**
 * BRAND-2 (3) — branding input is one calm optional step, defaulting to the
 * NEUTRAL platform look.
 *
 * Two things are pinned here. First, no surface that collects branding may
 * seed a colour of its own (the wizard and the settings panel both used to
 * seed UKEDL blue, so a neutral event silently adopted the platform brand on
 * the next save). Second, the wizard and the settings panel collect branding
 * through the SAME component, so the upload size/type limits cannot drift
 * apart — the class of bug where one surface accepts what the other rejects.
 */

const webDir = join(__dirname, "..");
const wizardSrc = readFileSync(join(webDir, "pages", "organizer", "events", "new.tsx"), "utf8");
const settingsSrc = readFileSync(
  join(webDir, "components", "organizer", "EventSettingsSlideOver.tsx"),
  "utf8",
);
const brandingFieldsSrc = readFileSync(
  join(webDir, "components", "organizer", "EventBrandingFields.tsx"),
  "utf8",
);

/** UKEDL blue — the platform's own brand, never an event's default. */
const UKEDL_BLUE = /#0033a0/i;

describe("no branding surface seeds UKEDL blue", () => {
  it("the wizard starts with no colour chosen", () => {
    expect(wizardSrc).not.toMatch(UKEDL_BLUE);
    expect(wizardSrc).toContain('const [brandColor, setBrandColor] = useState("")');
  });

  it("the settings panel shows the stored colour or nothing", () => {
    expect(settingsSrc).not.toMatch(UKEDL_BLUE);
    expect(settingsSrc).toContain('brandColor: event.brandColor || ""');
  });

  it("the shared branding form offers the neutral accent, not a brand colour", () => {
    expect(brandingFieldsSrc).not.toMatch(UKEDL_BLUE);
    expect(brandingFieldsSrc).toContain("emptyHex={NEUTRAL_EVENT_ACCENT.accent}");
  });
});

describe("an event with no chosen colour renders neutral", () => {
  it("the wizard's empty default flows through the shared derivation to the neutral accent", () => {
    // The wizard sends `brandColor.trim() || null`; both ends of that
    // expression must land on the neutral accent, not on a bright default.
    expect(accentFromBrand("")).toEqual(NEUTRAL_EVENT_ACCENT);
    expect(accentFromBrand(null)).toEqual(NEUTRAL_EVENT_ACCENT);
    expect(wizardSrc).toContain("brandColor: brandColor.trim() || null");
  });

  it("every event-scoped shell derives its accent from the stored colour alone", () => {
    // No surface may substitute its own fallback — absence is handled once, in
    // eventAccent.ts. (BRAND-1 wired these; this guards the seam.)
    for (const file of [
      ["pages", "dashboard.tsx"],
      ["pages", "e", "[slug].tsx"],
      ["pages", "session", "[sessionId].tsx"],
      ["pages", "r", "[token].tsx"],
    ]) {
      const src = readFileSync(join(webDir, ...file), "utf8");
      expect(src, file.join("/")).toMatch(/eventAccentStyle\((?:view\?\.)?event(\?)?\.brandColor\)/);
      expect(src, file.join("/")).not.toMatch(UKEDL_BLUE);
    }
  });
});

describe("branding is collected in one place, with one set of limits", () => {
  it("both surfaces render the shared branding form", () => {
    expect(wizardSrc).toContain("<EventBrandingFields");
    expect(settingsSrc).toContain("<EventBrandingFields");
  });

  it("neither surface keeps its own uploader, image resize, or byte limit", () => {
    for (const [name, src] of [
      ["wizard", wizardSrc],
      ["settings", settingsSrc],
    ] as const) {
      expect(src, name).not.toContain("UploadDropzone");
      expect(src, name).not.toContain("fileToDataUrl");
      expect(src, name).not.toContain("maxBytes");
    }
  });

  it("the limits are the ones the settings panel already enforced", () => {
    // Logo 2MB / 512px, banner 4.5MB / 1920×720 — reused, not re-guessed.
    expect(brandingFieldsSrc).toContain("logo: { maxBytes: 2_000_000, maxWidth: 512, maxHeight: 512");
    expect(brandingFieldsSrc).toContain(
      "banner: { maxBytes: 4_500_000, maxWidth: 1920, maxHeight: 720",
    );
    expect(brandingFieldsSrc).toContain('accept="image/*"');
  });

  it("the branding step is honestly optional and says what empty means", () => {
    expect(wizardSrc).toContain("Branding (optional)");
    expect(wizardSrc).toMatch(/neutral platform look/);
    expect(brandingFieldsSrc).toMatch(/Left empty, this event wears the neutral platform look/);
  });
});

describe("clearing branding reaches the server as a clear, not an omission", () => {
  it("the settings panel sends explicit nulls for emptied branding fields", () => {
    for (const field of ["brandColor", "logoUrl", "bannerUrl"]) {
      expect(settingsSrc).toContain(`${field}: form.${field}.trim() || null`);
    }
  });
});
