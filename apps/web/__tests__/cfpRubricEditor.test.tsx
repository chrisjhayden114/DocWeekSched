/**
 * @vitest-environment jsdom
 */

import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CfpRubricEditor } from "../components/organizer/CfpRubricEditor";
import { defaultCfpRubricRows, type CfpRubricRow } from "../lib/cfpRubric";

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

function Harness({ initial = defaultCfpRubricRows() }: { initial?: CfpRubricRow[] }) {
  const [rows, setRows] = useState(initial);
  return <CfpRubricEditor rows={rows} onChange={setRows} />;
}

describe("K-7 — CfpRubricEditor", () => {
  it("starts with Novelty / Clarity / Rigor and no JSON", () => {
    render(<Harness />);
    const names = [...container.querySelectorAll<HTMLInputElement>(".cfp-rubric-row input")]
      .filter((el) => el.type !== "number")
      .map((el) => el.value);
    expect(container.textContent).toContain("Review criteria");
    expect(names).toEqual(["Novelty", "Clarity", "Rigor"]);
    expect(container.textContent).not.toMatch(/JSON/i);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelectorAll(".cfp-rubric-row").length).toBe(3);
  });

  it("adds and removes rows; the last row cannot be removed", () => {
    render(<Harness />);
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add criterion")!;
    act(() => add.click());
    expect(container.querySelectorAll(".cfp-rubric-row").length).toBe(4);

    const removeButtons = () =>
      [...container.querySelectorAll("button")].filter((b) => b.textContent === "Remove");
    act(() => removeButtons()[3].click());
    expect(container.querySelectorAll(".cfp-rubric-row").length).toBe(3);
    act(() => removeButtons()[2].click());
    act(() => removeButtons()[1].click());
    expect(container.querySelectorAll(".cfp-rubric-row").length).toBe(1);
    expect(removeButtons()[0].disabled).toBe(true);
  });
});
