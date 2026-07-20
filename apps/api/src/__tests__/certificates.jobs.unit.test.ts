import { describe, expect, it } from "vitest";
import { mapPool } from "../lib/certificates/jobs";

describe("Phase P4 batch concurrency helper", () => {
  it("mapPool respects concurrency bound and visits every item", async () => {
    let inflight = 0;
    let maxInflight = 0;
    const seen: number[] = [];

    await mapPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      inflight -= 1;
    });

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(maxInflight).toBeLessThanOrEqual(3);
    expect(maxInflight).toBeGreaterThan(1);
  });
});
