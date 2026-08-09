export type ThreadAudience = {
  authorId: string | null;
  audienceType: string;
  audienceSessionId: string | null;
  audienceTrackId: string | null;
  audienceUserIds: string[];
};

export type ThreadViewer = {
  userId: string;
  isManager: boolean;
  joinedSessionIds: Set<string>;
  joinedTrackIds: Set<string>;
};

/** Whether a viewer may see a (possibly targeted) thread. */
export function threadVisibleTo(t: ThreadAudience, v: ThreadViewer): boolean {
  if (v.isManager) return true;
  if (t.authorId && t.authorId === v.userId) return true;
  switch (t.audienceType) {
    case "SESSION":
      return !!t.audienceSessionId && v.joinedSessionIds.has(t.audienceSessionId);
    case "TRACK":
      return !!t.audienceTrackId && v.joinedTrackIds.has(t.audienceTrackId);
    case "GROUP":
      return t.audienceUserIds.includes(v.userId);
    default:
      return true; // EVERYONE / unknown → visible
  }
}
