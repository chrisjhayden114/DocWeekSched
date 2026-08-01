import { useCallback, useEffect, useMemo, useState } from "react";
import { ReviewChangeset, type ReviewChangeRow } from "../ReviewChangeset";
import { parseCsvToTable } from "../../lib/csvTable";
import {
  SESSION_CSV_MAPPING_OPTIONS,
  autoMapSessionCsv,
  sessionCsvTemplate,
  validateSessionCsvRows,
  type SessionCsvCreate,
  type SessionCsvRowResult,
} from "../../lib/sessionCsv";
import { organizerFetch } from "../../lib/organizerApi";

type EventWindow = { timezone: string; startDate: string; endDate: string };

type Props = {
  eventId: string;
  /** Called after sessions were created, so the parent can refetch. */
  onCreated?: () => Promise<void> | void;
};

/**
 * Non-AI import path: organizers with a spreadsheet download a CSV template,
 * upload it, review a validated changeset (same surface as AI ingest), and
 * only then create sessions via POST /sessions. Nothing is created without
 * the explicit confirm step.
 */
export function SessionCsvImport({ eventId, onCreated }: Props) {
  const [event, setEvent] = useState<EventWindow | null>(null);
  const [tracks, setTracks] = useState<{ id: string; name: string }[]>([]);
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const loadContext = useCallback(async () => {
    if (!eventId) return;
    const [ev, t, r] = await Promise.all([
      organizerFetch<EventWindow>("/event/", eventId),
      organizerFetch<{ id: string; name: string }[]>("/tracks/", eventId),
      organizerFetch<{ id: string; name: string }[]>("/rooms/", eventId),
    ]);
    setEvent(ev);
    setTracks(t);
    setRooms(r);
  }, [eventId]);

  useEffect(() => {
    void loadContext().catch(() => setError("Could not load event details for the import."));
  }, [loadContext]);

  const results = useMemo<SessionCsvRowResult[]>(() => {
    if (!event || csvRows.length === 0) return [];
    return validateSessionCsvRows({ rows: csvRows, mapping, tracks, rooms, event });
  }, [event, csvRows, mapping, tracks, rooms]);

  const reviewRows = useMemo<ReviewChangeRow[]>(
    () =>
      results.map((r) =>
        r.kind === "error"
          ? { kind: "error", rowIndex: r.rowIndex, message: r.message }
          : {
              kind: "create",
              rowIndex: r.rowIndex,
              title: r.title,
              day: r.day,
              accepted: accepted[r.rowIndex] !== false,
            },
      ),
    [results, accepted],
  );

  const summary = useMemo(
    () => ({
      creates: reviewRows.filter((r) => r.kind === "create").length,
      errors: reviewRows.filter((r) => r.kind === "error").length,
    }),
    [reviewRows],
  );

  function reset() {
    setHeaders([]);
    setCsvRows([]);
    setMapping({});
    setAccepted({});
    setFileInputKey((k) => k + 1);
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    setMessage(null);
    const parsed = parseCsvToTable(await file.text());
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    setMapping(autoMapSessionCsv(parsed.headers));
    setAccepted({});
  }

  function downloadTemplate() {
    const blob = new Blob([sessionCsvTemplate()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sessions-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onConfirm() {
    const toCreate = results.filter(
      (r): r is SessionCsvCreate => r.kind === "create" && accepted[r.rowIndex] !== false,
    );
    if (toCreate.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    let created = 0;
    let firstFailure: string | null = null;
    for (const row of toCreate) {
      try {
        await organizerFetch("/sessions/", eventId, {
          method: "POST",
          body: JSON.stringify(row.payload),
        });
        created += 1;
      } catch (err) {
        if (!firstFailure) {
          const e = err as Error & { body?: { error?: string } };
          firstFailure = `Row ${row.rowIndex + 1} ("${row.title}"): ${e.body?.error || e.message || "request failed"}`;
        }
      }
    }
    setBusy(false);
    if (firstFailure) {
      setError(
        `Created ${created} of ${toCreate.length} sessions. First failure — ${firstFailure}. ` +
          `Fix the CSV and re-upload only the remaining rows.`,
      );
    } else {
      setMessage(`Created ${created} session${created === 1 ? "" : "s"}.`);
      reset();
    }
    if (created > 0 && onCreated) await onCreated();
  }

  const outsideCount = results.filter((r) => r.kind === "create" && r.outsideEventDates).length;

  return (
    <div className="console-panel">
      <div className="console-panel-head">
        <p className="console-panel-label">Import sessions from CSV</p>
        <button
          type="button"
          className="button ghost"
          style={{ fontSize: 13, padding: "2px 10px" }}
          onClick={downloadTemplate}
        >
          Download CSV template
        </button>
      </div>
      <p className="help-text" style={{ marginTop: 0 }}>
        Already have your program in a spreadsheet? Upload a CSV (columns: title, start, end, track, room,
        speakers, description — times as YYYY-MM-DD HH:MM in the event timezone). You review every row before
        anything is created. No AI involved.
      </p>
      <input
        key={fileInputKey}
        className="input"
        type="file"
        accept=".csv,text/csv"
        disabled={busy || !event}
        aria-label="Upload sessions CSV"
        onChange={(e) => void onFile(e.target.files?.[0] || null)}
      />
      {error ? (
        <p role="alert" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" style={{ color: "var(--success)" }}>
          {message}
        </p>
      ) : null}
      {csvRows.length > 0 && event ? (
        <>
          {outsideCount > 0 ? (
            <p role="status" style={{ color: "var(--warning)", font: "var(--text-body)" }}>
              {outsideCount} row{outsideCount === 1 ? " falls" : "s fall"} outside your event dates — marked
              below. You can still create them.
            </p>
          ) : null}
          <ReviewChangeset
            title="Review CSV import"
            headers={headers}
            mapping={mapping}
            onMappingChange={setMapping}
            mappingOptions={SESSION_CSV_MAPPING_OPTIONS}
            rows={reviewRows}
            summary={summary}
            confirmLabel={`Create ${summary.creates} session${summary.creates === 1 ? "" : "s"}`}
            busy={busy}
            onConfirm={onConfirm}
            onCancel={reset}
            onAcceptChange={(rowIndex, isAccepted) =>
              setAccepted((prev) => ({ ...prev, [rowIndex]: isAccepted }))
            }
            renderCreateSummary={(row) => {
              const r = results.find(
                (x): x is SessionCsvCreate => x.kind === "create" && x.rowIndex === row.rowIndex,
              );
              if (!r) return ("title" in row && row.title) || `Row ${row.rowIndex + 1}`;
              const bits = [r.title, r.timeLabel];
              if (r.trackName) bits.push(r.trackName);
              if (r.roomName) bits.push(r.roomName);
              return bits.join(" · ") + (r.outsideEventDates ? " — outside event dates" : "");
            }}
          />
        </>
      ) : null}
    </div>
  );
}
