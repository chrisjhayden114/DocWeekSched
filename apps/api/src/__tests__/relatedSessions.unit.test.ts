import { describe, expect, it } from "vitest";
import { buildDemoFixtureSpec } from "../lib/demoEvent/fixture";
import {
  overlapsYours,
  relatedSessionScore,
  relatedSessionTokens,
  relatedSessions,
  tokensForRelatedSession,
  type RelatedSessionDoc,
} from "../lib/relatedSessions";

function doc(partial: Partial<RelatedSessionDoc> & Pick<RelatedSessionDoc, "id" | "title">): RelatedSessionDoc {
  return {
    description: null,
    trackName: null,
    format: "talk",
    published: true,
    own: false,
    startsAt: new Date("2027-03-01T17:00:00.000Z"),
    endsAt: new Date("2027-03-01T18:00:00.000Z"),
    items: [],
    ...partial,
  };
}

describe("related session tokens", () => {
  it("lowercases, splits on non-letters, and drops short tokens and stop words", () => {
    const tokens = relatedSessionTokens([
      "The Calm Learning Day",
      "How a staff protects quiet energy — for schools!",
    ]);
    expect([...tokens].sort()).toEqual(
      ["calm", "energy", "learning", "protects", "quiet", "staff"].sort(),
    );
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("how")).toBe(false);
    expect(tokens.has("for")).toBe(false);
    expect(tokens.has("day")).toBe(false);
    expect(tokens.has("schools")).toBe(false);
    expect(tokens.has("a")).toBe(false);
  });

  it("reads the title, description, item title, item abstract, and track name", () => {
    const tokens = tokensForRelatedSession(
      doc({
        id: "t",
        title: "Opening",
        description: "energy",
        trackName: "Keynote",
        items: [{ title: "quiet staff", abstract: "calm learning" }],
      }),
    );
    expect(tokens.has("opening")).toBe(true);
    expect(tokens.has("energy")).toBe(true);
    expect(tokens.has("keynote")).toBe(true);
    expect(tokens.has("quiet")).toBe(true);
    expect(tokens.has("staff")).toBe(true);
    expect(tokens.has("calm")).toBe(true);
    expect(tokens.has("learning")).toBe(true);
  });
});

describe("related session scoring", () => {
  const target = doc({
    id: "target",
    title: "Calm learning",
    description: "quiet energy for staff",
  });

  it("ranks a closer overlap above a thinner one, and breaks ties by startsAt", () => {
    const close = doc({
      id: "close",
      title: "Calm learning",
      description: "quiet energy for staff",
      startsAt: new Date("2027-03-02T17:00:00.000Z"),
      endsAt: new Date("2027-03-02T18:00:00.000Z"),
    });
    const thin = doc({
      id: "thin",
      title: "Something else entirely",
      description: "mentions calm once",
      startsAt: new Date("2027-03-01T12:00:00.000Z"),
      endsAt: new Date("2027-03-01T13:00:00.000Z"),
    });
    const tieEarly = doc({
      id: "tie-early",
      title: "Calm only",
      startsAt: new Date("2027-03-01T15:00:00.000Z"),
      endsAt: new Date("2027-03-01T16:00:00.000Z"),
    });
    const tieLate = doc({
      id: "tie-late",
      title: "Calm only",
      startsAt: new Date("2027-03-03T15:00:00.000Z"),
      endsAt: new Date("2027-03-03T16:00:00.000Z"),
    });
    const targetTokens = tokensForRelatedSession(target);
    expect(relatedSessionScore(targetTokens, tokensForRelatedSession(close))).toBeGreaterThan(
      relatedSessionScore(targetTokens, tokensForRelatedSession(thin)),
    );
    expect(relatedSessionScore(targetTokens, tokensForRelatedSession(tieEarly))).toBe(
      relatedSessionScore(targetTokens, tokensForRelatedSession(tieLate)),
    );
    const ranked = relatedSessions(target, [thin, tieLate, close, tieEarly], { limit: 4 });
    expect(ranked.map((row) => row.id)).toEqual(["close", "tie-early", "tie-late", "thin"]);
  });

  it("drops a score of 0 and honors limit", () => {
    const none = doc({ id: "none", title: "Unrelated poster hour", description: "badges and coffee" });
    const some = doc({ id: "some", title: "Calm rooms", description: "learning" });
    expect(relatedSessions(target, [none, some], { limit: 5 }).map((row) => row.id)).toEqual(["some"]);
    expect(relatedSessions(target, [some], { limit: 0 })).toEqual([]);
  });
});

describe("related session exclusions", () => {
  const target = doc({ id: "mine", title: "Calm learning energy", own: true });
  const good = doc({ id: "good", title: "Calm learning energy", startsAt: new Date("2027-03-02T17:00:00.000Z") });

  it("excludes the presenter's own sessions, unpublished sessions, and break or social", () => {
    const otherOwn = doc({ id: "other-own", title: "Calm learning energy", own: true });
    const draft = doc({ id: "draft", title: "Calm learning energy", published: false });
    const coffee = doc({ id: "coffee", title: "Calm learning energy", format: "break" });
    const reception = doc({ id: "reception", title: "Calm learning energy", format: "Social" });
    const ranked = relatedSessions(target, [target, otherOwn, draft, coffee, reception, good], { limit: 5 });
    expect(ranked.map((row) => row.id)).toEqual(["good"]);
  });
});

describe("overlapsYours", () => {
  const yours = [{ startsAt: new Date("2027-03-02T19:00:00.000Z"), endsAt: new Date("2027-03-02T20:00:00.000Z") }];

  it("is true when the ranges share time, including another of the presenter's sessions", () => {
    expect(
      overlapsYours(
        { startsAt: new Date("2027-03-02T19:30:00.000Z"), endsAt: new Date("2027-03-02T20:30:00.000Z") },
        yours,
      ),
    ).toBe(true);
  });

  it("is false when one session ends as the other starts", () => {
    expect(
      overlapsYours(
        { startsAt: new Date("2027-03-02T18:00:00.000Z"), endsAt: new Date("2027-03-02T19:00:00.000Z") },
        yours,
      ),
    ).toBe(false);
  });
});

describe("demo fixture related to Maya's keynote", () => {
  it("offers at least four other sessions, one of which overlaps her closing roundtable", () => {
    const spec = buildDemoFixtureSpec("public_demo");
    const docs = spec.sessions.map((session, index) => {
      const startsAt = new Date(Date.UTC(2027, 2, 1 + session.dayOffset, 16, session.startMinute, 0));
      const endsAt = new Date(startsAt.getTime() + session.durationMinutes * 60_000);
      return doc({
        id: `demo-${index}`,
        title: session.title,
        description: session.description,
        trackName: spec.tracks[session.trackIndex]?.name ?? null,
        format: session.format,
        published: true,
        own: session.speakerKeys.includes("maya"),
        startsAt,
        endsAt,
        items: session.items?.map((item) => ({ title: item.title, abstract: item.abstract })),
      });
    });
    const keynote = docs.find((row) => row.title.startsWith("Opening keynote"));
    const roundtable = docs.find((row) => row.title.startsWith("Closing roundtable"));
    expect(keynote).toBeTruthy();
    expect(roundtable).toBeTruthy();
    const related = relatedSessions(keynote!, docs, { limit: 5 });
    expect(related.length).toBeGreaterThanOrEqual(4);
    expect(related.some((row) => row.own)).toBe(false);
    expect(related.some((row) => overlapsYours(row, [roundtable!]))).toBe(true);
  });
});
