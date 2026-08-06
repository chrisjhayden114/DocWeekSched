import { describe, expect, it } from "vitest";

/** Inline copy of web agenda filter helpers for API unit tests. */
type S = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  trackId?: string | null;
  roomId?: string | null;
  speakers?: string | null;
  items?: Array<{ title: string; authors?: Array<{ name: string }> }>;
};

function blob(s: S) {
  return [s.title, s.speakers, ...(s.items || []).flatMap((i) => [i.title, ...(i.authors || []).map((a) => a.name)])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterSessions(sessions: S[], q: string, trackId: string | null) {
  const query = q.trim().toLowerCase();
  return sessions.filter((s) => {
    if (trackId && s.trackId !== trackId) return false;
    if (query && !blob(s).includes(query)) return false;
    return true;
  });
}

function overlaps(sessions: S[]) {
  const out = new Set<string>();
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i];
      const b = sessions[j];
      if (new Date(a.startsAt) < new Date(b.endsAt) && new Date(b.startsAt) < new Date(a.endsAt)) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  }
  return out;
}

describe("agenda filter helpers", () => {
  const sessions: S[] = [
    {
      id: "1",
      title: "Opening",
      startsAt: "2027-06-01T14:00:00Z",
      endsAt: "2027-06-01T15:00:00Z",
      trackId: "t1",
      items: [{ title: "Welcome", authors: [{ name: "Ada" }] }],
    },
    {
      id: "2",
      title: "Workshop",
      startsAt: "2027-06-01T14:30:00Z",
      endsAt: "2027-06-01T16:00:00Z",
      trackId: "t2",
      speakers: "Grace",
    },
  ];

  it("filters by track and full-text", () => {
    expect(filterSessions(sessions, "", "t1").map((s) => s.id)).toEqual(["1"]);
    expect(filterSessions(sessions, "ada", null).map((s) => s.id)).toEqual(["1"]);
    expect(filterSessions(sessions, "grace", null).map((s) => s.id)).toEqual(["2"]);
  });

  it("detects overlapping sessions", () => {
    expect([...overlaps(sessions)].sort()).toEqual(["1", "2"]);
  });
});