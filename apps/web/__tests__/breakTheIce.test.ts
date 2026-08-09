import { describe, expect, it } from "vitest";
import { MAX_BREAK_THE_ICE, personalizeOpener } from "../lib/breakTheIce";

describe("personalizeOpener", () => {
  it("replaces a single {name} placeholder", () => {
    expect(personalizeOpener("Hi {name}, welcome!", "Ada")).toBe("Hi Ada, welcome!");
  });

  it("replaces every {name} placeholder", () => {
    expect(personalizeOpener("{name}? Is that you, {name}?", "Grace")).toBe("Grace? Is that you, Grace?");
  });

  it("falls back to \"there\" when the name is empty", () => {
    expect(personalizeOpener("Hi {name}!", "")).toBe("Hi there!");
  });

  it("falls back to \"there\" when the name is only whitespace", () => {
    expect(personalizeOpener("Hi {name}!", "   ")).toBe("Hi there!");
  });

  it("trims surrounding whitespace from the result", () => {
    expect(personalizeOpener("  Hi {name}!  ", "Ada")).toBe("Hi Ada!");
  });
});

describe("MAX_BREAK_THE_ICE", () => {
  it("caps a batch at 10 people", () => {
    expect(MAX_BREAK_THE_ICE).toBe(10);
  });
});
