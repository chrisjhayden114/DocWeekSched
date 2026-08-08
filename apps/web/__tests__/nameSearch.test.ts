import { describe, expect, it } from "vitest";
import { matchesNameQuery } from "../lib/nameSearch";

describe("matchesNameQuery", () => {
  it("matches out-of-order multi-word queries", () => {
    expect(matchesNameQuery("Dr. Maya Chen", "chen maya")).toBe(true);
  });

  it("matches a single first-name token", () => {
    expect(matchesNameQuery("Dr. Maya Chen", "maya")).toBe(true);
  });

  it("matches a single last-name token", () => {
    expect(matchesNameQuery("Dr. Maya Chen", "chen")).toBe(true);
  });

  it("rejects tokens not present in the haystack", () => {
    expect(matchesNameQuery("Dr. Maya Chen", "zed")).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(matchesNameQuery("Dr. Maya Chen", "")).toBe(true);
  });

  it("matches everything for a whitespace-only query", () => {
    expect(matchesNameQuery("Dr. Maya Chen", "   ")).toBe(true);
  });
});
