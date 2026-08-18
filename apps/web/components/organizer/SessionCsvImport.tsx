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
import {
  LEGACY_XLS_MESSAGE,
  fileToDataUrl,
  isLegacyExcelFile,
  isXlsxFile,
  type SpreadsheetParseResponse,
  type SpreadsheetSheetInfo,
} from "../../lib/spreadsheetImport";
import { organizerFetch } from "../../lib/organizerApi";

type EventWindow = { timezone: string; startDate: string; endDate: string };

type Props = {
  eventId: string;
  /** Called after sessions were created, so the parent can refetch. */
  onCreated?: () => Promise<void> | void;
  /**
   * Render without the console-panel chrome — for embedding inside an
   * existing panel (the ingest page's single input panel, E15.3).
   */
  bare?: boolean;
  /**
   * E21: a file handed over by another surface (the ingest page's Upload
   * tab routes .xlsx here so spreadsheets never go to the model).
   */
  initialFile?: File | null;
};

/**
 * Non-AI import path: organizers with a spreadsheet download a CSV template,
 * upload a CSV or Excel (.xlsx) file, review a validated changeset (same
 * surface as AI ingest), and only then create sessions via POST /sessions.
 * Nothing is created without the explicit confirm step. Excel files are
 * converted to rows server-side (E21) — same review, no AI.
 */
export function SessionCsvImport({ eventId, onCreated, bare, initialFile }: Props) {
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
  // E21: multi-sheet workbooks ask which sheet — never silently the first.
  const [sheetChoices, setSheetChoices] = useState<SpreadsheetSheetInfo[] | null>(null);
  const [pendingWorkbook, setPendingWorkbook] = useState<{ dataUrl: string; name: string } | null>(
    null,
  );

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
    setSheetChoices(null);
    setPendingWorkbook(null);
    setFileInputKey((k) => k + 1);
  }

  const applyTable = useCallback((parsedHeaders: string[], parsedRows: Record<string, string>[]) => {
    setHeaders(parsedHeaders);
    setCsvRows(parsedRows);
    setMapping(autoMapSessionCsv(parsedHeaders));
    setAccepted({});
  }, []);

  /** Parse a workbook server-side; `sheet` chooses one of several sheets. */
  const parseWorkbook = useCallback(
    async (dataUrl: string, fileName: string, sheet?: string) => {
      setBusy(true);
      try {
        const res = await organizerFetch<SpreadsheetParseResponse>(
          "/import/spreadsheet/parse",
          eventId,
          { method: "POST", body: JSON.stringify({ fileUrl: dataUrl, ...(sheet ? { sheet } : {}) }) },
        );
        if (res.needsSheetChoice) {
          setPendingWorkbook({ dataUrl, name: fileName });
          setSheetChoices(res.sheets);
          return;
        }
        setSheetChoices(null);
        setPendingWorkbook(null);
        applyTable(res.headers || [], res.rows || []);
      } catch (err) {
        const e = err as Error & { body?: { error?: string } };
        setError(e.body?.error || e.message || "Could not read the spreadsheet.");
      } finally {
        setBusy(false);
      }
    },
    [eventId, applyTable],
  );

  const onFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setError(null);
      setMessage(null);
      setSheetChoices(null);
      setPendingWorkbook(null);
      if (isLegacyExcelFile(file.name, file.type)) {
        setError(LEGACY_XLS_MESSAGE);
        return;
      }
      if (isXlsxFile(file.name, file.type)) {
        // E21: Excel parses server-side, then joins the same review path.
        const dataUrl = await fileToDataUrl(file);
        await parseWorkbook(dataUrl, file.name);
        return;
      }
      const parsed = parseCsvToTable(await file.text());
      if ("error" in parsed) {
        setError(parsed.error);
        return;
      }
      applyTable(parsed.headers, parsed.rows);
    },
    [applyTable, parseWorkbook],
  );

  // E21: process a file handed over by the ingest page's Upload tab.
  const [consumedInitialFile, setConsumedInitialFile] = useState<File | null>(null);
  useEffect(() => {
    if (initialFile && initialFile !== consumedInitialFile) {
      setConsumedInitialFile(initialFile);
      void onFile(initialFile);
    }
  }, [initialFile, consumedInitialFile, onFile]);

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
    <div className={bare ? undefined : "console-panel"}>
      <div className="console-panel-head">
        <p className="console-panel-label">Import sessions from a spreadsheet</p>
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
        Already have your program in a spreadsheet? Upload a CSV or Excel (.xlsx) file (columns: title,
        start, end, track, room, speakers, description — times as YYYY-MM-DD HH:MM in the event timezone).
        You review every row before anything is created. No AI involved.
      </p>
      <input
        key={fileInputKey}
        className="input"
        type="file"
        accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={busy || !event}
        aria-label="Upload sessions spreadsheet (CSV or Excel)"
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
      {sheetChoices && pendingWorkbook ? (
        // E21: never silently take the first sheet of a multi-sheet workbook.
        <div role="group" aria-label="Choose a sheet to import" style={{ marginTop: 8 }}>
          <p className="help-text" style={{ marginBottom: 6 }}>
            “{pendingWorkbook.name}” has {sheetChoices.length} sheets — which one holds your sessions?
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {sheetChoices.map((s) => (
              <button
                key={s.name}
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void parseWorkbook(pendingWorkbook.dataUrl, pendingWorkbook.name, s.name)}
              >
                {s.name} ({s.rowCount} row{s.rowCount === 1 ? "" : "s"})
              </button>
            ))}
          </div>
        </div>
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
