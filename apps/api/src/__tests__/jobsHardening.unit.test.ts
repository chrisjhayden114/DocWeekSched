/**
 * HARDEN-1 (2) + Sentry grouping — the job runner's two failure modes.
 *
 * (2) runOne sets a row RUNNING *before* calling the handler, so a crash or a
 *     dropped DB connection mid-handler used to strand it: processDueJobs only
 *     swept PENDING/FAILED, so nothing ever looked at that row again.
 *
 * Both suites drive the real processDueJobs against an in-memory prisma mock
 * (same approach as billingPlanSku.unit.test — the DB suites are guarded and
 * must not run without ALLOW_DESTRUCTIVE_DB).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type JobRow = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  progress: number;
  progressMessage: string | null;
  error: string | null;
  result?: unknown;
  input: unknown;
  organizationId: string | null;
  eventId: string | null;
  createdById: string | null;
  scheduledAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

const state = vi.hoisted(() => ({ jobs: new Map<string, Record<string, unknown>>() }));

vi.mock("../lib/ai/audit", () => ({ writeAuditLog: async () => {} }));

vi.mock("../lib/db", () => {
  /** Enough of Prisma's where semantics for the candidates query, including the
   *  rule that matters here: null never satisfies a lt/lte comparison. */
  const matches = (row: Record<string, unknown>, clause: Record<string, unknown>): boolean => {
    for (const [field, cond] of Object.entries(clause)) {
      const value = row[field];
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
        const { lt, lte } = cond as { lt?: Date; lte?: Date };
        if (lt !== undefined && !(value instanceof Date && value.getTime() < lt.getTime())) return false;
        if (lte !== undefined && !(value instanceof Date && value.getTime() <= lte.getTime())) return false;
      } else if (value !== cond) {
        return false;
      }
    }
    return true;
  };

  return {
    prisma: {
      backgroundJob: {
        findMany: async ({
          where,
          take,
        }: {
          where: { OR: Record<string, unknown>[] };
          take?: number;
        }) => {
          const rows = [...state.jobs.values()].filter((row) =>
            where.OR.some((clause) => matches(row, clause)),
          );
          rows.sort(
            (a, b) => (a.scheduledAt as Date).getTime() - (b.scheduledAt as Date).getTime(),
          );
          return take ? rows.slice(0, take) : rows;
        },
        findUnique: async ({ where }: { where: { id: string } }) =>
          state.jobs.get(where.id) ?? null,
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = state.jobs.get(where.id);
          if (!row) throw new Error(`No BackgroundJob ${where.id}`);
          for (const [key, value] of Object.entries(data)) {
            if (value === undefined) continue;
            if (value !== null && typeof value === "object" && "increment" in value) {
              row[key] = (row[key] as number) + (value as { increment: number }).increment;
            } else {
              row[key] = value;
            }
          }
          return row;
        },
      },
    },
  };
});

import { BackgroundJobStatus } from "@prisma/client";
import {
  STALE_RUNNING_RECLAIM_MS,
  jobCaptureContext,
  processDueJobs,
  registerJobHandler,
} from "../lib/jobs";

const MINUTE = 60_000;

function seedJob(overrides: Partial<JobRow> & { id: string }): JobRow {
  const row: JobRow = {
    type: "harden.test",
    status: BackgroundJobStatus.PENDING,
    attempts: 0,
    maxAttempts: 3,
    progress: 0,
    progressMessage: null,
    error: null,
    input: {},
    organizationId: null,
    eventId: null,
    createdById: null,
    scheduledAt: new Date(Date.now() - MINUTE),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
  state.jobs.set(row.id, row as unknown as Record<string, unknown>);
  return row;
}

const read = (id: string) => state.jobs.get(id) as unknown as JobRow;

let handlerCalls: string[] = [];
let warnLines: string[] = [];

beforeEach(() => {
  state.jobs.clear();
  handlerCalls = [];
  warnLines = [];
  registerJobHandler("harden.test", async (job) => {
    handlerCalls.push(job.id);
  });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnLines.push(args.map((a) => String(a)).join(" "));
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processDueJobs — stale RUNNING reclaim (HARDEN-1)", () => {
  it("reclaims a job stranded in RUNNING past the stale window", async () => {
    seedJob({
      id: "stranded",
      status: BackgroundJobStatus.RUNNING,
      attempts: 1,
      startedAt: new Date(Date.now() - STALE_RUNNING_RECLAIM_MS - MINUTE),
    });

    const processed = await processDueJobs();

    expect(processed).toBe(1);
    expect(handlerCalls).toEqual(["stranded"]);
    const job = read("stranded");
    expect(job.status).toBe(BackgroundJobStatus.SUCCEEDED);
    // The reclaimed run consumes an attempt, so a permanently crashing job
    // still walks to DEAD instead of looping forever.
    expect(job.attempts).toBe(2);
  });

  it("logs the reclaim so a crash loop is visible to ops", async () => {
    seedJob({
      id: "stranded",
      status: BackgroundJobStatus.RUNNING,
      attempts: 1,
      startedAt: new Date(Date.now() - STALE_RUNNING_RECLAIM_MS - MINUTE),
    });

    await processDueJobs();

    expect(warnLines.some((line) => line.includes("reclaiming stale RUNNING job"))).toBe(true);
  });

  it("leaves a genuinely in-flight RUNNING job alone", async () => {
    seedJob({
      id: "in-flight",
      status: BackgroundJobStatus.RUNNING,
      attempts: 1,
      startedAt: new Date(Date.now() - 2 * MINUTE),
    });

    const processed = await processDueJobs();

    expect(processed).toBe(0);
    expect(handlerCalls).toEqual([]);
    expect(read("in-flight").status).toBe(BackgroundJobStatus.RUNNING);
  });

  it("never selects a RUNNING row with no startedAt", async () => {
    seedJob({ id: "no-start", status: BackgroundJobStatus.RUNNING, attempts: 1, startedAt: null });

    expect(await processDueJobs()).toBe(0);
    expect(handlerCalls).toEqual([]);
  });

  it("marks a stale RUNNING job DEAD once attempts are exhausted", async () => {
    seedJob({
      id: "exhausted",
      status: BackgroundJobStatus.RUNNING,
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(Date.now() - STALE_RUNNING_RECLAIM_MS - MINUTE),
    });

    const processed = await processDueJobs();

    expect(processed).toBe(0);
    expect(handlerCalls).toEqual([]);
    const job = read("exhausted");
    expect(job.status).toBe(BackgroundJobStatus.DEAD);
    expect(job.finishedAt).toBeInstanceOf(Date);
  });

  it("still sweeps PENDING and FAILED jobs, and still ignores future work", async () => {
    seedJob({ id: "pending" });
    seedJob({ id: "failed", status: BackgroundJobStatus.FAILED, attempts: 1 });
    seedJob({ id: "later", scheduledAt: new Date(Date.now() + 10 * MINUTE) });

    const processed = await processDueJobs();

    expect(processed).toBe(2);
    expect(handlerCalls.sort()).toEqual(["failed", "pending"]);
    expect(read("later").status).toBe(BackgroundJobStatus.PENDING);
  });
});

describe("jobCaptureContext — Sentry grouping for connection-drop bursts", () => {
  function prismaError(code: string, name = "PrismaClientKnownRequestError"): Error {
    const err = new Error(`Prisma failed with ${code}`) as Error & { code: string };
    err.name = name;
    err.code = code;
    return err;
  }

  it("gives every connection drop the same fingerprint, whatever the job type", () => {
    const drops = ["P1001", "P1002", "P1008", "P1017", "P2024"].map((code, i) =>
      jobCaptureContext(prismaError(code), { jobType: `handler.${i}`, jobId: `job_${i}` }),
    );
    const poller = jobCaptureContext(prismaError("P1017"), { area: "job_poller" });

    const fingerprints = new Set([...drops, poller].map((c) => JSON.stringify(c.fingerprint)));
    expect(fingerprints.size).toBe(1);
    expect([...fingerprints][0]).not.toBe(undefined);
  });

  it("keeps the job type and Prisma code as searchable tags", () => {
    const ctx = jobCaptureContext(
      prismaError("P1017"),
      { jobType: "certificates.render", jobId: "job_1" },
      { dead: false },
    );
    expect(ctx.tags).toMatchObject({
      jobType: "certificates.render",
      jobId: "job_1",
      prismaCode: "P1017",
      dbConnectionDrop: "true",
    });
    expect(ctx.extra).toEqual({ dead: false });
  });

  it("leaves ordinary job failures on default stack grouping", () => {
    expect(jobCaptureContext(new Error("handler blew up"), { jobType: "a" }).fingerprint).toBe(
      undefined,
    );
    // A real Prisma bug (unique violation) is not an infra blip — keep it distinct.
    expect(jobCaptureContext(prismaError("P2002"), { jobType: "a" }).fingerprint).toBe(undefined);
    // A non-Prisma error that happens to carry a `code` must not be swept in.
    const enoent = new Error("no such file") as Error & { code: string };
    enoent.code = "P1001";
    expect(jobCaptureContext(enoent, { jobType: "a" }).fingerprint).toBe(undefined);
  });

  it("groups the Server-has-closed-the-connection message with other drops", () => {
    const closed = jobCaptureContext(new Error("Server has closed the connection"), {
      area: "job_poller",
    });
    const coded = jobCaptureContext(prismaError("P1017"), { area: "job_poller" });
    expect(closed.fingerprint).toEqual(coded.fingerprint);
    expect(closed.tags.prismaCode).toBe("P1017");
  });
});
