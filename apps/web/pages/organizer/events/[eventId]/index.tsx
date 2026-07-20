import { brand } from "@event-app/config";
import Head from "next/head";
import { useRouter } from "next/router";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { OrganizerShell } from "../../../../components/OrganizerShell";
import { ReviewChangeset, parseCsvToTable } from "../../../../components/ReviewChangeset";
import { FeatureConfigPanel, type FeatureOverridesMap } from "../../../../components/FeatureConfigPanel";
import { SetupCopilotChat } from "../../../../components/SetupCopilotChat";
import { VenueMapEditor } from "../../../../components/VenueMapEditor";
import { AnnouncementComposer } from "../../../../components/AnnouncementComposer";
import { EventFaqEditor } from "../../../../components/EventFaqEditor";
import { OpsInboxPanel } from "../../../../components/OpsInboxPanel";
import { RecapPanel } from "../../../../components/RecapPanel";
import { ListEmpty, ListError, ListSkeleton } from "../../../../components/ListState";
import { StatusChip } from "../../../../components/StatusChip";
import { apiFetch } from "../../../../lib/api";
import { organizerFetch } from "../../../../lib/organizerApi";

type EventDetail = {
  id: string;
  name: string;
  slug: string;
  status: string;
  uiStatus: string;
  description?: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
  venueName?: string | null;
  onlineUrl?: string | null;
  brandColor?: string | null;
  organizationId: string;
  seriesId?: string | null;
};

type Track = { id: string; name: string; color: string };
type Room = { id: string; name: string };
type Speaker = { id: string; name: string; title?: string | null; affiliation?: string | null };
type SessionRow = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  trackId?: string | null;
  roomId?: string | null;
  items?: { id: string; title: string; sortOrder: number; authors: { name: string; sortOrder: number }[] }[];
};
type DryRun = {
  headers: string[];
  mapping: Record<string, string>;
  rows: { kind: string; rowIndex: number; email?: string; name?: string; message?: string; researchInterests?: string; photoUrl?: string }[];
  summary: { creates: number; errors: number; skipped: number };
};

const MAPPING_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "name", label: "Name" },
  { value: "description", label: "Description / interests" },
  { value: "bio", label: "Bio" },
  { value: "photoUrl", label: "Photo URL" },
  { value: "skip", label: "Skip" },
];

export default function OrganizerEventPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === "string" ? router.query.eventId : "";
  const [tab, setTab] = useState<
    "overview" | "program" | "people" | "invites" | "maps" | "announcements" | "features" | "ops" | "recap"
  >("overview");
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [featureOverrides, setFeatureOverrides] = useState<FeatureOverridesMap>({});
  const [featuresDirty, setFeaturesDirty] = useState(false);
  const [featuresSaving, setFeaturesSaving] = useState(false);
  const [askAssistant, setAskAssistant] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Program forms
  const [trackName, setTrackName] = useState("");
  const [trackColor, setTrackColor] = useState("#0033A0");
  const [roomName, setRoomName] = useState("");
  const [speakerName, setSpeakerName] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionStart, setSessionStart] = useState("");
  const [sessionEnd, setSessionEnd] = useState("");
  const [sessionTrackId, setSessionTrackId] = useState("");
  const [sessionRoomId, setSessionRoomId] = useState("");
  const [itemSessionId, setItemSessionId] = useState("");
  const [itemTitle, setItemTitle] = useState("");
  const [itemAuthors, setItemAuthors] = useState("Author One\nAuthor Two\nAuthor Three");

  // Series
  const [nextStart, setNextStart] = useState("");

  // CSV
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [inviteLinks, setInviteLinks] = useState<{ slugUrl?: string; joinUrl?: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!eventId) return;
    const ev = await organizerFetch<EventDetail>("/event/", eventId);
    setEvent(ev);
    const [t, r, s, sess, links, feats] = await Promise.all([
      organizerFetch<Track[]>("/tracks/", eventId),
      organizerFetch<Room[]>("/rooms/", eventId),
      organizerFetch<Speaker[]>("/speakers/", eventId),
      organizerFetch<SessionRow[]>("/sessions/", eventId),
      organizerFetch<{ slugUrl?: string; joinUrl?: string }>("/event/invite-links", eventId).catch(() => null),
      organizerFetch<{ overrides: FeatureOverridesMap }>("/event/features", eventId).catch(() => ({ overrides: {} })),
    ]);
    setTracks(t);
    setRooms(r);
    setSpeakers(s);
    setSessions(sess);
    setInviteLinks(links);
    setFeatureOverrides(feats.overrides || {});
    setFeaturesDirty(false);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    void refresh().catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load event");
    });
  }, [eventId, refresh]);

  async function runStatus(path: string) {
    if (!eventId) return;
    setBusy(true);
    setError(null);
    try {
      await organizerFetch(path, eventId, { method: "POST", body: "{}" });
      await refresh();
      setMessage("Status updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status change failed");
    } finally {
      setBusy(false);
    }
  }

  async function addTrack(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !trackName.trim()) return;
    await organizerFetch("/tracks/", eventId, {
      method: "POST",
      body: JSON.stringify({ name: trackName.trim(), color: trackColor }),
    });
    setTrackName("");
    await refresh();
  }

  async function addRoom(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !roomName.trim()) return;
    await organizerFetch("/rooms/", eventId, {
      method: "POST",
      body: JSON.stringify({ name: roomName.trim() }),
    });
    setRoomName("");
    await refresh();
  }

  async function addSpeaker(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !speakerName.trim()) return;
    await organizerFetch("/speakers/", eventId, {
      method: "POST",
      body: JSON.stringify({ name: speakerName.trim() }),
    });
    setSpeakerName("");
    await refresh();
  }

  async function addSession(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !sessionTitle.trim() || !sessionStart || !sessionEnd) return;
    await organizerFetch("/sessions/", eventId, {
      method: "POST",
      body: JSON.stringify({
        title: sessionTitle.trim(),
        startsAt: new Date(sessionStart).toISOString(),
        endsAt: new Date(sessionEnd).toISOString(),
        trackId: sessionTrackId || null,
        roomId: sessionRoomId || null,
      }),
    });
    setSessionTitle("");
    await refresh();
  }

  async function addPaper(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !itemSessionId || !itemTitle.trim()) return;
    const authors = itemAuthors
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name, i) => ({ name, isPresenter: i === 0, sortOrder: i }));
    await organizerFetch(`/sessions/${itemSessionId}/items`, eventId, {
      method: "POST",
      body: JSON.stringify({ title: itemTitle.trim(), authors }),
    });
    setItemTitle("");
    await refresh();
  }

  async function createNextEdition(e: FormEvent) {
    e.preventDefault();
    if (!event || !nextStart) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ eventId: string }>("/series/next-edition", {
        method: "POST",
        body: JSON.stringify({
          sourceEventId: event.id,
          organizationId: event.organizationId,
          startDate: new Date(nextStart).toISOString(),
        }),
      });
      void router.push(`/organizer/events/${result.eventId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clone edition");
    } finally {
      setBusy(false);
    }
  }

  async function onCsvFile(file: File) {
    const text = await file.text();
    const parsed = parseCsvToTable(text);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    setDryRun(null);
    const dry = await organizerFetch<DryRun>("/attendees/invite-dry-run", eventId, {
      method: "POST",
      body: JSON.stringify({ headers: parsed.headers, rows: parsed.rows }),
    });
    setCsvMapping(dry.mapping);
    setDryRun(dry);
  }

  async function reDryRun(mapping: Record<string, string>) {
    setCsvMapping(mapping);
    if (!eventId || !csvHeaders.length) return;
    const dry = await organizerFetch<DryRun>("/attendees/invite-dry-run", eventId, {
      method: "POST",
      body: JSON.stringify({ headers: csvHeaders, rows: csvRows, mapping }),
    });
    setDryRun(dry);
  }

  async function confirmInvites() {
    if (!dryRun || !eventId) return;
    setBusy(true);
    try {
      const invites = dryRun.rows
        .filter((r) => r.kind === "create" && r.email && r.name)
        .map((r) => ({
          email: r.email!,
          name: r.name!,
          researchInterests: r.researchInterests,
          photoUrl: r.photoUrl,
        }));
      const result = await organizerFetch<{
        sentCount: number;
        emailFallbackMessage?: string;
        sent: { inviteUrl: string; emailDelivered: boolean }[];
      }>("/attendees/invite-bulk", eventId, {
        method: "POST",
        body: JSON.stringify({ invites }),
      });
      setMessage(
        result.emailFallbackMessage
          ? `${result.sentCount} invited. ${result.emailFallbackMessage}`
          : `Invited ${result.sentCount} people.`,
      );
      setDryRun(null);
      setCsvRows([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  if (!eventId) return null;

  return (
    <>
      <Head>
        <title>{`${event?.name || "Event"} — Organizer — ${brand.productName}`}</title>
      </Head>
      <OrganizerShell active="overview" eventId={eventId} eventName={event?.name}>
        {error && !event ? (
          <ListError message={error} onRetry={() => void refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed to load event"))} />
        ) : null}
        {!event && !error ? <ListSkeleton rows={5} /> : null}

        {event ? (
          <header className="console-page-header">
            <div>
              <h1>{event.name}</h1>
              <p className="text-meta" style={{ margin: "6px 0 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <StatusChip status={event.uiStatus} />
                <span>/e/{event.slug}</span>
                {inviteLinks?.slugUrl ? (
                  <a href={inviteLinks.slugUrl}>{inviteLinks.slugUrl}</a>
                ) : null}
              </p>
            </div>
          </header>
        ) : null}

        {message ? <p style={{ color: "var(--success)" }}>{message}</p> : null}
        {error && event ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

        {event ? (
        <nav className="nav" style={{ margin: "0 0 16px" }}>
          {(
            [
              ["overview", "Overview"],
              ["program", "Program"],
              ["people", "Speakers"],
              ["invites", "Invites"],
              ["maps", "Maps"],
              ["announcements", "Announcements"],
              ["ops", "Ops Inbox"],
              ["recap", "Recap"],
              ["features", "Features"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        ) : null}

        {tab === "overview" && event ? (
          <section style={{ display: "grid", gap: 16 }}>
            <div className="console-panel">
              <p className="console-panel-label">Publish</p>
              <p className="help-text" style={{ marginTop: 0 }}>
                Draft events 404 for outsiders. Published events are reachable via slug/join link. Archive hides them from
                attendees while keeping data.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {event.status !== "ACTIVE" ? (
                  <button type="button" className="button" disabled={busy} onClick={() => void runStatus("/event/publish")}>
                    Publish
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void runStatus("/event/unpublish")}
                  >
                    Unpublish (back to Draft)
                  </button>
                )}
                {event.status !== "ARCHIVED" ? (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void runStatus("/event/archive")}
                  >
                    Archive
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void runStatus("/event/unarchive")}
                  >
                    Unarchive to Draft
                  </button>
                )}
              </div>
            </div>

            <div className="console-panel">
              <p className="console-panel-label">Create next edition</p>
              <p className="help-text" style={{ marginTop: 0 }}>
                Clones tracks, rooms, speakers, sessions, and papers into a new Draft — no attendees. Dates shift from the
                new start.
              </p>
              <form onSubmit={createNextEdition} className="console-form">
                <label>
                  New start
                  <input
                    className="input"
                    type="datetime-local"
                    required
                    value={nextStart}
                    onChange={(e) => setNextStart(e.target.value)}
                  />
                </label>
                <button className="button" type="submit" disabled={busy} style={{ justifySelf: "start" }}>
                  Create next edition
                </button>
              </form>
            </div>

            {event.description ? (
              <div className="console-panel">
                <p className="console-panel-label">About</p>
                <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{event.description}</p>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "program" ? (
          <section style={{ display: "grid", gap: 16 }}>
            <div className="console-panel">
              <p className="console-panel-label">Tracks</p>
              <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                {tracks.map((t) => (
                  <li key={t.id}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: t.color, marginRight: 6 }} />
                    {t.name}
                  </li>
                ))}
              </ul>
              <form onSubmit={addTrack} className="console-form" style={{ gridTemplateColumns: "1fr auto auto", alignItems: "end" }}>
                <label style={{ margin: 0 }}>
                  Track name
                  <input className="input" placeholder="Track name" value={trackName} onChange={(e) => setTrackName(e.target.value)} />
                </label>
                <input className="input" type="color" value={trackColor} onChange={(e) => setTrackColor(e.target.value)} style={{ width: 56 }} aria-label="Track color" />
                <button className="button" type="submit">
                  Add track
                </button>
              </form>
            </div>

            <div className="console-panel">
              <p className="console-panel-label">Rooms</p>
              <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                {rooms.map((r) => (
                  <li key={r.id}>{r.name}</li>
                ))}
              </ul>
              <form onSubmit={addRoom} className="console-form" style={{ gridTemplateColumns: "1fr auto", alignItems: "end" }}>
                <label style={{ margin: 0 }}>
                  Room name
                  <input className="input" placeholder="Room name" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
                </label>
                <button className="button" type="submit">
                  Add room
                </button>
              </form>
            </div>

            <div className="console-panel">
              <p className="console-panel-label">Sessions</p>
              {sessions.length === 0 ? (
                <ListEmpty
                  title="No sessions yet"
                  body="Add your first block below, or paste a program via Agenda ingest."
                  actionLabel="Agenda ingest"
                  onAction={() => void router.push(`/organizer/events/${eventId}/ingest`)}
                />
              ) : (
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  {sessions.map((s) => (
                    <li key={s.id} style={{ marginBottom: 12 }}>
                      <strong>{s.title}</strong>
                      <span className="help-text">
                        {" "}
                        · {new Date(s.startsAt).toLocaleString()}
                      </span>
                      {s.items && s.items.length > 0 ? (
                        <ol style={{ margin: "6px 0 0" }}>
                          {s.items.map((it) => (
                            <li key={it.id}>
                              {it.title}
                              {it.authors?.length ? (
                                <span className="help-text">
                                  {" "}
                                  — {it.authors.map((a) => a.name).join(", ")}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <form onSubmit={addSession} style={{ display: "grid", gap: 8, maxWidth: 480 }}>
                <input className="input" placeholder="Session title" required value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} />
                <input className="input" type="datetime-local" required value={sessionStart} onChange={(e) => setSessionStart(e.target.value)} />
                <input className="input" type="datetime-local" required value={sessionEnd} onChange={(e) => setSessionEnd(e.target.value)} />
                <select className="input" value={sessionTrackId} onChange={(e) => setSessionTrackId(e.target.value)}>
                  <option value="">No track</option>
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <select className="input" value={sessionRoomId} onChange={(e) => setSessionRoomId(e.target.value)}>
                  <option value="">No room</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <button className="button" type="submit">
                  Add session
                </button>
              </form>
            </div>

            <div className="console-panel">
              <p className="console-panel-label">Papers</p>
              <p className="help-text" style={{ marginTop: 0 }}>Authors stay in the order you enter them — never alphabetized.</p>
              <form onSubmit={addPaper} className="console-form">
                <label>
                  Session
                  <select className="input" required value={itemSessionId} onChange={(e) => setItemSessionId(e.target.value)}>
                    <option value="">Choose session</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Paper title
                  <input className="input" placeholder="Paper title" required value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} />
                </label>
                <label>
                  Authors
                  <textarea
                    className="input"
                    rows={4}
                    value={itemAuthors}
                    onChange={(e) => setItemAuthors(e.target.value)}
                    placeholder="One author per line (first = presenter)"
                  />
                </label>
                <button className="button" type="submit" style={{ justifySelf: "start" }}>
                  Add paper
                </button>
              </form>
            </div>
          </section>
        ) : null}

        {tab === "people" ? (
          <section className="console-panel">
            <p className="console-panel-label">Speakers</p>
            {speakers.length === 0 ? (
              <ListEmpty title="No speakers yet" body="Add speakers to assign them to sessions and papers." />
            ) : (
              <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                {speakers.map((s) => (
                  <li key={s.id}>
                    {s.name}
                    {s.title || s.affiliation ? (
                      <span className="help-text">
                        {" "}
                        — {[s.title, s.affiliation].filter(Boolean).join(", ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addSpeaker} className="console-form" style={{ gridTemplateColumns: "1fr auto", alignItems: "end" }}>
              <label style={{ margin: 0 }}>
                Speaker name
                <input className="input" placeholder="Speaker name" value={speakerName} onChange={(e) => setSpeakerName(e.target.value)} />
              </label>
              <button className="button" type="submit">
                Add speaker
              </button>
            </form>
          </section>
        ) : null}

        {tab === "invites" ? (
          <section className="console-panel">
            <p className="console-panel-label">CSV bulk invite</p>
            <p className="help-text" style={{ marginTop: 0 }}>
              Upload a CSV, review the dry-run (errors per row), then confirm. If email isn&apos;t set up, you&apos;ll get
              copyable invite links instead.
            </p>
            <input
              className="input"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onCsvFile(f).catch((err) => setError(err instanceof Error ? err.message : "CSV failed"));
              }}
            />
            {dryRun ? (
              <ReviewChangeset
                title="Review invite changeset"
                headers={csvHeaders}
                mapping={csvMapping}
                onMappingChange={(m) => void reDryRun(m)}
                mappingOptions={MAPPING_OPTIONS}
                rows={dryRun.rows as never}
                summary={dryRun.summary}
                confirmLabel={`Invite ${dryRun.summary.creates} people`}
                busy={busy}
                onConfirm={confirmInvites}
                onCancel={() => {
                  setDryRun(null);
                  setCsvRows([]);
                }}
                renderCreateSummary={(row) =>
                  row.kind === "create" ? `${row.name || ""} <${row.email || ""}>` : ""
                }
              />
            ) : null}
          </section>
        ) : null}

        {tab === "maps" && eventId ? <VenueMapEditor eventId={eventId} rooms={rooms} /> : null}

        {tab === "announcements" && eventId ? (
          <AnnouncementComposer eventId={eventId} sessions={sessions.map((s) => ({ id: s.id, title: s.title }))} />
        ) : null}

        {tab === "ops" && eventId ? <OpsInboxPanel eventId={eventId} /> : null}
        {tab === "recap" && eventId ? <RecapPanel eventId={eventId} /> : null}

        {tab === "features" ? (
          <section>
            <h2 style={{ marginTop: 0 }}>Features</h2>
            <p className="help-text">
              Turn capabilities on or off for attendees. Existing data is preserved when a feature is disabled.
            </p>
            <div style={{ marginBottom: 16 }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => setAskAssistant((v) => !v)}
              >
                {askAssistant ? "Hide assistant" : "Ask the assistant"}
              </button>
            </div>
            {askAssistant && eventId ? (
              <div style={{ marginBottom: 20 }}>
                <SetupCopilotChat
                  mode="settings"
                  eventId={eventId}
                  organizationId={event?.organizationId}
                  compact
                  onFormChange={(form) => {
                    setFeatureOverrides(form.featureOverrides);
                    setFeaturesDirty(true);
                  }}
                  onFeaturesApplied={(overrides) => {
                    setFeatureOverrides(overrides);
                    setFeaturesDirty(false);
                    setMessage("Feature settings updated");
                  }}
                />
              </div>
            ) : null}
            <FeatureConfigPanel
              overrides={featureOverrides}
              onChange={(next) => {
                setFeatureOverrides(next);
                setFeaturesDirty(true);
              }}
              confirmOff
              showPresets
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
              <button
                type="button"
                className="button"
                disabled={!featuresDirty || featuresSaving}
                onClick={() => {
                  void (async () => {
                    setFeaturesSaving(true);
                    setError(null);
                    try {
                      await organizerFetch("/event/features", eventId, {
                        method: "PUT",
                        body: JSON.stringify({ overrides: featureOverrides }),
                      });
                      setFeaturesDirty(false);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not save features");
                    } finally {
                      setFeaturesSaving(false);
                    }
                  })();
                }}
              >
                {featuresSaving ? "Saving…" : "Save features"}
              </button>
              {featuresDirty ? <span className="help-text">Unsaved changes</span> : null}
            </div>
            {eventId ? <EventFaqEditor eventId={eventId} /> : null}
          </section>
        ) : null}
      </OrganizerShell>
    </>
  );
}
