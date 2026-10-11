/**
 * DEMO-EXPLORERS-1 — stable presenter portal tokens.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  DEMO_PRESENTER_PORTAL_TOKEN,
  DEMO_PRESENTER_PORTAL_TOKEN_2,
} from "../lib/demoEvent/reset";

const HEX_64 = /^[0-9a-f]{64}$/;

describe("DEMO-EXPLORERS-1 presenter portal tokens", () => {
  it("both tokens are 64 hex chars and distinct", () => {
    expect(DEMO_PRESENTER_PORTAL_TOKEN).toMatch(HEX_64);
    expect(DEMO_PRESENTER_PORTAL_TOKEN_2).toMatch(HEX_64);
    expect(DEMO_PRESENTER_PORTAL_TOKEN).not.toBe(DEMO_PRESENTER_PORTAL_TOKEN_2);
  });

  it("matches the tokens hardcoded in public/_redirects", () => {
    const source = readFileSync(resolve(__dirname, "../../../web/public/_redirects"), "utf8");
    expect(source).toContain(`/demo/presenter    /r/${DEMO_PRESENTER_PORTAL_TOKEN}  302`);
    expect(source).toContain(`/demo/presenter-2  /r/${DEMO_PRESENTER_PORTAL_TOKEN_2}  302`);
  });
});
