/**
 * @vitest-environment jsdom
 *
 * CERT-2 — image-background certificates, organizer side.
 *
 * The claim the preview makes is that it is not an approximation: it positions
 * the sample name with `certificateNamePlacement`, the same helper the pdfkit
 * renderer calls, so what the organizer positions is what issues. These tests
 * pin that (the rendered inline styles must equal the helper's output), pin the
 * v1 shape of the control set (slider + stepper + colour, no draggable box),
 * and pin the patch contract that keeps a slider nudge from resending
 * megabytes of artwork.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CERTIFICATE_BACKGROUND_MAX_BYTES,
  CERTIFICATE_NAME_COLORS,
  CERTIFICATE_PREVIEW_SAMPLE_NAME,
  certificateNamePlacement,
  certificatePageAspectRatio,
  normalizeCertificateNameBox,
} from "@event-app/shared";
import { CertificateDesignPreview } from "../components/organizer/CertificateDesignPreview";
import { CONSOLE_TAB_ALWAYS_OVERFLOW } from "../lib/tabOverflow";
import { EVENT_TABS, resolveEventTab } from "../lib/eventTabs";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const webRoot = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(webRoot, ...parts), "utf8");
const tabSource = read("components", "organizer", "CertificatesTab.tsx");
const previewSource = read("components", "organizer", "CertificateDesignPreview.tsx");
/** Code only — the comments discuss the very patterns some of these tests forbid. */
const tabCode = tabSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: ReactElement) {
  act(() => root.render(node));
}

/** jsdom has no layout, so the preview falls back to its nominal width. */
const PREVIEW_WIDTH = 640;

describe("CERT-2 preview draws where the renderer draws", () => {
  it("positions the sample name from the shared placement helper", () => {
    const nameBox = normalizeCertificateNameBox({
      yPct: 68,
      fontSize: 44,
      color: CERTIFICATE_NAME_COLORS.light,
      align: "center",
    });
    render(
      <CertificateDesignPreview
        backgroundImageUrl="data:image/png;base64,iVBORw0KGgo="
        nameBox={nameBox}
        orientation="LANDSCAPE"
      />,
    );

    const name = container.querySelector<HTMLElement>(".cert-preview-name");
    expect(name?.textContent).toBe(CERTIFICATE_PREVIEW_SAMPLE_NAME);

    const expected = certificateNamePlacement({
      orientation: "LANDSCAPE",
      nameBox,
      surfaceWidth: PREVIEW_WIDTH,
    });
    expect(name!.style.left).toBe(`${expected.x}px`);
    expect(name!.style.width).toBe(`${expected.width}px`);
    expect(name!.style.top).toBe(`${expected.centerY}px`);
    expect(name!.style.fontSize).toBe(`${expected.fontSize}px`);
    expect(name!.style.textAlign).toBe("center");
  });

  it("anchors the name on its vertical centre so resizing does not move it", () => {
    // translateY(-50%) is the CSS twin of the renderer subtracting half the
    // measured line height from centerY: the slider position means "the name
    // sits here" at any font size.
    const css = read("styles", "globals.css");
    const rule = css.slice(css.indexOf(".cert-preview-name"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("translateY(-50%)");

    const small = certificateNamePlacement({
      orientation: "LANDSCAPE",
      nameBox: { yPct: 40, fontSize: 14 },
      surfaceWidth: PREVIEW_WIDTH,
    });
    const large = certificateNamePlacement({
      orientation: "LANDSCAPE",
      nameBox: { yPct: 40, fontSize: 60 },
      surfaceWidth: PREVIEW_WIDTH,
    });
    expect(small.centerY).toBeCloseTo(large.centerY, 6);
  });

  it("takes the page shape from the chosen orientation", () => {
    for (const orientation of ["LANDSCAPE", "PORTRAIT"] as const) {
      render(
        <CertificateDesignPreview
          backgroundImageUrl={null}
          nameBox={normalizeCertificateNameBox({})}
          orientation={orientation}
        />,
      );
      const frame = container.querySelector<HTMLElement>(".cert-preview");
      expect(frame!.style.aspectRatio).toBe(`1 / ${certificatePageAspectRatio(orientation)}`);
    }
  });

  it("says what to do instead of showing an empty frame before an upload", () => {
    render(
      <CertificateDesignPreview
        backgroundImageUrl={null}
        nameBox={normalizeCertificateNameBox({})}
        orientation="LANDSCAPE"
      />,
    );
    expect(container.querySelector(".cert-preview-art")).toBeNull();
    expect(container.querySelector(".cert-preview-placeholder")?.textContent).toMatch(/upload/i);
  });

  it("crops the artwork the same way pdfkit's `cover` does", () => {
    // A design exported in a different shape must be cropped in the preview
    // exactly as it will be in the PDF, never letterboxed or squashed.
    const css = read("styles", "globals.css");
    const rule = css.slice(css.indexOf(".cert-preview-art"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("object-fit: cover");
    expect(previewSource).toContain("certificateNamePlacement");
  });
});

describe("CERT-2 organizer controls are the v1 set", () => {
  it("offers a kind switch between the built-in layout and an uploaded design", () => {
    expect(tabSource).toContain('label: "Built-in layout"');
    expect(tabSource).toContain('label: "Your own design"');
    expect(tabSource).toContain('id: "IMAGE_BACKGROUND"');
  });

  it("gives exactly one placement control: a vertical slider, centred name", () => {
    expect(tabSource).toContain('type="range"');
    expect(tabSource).toContain("yPct");
    // No draggable box, no WYSIWYG canvas — the v1 line from the design doc.
    expect(tabCode).not.toMatch(/onDrag|draggable|onMouseDown|onPointerDown|xPct|widthPct/);
  });

  it("has a font-size stepper bounded by the shared limits", () => {
    expect(tabSource).toContain("CERTIFICATE_NAME_FONT_SIZE_MIN");
    expect(tabSource).toContain("CERTIFICATE_NAME_FONT_SIZE_MAX");
    expect(tabSource).toContain("CERTIFICATE_NAME_FONT_SIZE_STEP");
  });

  it("offers the light/dark colour choice and nothing more", () => {
    expect(tabSource).toContain("CERTIFICATE_NAME_COLORS.dark");
    expect(tabSource).toContain("CERTIFICATE_NAME_COLORS.light");
    expect(Object.keys(CERTIFICATE_NAME_COLORS)).toEqual(["dark", "light"]);
  });

  it("accepts PNG/JPG up to the shared ceiling, and passes the file through untouched", () => {
    expect(tabSource).toContain("CERTIFICATE_BACKGROUND_ACCEPT");
    expect(tabSource).toContain("CERTIFICATE_BACKGROUND_MAX_BYTES");
    expect(CERTIFICATE_BACKGROUND_MAX_BYTES).toBe(10_000_000);
    // Deliberately not EventBrandingFields#fileToDataUrl: that resizes to 512px
    // and re-encodes as JPEG, which would wreck the type and logos in a
    // finished certificate design.
    expect(tabSource).toContain("readFileAsDataUrl");
    expect(tabCode).not.toContain("EventBrandingFields");
    expect(tabCode).not.toContain("BRANDING_IMAGE_RULES");
  });

  it("omits the artwork from the payload unless it actually changed", () => {
    expect(tabSource).toContain("backgroundDirty");
    expect(tabSource).toContain("if (form.backgroundDirty || !form.id)");
  });

  it("is honest that only the name is overlaid, and recommends the export width", () => {
    expect(tabSource).toContain("CERTIFICATE_NAME_ONLY_NOTE");
    expect(tabSource).toContain("CERTIFICATE_BACKGROUND_GUIDANCE");
  });

  it("shares eligibility, issuing, and the verify page with the built-in kind", () => {
    // CERT-2 touches none of that machinery, so the tab must not reimplement it.
    expect(tabSource).toContain("eligibilityRule");
    expect(tabCode).not.toContain("/batch");
    expect(tabCode).not.toContain("/issue");
  });
});

describe("CERT-2 console wiring", () => {
  it("adds a certificates tab that resolves from ?tab=", () => {
    expect(EVENT_TABS).toContain("certificates");
    expect(resolveEventTab("certificates")).toEqual({
      tab: "certificates",
      urlTab: "certificates",
      rewrite: false,
    });
  });

  it("pins the tab into More ▾ beside Ops and Recap", () => {
    expect([...CONSOLE_TAB_ALWAYS_OVERFLOW]).toContain("certificates");
  });

  it("only shows the tab when the resolved feature is on", () => {
    const page = read("pages", "organizer", "events", "[eventId]", "index.tsx");
    expect(page).toContain("certificatesEnabled");
    expect(page).toContain('f.key === "certificates"');
    // A deep link with the feature off explains itself instead of rendering nothing.
    expect(page).toMatch(/Certificates aren&apos;t enabled for this event/);
  });
});
