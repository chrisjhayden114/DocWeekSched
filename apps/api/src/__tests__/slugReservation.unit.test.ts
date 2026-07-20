/**
 * Phase 7 Chunk B — reserved event slugs (unit).
 */

import { describe, expect, it } from "vitest";
import { brand } from "@event-app/config";
import { isReservedEventSlug } from "../lib/slug";

describe("isReservedEventSlug", () => {
  it("reserves the public demo slug", () => {
    expect(isReservedEventSlug(brand.demoEventSlug)).toBe(true);
    expect(isReservedEventSlug("demo")).toBe(true);
    expect(isReservedEventSlug(" DEMO ")).toBe(true);
  });

  it("reserves sample and the sample- prefix", () => {
    expect(isReservedEventSlug("sample")).toBe(true);
    expect(isReservedEventSlug("sample-foo")).toBe(true);
    expect(isReservedEventSlug("sample-m3k2j1")).toBe(true);
  });

  it("does not reserve ordinary or merely similar slugs", () => {
    expect(isReservedEventSlug("demo-day-2026")).toBe(false);
    expect(isReservedEventSlug("samples")).toBe(false);
    expect(isReservedEventSlug("my-conference")).toBe(false);
    expect(isReservedEventSlug("event-demo")).toBe(false);
  });
});
