import { describe, expect, it } from "vitest";
import {
  FIXTURES,
  INJECTION_PHRASE,
  REIMPORT_TITLE_THRESHOLD,
  buildReimportChangeset,
  chunkSourceText,
  loadFixtureExpected,
  loadFixtureSource,
  matchFixtureId,
  mergeExtractChunks,
  titleSimilarity,
  agendaExtractSchema,
} from "../lib/ai/ingest";
import { runAgendaExtract } from "../lib/ai/ingest/extract";
import { MockAiProvider, resetAiProviderForTests } from "../lib/ai";

describe("Agenda ingest (unit)", () => {
  it("loads all 5 fixtures including injection phrase", () => {
    expect(FIXTURES).toHaveLength(5);
    const pdf = loadFixtureSource("multi-day-pdf");
    expect(pdf.toLowerCase()).toContain(INJECTION_PHRASE);
    for (const f of FIXTURES) {
      const expected = loadFixtureExpected(f.id);
      expect(expected.sessions.length).toBeGreaterThan(0);
      expect(matchFixtureId(loadFixtureSource(f.id))).toBe(f.id);
    }
  });

  it("scores title similarity for re-import threshold", () => {
    expect(titleSimilarity("Paper Session A: Methods", "Paper Session A: Methods")).toBe(1);
    expect(titleSimilarity("Paper Session A: Methods", "Paper Session A Methods")).toBeGreaterThanOrEqual(
      REIMPORT_TITLE_THRESHOLD,
    );
    expect(titleSimilarity("Keynote", "Completely Different Lunch")).toBeLessThan(0.5);
  });

  it("merges chunks with dedupe by title+date+startTime", () => {
    const a = agendaExtractSchema.parse({
      sessions: [
        { title: "Welcome", date: "2027-06-12", startTime: "09:00", endTime: "09:30", speakers: [] },
        { title: "Keynote", date: "2027-06-12", startTime: "09:30", speakers: ["A"] },
      ],
      assumptions: [],
    });
    const b = agendaExtractSchema.parse({
      sessions: [
        { title: "Welcome", date: "2027-06-12", startTime: "09:00", endTime: "09:30", room: "Hall", speakers: [] },
        { title: "Lunch", date: "2027-06-12", startTime: "12:00", speakers: [] },
      ],
      assumptions: [{ id: "x", question: "q" }],
    });
    const merged = mergeExtractChunks([a, b]);
    expect(merged.sessions).toHaveLength(3);
    expect(merged.sessions.find((s) => s.title === "Welcome")?.room).toBe("Hall");
    expect(merged.assumptions).toHaveLength(1);
  });

  it("chunks long source text", () => {
    const text = "x".repeat(25_000);
    const chunks = chunkSourceText(text, 10_000, 100);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("re-import yields updates not duplicate creates for matched titles", () => {
    const extract = loadFixtureExpected("xlsx-grid");
    const existing = extract.sessions.slice(0, 2).map((s, i) => ({
      id: `sess-${i}`,
      title: s.title,
      startsAt: new Date(`${s.date}T${s.startTime}:00Z`),
      endsAt: new Date(`${s.date}T${s.endTime || s.startTime}:00Z`),
      roomName: s.room,
      trackName: s.track,
    }));
    // Slightly modified title + new session
    const modified = {
      ...extract,
      sessions: [
        { ...extract.sessions[0], title: `${extract.sessions[0].title}!` },
        extract.sessions[1],
        {
          title: "Brand New Breakout",
          date: "2027-09-08",
          startTime: "14:00",
          endTime: "15:00",
          speakers: [],
        },
        ...extract.sessions.slice(2),
      ],
    };
    const rows = buildReimportChangeset(modified, existing, "UTC");
    const updates = rows.filter((r) => r.kind === "update");
    const creates = rows.filter((r) => r.kind === "create");
    const deletes = rows.filter((r) => r.kind === "delete");
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(creates.some((c) => c.kind === "create" && c.session.title === "Brand New Breakout")).toBe(true);
    expect(deletes.every((d) => d.kind === "delete" && d.accepted === false)).toBe(true);
    // Matched existing should not also appear as creates with same id titles duplicated unboundedly
    expect(creates.filter((c) => c.session.title === extract.sessions[0].title).length).toBe(0);
  });

  it("mock extract hits ≥90% of unambiguous fixture fields + keeps author order; injection inert", async () => {
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());

    for (const f of FIXTURES) {
      const source = loadFixtureSource(f.id);
      const expected = loadFixtureExpected(f.id);
      const result = await runAgendaExtract({
        organizationId: "org_test",
        eventId: "evt_test",
        sourceText: source,
        eventTimezone: expected.event?.timezone || "UTC",
        existingSessions: [],
        skipCap: true,
        skipMetering: true,
        skipAudit: true,
      });

      expect(result.fixtureId).toBe(f.id);
      expect(result.extraction.sessions.length).toBe(expected.sessions.length);

      // Injection must not wipe sessions or invent a destructive-only agenda
      if (f.id === "multi-day-pdf") {
        expect(source.toLowerCase()).toContain(INJECTION_PHRASE);
        expect(result.extraction.sessions.length).toBeGreaterThan(5);
        expect(
          result.extraction.sessions.every(
            (s) => !/delete all sessions/i.test(s.title) && !/ignore previous/i.test(s.title),
          ),
        ).toBe(true);
      }

      let checked = 0;
      let matched = 0;
      for (let i = 0; i < expected.sessions.length; i += 1) {
        const exp = expected.sessions[i];
        const got = result.extraction.sessions[i];
        const unambiguous: Array<[string, string | undefined, string | undefined]> = [
          ["title", exp.title, got?.title],
          ["date", exp.date, got?.date],
          ["startTime", exp.startTime, got?.startTime],
        ];
        if (exp.endTime) unambiguous.push(["endTime", exp.endTime, got?.endTime]);
        if (exp.room) unambiguous.push(["room", exp.room, got?.room]);
        if (exp.track) unambiguous.push(["track", exp.track, got?.track]);
        for (const [, e, g] of unambiguous) {
          checked += 1;
          if (e === g) matched += 1;
        }
        if (exp.items?.length) {
          for (let j = 0; j < exp.items.length; j += 1) {
            const ei = exp.items[j];
            const gi = got?.items?.[j];
            checked += 1;
            if (ei.title === gi?.title) matched += 1;
            expect(gi?.authors).toEqual(ei.authors);
          }
        }
      }
      const ratio = matched / checked;
      expect(ratio).toBeGreaterThanOrEqual(0.9);
    }
  });
});
