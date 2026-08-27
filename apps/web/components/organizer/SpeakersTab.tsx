import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { ListEmpty } from "../ListState";
import { StatusChip } from "../StatusChip";
import { UploadDropzone } from "../UploadDropzone";
import { AutoGrowTextarea, SlideOver, initialsFor } from "../kit";
import { organizerFetch } from "../../lib/organizerApi";
import { fileToDataUrl } from "../../lib/photoDataUrl";
import type { OverviewAssignment, ReadinessOverview } from "../../lib/readinessView";
import {
  accessesBySpeakerId,
  filterSpeakers,
  isCfpConverted,
  portalCell,
  readinessChip,
  rollupsBySpeakerId,
  sessionsCellText,
  shouldShowSpeakerFilter,
  speakerCascadeCounts,
  speakerDeleteCascadeCopy,
  speakerDeleteTitle,
  speakerSessions,
  type SpeakerPortalAccess,
  type SpeakerRow,
  type SpeakerSession,
} from "../../lib/speakersView";

/**
 * SPK-1 — the Speakers tab as a real speaker summary (DESIGN_PHASE_J).
 *
 * Replaces the add-only <ul> with a table (photo/name/title + CFP badge,
 * sessions, readiness counts, portal state) and a wide SpeakerDetail
 * SlideOver over the existing PUT/DELETE /speakers/:id routes.
 *
 * Readiness and portal data are extra fetches, so they happen ONLY when the
 * readiness feature is on, and every cell degrades to an em dash when the
 * data isn't there — the table never guesses a state it can't see. Minting
 * and revoking portal links stay in the Readiness tab; this panel shows the
 * presenter email read-only and deep-links across.
 *
 * Deliberately absent (SPK-1 scope): engagement stats, progress bars,
 * approve/reject, reminder controls, bulk actions, featured flags.
 */

type Props = {
  eventId: string;
  speakers: SpeakerRow[];
  sessions: SpeakerSession[];
  /** Resolved (plan AND override) readiness flag — gates the extra fetches. */
  readinessEnabled: boolean;
  /** F2 URL-SlideOver pattern: ?tab=people&speaker=<id> drives the panel. */
  openSpeakerId: string | null;
  onOpenSpeaker: (speakerId: string | null) => void;
  /** Refetch the console's speakers/sessions after a write. */
  onChanged: () => Promise<void>;
};

type ProfileDraft = {
  name: string;
  title: string;
  affiliation: string;
  bio: string;
  /** null = untouched; "" = the organizer removed the photo. */
  photoUrl: string | null;
};

/** Speaker headshots are small and square; the API caps uploads at 4.5MB. */
const PHOTO_RULES = { maxBytes: 4_500_000, maxWidth: 512, maxHeight: 512, quality: 0.85 };

const EM_DASH = "—";

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function draftFor(speaker: SpeakerRow): ProfileDraft {
  return {
    name: speaker.name,
    title: speaker.title ?? "",
    affiliation: speaker.affiliation ?? "",
    bio: speaker.bio ?? "",
    photoUrl: null,
  };
}

function SpeakerAvatar({
  speaker,
  photoOverride,
  large,
}: {
  speaker: SpeakerRow;
  photoOverride?: string | null;
  large?: boolean;
}) {
  const src = photoOverride !== undefined && photoOverride !== null ? photoOverride : speaker.photoUrl;
  const className = `speaker-avatar${large ? " speaker-avatar--lg" : ""}`;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- data URLs and arbitrary storage hosts
    return <img className={className} src={src} alt="" />;
  }
  return (
    <span className={`${className} speaker-avatar--initials`} aria-hidden>
      {initialsFor(speaker.name)}
    </span>
  );
}

export function SpeakersTab({
  eventId,
  speakers,
  sessions,
  readinessEnabled,
  openSpeakerId,
  onOpenSpeaker,
  onChanged,
}: Props) {
  const [overview, setOverview] = useState<ReadinessOverview | null>(null);
  const [accesses, setAccesses] = useState<SpeakerPortalAccess[] | null>(null);

  const [query, setQuery] = useState("");
  const [addName, setAddName] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  /**
   * The two readiness reads, only when the feature is on. Failures are not
   * escalated: the columns fall back to em dashes and the rest of the tab
   * keeps working (a speaker roster shouldn't break because readiness did).
   */
  useEffect(() => {
    if (!readinessEnabled) {
      setOverview(null);
      setAccesses(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [data, portal] = await Promise.all([
        organizerFetch<ReadinessOverview>("/readiness/overview", eventId).catch(() => null),
        organizerFetch<{ accesses: SpeakerPortalAccess[] }>(
          "/readiness/portal-access",
          eventId,
        ).catch(() => null),
      ]);
      if (cancelled) return;
      setOverview(data);
      setAccesses(portal ? portal.accesses : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, readinessEnabled]);

  const rollups = useMemo(() => rollupsBySpeakerId(overview?.subjects), [overview]);
  const accessById = useMemo(() => accessesBySpeakerId(accesses), [accesses]);
  const visible = useMemo(() => filterSpeakers(speakers, query), [speakers, query]);
  const showFilter = shouldShowSpeakerFilter(speakers.length);

  const selected = useMemo(
    () => (openSpeakerId ? (speakers.find((s) => s.id === openSpeakerId) ?? null) : null),
    [openSpeakerId, speakers],
  );

  // Reseed the form whenever a different speaker opens. Keyed on the id, not
  // the row object: a background refresh replaces the object every poll and
  // would otherwise wipe what the organizer is typing.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selected) {
      seededFor.current = null;
      setDraft(null);
      return;
    }
    if (seededFor.current === selected.id) return;
    seededFor.current = selected.id;
    setDraft(draftFor(selected));
    setDetailError(null);
    setConfirmDelete(false);
  }, [selected]);

  const closeDetail = useCallback(() => onOpenSpeaker(null), [onOpenSpeaker]);

  async function addSpeaker(e: FormEvent) {
    e.preventDefault();
    const name = addName.trim();
    if (!eventId || !name) return;
    setAddBusy(true);
    setError(null);
    try {
      await organizerFetch("/speakers/", eventId, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setAddName("");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add this speaker");
    } finally {
      setAddBusy(false);
    }
  }

  async function saveProfile() {
    if (!selected || !draft || !draft.name.trim()) return;
    setSaveBusy(true);
    setDetailError(null);
    try {
      await organizerFetch(`/speakers/${selected.id}`, eventId, {
        method: "PUT",
        body: JSON.stringify({
          name: draft.name.trim(),
          title: draft.title.trim() || null,
          affiliation: draft.affiliation.trim() || null,
          bio: draft.bio.trim() || null,
          // Omitted unless touched, so a save never clears a photo by accident.
          ...(draft.photoUrl !== null ? { photoUrl: draft.photoUrl || null } : {}),
        }),
      });
      await onChanged();
      closeDetail();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Could not save this speaker");
    } finally {
      setSaveBusy(false);
    }
  }

  async function deleteSpeaker() {
    if (!selected) return;
    setDeleteBusy(true);
    setDetailError(null);
    try {
      await organizerFetch(`/speakers/${selected.id}`, eventId, { method: "DELETE" });
      setConfirmDelete(false);
      await onChanged();
      closeDetail();
    } catch (err) {
      setConfirmDelete(false);
      setDetailError(err instanceof Error ? err.message : "Could not delete this speaker");
    } finally {
      setDeleteBusy(false);
    }
  }

  const detailSessions = selected ? speakerSessions(selected, sessions) : [];
  const detailRollup = selected ? (rollups.get(selected.id) ?? null) : null;
  const detailChip = readinessChip(detailRollup);
  const detailAccess = selected ? (accessById.get(selected.id) ?? null) : null;
  const detailPortal = portalCell(detailAccess);
  /**
   * Assignments flattened to what the cascade copy counts. null (not []) when
   * readiness is off or its fetch failed, so the confirmation admits it can't
   * see the readiness blast radius instead of reporting a confident zero.
   */
  const cascadeAssignments = useMemo(
    () =>
      overview
        ? overview.assignments.map((a: OverviewAssignment) => ({
            speakerId: a.subject.type === "speaker" ? a.subject.id : null,
            latestSubmission: a.latestSubmission ? { id: a.latestSubmission.id } : null,
          }))
        : null,
    [overview],
  );
  const cascade = selected
    ? speakerCascadeCounts({
        speaker: selected,
        sessions,
        assignments: cascadeAssignments,
        access: detailAccess,
      })
    : null;

  return (
    <section className="console-panel">
      <p className="console-panel-label">Speakers</p>
      <p className="help-text" style={{ marginTop: 0 }}>
        Speakers present sessions and appear on the public schedule. Authors and presenters are listed under each
        paper or presentation inside a session (Program tab) — a person can be both.
      </p>

      {error ? (
        <p role="alert" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}

      {speakers.length === 0 ? (
        <ListEmpty
          title="No speakers yet"
          body="Add speakers to assign them to sessions, papers, and presentations."
        />
      ) : (
        <>
          {showFilter ? (
            <div style={{ margin: "0 0 12px" }}>
              <input
                className="input"
                type="search"
                placeholder="Filter by name"
                aria-label="Filter speakers by name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ maxWidth: 280 }}
              />
            </div>
          ) : null}

          {visible.length === 0 ? (
            <p className="help-text">No speakers match “{query.trim()}”.</p>
          ) : (
            <div className="console-table-wrap" style={{ marginBottom: 16 }}>
              <table className="console-table">
                <thead>
                  <tr>
                    <th>Speaker</th>
                    <th>Sessions</th>
                    <th>Readiness</th>
                    <th>Presenter portal</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => {
                    const chip = readinessChip(rollups.get(s.id));
                    const portal = portalCell(accessById.get(s.id));
                    const sessionText = sessionsCellText(s, sessions);
                    const subtitle = [s.title, s.affiliation].filter(Boolean).join(", ");
                    return (
                      <tr key={s.id}>
                        <td>
                          <div className="speaker-identity">
                            <SpeakerAvatar speaker={s} />
                            <div style={{ minWidth: 0 }}>
                              <button
                                type="button"
                                className="linkish speaker-name-button"
                                onClick={() => onOpenSpeaker(s.id)}
                              >
                                {s.name}
                              </button>
                              {isCfpConverted(s) ? (
                                <>
                                  {" "}
                                  <StatusChip status="default" label="CFP" />
                                </>
                              ) : null}
                              {subtitle ? <p className="text-meta speaker-subtitle">{subtitle}</p> : null}
                            </div>
                          </div>
                        </td>
                        <td>{sessionText ?? <span className="text-meta">{EM_DASH}</span>}</td>
                        <td>
                          {chip ? (
                            <StatusChip status={chip.tone} label={chip.label} />
                          ) : (
                            <span className="text-meta">{EM_DASH}</span>
                          )}
                        </td>
                        <td>
                          {portal.email ? (
                            <span
                              style={{
                                display: "inline-flex",
                                gap: 8,
                                alignItems: "center",
                                flexWrap: "wrap",
                              }}
                            >
                              <span>{portal.email}</span>
                              <StatusChip status={portal.tone} label={portal.label} />
                            </span>
                          ) : readinessEnabled && accesses ? (
                            <StatusChip status={portal.tone} label={portal.label} />
                          ) : (
                            <span className="text-meta">{EM_DASH}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <form
        onSubmit={addSpeaker}
        className="console-form"
        style={{ gridTemplateColumns: "1fr auto", alignItems: "end" }}
      >
        <label style={{ margin: 0 }}>
          Speaker name
          <input
            className="input"
            placeholder="Speaker name"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
          />
        </label>
        <button className="button" type="submit" disabled={addBusy || !addName.trim()}>
          {addBusy ? "Adding…" : "Add speaker"}
        </button>
      </form>

      {/* ——— SpeakerDetail (wide) ——— */}
      <SlideOver
        open={selected != null}
        wide
        title={selected?.name ?? "Speaker"}
        onClose={closeDetail}
        footer={
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              width: "100%",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="button button-danger"
              disabled={saveBusy || deleteBusy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                type="button"
                className="button secondary"
                disabled={saveBusy || deleteBusy}
                onClick={closeDetail}
              >
                Close
              </button>
              <button
                type="button"
                className="button"
                disabled={saveBusy || deleteBusy || !draft?.name.trim()}
                onClick={() => void saveProfile()}
              >
                {saveBusy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        }
      >
        {selected && draft ? (
          <div style={{ display: "grid", gap: 16 }}>
            {detailError ? (
              <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
                {detailError}
              </p>
            ) : null}

            <div style={{ display: "grid", gap: 10 }}>
              <p className="console-panel-label" style={{ margin: 0 }}>
                Profile
              </p>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <SpeakerAvatar speaker={selected} photoOverride={draft.photoUrl} large />
                <div style={{ flex: 1, minWidth: 200, display: "grid", gap: 6 }}>
                  <UploadDropzone
                    variant="compact"
                    label="Photo"
                    accept="image/*"
                    maxBytes={PHOTO_RULES.maxBytes}
                    disabled={saveBusy}
                    onFile={async (file) => {
                      const dataUrl = await fileToDataUrl(file, PHOTO_RULES);
                      setDraft((prev) => (prev ? { ...prev, photoUrl: dataUrl } : prev));
                    }}
                  />
                  {selected.photoUrl || draft.photoUrl ? (
                    <button
                      type="button"
                      className="button secondary"
                      style={{ justifySelf: "start" }}
                      disabled={saveBusy}
                      onClick={() => setDraft((prev) => (prev ? { ...prev, photoUrl: "" } : prev))}
                    >
                      Remove photo
                    </button>
                  ) : null}
                </div>
              </div>

              <label style={{ margin: 0 }}>
                Name
                <input
                  className="input"
                  value={draft.name}
                  disabled={saveBusy}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label style={{ margin: 0 }}>
                Title
                <input
                  className="input"
                  placeholder="Professor of Education"
                  value={draft.title}
                  disabled={saveBusy}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </label>
              <label style={{ margin: 0 }}>
                Affiliation
                <input
                  className="input"
                  placeholder="Northbridge University"
                  value={draft.affiliation}
                  disabled={saveBusy}
                  onChange={(e) => setDraft({ ...draft, affiliation: e.target.value })}
                />
              </label>
              <label style={{ margin: 0 }}>
                Bio
                <AutoGrowTextarea
                  className="input"
                  minRows={4}
                  placeholder="Shown on the public speaker profile."
                  value={draft.bio}
                  disabled={saveBusy}
                  onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
                />
              </label>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <p className="console-panel-label" style={{ margin: 0 }}>
                Contact
              </p>
              {!readinessEnabled ? (
                <p className="help-text" style={{ margin: 0 }}>
                  Presenter emails live with the presenter portal. Turn on “Speaker &amp; Session
                  Readiness” on the Features tab to invite speakers.
                </p>
              ) : detailPortal.email ? (
                <>
                  <p style={{ margin: 0 }}>
                    {detailPortal.email}{" "}
                    <StatusChip status={detailPortal.tone} label={detailPortal.label} />
                  </p>
                  <p className="text-meta" style={{ margin: 0 }}>
                    {[
                      detailAccess?.invitedAt ? `Invited ${formatDate(detailAccess.invitedAt)}` : null,
                      detailAccess?.lastUsedAt
                        ? `last opened ${formatDate(detailAccess.lastUsedAt)}`
                        : null,
                      detailAccess?.revokedAt
                        ? `revoked ${formatDate(detailAccess.revokedAt)}`
                        : detailAccess?.expiresAt
                          ? `expires ${formatDate(detailAccess.expiresAt)}`
                          : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="help-text" style={{ margin: 0 }}>
                    Sending, resending and revoking portal links stay in the Readiness tab.
                  </p>
                </>
              ) : (
                <p className="help-text" style={{ margin: 0 }}>
                  No portal invite yet. Invite this speaker from the Readiness tab once they have
                  requirements assigned.
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <p className="console-panel-label" style={{ margin: 0 }}>
                Sessions
              </p>
              {detailSessions.length === 0 ? (
                <p className="help-text" style={{ margin: 0 }}>
                  Not presenting anything yet. Assign speakers to sessions in the{" "}
                  <Link href={`/organizer/events/${eventId}?tab=program`}>Program tab</Link>.
                </p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                  {detailSessions.map((s) => (
                    <li key={s.id}>
                      <Link href={`/organizer/events/${eventId}?tab=program`}>{s.title}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <p className="console-panel-label" style={{ margin: 0 }}>
                Readiness
              </p>
              {!readinessEnabled ? (
                <p className="help-text" style={{ margin: 0 }}>
                  Readiness isn&apos;t enabled for this event.
                </p>
              ) : detailChip ? (
                <p style={{ margin: 0 }}>
                  {detailChip.label} ·{" "}
                  <Link href={`/organizer/events/${eventId}?tab=readiness&speaker=${selected.id}`}>
                    Open in Readiness
                  </Link>
                </p>
              ) : (
                <p className="help-text" style={{ margin: 0 }}>
                  Nothing assigned yet. Assign a template in the{" "}
                  <Link href={`/organizer/events/${eventId}?tab=readiness`}>Readiness tab</Link>.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </SlideOver>

      {/* Honest cascade: every consequence named, counts from the data on
          screen — sessions survive, readiness and portal access do not. */}
      <ConfirmDialog
        open={confirmDelete && selected != null}
        tone="danger"
        title={selected ? speakerDeleteTitle(selected.name) : "Delete speaker?"}
        body={cascade ? speakerDeleteCascadeCopy(cascade) : ""}
        confirmLabel="Delete speaker"
        busy={deleteBusy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deleteSpeaker()}
      />
    </section>
  );
}
