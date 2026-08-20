import { describe, expect, it } from "vitest";
import { parseCsvToTable } from "../lib/csvTable";
import {
  autoMapSessionCsv,
  parseCsvDateTime,
  sessionCsvTemplate,
  validateSessionCsvRows,
  type SessionCsvCreate,
} from "../lib/sessionCsv";

const event = {
  timezone: "America/Los_Angeles",
  // Event window: Sep 14–16, 2026 (PDT).
  startDate: "2026-09-14T16:00:00.000Z",
  endDate: "2026-09-16T23:00:00.000Z",
};
const tracks = [{ id: "trk_1", name: "Plenary" }];
const rooms = [{ id: "rm_1", name: "Hall A" }];

describe("sessionCsv", () => {
  it("the downloadable template parses and validates into creates", () => {
    const parsed = parseCsvToTable(sessionCsvTemplate());
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    const mapping = autoMapSessionCsv(parsed.headers);
    expect(mapping).toMatchObject({ title: "title", start: "start", end: "end" });
    const results = validateSessionCsvRows({
      rows: parsed.rows,
      mapping,
      tracks: [
        { id: "t1", name: "Keynote" },
        { id: "t2", name: "Workshops" },
      ],
      rooms: [
        { id: "r1", name: "Hall A" },
        { id: "r2", name: "Room 12" },
      ],
      event,
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.kind === "create")).toBe(true);
  });

  it("auto-maps common header aliases and skips unknowns", () => {
    const mapping = autoMapSessionCsv(["Session Title", "Start Time", "End Time", "Location", "Presenters", "Budget"]);
    expect(mapping).toEqual({
      "Session Title": "title",
      "Start Time": "start",
      "End Time": "end",
      Location: "room",
      Presenters: "speakers",
      Budget: "skip",
    });
  });

  it("parses both space and T datetime separators, rejects garbage", () => {
    expect(parseCsvDateTime("2026-09-14 09:00")).toBe("2026-09-14T09:00");
    expect(parseCsvDateTime("2026-9-14T9:05")).toBe("2026-09-14T09:05");
    expect(parseCsvDateTime("09/14/2026 9am")).toBeNull();
    expect(parseCsvDateTime("2026-13-01 09:00")).toBeNull();
    expect(parseCsvDateTime("")).toBeNull();
  });

  it("converts wall-clock times using the event timezone", () => {
    const results = validateSessionCsvRows({
      rows: [{ title: "Keynote", start: "2026-09-14 09:00", end: "2026-09-14 10:00", track: "", room: "" }],
      mapping: { title: "title", start: "start", end: "end", track: "track", room: "room" },
      tracks,
      rooms,
      event,
    });
    const row = results[0] as SessionCsvCreate;
    expect(row.kind).toBe("create");
    // 09:00 PDT = 16:00 UTC
    expect(row.payload.startsAt).toBe("2026-09-14T16:00:00.000Z");
    expect(row.payload.endsAt).toBe("2026-09-14T17:00:00.000Z");
    expect(row.day).toBe("2026-09-14");
    expect(row.outsideEventDates).toBe(false);
  });

  it("resolves track/room names case-insensitively and errors on unknown names", () => {
    const results = validateSessionCsvRows({
      rows: [
        { title: "A", start: "2026-09-14 09:00", end: "2026-09-14 10:00", track: "plenary", room: "HALL A" },
        { title: "B", start: "2026-09-14 09:00", end: "2026-09-14 10:00", track: "Ghost Track", room: "" },
      ],
      mapping: { title: "title", start: "start", end: "end", track: "track", room: "room" },
      tracks,
      rooms,
      event,
    });
    const ok = results[0] as SessionCsvCreate;
    expect(ok.kind).toBe("create");
    expect(ok.payload.trackId).toBe("trk_1");
    expect(ok.payload.roomId).toBe("rm_1");
    expect(results[1]).toMatchObject({ kind: "error", rowIndex: 1 });
    expect((results[1] as { message: string }).message).toContain("Ghost Track");
  });

  it("errors per row: missing title, bad dates, end before start", () => {
    const results = validateSessionCsvRows({
      rows: [
        { title: "", start: "2026-09-14 09:00", end: "2026-09-14 10:00" },
        { title: "Bad start", start: "next tuesday", end: "2026-09-14 10:00" },
        { title: "Backwards", start: "2026-09-14 10:00", end: "2026-09-14 09:00" },
      ],
      mapping: { title: "title", start: "start", end: "end" },
      tracks,
      rooms,
      event,
    });
    expect(results.map((r) => r.kind)).toEqual(["error", "error", "error"]);
    expect((results[1] as { message: string }).message).toContain("next tuesday");
    expect((results[2] as { message: string }).message).toContain("must be after");
  });

  it("flags sessions outside the event window without blocking them", () => {
    const results = validateSessionCsvRows({
      rows: [{ title: "Stray", start: "2027-09-14 09:00", end: "2027-09-14 10:00" }],
      mapping: { title: "title", start: "start", end: "end" },
      tracks,
      rooms,
      event,
    });
    const row = results[0] as SessionCsvCreate;
    expect(row.kind).toBe("create");
    expect(row.outsideEventDates).toBe(true);
  });

  it("returns a single file-level error when a required column is unmapped", () => {
    const results = validateSessionCsvRows({
      rows: [{ title: "A" }],
      mapping: { title: "title" },
      tracks,
      rooms,
      event,
    });
    expect(results).toEqual([
      { kind: "error", rowIndex: -1, message: expect.stringContaining("start, end") },
    ]);
  });
});
