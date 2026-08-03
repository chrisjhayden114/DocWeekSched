import { programCopy } from "@event-app/config";
import { useRouter } from "next/router";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { ListEmpty } from "../ListState";
import { timeZoneAbbrev } from "../../lib/dateFormat";
import {
  isOutsideEventDates,
  toLocalInputValueInTimeZone,
  zonedDateTimeLocalToIso,
  zonedDayKey,
} from "../../lib/eventTimezone";
import { organizerFetch } from "../../lib/organizerApi";
import { browserTimezone } from "../../lib/timezones";
import { SessionCsvImport } from "./SessionCsvImport";

export type Track = { id: string; name: string; color: string };
export type SessionResourceRow = {
  id: string;
  title: string;
  kind: "LINK" | "FILE";
  url: string;
  createdAt: string;
  user: { id: string; name: string };
};
export type Room = { id: string; name: string };
export type PaperAuthor = { name: string; sortOrder: number };
export type Paper = { id: string; title: string; sortOrder: number; authors: PaperAuthor[] };
export type ProgramSession = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  trackId?: string | null;
  roomId?: string | null;
  // Round-tripped on PUT (the API nulls omitted optional fields).
  description?: string | null;
  location?: string | null;
  speakers?: string | null;
  imageUrl?: string | null;
  zoomLink?: string | null;
  recordingUrl?: string | null;
  fileUrl?: string | null;
  fileLink?: string | null;
  speakerId?: string | null;
  allowVirtualJoin?: boolean | null;
  inPersonCapacity?: number | null;
  virtualCapacity?: number | null;
  items?: Paper[];
};

type EventWindow = { timezone: string; startDate: string; endDate: string };

type Props = {
  eventId: string;
  event: EventWindow;
  tracks: Track[];
  rooms: Room[];
  sessions: ProgramSession[];
  onChanged: () => Promise<void>;
};

type ConfirmState =
  | { kind: "track"; id: string; name: string }
  | { kind: "room"; id: string; name: string }
  | { kind: "session"; id: string; title: string; paperCount: number }
  | { kind: "paper"; sessionId: string; itemId: string; title: string; sessionTitle: string }
  | { kind: "resource"; sessionId: string; resourceId: string; title: string; sessionTitle: string }
  | null;

type SessionDraft = {
  title: string;
  startLocal: string;
  endLocal: string;
  trackId: string;
  roomId: string;
};

const smallButton = { fontSize: 13, padding: "2px 10px" } as const;

/** Same encoding ceiling as the session-page resource form (server accepts ~4.5 MB). */
const RESOURCE_DATA_URL_MAX_CHARS = 4_500_000;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function errorMessage(err: unknown): string {
  const e = err as Error & { body?: { error?: string } };
  return e?.body?.error || e?.message || "Request failed";
}

function authorsToText(authors: PaperAuthor[] | undefined): string {
  return (authors || [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((a) => a.name)
    .join("\n");
}

function textToAuthors(text: string) {
  return text
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name, i) => ({ name, isPresenter: i === 0, sortOrder: i }));
}

/** Full-schema PUT body: draft fields + existing values the API would otherwise wipe. */
function sessionUpdatePayload(existing: ProgramSession, draft: SessionDraft, timezone: string) {
  return {
    title: draft.title.trim(),
    startsAt: zonedDateTimeLocalToIso(draft.startLocal, timezone),
    endsAt: zonedDateTimeLocalToIso(draft.endLocal, timezone),
    trackId: draft.trackId || null,
    roomId: draft.roomId || null,
    description: existing.description ?? undefined,
    location: existing.location ?? undefined,
    speakers: existing.speakers ?? undefined,
    imageUrl: existing.imageUrl ?? undefined,
    zoomLink: existing.zoomLink ?? undefined,
    recordingUrl: existing.recordingUrl ?? undefined,
    fileUrl: existing.fileUrl ?? undefined,
    fileLink: existing.fileLink ?? undefined,
    speakerId: existing.speakerId ?? undefined,
    allowVirtualJoin: existing.allowVirtualJoin ?? undefined,
    inPersonCapacity: existing.inPersonCapacity ?? undefined,
    virtualCapacity: existing.virtualCapacity ?? undefined,
  };
}

function OutsideDatesWarning({
  startLocal,
  endLocal,
  event,
}: {
  startLocal: string;
  endLocal: string;
  event: EventWindow;
}) {
  if (!startLocal || !endLocal) return null;
  const outside = isOutsideEventDates(
    zonedDateTimeLocalToIso(startLocal, event.timezone),
    zonedDateTimeLocalToIso(endLocal, event.timezone),
    event.startDate,
    event.endDate,
    event.timezone,
  );
  if (!outside) return null;
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: event.timezone,
    }).format(new Date(iso));
  return (
    <p role="status" style={{ margin: 0, color: "var(--warning)", font: "var(--text-body)" }}>
      This is outside your event dates ({fmt(event.startDate)} – {fmt(event.endDate)}) — is that right? You can
      still save.
    </p>
  );
}

/**
 * Program tab: tracks, rooms, day-grouped sessions, and papers — each with
 * inline edit and delete against the existing PUT/DELETE endpoints. Times
 * display in the EVENT timezone (with an optional local-time toggle).
 */
export function ProgramTab({ eventId, event, tracks, rooms, sessions, onChanged }: Props) {
  const router = useRouter();
  const localZone = useMemo(() => browserTimezone(), []);
  const [showLocalTime, setShowLocalTime] = useState(false);
  const displayZone = showLocalTime ? localZone : event.timezone;

  const [busy, setBusy] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  // Collapsed add-forms (item 7: no always-open forms mid-page).
  const [addTrackOpen, setAddTrackOpen] = useState(false);
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [addPaperSessionId, setAddPaperSessionId] = useState<string | null>(null);
  // E11.3: one combined "+ Add" entry point per session. The chooser opens
  // either the paper form (unchanged) or the resource form (SessionResource —
  // a separate model with its own endpoints).
  const [addChooserSessionId, setAddChooserSessionId] = useState<string | null>(null);
  const [addResourceSessionId, setAddResourceSessionId] = useState<string | null>(null);

  const [trackDraft, setTrackDraft] = useState({ name: "", color: "#0033A0" });
  const [roomDraft, setRoomDraft] = useState({ name: "" });
  const emptySessionDraft: SessionDraft = { title: "", startLocal: "", endLocal: "", trackId: "", roomId: "" };
  const [sessionDraft, setSessionDraft] = useState<SessionDraft>(emptySessionDraft);
  const [paperDraft, setPaperDraft] = useState({ title: "", authorsText: "" });
  const emptyResourceDraft = { title: "", kind: "LINK" as "LINK" | "FILE", url: "", file: null as File | null };
  const [resourceDraft, setResourceDraft] = useState(emptyResourceDraft);
  const [resourceNotices, setResourceNotices] = useState<Record<string, string>>({});
  // E12.2: existing resources per session, shown inline like papers so the
  // organizer can verify what was attached without leaving the console.
  // null = load failed for that session (rendered as an explicit note).
  const [resourcesBySession, setResourcesBySession] = useState<Record<string, SessionResourceRow[] | null>>({});

  const [editTrack, setEditTrack] = useState<{ id: string; name: string; color: string } | null>(null);
  const [editRoom, setEditRoom] = useState<{ id: string; name: string } | null>(null);
  const [editSession, setEditSession] = useState<({ id: string } & SessionDraft) | null>(null);
  const [editPaper, setEditPaper] = useState<{
    sessionId: string;
    itemId: string;
    title: string;
    authorsText: string;
  } | null>(null);

  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  // Resources are not part of the sessions payload — fetch them per session
  // via the endpoints from E9.3 (organizer manage access always passes).
  const sessionIdsKey = useMemo(
    () =>
      sessions
        .map((s) => s.id)
        .sort()
        .join(","),
    [sessions],
  );

  useEffect(() => {
    if (!eventId || !sessionIdsKey) return;
    let cancelled = false;
    void (async () => {
      const ids = sessionIdsKey.split(",");
      const entries = await Promise.all(
        ids.map(async (id): Promise<[string, SessionResourceRow[] | null]> => {
          try {
            return [id, await organizerFetch<SessionResourceRow[]>(`/sessions/${id}/resources`, eventId)];
          } catch {
            return [id, null];
          }
        }),
      );
      if (!cancelled) setResourcesBySession(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, sessionIdsKey]);

  async function refreshSessionResources(sessionId: string) {
    try {
      const list = await organizerFetch<SessionResourceRow[]>(`/sessions/${sessionId}/resources`, eventId);
      setResourcesBySession((prev) => ({ ...prev, [sessionId]: list }));
    } catch {
      setResourcesBySession((prev) => ({ ...prev, [sessionId]: null }));
    }
  }

  const dayGroups = useMemo(() => {
    const sorted = sessions
      .slice()
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const groups: { key: string; label: string; sessions: ProgramSession[] }[] = [];
    for (const s of sorted) {
      const key = zonedDayKey(s.startsAt, displayZone);
      let group = groups[groups.length - 1];
      if (!group || group.key !== key) {
        const label = new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: displayZone,
        }).format(new Date(s.startsAt));
        group = { key, label, sessions: [] };
        groups.push(group);
      }
      group.sessions.push(s);
    }
    return groups;
  }, [sessions, displayZone]);

  const zoneAbbrev = timeZoneAbbrev(new Date(), displayZone);

  function timeRange(startIso: string, endIso: string): string {
    const fmt = (iso: string) =>
      new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: displayZone }).format(
        new Date(iso),
      );
    return `${fmt(startIso)} – ${fmt(endIso)}`;
  }

  function setRowError(key: string, message: string | null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }

  /** Run a mutation, refetch on success, keep the error on the row on failure. */
  async function run(key: string, fn: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setRowError(key, null);
    try {
      await fn();
      await onChanged();
      return true;
    } catch (err) {
      setRowError(key, errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ——— Tracks ———

  async function submitAddTrack(e: FormEvent) {
    e.preventDefault();
    if (!trackDraft.name.trim()) return;
    const ok = await run("add-track", async () => {
      await organizerFetch("/tracks/", eventId, {
        method: "POST",
        body: JSON.stringify({ name: trackDraft.name.trim(), color: trackDraft.color }),
      });
    });
    if (ok) {
      setTrackDraft({ name: "", color: "#0033A0" });
      setAddTrackOpen(false);
    }
  }

  async function submitEditTrack(e: FormEvent) {
    e.preventDefault();
    if (!editTrack || !editTrack.name.trim()) return;
    const ok = await run(editTrack.id, async () => {
      await organizerFetch(`/tracks/${editTrack.id}`, eventId, {
        method: "PUT",
        body: JSON.stringify({ name: editTrack.name.trim(), color: editTrack.color }),
      });
    });
    if (ok) setEditTrack(null);
  }

  // ——— Rooms ———

  async function submitAddRoom(e: FormEvent) {
    e.preventDefault();
    if (!roomDraft.name.trim()) return;
    const ok = await run("add-room", async () => {
      await organizerFetch("/rooms/", eventId, {
        method: "POST",
        body: JSON.stringify({ name: roomDraft.name.trim() }),
      });
    });
    if (ok) {
      setRoomDraft({ name: "" });
      setAddRoomOpen(false);
    }
  }

  async function submitEditRoom(e: FormEvent) {
    e.preventDefault();
    if (!editRoom || !editRoom.name.trim()) return;
    const ok = await run(editRoom.id, async () => {
      await organizerFetch(`/rooms/${editRoom.id}`, eventId, {
        method: "PUT",
        body: JSON.stringify({ name: editRoom.name.trim() }),
      });
    });
    if (ok) setEditRoom(null);
  }

  // ——— Sessions ———

  async function submitAddSession(e: FormEvent) {
    e.preventDefault();
    if (!sessionDraft.title.trim() || !sessionDraft.startLocal || !sessionDraft.endLocal) return;
    const ok = await run("add-session", async () => {
      await organizerFetch("/sessions/", eventId, {
        method: "POST",
        body: JSON.stringify({
          title: sessionDraft.title.trim(),
          startsAt: zonedDateTimeLocalToIso(sessionDraft.startLocal, event.timezone),
          endsAt: zonedDateTimeLocalToIso(sessionDraft.endLocal, event.timezone),
          trackId: sessionDraft.trackId || null,
          roomId: sessionDraft.roomId || null,
        }),
      });
    });
    if (ok) {
      setSessionDraft(emptySessionDraft);
      setAddSessionOpen(false);
    }
  }

  async function submitEditSession(e: FormEvent) {
    e.preventDefault();
    if (!editSession) return;
    const existing = sessions.find((s) => s.id === editSession.id);
    if (!existing || !editSession.title.trim() || !editSession.startLocal || !editSession.endLocal) return;
    const ok = await run(editSession.id, async () => {
      await organizerFetch(`/sessions/${editSession.id}`, eventId, {
        method: "PUT",
        body: JSON.stringify(sessionUpdatePayload(existing, editSession, event.timezone)),
      });
    });
    if (ok) setEditSession(null);
  }

  // ——— Papers ———

  async function submitAddPaper(e: FormEvent, sessionId: string) {
    e.preventDefault();
    if (!paperDraft.title.trim()) return;
    const ok = await run(`add-paper-${sessionId}`, async () => {
      await organizerFetch(`/sessions/${sessionId}/items`, eventId, {
        method: "POST",
        body: JSON.stringify({
          title: paperDraft.title.trim(),
          authors: textToAuthors(paperDraft.authorsText),
        }),
      });
    });
    if (ok) {
      setPaperDraft({ title: "", authorsText: "" });
      setAddPaperSessionId(null);
    }
  }

  // ——— Session resources (E11.3 — reuses the endpoints fixed in E9.3) ———

  async function submitAddResource(e: FormEvent, sessionId: string) {
    e.preventDefault();
    const key = `add-resource-${sessionId}`;
    if (!resourceDraft.title.trim()) return;
    let url = "";
    if (resourceDraft.kind === "LINK") {
      url = resourceDraft.url.trim();
      if (!url) {
        setRowError(key, "Paste a link URL.");
        return;
      }
    } else {
      if (!resourceDraft.file) {
        setRowError(key, "Choose a file to upload.");
        return;
      }
      url = await fileToDataUrl(resourceDraft.file);
      if (url.length > RESOURCE_DATA_URL_MAX_CHARS) {
        setRowError(key, "That file is too large after encoding. Try a smaller file or share a link instead.");
        return;
      }
    }
    const ok = await run(key, async () => {
      await organizerFetch(`/sessions/${sessionId}/resources`, eventId, {
        method: "POST",
        body: JSON.stringify({ title: resourceDraft.title.trim(), kind: resourceDraft.kind, url }),
      });
    });
    if (ok) {
      setResourceDraft(emptyResourceDraft);
      setAddResourceSessionId(null);
      // E12.2: the confirmation must be verifiable in place — refresh the
      // inline list so the new resource is visible right away.
      await refreshSessionResources(sessionId);
      setResourceNotices((prev) => ({
        ...prev,
        [sessionId]: "Resource added — attendees who join this session can open it from the session page.",
      }));
    }
  }

  async function submitEditPaper(e: FormEvent) {
    e.preventDefault();
    if (!editPaper || !editPaper.title.trim()) return;
    const ok = await run(editPaper.itemId, async () => {
      await organizerFetch(`/sessions/${editPaper.sessionId}/items/${editPaper.itemId}`, eventId, {
        method: "PUT",
        body: JSON.stringify({
          title: editPaper.title.trim(),
          authors: textToAuthors(editPaper.authorsText),
        }),
      });
    });
    if (ok) setEditPaper(null);
  }

  // ——— Delete (all via ConfirmDialog) ———

  async function onConfirmDelete() {
    if (!confirm) return;
    let key = "";
    let path = "";
    if (confirm.kind === "track") {
      key = confirm.id;
      path = `/tracks/${confirm.id}`;
    } else if (confirm.kind === "room") {
      key = confirm.id;
      path = `/rooms/${confirm.id}`;
    } else if (confirm.kind === "session") {
      key = confirm.id;
      path = `/sessions/${confirm.id}`;
    } else if (confirm.kind === "resource") {
      key = confirm.resourceId;
      path = `/sessions/${confirm.sessionId}/resources/${confirm.resourceId}`;
    } else {
      key = confirm.itemId;
      path = `/sessions/${confirm.sessionId}/items/${confirm.itemId}`;
    }
    const resourceSessionId = confirm.kind === "resource" ? confirm.sessionId : null;
    const ok = await run(key, async () => {
      await organizerFetch(path, eventId, { method: "DELETE" });
    });
    if (ok) {
      setConfirm(null);
      // Resources aren't in the sessions payload onChanged() refetches.
      if (resourceSessionId) await refreshSessionResources(resourceSessionId);
    }
  }

  function confirmCopy(c: NonNullable<ConfirmState>): { title: string; body: string } {
    if (c.kind === "track") {
      const inUse = sessions.filter((s) => s.trackId === c.id).length;
      return {
        title: `Delete track “${c.name}”?`,
        body:
          inUse > 0
            ? `${inUse} session${inUse === 1 ? "" : "s"} currently use${inUse === 1 ? "s" : ""} this track. ` +
              `They stay on the schedule with their times, but lose the “${c.name}” label and color.`
            : "This track isn't used by any session. It will be removed.",
      };
    }
    if (c.kind === "room") {
      const inUse = sessions.filter((s) => s.roomId === c.id).length;
      return {
        title: `Delete room “${c.name}”?`,
        body:
          inUse > 0
            ? `${inUse} session${inUse === 1 ? " is" : "s are"} assigned to this room. ` +
              `They stay scheduled but will show no room until you reassign them.`
            : "No sessions are assigned to this room. It will be removed.",
      };
    }
    if (c.kind === "session") {
      return {
        title: `Delete session “${c.title}”?`,
        body:
          `This permanently removes the session` +
          (c.paperCount > 0 ? ` and its ${c.paperCount} paper${c.paperCount === 1 ? "" : "s"}` : "") +
          `. Attendee schedules and attendance records for this session are removed with it.`,
      };
    }
    if (c.kind === "resource") {
      return {
        title: `Remove resource “${c.title}”?`,
        body: `This removes it from “${c.sessionTitle}”. Attendees will no longer see it on the session page.`,
      };
    }
    return {
      title: `Delete paper “${c.title}”?`,
      body: `This removes the paper and its author list from “${c.sessionTitle}”.`,
    };
  }

  const rowError = (key: string) =>
    rowErrors[key] ? (
      <p role="alert" style={{ margin: "4px 0 0", color: "var(--danger)", font: "var(--text-body)" }}>
        {rowErrors[key]}
      </p>
    ) : null;

  const sessionFormFields = (
    draft: SessionDraft,
    update: (patch: Partial<SessionDraft>) => void,
  ) => (
    <>
      <label>
        Title
        <input
          className="input"
          required
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
        />
      </label>
      <label>
        Starts (event time, {timeZoneAbbrev(new Date(), event.timezone)})
        <input
          className="input"
          type="datetime-local"
          required
          value={draft.startLocal}
          onChange={(e) => update({ startLocal: e.target.value })}
        />
      </label>
      <label>
        Ends (event time, {timeZoneAbbrev(new Date(), event.timezone)})
        <input
          className="input"
          type="datetime-local"
          required
          value={draft.endLocal}
          onChange={(e) => update({ endLocal: e.target.value })}
        />
      </label>
      <label>
        Track
        <select className="input" value={draft.trackId} onChange={(e) => update({ trackId: e.target.value })}>
          <option value="">No track</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Room
        <select className="input" value={draft.roomId} onChange={(e) => update({ roomId: e.target.value })}>
          <option value="">No room</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <OutsideDatesWarning startLocal={draft.startLocal} endLocal={draft.endLocal} event={event} />
    </>
  );

  return (
    <section style={{ display: "grid", gap: 16 }}>
      {/* ——— Tracks ——— */}
      <div className="console-panel">
        <div className="console-panel-head">
          <p className="console-panel-label">Tracks</p>
          <button
            type="button"
            className="button ghost"
            style={smallButton}
            onClick={() => setAddTrackOpen((v) => !v)}
          >
            {addTrackOpen ? "Close" : "+ Add track"}
          </button>
        </div>
        {tracks.length === 0 && !addTrackOpen ? (
          <p className="help-text" style={{ margin: 0 }}>
            No tracks yet. Tracks color-code sessions on the schedule.
          </p>
        ) : null}
        <div style={{ display: "grid", gap: 4 }}>
          {tracks.map((t) =>
            editTrack?.id === t.id ? (
              <form
                key={t.id}
                onSubmit={(e) => void submitEditTrack(e)}
                style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0" }}
              >
                <input
                  className="input"
                  type="color"
                  value={editTrack.color}
                  onChange={(e) => setEditTrack({ ...editTrack, color: e.target.value })}
                  style={{ width: 44, padding: 2, height: 32 }}
                  aria-label="Track color"
                />
                <input
                  className="input"
                  required
                  value={editTrack.name}
                  onChange={(e) => setEditTrack({ ...editTrack, name: e.target.value })}
                  style={{ maxWidth: 280 }}
                  aria-label="Track name"
                />
                <button className="button" type="submit" style={smallButton} disabled={busy}>
                  Save
                </button>
                <button
                  className="button secondary"
                  type="button"
                  style={smallButton}
                  disabled={busy}
                  onClick={() => setEditTrack(null)}
                >
                  Cancel
                </button>
                {rowError(t.id)}
              </form>
            ) : (
              <div key={t.id} style={{ padding: "4px 0" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: t.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, font: "var(--text-body)", color: "var(--gray-900)" }}>{t.name}</span>
                  <button
                    type="button"
                    className="button ghost"
                    style={smallButton}
                    onClick={() => setEditTrack({ id: t.id, name: t.name, color: t.color })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    style={{ ...smallButton, color: "var(--danger)" }}
                    onClick={() => setConfirm({ kind: "track", id: t.id, name: t.name })}
                  >
                    Delete
                  </button>
                </div>
                {rowError(t.id)}
              </div>
            ),
          )}
        </div>
        {addTrackOpen ? (
          <form
            onSubmit={(e) => void submitAddTrack(e)}
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}
          >
            <input
              className="input"
              type="color"
              value={trackDraft.color}
              onChange={(e) => setTrackDraft((d) => ({ ...d, color: e.target.value }))}
              style={{ width: 44, padding: 2, height: 32 }}
              aria-label="Track color"
            />
            <input
              className="input"
              required
              placeholder="Track name"
              value={trackDraft.name}
              onChange={(e) => setTrackDraft((d) => ({ ...d, name: e.target.value }))}
              style={{ maxWidth: 280 }}
            />
            <button className="button" type="submit" style={smallButton} disabled={busy}>
              Add track
            </button>
            {rowError("add-track")}
          </form>
        ) : null}
      </div>

      {/* ——— Rooms ——— */}
      <div className="console-panel">
        <div className="console-panel-head">
          <p className="console-panel-label">Rooms</p>
          <button
            type="button"
            className="button ghost"
            style={smallButton}
            onClick={() => setAddRoomOpen((v) => !v)}
          >
            {addRoomOpen ? "Close" : "+ Add room"}
          </button>
        </div>
        {rooms.length === 0 && !addRoomOpen ? (
          <p className="help-text" style={{ margin: 0 }}>
            No rooms yet. Rooms power the by-room schedule view.
          </p>
        ) : null}
        <div style={{ display: "grid", gap: 4 }}>
          {rooms.map((r) =>
            editRoom?.id === r.id ? (
              <form
                key={r.id}
                onSubmit={(e) => void submitEditRoom(e)}
                style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0" }}
              >
                <input
                  className="input"
                  required
                  value={editRoom.name}
                  onChange={(e) => setEditRoom({ ...editRoom, name: e.target.value })}
                  style={{ maxWidth: 280 }}
                  aria-label="Room name"
                />
                <button className="button" type="submit" style={smallButton} disabled={busy}>
                  Save
                </button>
                <button
                  className="button secondary"
                  type="button"
                  style={smallButton}
                  disabled={busy}
                  onClick={() => setEditRoom(null)}
                >
                  Cancel
                </button>
                {rowError(r.id)}
              </form>
            ) : (
              <div key={r.id} style={{ padding: "4px 0" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ flex: 1, font: "var(--text-body)", color: "var(--gray-900)" }}>{r.name}</span>
                  <button
                    type="button"
                    className="button ghost"
                    style={smallButton}
                    onClick={() => setEditRoom({ id: r.id, name: r.name })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    style={{ ...smallButton, color: "var(--danger)" }}
                    onClick={() => setConfirm({ kind: "room", id: r.id, name: r.name })}
                  >
                    Delete
                  </button>
                </div>
                {rowError(r.id)}
              </div>
            ),
          )}
        </div>
        {addRoomOpen ? (
          <form
            onSubmit={(e) => void submitAddRoom(e)}
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}
          >
            <input
              className="input"
              required
              placeholder="Room name"
              value={roomDraft.name}
              onChange={(e) => setRoomDraft({ name: e.target.value })}
              style={{ maxWidth: 280 }}
            />
            <button className="button" type="submit" style={smallButton} disabled={busy}>
              Add room
            </button>
            {rowError("add-room")}
          </form>
        ) : null}
      </div>

      {/* ——— Sessions (grouped by day, times in event timezone) ——— */}
      <div className="console-panel">
        <div className="console-panel-head">
          <p className="console-panel-label">Sessions</p>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span className="help-text" style={{ margin: 0 }}>
              Times in {displayZone.replace(/_/g, " ")} ({zoneAbbrev})
            </span>
            {localZone !== event.timezone ? (
              <label
                className="help-text"
                style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={showLocalTime}
                  onChange={(e) => setShowLocalTime(e.target.checked)}
                />
                Show in my local time
              </label>
            ) : null}
            <button
              type="button"
              className="button ghost"
              style={smallButton}
              onClick={() => setAddSessionOpen((v) => !v)}
            >
              {addSessionOpen ? "Close" : "+ Add session"}
            </button>
          </div>
        </div>

        <p className="help-text" style={{ margin: "0 0 8px" }}>
          A session can hold papers (with author lists) and resources (slides, links, files). Speakers (from the
          Speakers tab) present sessions — a person can be both.
        </p>

        {sessions.length === 0 && !addSessionOpen ? (
          <ListEmpty
            title="No sessions yet"
            body="Add your first block, import a CSV below, or paste a program via Agenda ingest."
            actionLabel="Agenda ingest"
            onAction={() => void router.push(`/organizer/events/${eventId}/ingest`)}
          />
        ) : null}

        {addSessionOpen ? (
          <form onSubmit={(e) => void submitAddSession(e)} className="console-form" style={{ marginBottom: 16 }}>
            {sessionFormFields(sessionDraft, (patch) => setSessionDraft((d) => ({ ...d, ...patch })))}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="button" type="submit" disabled={busy}>
                Add session
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => setAddSessionOpen(false)}
              >
                Cancel
              </button>
            </div>
            {rowError("add-session")}
          </form>
        ) : null}

        <div style={{ display: "grid", gap: 16 }}>
          {dayGroups.map((group) => (
            <div key={group.key}>
              <h3
                style={{
                  margin: "0 0 8px",
                  font: "600 14px/20px var(--font-body, inherit)",
                  color: "var(--gray-600)",
                }}
              >
                {group.label}
              </h3>
              <div style={{ display: "grid", gap: 8 }}>
                {group.sessions.map((s) => {
                  const track = s.trackId ? trackById.get(s.trackId) : undefined;
                  const room = s.roomId ? roomById.get(s.roomId) : undefined;
                  const papers = (s.items || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
                  const sessionResources = resourcesBySession[s.id];
                  return (
                    <div
                      key={s.id}
                      style={{
                        border: "1px solid var(--gray-200)",
                        borderRadius: "var(--radius-sm)",
                        padding: "10px 12px",
                        borderLeft: track ? `3px solid ${track.color}` : "1px solid var(--gray-200)",
                      }}
                    >
                      {editSession?.id === s.id ? (
                        <form onSubmit={(e) => void submitEditSession(e)} className="console-form">
                          {sessionFormFields(editSession, (patch) =>
                            setEditSession((d) => (d ? { ...d, ...patch } : d)),
                          )}
                          <div style={{ display: "flex", gap: 8 }}>
                            <button className="button" type="submit" disabled={busy}>
                              Save session
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => setEditSession(null)}
                            >
                              Cancel
                            </button>
                          </div>
                          {rowError(s.id)}
                        </form>
                      ) : (
                        <>
                          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ margin: 0, font: "600 15px/20px inherit", color: "var(--gray-900)" }}>
                                {s.title}
                              </p>
                              <p className="help-text" style={{ margin: "2px 0 0" }}>
                                {timeRange(s.startsAt, s.endsAt)}
                                {track ? <> · {track.name}</> : null}
                                {room ? <> · {room.name}</> : null}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="button ghost"
                              style={smallButton}
                              onClick={() =>
                                setEditSession({
                                  id: s.id,
                                  title: s.title,
                                  startLocal: toLocalInputValueInTimeZone(s.startsAt, event.timezone),
                                  endLocal: toLocalInputValueInTimeZone(s.endsAt, event.timezone),
                                  trackId: s.trackId || "",
                                  roomId: s.roomId || "",
                                })
                              }
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="button ghost"
                              style={{ ...smallButton, color: "var(--danger)" }}
                              onClick={() =>
                                setConfirm({
                                  kind: "session",
                                  id: s.id,
                                  title: s.title,
                                  paperCount: papers.length,
                                })
                              }
                            >
                              Delete
                            </button>
                          </div>
                          {rowError(s.id)}

                          {/* Papers under the session */}
                          {papers.length > 0 || addPaperSessionId === s.id ? (
                            <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid var(--gray-100)" }}>
                              {papers.map((p) =>
                                editPaper?.itemId === p.id ? (
                                  <form
                                    key={p.id}
                                    onSubmit={(e) => void submitEditPaper(e)}
                                    className="console-form"
                                    style={{ margin: "6px 0" }}
                                  >
                                    <label>
                                      Paper title
                                      <input
                                        className="input"
                                        required
                                        value={editPaper.title}
                                        onChange={(e) => setEditPaper({ ...editPaper, title: e.target.value })}
                                      />
                                    </label>
                                    <label>
                                      Authors
                                      <textarea
                                        className="input"
                                        rows={3}
                                        value={editPaper.authorsText}
                                        onChange={(e) =>
                                          setEditPaper({ ...editPaper, authorsText: e.target.value })
                                        }
                                        placeholder="One author per line (first = presenter)"
                                      />
                                      <span className="help-text">
                                        Order is preserved exactly — never alphabetized.
                                      </span>
                                    </label>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <button className="button" type="submit" style={smallButton} disabled={busy}>
                                        Save paper
                                      </button>
                                      <button
                                        className="button secondary"
                                        type="button"
                                        style={smallButton}
                                        disabled={busy}
                                        onClick={() => setEditPaper(null)}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                    {rowError(p.id)}
                                  </form>
                                ) : (
                                  <div key={p.id} style={{ padding: "3px 0" }}>
                                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                                      <span style={{ flex: 1, minWidth: 0, font: "var(--text-body)" }}>
                                        {p.title}
                                        {p.authors?.length ? (
                                          <span className="help-text">
                                            {" "}
                                            — {authorsToText(p.authors).split("\n").join(", ")}
                                          </span>
                                        ) : null}
                                      </span>
                                      <button
                                        type="button"
                                        className="button ghost"
                                        style={smallButton}
                                        onClick={() =>
                                          setEditPaper({
                                            sessionId: s.id,
                                            itemId: p.id,
                                            title: p.title,
                                            authorsText: authorsToText(p.authors),
                                          })
                                        }
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="button ghost"
                                        style={{ ...smallButton, color: "var(--danger)" }}
                                        onClick={() =>
                                          setConfirm({
                                            kind: "paper",
                                            sessionId: s.id,
                                            itemId: p.id,
                                            title: p.title,
                                            sessionTitle: s.title,
                                          })
                                        }
                                      >
                                        Delete
                                      </button>
                                    </div>
                                    {rowError(p.id)}
                                  </div>
                                ),
                              )}
                              {addPaperSessionId === s.id ? (
                                <form
                                  onSubmit={(e) => void submitAddPaper(e, s.id)}
                                  className="console-form"
                                  style={{ margin: "6px 0" }}
                                >
                                  <label>
                                    Paper title
                                    <input
                                      className="input"
                                      required
                                      value={paperDraft.title}
                                      onChange={(e) => setPaperDraft((d) => ({ ...d, title: e.target.value }))}
                                    />
                                  </label>
                                  <label>
                                    Authors
                                    <textarea
                                      className="input"
                                      rows={3}
                                      value={paperDraft.authorsText}
                                      onChange={(e) =>
                                        setPaperDraft((d) => ({ ...d, authorsText: e.target.value }))
                                      }
                                      placeholder="One author per line (first = presenter)"
                                    />
                                    <span className="help-text">
                                      Order is preserved exactly — never alphabetized.
                                    </span>
                                  </label>
                                  <div style={{ display: "flex", gap: 8 }}>
                                    <button className="button" type="submit" style={smallButton} disabled={busy}>
                                      Add paper
                                    </button>
                                    <button
                                      className="button secondary"
                                      type="button"
                                      style={smallButton}
                                      disabled={busy}
                                      onClick={() => setAddPaperSessionId(null)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                  {rowError(`add-paper-${s.id}`)}
                                </form>
                              ) : null}
                            </div>
                          ) : null}

                          {/* Resources under the session (E12.2) — listed like papers,
                              with Open and Remove, so an added resource is verifiable
                              in place. */}
                          {sessionResources === null || (sessionResources || []).length > 0 ? (
                            <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid var(--gray-100)" }}>
                              {sessionResources === null ? (
                                <p className="help-text" style={{ margin: "3px 0", color: "var(--danger)" }}>
                                  Couldn’t load this session’s resources — reload the page to retry.
                                </p>
                              ) : (
                                (sessionResources || []).map((r) => (
                                  <div key={r.id} style={{ padding: "3px 0" }}>
                                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                                      <span style={{ flex: 1, minWidth: 0, font: "var(--text-body)" }}>
                                        {r.title}
                                        <span className="help-text">
                                          {" "}
                                          — {r.kind === "LINK" ? "Link" : "File"} · added by {r.user.name}
                                        </span>
                                      </span>
                                      <a
                                        className="button ghost"
                                        style={{ ...smallButton, textDecoration: "none" }}
                                        href={r.url}
                                        {...(r.kind === "LINK"
                                          ? { target: "_blank", rel: "noreferrer" }
                                          : { download: r.title })}
                                      >
                                        Open
                                      </a>
                                      <button
                                        type="button"
                                        className="button ghost"
                                        style={{ ...smallButton, color: "var(--danger)" }}
                                        onClick={() =>
                                          setConfirm({
                                            kind: "resource",
                                            sessionId: s.id,
                                            resourceId: r.id,
                                            title: r.title,
                                            sessionTitle: s.title,
                                          })
                                        }
                                      >
                                        Remove
                                      </button>
                                    </div>
                                    {rowError(r.id)}
                                  </div>
                                ))
                              )}
                            </div>
                          ) : null}
                          {addResourceSessionId === s.id ? (
                            <form
                              onSubmit={(e) => void submitAddResource(e, s.id)}
                              className="console-form"
                              style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid var(--gray-100)" }}
                            >
                              <label>
                                Resource title
                                <input
                                  className="input"
                                  required
                                  value={resourceDraft.title}
                                  onChange={(e) => setResourceDraft((d) => ({ ...d, title: e.target.value }))}
                                  placeholder="e.g. Slides, reading list"
                                />
                              </label>
                              <div
                                role="group"
                                aria-label="Resource type"
                                style={{ display: "flex", gap: 16, alignItems: "center" }}
                              >
                                <label
                                  style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}
                                >
                                  <input
                                    type="radio"
                                    name={`resource-kind-${s.id}`}
                                    checked={resourceDraft.kind === "LINK"}
                                    onChange={() => setResourceDraft((d) => ({ ...d, kind: "LINK" }))}
                                  />
                                  Link
                                </label>
                                <label
                                  style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}
                                >
                                  <input
                                    type="radio"
                                    name={`resource-kind-${s.id}`}
                                    checked={resourceDraft.kind === "FILE"}
                                    onChange={() => setResourceDraft((d) => ({ ...d, kind: "FILE" }))}
                                  />
                                  File
                                </label>
                              </div>
                              {resourceDraft.kind === "LINK" ? (
                                <label>
                                  Link URL
                                  <input
                                    className="input"
                                    type="url"
                                    required
                                    value={resourceDraft.url}
                                    onChange={(e) => setResourceDraft((d) => ({ ...d, url: e.target.value }))}
                                    placeholder="https://…"
                                  />
                                </label>
                              ) : (
                                <label>
                                  File (up to ~4.5 MB)
                                  <input
                                    className="input"
                                    type="file"
                                    onChange={(e) =>
                                      setResourceDraft((d) => ({ ...d, file: e.target.files?.[0] || null }))
                                    }
                                  />
                                </label>
                              )}
                              <div style={{ display: "flex", gap: 8 }}>
                                <button className="button" type="submit" style={smallButton} disabled={busy}>
                                  Add resource
                                </button>
                                <button
                                  className="button secondary"
                                  type="button"
                                  style={smallButton}
                                  disabled={busy}
                                  onClick={() => setAddResourceSessionId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                              {rowError(`add-resource-${s.id}`)}
                            </form>
                          ) : null}
                          {resourceNotices[s.id] ? (
                            <p
                              role="status"
                              style={{ margin: "6px 0 0", color: "var(--success)", font: "var(--text-body)" }}
                            >
                              {resourceNotices[s.id]}
                            </p>
                          ) : null}
                          {/* E11.3: one combined entry point; Paper and SessionResource stay separate models. */}
                          {addPaperSessionId !== s.id && addResourceSessionId !== s.id ? (
                            addChooserSessionId === s.id ? (
                              <div style={{ marginTop: 8, display: "grid", gap: 6, justifyItems: "start" }}>
                                <button
                                  type="button"
                                  className="button ghost"
                                  style={{ ...smallButton, textAlign: "left" }}
                                  onClick={() => {
                                    setPaperDraft({ title: "", authorsText: "" });
                                    setAddPaperSessionId(s.id);
                                    setAddChooserSessionId(null);
                                  }}
                                >
                                  <strong>{programCopy.paper.noun}</strong> — {programCopy.paper.hint}
                                </button>
                                <button
                                  type="button"
                                  className="button ghost"
                                  style={{ ...smallButton, textAlign: "left" }}
                                  onClick={() => {
                                    setResourceDraft(emptyResourceDraft);
                                    setAddResourceSessionId(s.id);
                                    setAddChooserSessionId(null);
                                  }}
                                >
                                  <strong>{programCopy.resource.noun}</strong> — {programCopy.resource.hint}
                                </button>
                                <button
                                  type="button"
                                  className="button secondary"
                                  style={smallButton}
                                  onClick={() => setAddChooserSessionId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="button ghost"
                                style={{ ...smallButton, marginTop: 4 }}
                                onClick={() => {
                                  setResourceNotices((prev) => {
                                    const next = { ...prev };
                                    delete next[s.id];
                                    return next;
                                  });
                                  setAddChooserSessionId(s.id);
                                }}
                              >
                                + {programCopy.addEntryLabel}
                              </button>
                            )
                          ) : null}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ——— CSV import (non-AI fallback) ——— */}
      <SessionCsvImport eventId={eventId} onCreated={onChanged} />

      {confirm ? (
        <ConfirmDialog
          open
          title={confirmCopy(confirm).title}
          body={confirmCopy(confirm).body}
          confirmLabel={confirm.kind === "resource" ? "Remove" : "Delete"}
          tone="danger"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void onConfirmDelete()}
        />
      ) : null}
    </section>
  );
}
