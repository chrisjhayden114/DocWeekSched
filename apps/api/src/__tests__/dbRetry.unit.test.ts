/**
 * HARDEN-2 — withDbRetry retries only connection-class Prisma failures.
 */

import { describe, expect, it, vi } from "vitest";
import { withDbRetry } from "../lib/dbRetry";

function prismaError(code: string, name = "PrismaClientKnownRequestError"): Error {
  const err = new Error(`Prisma failed with ${code}`) as Error & { code: string };
  err.name = name;
  err.code = code;
  return err;
}

describe("withDbRetry", () => {
  it("retries on P1001 then succeeds", async () => {
    let n = 0;
    const result = await withDbRetry(
      async () => {
        n += 1;
        if (n === 1) throw prismaError("P1001");
        return "ok";
      },
      { retries: 3, baseDelayMs: 0 },
    );
    expect(result).toBe("ok");
    expect(n).toBe(2);
  });

  it("gives up after 3", async () => {
    let n = 0;
    await expect(
      withDbRetry(
        async () => {
          n += 1;
          throw prismaError("P1001");
        },
        { retries: 3, baseDelayMs: 0 },
      ),
    ).rejects.toMatchObject({ code: "P1001" });
    expect(n).toBe(3);
  });

  it("does not retry P2002", async () => {
    let n = 0;
    await expect(
      withDbRetry(
        async () => {
          n += 1;
          throw prismaError("P2002");
        },
        { retries: 3, baseDelayMs: 0 },
      ),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(n).toBe(1);
  });

  it("retries the Server-has-closed-the-connection message", async () => {
    let n = 0;
    const result = await withDbRetry(
      async () => {
        n += 1;
        if (n === 1) throw new Error("Error in PostgreSQL connection: Server has closed the connection.");
        return "recovered";
      },
      { retries: 3, baseDelayMs: 0 },
    );
    expect(result).toBe("recovered");
    expect(n).toBe(2);
  });

  it("backs off exponentially with jitter between retries", async () => {
    vi.useFakeTimers();
    let n = 0;
    const pending = withDbRetry(
      async () => {
        n += 1;
        throw prismaError("P1017");
      },
      { retries: 3, baseDelayMs: 250 },
    ).catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(10_000);
    const err = await pending;
    expect(err).toMatchObject({ code: "P1017" });
    expect(n).toBe(3);
    vi.useRealTimers();
  });
});
