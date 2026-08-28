/**
 * @vitest-environment jsdom
 *
 * K-2.1 — one illustration per feature category.
 */

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FEATURE_GUIDE_CATEGORY_LABEL, type FeatureCategory } from "@event-app/shared";
import { FEATURE_ART, FeatureArt } from "../components/featureArt";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

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

function render(element: ReactElement) {
  act(() => root.render(element));
}

const CATEGORIES = Object.keys(FEATURE_GUIDE_CATEGORY_LABEL) as FeatureCategory[];

describe("featureArt", () => {
  it("covers every feature category with a 16:9 vignette", () => {
    expect(Object.keys(FEATURE_ART).sort()).toEqual([...CATEGORIES].sort());
    for (const category of CATEGORIES) {
      render(<FeatureArt category={category} />);
      const svg = container.querySelector("svg.feature-art");
      expect(svg, category).not.toBeNull();
      expect(svg!.getAttribute("viewBox")).toBe("0 0 400 225");
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
