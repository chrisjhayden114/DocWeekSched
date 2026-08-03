import { describe, expect, it } from "vitest";
import {
  INGEST_POLL_HARD_STOP_MS,
  INGEST_POLL_OVERTIME_MS,
  formatElapsed,
  ingestPollDelayMs,
  ingestStageLabel,
  isIngestRunActive,
} from "../lib/ingestStatus";

describe("ingestPollDelayMs", () => {
  it("polls quickly at first and backs off as the run gets longer", () => {
    expect(ingestPollDelayMs(0)).toBe(400);
    expect(ingestPollDelayMs(9_999)).toBe(400);
    expect(ingestPollDelayMs(10_000)).toBe(1_000);
    expect(ingestPollDelayMs(59_999)).toBe(1_000);
    expect(ingestPollDelayMs(60_000)).toBe(2_000);
    expect(ingestPollDelayMs(INGEST_POLL_OVERTIME_MS - 1)).toBe(2_000);
    expect(ingestPollDelayMs(INGEST_POLL_OVERTIME_MS)).toBe(5_000);
  });

  it("keeps a real ceiling well past observed run times (2+ minutes)", () => {
    // A 7-page PDF has been observed taking over two minutes; the page must
    // keep watching far beyond that instead of dumping the user to history.
    expect(INGEST_POLL_OVERTIME_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(INGEST_POLL_HARD_STOP_MS).toBeGreaterThan(INGEST_POLL_OVERTIME_MS);
  });
});

describe("isIngestRunActive", () => {
  it("is true only while the job is still going", () => {
    expect(isIngestRunActive("PENDING")).toBe(true);
    expect(isIngestRunActive("EXTRACTING")).toBe(true);
    expect(isIngestRunActive("READY_FOR_REVIEW")).toBe(false);
    expect(isIngestRunActive("FAILED")).toBe(false);
    expect(isIngestRunActive("CONFIRMED")).toBe(false);
  });
});

describe("ingestStageLabel", () => {
  it("maps run statuses to plain English", () => {
    expect(ingestStageLabel("PENDING")).toBe("Queued");
    expect(ingestStageLabel("EXTRACTING")).toBe("Reading your program");
  });

  it("falls back to a generic label for unknown states", () => {
    expect(ingestStageLabel(null)).toBe("Working");
    expect(ingestStageLabel("SOMETHING_NEW")).toBe("Working");
  });
});

describe("formatElapsed", () => {
  it("formats a counting m:ss timer", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(999)).toBe("0:00");
    expect(formatElapsed(1_000)).toBe("0:01");
    expect(formatElapsed(72_000)).toBe("1:12");
    expect(formatElapsed(600_000)).toBe("10:00");
  });

  it("rolls into h:mm:ss past an hour and never goes negative", () => {
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
    expect(formatElapsed(-5_000)).toBe("0:00");
  });
});
