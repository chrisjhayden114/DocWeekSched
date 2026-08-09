import { describe, expect, it } from "vitest";
import { threadVisibleTo, type ThreadAudience, type ThreadViewer } from "../lib/threadAudience";

function thread(overrides: Partial<ThreadAudience> = {}): ThreadAudience {
  return {
    authorId: "author-1",
    audienceType: "EVERYONE",
    audienceSessionId: null,
    audienceTrackId: null,
    audienceUserIds: [],
    ...overrides,
  };
}

function viewer(overrides: Partial<ThreadViewer> = {}): ThreadViewer {
  return {
    userId: "viewer-1",
    isManager: false,
    joinedSessionIds: new Set<string>(),
    joinedTrackIds: new Set<string>(),
    ...overrides,
  };
}

describe("threadVisibleTo", () => {
  it("EVERYONE posts are visible to anyone", () => {
    expect(threadVisibleTo(thread(), viewer())).toBe(true);
    expect(threadVisibleTo(thread({ authorId: null }), viewer())).toBe(true);
  });

  it("managers see all audience types", () => {
    const manager = viewer({ isManager: true });
    expect(threadVisibleTo(thread({ audienceType: "SESSION", audienceSessionId: "s1" }), manager)).toBe(true);
    expect(threadVisibleTo(thread({ audienceType: "TRACK", audienceTrackId: "t1" }), manager)).toBe(true);
    expect(threadVisibleTo(thread({ audienceType: "GROUP", audienceUserIds: ["someone-else"] }), manager)).toBe(true);
  });

  it("the author always sees their own targeted post", () => {
    const author = viewer({ userId: "author-1" });
    expect(threadVisibleTo(thread({ audienceType: "SESSION", audienceSessionId: "s1" }), author)).toBe(true);
    expect(threadVisibleTo(thread({ audienceType: "TRACK", audienceTrackId: "t1" }), author)).toBe(true);
    expect(threadVisibleTo(thread({ audienceType: "GROUP", audienceUserIds: [] }), author)).toBe(true);
  });

  it("SESSION posts are visible only to attendees of that session", () => {
    const t = thread({ audienceType: "SESSION", audienceSessionId: "s1" });
    expect(threadVisibleTo(t, viewer({ joinedSessionIds: new Set(["s1"]) }))).toBe(true);
    expect(threadVisibleTo(t, viewer({ joinedSessionIds: new Set(["s2"]) }))).toBe(false);
    expect(threadVisibleTo(t, viewer())).toBe(false);
    expect(threadVisibleTo(thread({ audienceType: "SESSION", audienceSessionId: null }), viewer())).toBe(false);
  });

  it("TRACK posts are visible only to attendees joined to that track", () => {
    const t = thread({ audienceType: "TRACK", audienceTrackId: "t1" });
    expect(threadVisibleTo(t, viewer({ joinedTrackIds: new Set(["t1"]) }))).toBe(true);
    expect(threadVisibleTo(t, viewer({ joinedTrackIds: new Set(["t2"]) }))).toBe(false);
    expect(threadVisibleTo(thread({ audienceType: "TRACK", audienceTrackId: null }), viewer())).toBe(false);
  });

  it("GROUP posts are visible only to listed users", () => {
    const t = thread({ audienceType: "GROUP", audienceUserIds: ["viewer-1", "viewer-2"] });
    expect(threadVisibleTo(t, viewer({ userId: "viewer-1" }))).toBe(true);
    expect(threadVisibleTo(t, viewer({ userId: "viewer-3" }))).toBe(false);
  });

  it("hides targeted posts from non-audience, non-manager, non-author viewers", () => {
    const outsider = viewer({ userId: "outsider" });
    expect(threadVisibleTo(thread({ audienceType: "SESSION", audienceSessionId: "s1" }), outsider)).toBe(false);
    expect(threadVisibleTo(thread({ audienceType: "TRACK", audienceTrackId: "t1" }), outsider)).toBe(false);
    expect(threadVisibleTo(thread({ audienceType: "GROUP", audienceUserIds: ["viewer-1"] }), outsider)).toBe(false);
  });
});
