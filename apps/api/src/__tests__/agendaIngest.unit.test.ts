import { describe, expect, it } from "vitest";
import {
  AGENDA_INGEST_MAX_BYTES,
  FIXTURES,
  INJECTION_PHRASE,
  REIMPORT_TITLE_THRESHOLD,
  attachmentFromDataUrl,
  buildReimportChangeset,
  chunkSourceText,
  loadFixtureExpected,
  loadFixtureSource,
  matchFixtureId,
  mergeExtractChunks,
  titleSimilarity,
  agendaExtractSchema,
} from "../lib/ai/ingest";
import { publishEventDraftSessions } from "../lib/ai/ingest";
import { runAgendaExtract } from "../lib/ai/ingest/extract";
import { MockAiProvider, resetAiProviderForTests } from "../lib/ai";

describe("Agenda ingest (unit)", () => {
  it("loads all 7 fixtures including injection phrase", () => {
    expect(FIXTURES).toHaveLength(7);
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

  it("re-import proposes unchecked child removals instead of forcing them (E13.3)", () => {
    const extract = agendaExtractSchema.parse({
      sessions: [
        {
          title: "Methods Workshop",
          date: "2027-06-12",
          startTime: "09:00",
          endTime: "10:00",
          speakers: ["Alice Chen"],
          items: [{ title: "Imported Paper", authors: ["Alice Chen"] }],
        },
      ],
      assumptions: [],
    });
    const existing = [
      {
        id: "sess-1",
        title: "Methods Workshop",
        startsAt: new Date("2027-06-12T09:00:00Z"),
        endsAt: new Date("2027-06-12T10:00:00Z"),
        speakers: [
          { speakerId: "spk-alice", name: "Alice Chen" },
          { speakerId: "spk-hand", name: "Hand Added" },
        ],
        items: [
          { itemId: "item-imported", title: "Imported Paper" },
          { itemId: "item-hand", title: "Hand-Added Paper" },
        ],
      },
    ];
    const rows = buildReimportChangeset(extract, existing, "UTC");
    const update = rows.find((r) => r.kind === "update");
    expect(update?.kind).toBe("update");
    if (update?.kind !== "update") throw new Error("expected update row");
    // Children the import covers are NOT proposed for removal; children it
    // does not mention become unchecked-by-default proposals.
    expect(update.speakerRemovals).toEqual([
      { speakerId: "spk-hand", name: "Hand Added", accepted: false },
    ]);
    expect(update.itemRemovals).toEqual([
      { itemId: "item-hand", title: "Hand-Added Paper", accepted: false },
    ]);
  });

  it("re-import with all children covered proposes no removals (E13.3)", () => {
    // W-7: the row exists because the session was retimed — a re-import that
    // changes nothing at all now produces no row (see the W-7 suite below).
    const extract = agendaExtractSchema.parse({
      sessions: [
        {
          title: "Methods Workshop",
          date: "2027-06-12",
          startTime: "09:30",
          speakers: ["Alice Chen"],
          items: [{ title: "Imported Paper", authors: [] }],
        },
      ],
      assumptions: [],
    });
    const existing = [
      {
        id: "sess-1",
        title: "Methods Workshop",
        startsAt: new Date("2027-06-12T09:00:00Z"),
        endsAt: new Date("2027-06-12T10:00:00Z"),
        // Matching is normalized — case/punctuation differences still match.
        speakers: [{ speakerId: "spk-alice", name: "alice chen" }],
        items: [{ itemId: "item-imported", title: "Imported  Paper!" }],
      },
    ];
    const rows = buildReimportChangeset(extract, existing, "UTC");
    const update = rows.find((r) => r.kind === "update");
    if (update?.kind !== "update") throw new Error("expected update row");
    expect(update.speakerRemovals).toBeUndefined();
    expect(update.itemRemovals).toBeUndefined();
  });

  it("W-7 — a session that moved to another day updates instead of duplicating", () => {
    const extract = agendaExtractSchema.parse({
      sessions: [
        {
          title: "Ethics Roundtable",
          date: "2027-06-13",
          startTime: "09:30",
          endTime: "10:30",
          speakers: [],
        },
      ],
      assumptions: [],
    });
    const rows = buildReimportChangeset(
      extract,
      [
        {
          id: "sess-1",
          title: "Ethics Roundtable",
          startsAt: new Date("2027-06-12T09:30:00Z"),
          endsAt: new Date("2027-06-12T10:30:00Z"),
          description: null,
          speakers: [],
          items: [],
          joinedCount: 7,
          bookmarkCount: 2,
        },
      ],
      "UTC",
    );
    // One update row and nothing else: no duplicate create, no delete pair.
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row.kind !== "update") throw new Error("expected update row");
    expect(row.sessionId).toBe("sess-1");
    expect(row.tier).toBe("moved");
    expect(row.changes).toEqual([
      { field: "day", label: "Day", from: "2027-06-12", to: "2027-06-13" },
    ]);
    // Blast radius travels with anything that moves times.
    expect(row.movesTime).toBe(true);
    expect(row.joinedCount).toBe(7);
    expect(row.bookmarkCount).toBe(2);
  });

  it("W-7 — a retitled session matches on its day and on its time slot", () => {
    const existing = {
      id: "sess-1",
      title: "Poster Lightning Talk",
      startsAt: new Date("2027-06-12T11:15:00Z"),
      endsAt: new Date("2027-06-12T12:00:00Z"),
      description: null,
      speakers: [],
      items: [],
      joinedCount: 3,
      bookmarkCount: 1,
    };

    const sameDay = buildReimportChangeset(
      agendaExtractSchema.parse({
        sessions: [
          {
            title: "Poster Lightning Talks",
            date: "2027-06-12",
            startTime: "11:15",
            endTime: "12:00",
            speakers: [],
          },
        ],
        assumptions: [],
      }),
      [existing],
      "UTC",
    );
    expect(sameDay).toHaveLength(1);
    if (sameDay[0].kind !== "update") throw new Error("expected update row");
    expect(sameDay[0].tier).toBe("retitled");
    expect(sameDay[0].similarity).toBeGreaterThanOrEqual(REIMPORT_TITLE_THRESHOLD);
    expect(sameDay[0].changes).toEqual([
      {
        field: "title",
        label: "Title",
        from: "Poster Lightning Talk",
        to: "Poster Lightning Talks",
      },
    ]);
    // A retitle alone does not move anyone's schedule.
    expect(sameDay[0].movesTime).toBe(false);

    // Same title similarity, different day, same time slot — still a match.
    const sameSlot = buildReimportChangeset(
      agendaExtractSchema.parse({
        sessions: [
          {
            title: "Poster Lightning Talks",
            date: "2027-06-13",
            startTime: "11:15",
            endTime: "12:00",
            speakers: [],
          },
        ],
        assumptions: [],
      }),
      [existing],
      "UTC",
    );
    expect(sameSlot).toHaveLength(1);
    if (sameSlot[0].kind !== "update") throw new Error("expected update row");
    expect(sameSlot[0].sessionId).toBe("sess-1");
    expect(sameSlot[0].changes?.map((c) => c.field)).toEqual(["day", "title"]);
    expect(sameSlot[0].movesTime).toBe(true);
  });

  it("W-7 — one import row matching two existing sessions asks instead of guessing", () => {
    const extract = agendaExtractSchema.parse({
      sessions: [
        { title: "Workshop", date: "2027-06-12", startTime: "09:00", endTime: "10:00", speakers: [] },
      ],
      assumptions: [],
    });
    const twin = (id: string, roomName: string) => ({
      id,
      title: "Workshop",
      startsAt: new Date("2027-06-12T09:00:00Z"),
      endsAt: new Date("2027-06-12T10:00:00Z"),
      roomName,
      description: null,
      speakers: [],
      items: [],
      joinedCount: 4,
      bookmarkCount: 0,
    });
    const rows = buildReimportChangeset(extract, [twin("sess-a", "Room A"), twin("sess-b", "Room B")], "UTC");

    const row = rows[0];
    if (row.kind !== "create") throw new Error("expected a create row defaulting to add");
    expect(row.accepted).toBe(true);
    expect(row.decision?.reason).toBe("multiple-existing");
    expect(row.decision?.candidates.map((c) => c.sessionId)).toEqual(["sess-a", "sess-b"]);
    expect(row.decision?.candidates.map((c) => c.existingRoom)).toEqual(["Room A", "Room B"]);
    // Neither contested session is proposed for delete — that would be a guess too.
    expect(rows.filter((r) => r.kind === "delete")).toEqual([]);
  });

  it("W-7 — two import rows matching one existing session ask instead of guessing", () => {
    const extract = agendaExtractSchema.parse({
      sessions: [
        {
          title: "Workshop",
          date: "2027-06-12",
          startTime: "09:00",
          endTime: "10:00",
          room: "Room A",
          speakers: [],
        },
        {
          title: "Workshop",
          date: "2027-06-12",
          startTime: "09:00",
          endTime: "10:00",
          room: "Room B",
          speakers: [],
        },
      ],
      assumptions: [],
    });
    const rows = buildReimportChangeset(
      extract,
      [
        {
          id: "sess-1",
          title: "Workshop",
          startsAt: new Date("2027-06-12T09:00:00Z"),
          endsAt: new Date("2027-06-12T10:00:00Z"),
          description: null,
          speakers: [],
          items: [],
        },
      ],
      "UTC",
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      if (row.kind !== "create") throw new Error("expected create rows defaulting to add");
      expect(row.decision?.reason).toBe("multiple-imported");
      expect(row.decision?.candidates.map((c) => c.sessionId)).toEqual(["sess-1"]);
    }
    const [first, second] = rows;
    if (first.kind !== "create" || second.kind !== "create") throw new Error("expected create rows");
    expect(first.decision?.contendingRowIndexes).toEqual([second.rowIndex]);
    expect(second.decision?.contendingRowIndexes).toEqual([first.rowIndex]);
  });

  it("W-7 — an ambiguous row never steals the match another row clearly owns", () => {
    const extract = agendaExtractSchema.parse({
      sessions: [
        // Names its room, so it clearly belongs to the Room A session.
        {
          title: "Workshop",
          date: "2027-06-12",
          startTime: "09:00",
          endTime: "10:30",
          room: "Room A",
          speakers: [],
        },
        // Names no room, so on its own it fits either twin.
        { title: "Workshop", date: "2027-06-12", startTime: "09:00", endTime: "10:30", speakers: [] },
      ],
      assumptions: [],
    });
    const twin = (id: string, roomName: string) => ({
      id,
      title: "Workshop",
      startsAt: new Date("2027-06-12T09:00:00Z"),
      endsAt: new Date("2027-06-12T10:00:00Z"),
      roomName,
      description: null,
      speakers: [],
      items: [],
    });
    const rows = buildReimportChangeset(extract, [twin("sess-a", "Room A"), twin("sess-b", "Room B")], "UTC");

    // The clear match settles first, which leaves exactly one session for the
    // vaguer row — so neither needs a decision, and neither is duplicated.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind)).toEqual(["update", "update"]);
    if (rows[0].kind !== "update" || rows[1].kind !== "update") throw new Error("expected updates");
    expect(rows[0].sessionId).toBe("sess-a");
    expect(rows[1].sessionId).toBe("sess-b");
  });

  it("W-7 — a repeated title is resolved by time, not surfaced as ambiguous", () => {
    const extract = agendaExtractSchema.parse({
      sessions: [
        { title: "Break", date: "2027-06-12", startTime: "10:30", endTime: "10:45", speakers: [] },
        { title: "Break", date: "2027-06-12", startTime: "15:00", endTime: "15:20", speakers: [] },
      ],
      assumptions: [],
    });
    const rows = buildReimportChangeset(
      extract,
      [
        {
          id: "morning",
          title: "Break",
          startsAt: new Date("2027-06-12T10:30:00Z"),
          endsAt: new Date("2027-06-12T10:45:00Z"),
          description: null,
          speakers: [],
          items: [],
        },
        {
          id: "afternoon",
          title: "Break",
          startsAt: new Date("2027-06-12T15:00:00Z"),
          endsAt: new Date("2027-06-12T15:15:00Z"),
          description: null,
          speakers: [],
          items: [],
        },
      ],
      "UTC",
    );
    // The morning break is untouched; only the afternoon one changed length.
    expect(rows).toHaveLength(1);
    if (rows[0].kind !== "update") throw new Error("expected update row");
    expect(rows[0].sessionId).toBe("afternoon");
    expect(rows[0].changes).toEqual([
      { field: "time", label: "Time", from: "15:00–15:15", to: "15:00–15:20" },
    ]);
  });

  it("W-7 — unchanged sessions produce no rows at all", () => {
    const extract = agendaExtractSchema.parse({
      sessions: [
        {
          title: "Opening Keynote",
          date: "2027-06-12",
          startTime: "09:00",
          endTime: "09:45",
          room: "Hall 1",
          track: "Plenary",
          description: "Same as before.",
          speakers: ["Nora Wells"],
        },
      ],
      assumptions: [],
    });
    const rows = buildReimportChangeset(
      extract,
      [
        {
          id: "sess-1",
          title: "Opening Keynote",
          startsAt: new Date("2027-06-12T09:00:00Z"),
          endsAt: new Date("2027-06-12T09:45:00Z"),
          roomName: "Hall 1",
          trackName: "Plenary",
          description: "Same as before.",
          speakers: [{ speakerId: "spk-1", name: "Nora Wells" }],
          items: [],
          joinedCount: 9,
          bookmarkCount: 4,
        },
      ],
      "UTC",
    );
    // No update row to review, and no delete row either — it was matched.
    expect(rows).toEqual([]);
  });

  it("W-7 — an update that only changes the room carries counts but does not move times", () => {
    const extract = agendaExtractSchema.parse({
      sessions: [
        {
          title: "Opening Keynote",
          date: "2027-06-12",
          startTime: "09:00",
          endTime: "09:45",
          room: "Hall 2",
          speakers: [],
        },
      ],
      assumptions: [],
    });
    const rows = buildReimportChangeset(
      extract,
      [
        {
          id: "sess-1",
          title: "Opening Keynote",
          startsAt: new Date("2027-06-12T09:00:00Z"),
          endsAt: new Date("2027-06-12T09:45:00Z"),
          roomName: "Hall 1",
          description: null,
          speakers: [],
          items: [],
          joinedCount: 9,
          bookmarkCount: 4,
        },
      ],
      "UTC",
    );
    expect(rows).toHaveLength(1);
    if (rows[0].kind !== "update") throw new Error("expected update row");
    expect(rows[0].tier).toBe("exact");
    expect(rows[0].changes).toEqual([
      { field: "room", label: "Room", from: "Hall 1", to: "Hall 2" },
    ]);
    expect(rows[0].movesTime).toBe(false);
    expect(rows[0].joinedCount).toBe(9);
  });

  it("publishEventDraftSessions scopes to the event's DRAFT sessions (E13.1)", async () => {
    const calls: unknown[] = [];
    const db = {
      session: {
        updateMany: async (args: unknown) => {
          calls.push(args);
          return { count: 3 };
        },
      },
    };
    const count = await publishEventDraftSessions(db as never, "evt-1");
    expect(count).toBe(3);
    expect(calls).toEqual([
      {
        where: { eventId: "evt-1", publishStatus: "DRAFT" },
        data: { publishStatus: "PUBLISHED" },
      },
    ]);
  });

  it("W-6 — delete rows carry joined/bookmarked counts for the confirm", () => {
    const extract = agendaExtractSchema.parse({
      sessions: [
        {
          title: "Welcome",
          date: "2027-06-12",
          startTime: "09:00",
          speakers: [],
        },
      ],
      assumptions: [],
    });
    const existing = [
      {
        id: "keep",
        title: "Welcome",
        startsAt: new Date("2027-06-12T09:00:00Z"),
        endsAt: new Date("2027-06-12T09:30:00Z"),
        joinedCount: 1,
        bookmarkCount: 0,
      },
      {
        id: "gone",
        title: "Keynote",
        startsAt: new Date("2027-06-12T10:00:00Z"),
        endsAt: new Date("2027-06-12T11:00:00Z"),
        joinedCount: 4,
        bookmarkCount: 2,
      },
    ];
    const rows = buildReimportChangeset(extract, existing, "UTC");
    const del = rows.find((r) => r.kind === "delete");
    expect(del?.kind).toBe("delete");
    if (del?.kind !== "delete") throw new Error("expected delete row");
    expect(del.sessionId).toBe("gone");
    expect(del.joinedCount).toBe(4);
    expect(del.bookmarkCount).toBe(2);
  });

  it("empty extract proposes NO deletions (E9.2)", () => {
    const empty = agendaExtractSchema.parse({ sessions: [], assumptions: [] });
    const existing = [
      {
        id: "sess-1",
        title: "Keynote",
        startsAt: new Date("2027-06-12T09:00:00Z"),
        endsAt: new Date("2027-06-12T10:00:00Z"),
      },
      {
        id: "sess-2",
        title: "Lunch",
        startsAt: new Date("2027-06-12T12:00:00Z"),
        endsAt: new Date("2027-06-12T13:00:00Z"),
      },
    ];
    const rows = buildReimportChangeset(empty, existing, "UTC");
    expect(rows).toEqual([]);
  });

  it("empty extract through runAgendaExtract yields no delete proposals (E9.2)", async () => {
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());
    // Non-fixture source → mock provider returns zero sessions.
    const result = await runAgendaExtract({
      organizationId: "org_test",
      eventId: "evt_test",
      sourceText: "random text that matches no fixture",
      eventTimezone: "UTC",
      existingSessions: [
        {
          id: "sess-1",
          title: "Keynote",
          startsAt: new Date("2027-06-12T09:00:00Z"),
          endsAt: new Date("2027-06-12T10:00:00Z"),
        },
      ],
      skipCap: true,
      skipMetering: true,
      skipAudit: true,
    });
    expect(result.extraction.sessions).toHaveLength(0);
    expect(result.changeset).toEqual([]);
  });

  it("attachmentFromDataUrl builds PDF/image attachments, rejects others, enforces max bytes (E9.1)", () => {
    const pdfB64 = Buffer.from("%PDF-1.4 fake").toString("base64");
    const pdf = attachmentFromDataUrl(`data:application/pdf;base64,${pdfB64}`);
    expect(pdf).toEqual({ type: "document", mediaType: "application/pdf", base64: pdfB64 });

    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const png = attachmentFromDataUrl(`data:image/png;base64,${pngB64}`);
    expect(png).toEqual({ type: "image", mediaType: "image/png", base64: pngB64 });

    const txtB64 = Buffer.from("plain text").toString("base64");
    expect(attachmentFromDataUrl(`data:text/plain;base64,${txtB64}`)).toBeNull();
    expect(attachmentFromDataUrl("not a data url")).toBeNull();

    // 3 base64 chars ≈ ceil(n/3)*4 — build a payload just over the cap.
    const overCap = Buffer.alloc(AGENDA_INGEST_MAX_BYTES + 1).toString("base64");
    expect(() => attachmentFromDataUrl(`data:application/pdf;base64,${overCap}`)).toThrow(
      /exceeds max size/,
    );
  });

  it("E31: sheet-name timeslot reaches the changeset (xlsx-rooming fixture)", async () => {
    process.env.AI_PROVIDER = "mock";
    resetAiProviderForTests(new MockAiProvider());

    const source = loadFixtureSource("xlsx-rooming");
    // The serialized workbook carries times ONLY in its sheet-name headings.
    expect(source).toContain("## Sheet: Breakout Session 1 (10.00-11.00)");
    expect(source).toContain("## Sheet: Breakout Session 2 (11.15-12.15)");

    const expected = loadFixtureExpected("xlsx-rooming");
    const result = await runAgendaExtract({
      organizationId: "org_test",
      eventId: "evt_test",
      sourceText: source,
      eventTimezone: "UTC",
      eventDates: { start: "2027-03-15", end: "2027-03-15" },
      existingSessions: [],
      skipCap: true,
      skipMetering: true,
      skipAudit: true,
    });

    expect(result.fixtureId).toBe("xlsx-rooming");
    const creates = result.changeset.filter((r) => r.kind === "create");
    expect(creates).toHaveLength(expected.sessions.length);

    // Times inferred from the sheet names land on the changeset rows.
    const first = creates.find(
      (r) => r.kind === "create" && r.session.title === "Community Rooming Coordination",
    );
    if (first?.kind !== "create") throw new Error("expected create row");
    expect(first.session.startTime).toBe("10:00");
    expect(first.session.endTime).toBe("11:00");
    expect(first.session.date).toBe("2027-03-15");

    const second = creates.find(
      (r) => r.kind === "create" && r.session.title === "Guest Services Walkthrough",
    );
    if (second?.kind !== "create") throw new Error("expected create row");
    expect(second.session.startTime).toBe("11:15");
    expect(second.session.endTime).toBe("12:15");

    // The inference is recorded as an assumption, not silently applied.
    expect(
      result.assumptions.some((a) => /sheet name/i.test(a.question) || a.id === "sheet-name-times"),
    ).toBe(true);
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
