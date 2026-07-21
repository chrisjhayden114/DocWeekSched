import { describe, expect, it } from "vitest";
import { sayHiPrefill, splitInterestTokens } from "../lib/sayHi";

describe("sayHiPrefill", () => {
  it("includes first name, event, and first shared interest", () => {
    expect(
      sayHiPrefill({
        toName: "Ada Lovelace",
        eventName: "DocWeek 2026",
        myInterests: "AI, equity",
        theirInterests: "Equity; measurement",
      }),
    ).toBe("Hi Ada — I'm also at DocWeek 2026. Would love to compare notes on Equity.");
  });

  it("omits interest clause when none are shared", () => {
    expect(
      sayHiPrefill({
        toName: "Grace",
        eventName: "Summit",
        myInterests: "AI",
        theirInterests: "history",
      }),
    ).toBe("Hi Grace — I'm also at Summit. Would love to compare notes.");
  });

  it("splits interest tokens on commas, semicolons, and newlines", () => {
    expect(splitInterestTokens("a, b; c\nd")).toEqual(["a", "b", "c", "d"]);
  });
});
