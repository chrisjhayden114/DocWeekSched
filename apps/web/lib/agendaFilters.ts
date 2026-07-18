/**
 * Client-side agenda filter / search / now-next helpers.
 */

export type FilterableSession = {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  speakers?: string | null;
  startsAt: string;
  endsAt: string;
  trackId?: string | null;
  roomId?: string | null;
  track?: { id: string; name: string; color?: string } | null;
  room?: { id: string; name: string } | null;
  items?: Array<{ title: string; authors?: Array<{ name: string }> }>;
  speaker?: { name: string } | null;
};

export type AgendaFilters = {
  trackId: string | null;
  roomId: string | null;
  dayKey: string | null;
  query: string;
};

export function sessionSearchBlob(s: FilterableSession): string {
  const parts = [
    s.title,
    s.description,
    s.location,
    s.speakers,
    s.speaker?.name,
    s.track?.name,
    s.room?.name,
    ...(s.items || []).flatMap((it) => [it.title, ...(it.authors || []).map((a) => a.name)]),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function filterSessions(
  sessions: FilterableSession[],
  filters: AgendaFilters,
  dayKeyFn: (iso: string) => string,
): FilterableSession[] {
  const q = filters.query.trim().toLowerCase();
  return sessions.filter((s) => {
    if (filters.trackId && s.trackId !== filters.trackId) return false;
    if (filters.roomId && s.roomId !== filters.roomId) return false;
    if (filters.dayKey && dayKeyFn(s.startsAt) !== filters.dayKey) return false;
    if (q && !sessionSearchBlob(s).includes(q)) return false;
    return true;
  });
}

/** Sessions happening now or the next upcoming one (by startsAt). */
export function nowAndNext(
  sessions: FilterableSession[],
  now = new Date(),
): { now: FilterableSession[]; next: FilterableSession | null } {
  const t = now.getTime();
  const happening = sessions.filter((s) => {
    const a = new Date(s.startsAt).getTime();
    const b = new Date(s.endsAt).getTime();
    return a <= t && t < b;
  });
  const upcoming = sessions
    .filter((s) => new Date(s.startsAt).getTime() > t)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return { now: happening, next: upcoming[0] || null };
}

/** True if two intervals overlap (half-open). */
export function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = new Date(aStart).getTime();
  const ae = new Date(aEnd).getTime();
  const bs = new Date(bStart).getTime();
  const be = new Date(bEnd).getTime();
  return as < be && bs < ae;
}

export function overlappingSessionIds(sessions: FilterableSession[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      if (intervalsOverlap(sessions[i].startsAt, sessions[i].endsAt, sessions[j].startsAt, sessions[j].endsAt)) {
        out.add(sessions[i].id);
        out.add(sessions[j].id);
      }
    }
  }
  return out;
}
