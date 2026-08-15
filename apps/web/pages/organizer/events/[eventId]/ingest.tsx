import { brand, overviewCopy } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrganizerShell } from "../../../../components/OrganizerShell";
import {
  ReviewChangeset,
  type ReviewAssumption,
  type ReviewChangeRow,
} from "../../../../components/ReviewChangeset";
import { SessionCsvImport } from "../../../../components/organizer/SessionCsvImport";
import {
  LEGACY_DOC_MESSAGE,
  LEGACY_XLS_MESSAGE,
  isLegacyExcelFile,
  isLegacyWordFile,
  isXlsxFile,
} from "../../../../lib/spreadsheetImport";
import { CountUp } from "../../../../components/CountUp";
import { describeIngestSource, ingestReviewHeading, ingestSourceName } from "../../../../lib/ingestSource";
import { rowsToApiChangeset, toggleRemoval } from "../../../../lib/ingestReview";
import {
  INGEST_POLL_HARD_STOP_MS,
  INGEST_POLL_OVERTIME_MS,
  formatElapsed,
  ingestPollDelayMs,
  ingestStageLabel,
  isIngestRunActive,
} from "../../../../lib/ingestStatus";
import { openAttendeeApp } from "../../../../lib/organizerLinks";
import { organizerFetch } from "../../../../lib/organizerApi";

type IngestRun = {
  id: string;
  sourceKind: string;
  sourceFileName?: string | null;
  sourceMime?: string | null;
  sourceBytes?: number | null;
  sourceTextPreview?: string | null;
  status: string;
  extraction?: unknown;
  assumptions?: ReviewAssumption[] | unknown;
  changeset?: unknown;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  error?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
  jobId?: string | null;
};

type HistoryResponse = {
  runs: IngestRun[];
  audit: { id: string; action: string; entityId: string | null; createdAt: string; payload: unknown }[];
};

type ConfirmResponse = {
  run: IngestRun;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function kindFromFile(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "PDF";
  if (name.endsWith(".docx") || file.type.includes("wordprocessingml")) return "DOCX";
  if (name.endsWith(".xlsx") || file.type.includes("spreadsheetml")) return "XLSX";
  if (name.endsWith(".csv") || file.type === "text/csv") return "CSV";
  if (file.type.startsWith("image/")) return "IMAGE";
  return "PDF";
}

function minConfidence(session: { confidence?: Record<string, number> } | undefined): number | undefined {
  if (!session?.confidence) return undefined;
  const vals = Object.values(session.confidence);
  if (!vals.length) return undefined;
  return Math.min(...vals);
}

/**
 * A confidence value only means something when it varies. Some model runs
 * emit the same placeholder (e.g. 0.50) on every row — displaying that reads
 * as "the AI is unsure of everything" while carrying no information. Strip
 * confidence when it is uniform across multiple rows.
 */
function stripUniformConfidence(rows: ReviewChangeRow[]): ReviewChangeRow[] {
  const values = rows
    .map((r) => ("confidence" in r ? r.confidence : undefined))
    .filter((v): v is number => typeof v === "number");
  if (values.length < 2) return rows;
  const uniform = values.every((v) => v === values[0]);
  if (!uniform) return rows;
  return rows.map((r) => ("confidence" in r ? { ...r, confidence: undefined } : r));
}

/** Never show a raw provider-error JSON blob to the organizer. */
function friendlyIngestError(raw: string | null | undefined): string {
  const text = (raw || "").trim();
  if (!text) return "Extract failed. Try again shortly.";
  const looksLikeProviderBlob =
    /"type"\s*:\s*"(?:error|not_found_error|invalid_request_error|authentication_error)"/.test(text) ||
    text.startsWith("{");
  if (looksLikeProviderBlob) {
    return "The AI provider rejected the request — the team has been notified. Try again shortly.";
  }
  return text;
}

type InputMode = "paste" | "upload" | "url" | "csv";

/** E15.3: one input at a time behind a chooser; Upload file is the default. */
const INPUT_MODES: { id: InputMode; label: string }[] = [
  { id: "paste", label: "Paste text" },
  { id: "upload", label: "Upload file" },
  { id: "url", label: "Fetch URL" },
  { id: "csv", label: "Import spreadsheet" },
];

function changesetToRows(raw: unknown): ReviewChangeRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const row = r as Record<string, unknown>;
    const kind = String(row.kind || "create") as ReviewChangeRow["kind"];
    const session = row.session as { title?: string; date?: string; startTime?: string; confidence?: Record<string, number> } | undefined;
    if (kind === "delete") {
      return {
        kind: "delete",
        rowIndex: Number(row.rowIndex ?? 0),
        title: String(row.existingTitle || row.title || "Session"),
        message: typeof row.message === "string" ? row.message : undefined,
        accepted: row.accepted === true,
        sessionId: row.sessionId,
      };
    }
    if (kind === "update") {
      return {
        kind: "update",
        rowIndex: Number(row.rowIndex ?? 0),
        title: session?.title || String(row.existingTitle || ""),
        message: typeof row.message === "string" ? row.message : undefined,
        day: session?.date,
        confidence: minConfidence(session),
        accepted: row.accepted !== false,
        sessionId: row.sessionId,
        session,
        // E13.3: child-removal proposals ride along so the review UI can
        // offer them as unchecked checkboxes.
        speakerRemovals: row.speakerRemovals,
        itemRemovals: row.itemRemovals,
      };
    }
    if (kind === "error") {
      return {
        kind: "error",
        rowIndex: Number(row.rowIndex ?? 0),
        message: String(row.message || "Error"),
      };
    }
    return {
      kind: "create",
      rowIndex: Number(row.rowIndex ?? 0),
      title: session?.title || String(row.title || ""),
      day: session?.date,
      confidence: minConfidence(session),
      accepted: row.accepted !== false,
      session,
    };
  });
}

export default function AgendaIngestPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === "string" ? router.query.eventId : "";
  const [paste, setPaste] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("upload");
  // E15.2: live status while a run is going — the stage the run reports and
  // a counting elapsed timer. The job reports no percent complete, so no
  // progress bar: an honest timer beats a lying bar.
  const [stage, setStage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const aliveRef = useRef(true);
  const [emptyResult, setEmptyResult] = useState(false);
  const [lastRequest, setLastRequest] = useState<Record<string, unknown> | null>(null);
  const [run, setRun] = useState<IngestRun | null>(null);
  // E21: an .xlsx routed to the spreadsheet importer (no AI) rides here.
  const [spreadsheetFile, setSpreadsheetFile] = useState<File | null>(null);
  // E31: an .xlsx dropped on the Upload tab waits here while the organizer
  // chooses between the AI extractor and the exact-control column mapper.
  const [pendingXlsxFile, setPendingXlsxFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ReviewChangeRow[]>([]);
  const [assumptions, setAssumptions] = useState<ReviewAssumption[]>([]);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const reviewRef = useRef<HTMLDivElement | null>(null);
  const messageRef = useRef<HTMLDivElement | null>(null);

  // E11.2: after a multi-minute extraction the result must not sit invisibly
  // below the upload widgets — bring the review panel into view.
  useEffect(() => {
    // The ref is only attached while the review panel renders, so this is a
    // no-op for failed/empty runs.
    if (run?.status === "READY_FOR_REVIEW") {
      reviewRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  }, [run?.id, run?.status]);

  const [message, setMessageSafe] = useState<string | null>(null);

  // Stop the poll loop if the page unmounts mid-run; the run itself keeps
  // going server-side and stays reachable from Ingest history.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Tick the elapsed timer once a second while a run is extracting.
  useEffect(() => {
    if (!extracting || startedAt == null) return;
    setElapsedMs(Date.now() - startedAt);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [extracting, startedAt]);

  // E12.1: the user confirms at the review panel far down the page; the
  // success message (with its View program action) renders near the top.
  useEffect(() => {
    if (message) {
      messageRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }
  }, [message]);

  const loadHistory = useCallback(async () => {
    if (!eventId) return;
    const data = await organizerFetch<HistoryResponse>("/ai/ingest", eventId);
    setHistory(data);
  }, [eventId]);

  useEffect(() => {
    void loadHistory().catch(() => undefined);
  }, [loadHistory]);

  const summary = useMemo(
    () => ({
      creates: rows.filter((r) => r.kind === "create").length,
      updates: rows.filter((r) => r.kind === "update").length,
      deletes: rows.filter((r) => r.kind === "delete").length,
      errors: rows.filter((r) => r.kind === "error").length,
    }),
    [rows],
  );

  // E11.1: file-sourced runs show real metadata in the Source panel — never
  // the internal "[Binary …]" placeholder that sourceTextPreview holds for them.
  const sourceDisplay = useMemo(() => (run ? describeIngestSource(run) : null), [run]);

  // E15.3: when a run completes, the review replaces the input panel;
  // "Import another" (or Cancel) brings the input panel back.
  const reviewVisible = Boolean(
    run &&
      sourceDisplay &&
      rows.length > 0 &&
      (run.status === "READY_FOR_REVIEW" || run.status === "CONFIRMED"),
  );

  async function startIngest(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setUpgrade(null);
    setEmptyResult(false);
    setMessageSafe(null);
    setLastRequest(body);
    setExtracting(true);
    setStage("PENDING");
    const startedAtMs = Date.now();
    setStartedAt(startedAtMs);
    try {
      const res = await organizerFetch<{ run: IngestRun; jobId: string }>("/ai/ingest", eventId, {
        method: "POST",
        body: JSON.stringify({ ...body, processInline: true }),
      });
      let current = res.run;
      setStage(current.status);
      // E15.1: poll until the run reaches a terminal status, backing off as
      // time passes (400ms → 1s → 2s → 5s). Real runs on multi-page PDFs
      // have exceeded two minutes, so the ceiling is ~30 minutes
      // (INGEST_POLL_HARD_STOP_MS); past ~5 minutes the status block says
      // the run is taking longer than usual while polling continues. Only
      // the stage is pushed into state here — `run` is set together with
      // `rows` below so the review panel and its scroll-into-view arrive in
      // one render.
      while (isIngestRunActive(current.status) && Date.now() - startedAtMs < INGEST_POLL_HARD_STOP_MS) {
        await new Promise((r) => setTimeout(r, ingestPollDelayMs(Date.now() - startedAtMs)));
        if (!aliveRef.current) return;
        current = await organizerFetch<IngestRun>(`/ai/ingest/${current.id}`, eventId);
        setStage(current.status);
      }
      if (isIngestRunActive(current.status)) {
        // Only after the 30-minute ceiling — something is genuinely wrong.
        setRun(current);
        setError(
          "Extraction is still running after 30 minutes, which usually means something went wrong. " +
            "The run stays in Ingest history — reopen it there, or retry.",
        );
        await loadHistory();
        return;
      }
      if (current.status === "FAILED") {
        setError(friendlyIngestError(current.error));
        setRun(current);
        return;
      }
      if (current.error) {
        // Non-fatal run error text — never swallow it.
        setError(friendlyIngestError(current.error));
      }
      setRun(current);
      const nextRows = stripUniformConfidence(changesetToRows(current.changeset));
      setRows(nextRows);
      if (current.status === "READY_FOR_REVIEW" && nextRows.length === 0) {
        setEmptyResult(true);
      }
      const a = Array.isArray(current.assumptions) ? (current.assumptions as ReviewAssumption[]) : [];
      setAssumptions(a);
      await loadHistory();
    } catch (err) {
      const e = err as Error & { status?: number; body?: { error?: string; upgrade?: { message?: string } } };
      if (e.status === 402 || e.body?.upgrade) {
        setUpgrade(e.body?.upgrade?.message || e.body?.error || e.message);
      } else {
        setError(friendlyIngestError(e.body?.error || e.message || "Ingest failed"));
      }
    } finally {
      setExtracting(false);
      setStage(null);
      setBusy(false);
    }
  }

  async function onPaste(e: FormEvent) {
    e.preventDefault();
    await startIngest({ sourceKind: "PASTE", text: paste });
  }

  async function onUrl(e: FormEvent) {
    e.preventDefault();
    await startIngest({ sourceKind: "URL", url });
  }

  async function onFile(file: File | null) {
    if (!file) return;
    if (file.size > 20_000_000) {
      setError("File exceeds 20 MB limit");
      return;
    }
    // E21: honest handling per format — legacy Office formats get conversion
    // guidance. E31: modern spreadsheets offer a choice: AI extraction (sheet
    // names carry timeslot context) or the non-AI column mapper.
    if (isLegacyWordFile(file.name, file.type)) {
      setError(LEGACY_DOC_MESSAGE);
      return;
    }
    if (isLegacyExcelFile(file.name, file.type)) {
      setError(LEGACY_XLS_MESSAGE);
      return;
    }
    if (isXlsxFile(file.name, file.type)) {
      setError(null);
      setPendingXlsxFile(file);
      return;
    }
    setPendingXlsxFile(null);
    const dataUrl = await fileToDataUrl(file);
    await startIngest({
      sourceKind: kindFromFile(file),
      fileUrl: dataUrl,
      fileName: file.name,
      mime: file.type || undefined,
      text: file.type.startsWith("text/") || file.name.endsWith(".csv") || file.name.endsWith(".html")
        ? await file.text()
        : undefined,
    });
  }

  async function onConfirm() {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      // E13.2: assumptions are read-only display now — only the changeset
      // (with accept ticks and removal ticks) is persisted before confirm.
      const changeset = rowsToApiChangeset(rows, run.changeset);
      await organizerFetch(`/ai/ingest/${run.id}`, eventId, {
        method: "PATCH",
        body: JSON.stringify({ changeset }),
      });
      const res = await organizerFetch<ConfirmResponse>(`/ai/ingest/${run.id}/confirm`, eventId, {
        method: "POST",
        body: JSON.stringify({ changeset }),
      });
      setRun(res.run);
      setMessageSafe(
        `Created ${res.createdCount} draft session(s), updated ${res.updatedCount}, deleted ${res.deletedCount}. ` +
          `Drafts stay hidden from attendees until published — publishing the event publishes them, ` +
          `or use “Publish draft sessions” on the Program tab if the event is already live.`,
      );
      await loadHistory();
    } catch (err) {
      const e = err as Error & { body?: { error?: string } };
      setError(e.body?.error || e.message || "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>{`Agenda ingest · ${brand.productName}`}</title>
      </Head>
      <OrganizerShell active="ingest" eventId={eventId}>
        {/* E15.3: one column of work — the input panel and the review area
            share this width and left edge. */}
        <div className="ingest-work">
        <h1 style={{ marginTop: 0, font: "var(--text-h1)" }}>Agenda ingest</h1>
        <p className="help-text">
          Upload a program (≤20 MB), paste text, or fetch a URL. Review the changeset, then confirm to create{" "}
          <strong>DRAFT</strong> sessions only.
        </p>

        {extracting ? (
          // E15.2: during the run the input area is replaced by a live status
          // block — spinner, reported stage, counting elapsed timer. No
          // percentage bar: the job reports no percent complete.
          <section className="console-panel" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="ingest-spinner" aria-hidden />
              <strong role="status" aria-live="polite">
                {ingestStageLabel(stage)}…
              </strong>
              {/* Hidden from screen readers: announcing a per-second timer is noise. */}
              <span aria-hidden style={{ fontVariantNumeric: "tabular-nums", color: "var(--gray-600)" }}>
                {formatElapsed(elapsedMs)}
              </span>
            </div>
            <p className="help-text" style={{ margin: "8px 0 0" }}>
              {elapsedMs >= INGEST_POLL_OVERTIME_MS
                ? "Still working — this run is taking longer than usual. We keep checking, and the run also appears in Ingest history."
                : "Large programs can take 2–3 minutes. You can leave this page — the run keeps going and appears in Ingest history."}
            </p>
          </section>
        ) : null}
        {error ? (
          <p role="alert" style={{ color: "var(--danger)" }}>
            {error}
            {lastRequest && !busy ? (
              <>
                {" "}
                <button
                  type="button"
                  className="button secondary"
                  style={{ fontSize: 13, padding: "4px 10px", marginLeft: 8 }}
                  onClick={() => void startIngest(lastRequest)}
                >
                  Retry
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {emptyResult && !error ? (
          <div
            role="status"
            style={{
              padding: 12,
              borderRadius: "var(--radius-sm)",
              background: "var(--warning-50, #fffaeb)",
              border: "1px solid var(--gray-200)",
            }}
          >
            <strong>No sessions found in that text.</strong>
            <p className="help-text" style={{ margin: "6px 0 0" }}>
              Include times like “9:00–10:15” and one session per line, then try again.
            </p>
            {lastRequest && !busy ? (
              <button
                type="button"
                className="button secondary"
                style={{ marginTop: 8 }}
                onClick={() => void startIngest(lastRequest)}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {upgrade ? (
          <p style={{ color: "var(--warning)", background: "var(--warning-50)", padding: 12, borderRadius: "var(--radius-sm)" }}>
            {upgrade}{" "}
            <Link href="/organizer/billing">Upgrade plan</Link>
          </p>
        ) : null}
        {message ? (
          // E12.1: confirming drafts must not be a dead end — the success
          // message carries a primary route to the sessions it just created.
          <div
            ref={messageRef}
            role="status"
            style={{
              padding: 12,
              borderRadius: "var(--radius-sm)",
              background: "var(--success-50, #f0fdf4)",
              border: "1px solid var(--gray-200)",
            }}
          >
            <p style={{ margin: 0, color: "var(--success)" }}>{message}</p>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <Link href={`/organizer/events/${eventId}?tab=program`} className="button">
                View program
              </Link>
              <button
                type="button"
                className="button secondary"
                onClick={() => openAttendeeApp(eventId)}
              >
                {overviewCopy.actions.openAttendeeApp}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setMessageSafe(null);
                  setRun(null);
                  setRows([]);
                  setAssumptions([]);
                  setEmptyResult(false);
                  setError(null);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                Import another
              </button>
            </div>
          </div>
        ) : null}

        {/* E15.3: one panel, one visible input, behind a chooser. Hidden while
            a run is extracting (the status block stands in) and while a
            completed run's review is on screen (the review replaces it). */}
        {!extracting && !reviewVisible ? (
          <section className="console-panel ingest-input-panel" style={{ marginTop: 16 }}>
            <div className="ingest-mode-toggle" role="group" aria-label="Import method">
              {INPUT_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={inputMode === m.id ? "active" : undefined}
                  aria-pressed={inputMode === m.id}
                  onClick={() => {
                    setInputMode(m.id);
                    // A handed-over workbook only applies to the visit that
                    // triggered it — leaving the tab drops it.
                    if (m.id !== "csv") setSpreadsheetFile(null);
                    setPendingXlsxFile(null);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {inputMode !== "csv" ? (
              // E15.2: set the honest expectation before the wait begins.
              <p className="help-text" style={{ marginTop: 0 }}>
                Large programs can take 2–3 minutes. You can leave this page — the run keeps going and appears
                in Ingest history.
              </p>
            ) : null}

            {inputMode === "paste" ? (
              <form onSubmit={onPaste} className="console-form">
                <label>
                  Program text
                  <textarea
                    className="input"
                    rows={6}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    placeholder="Paste agenda text…"
                  />
                </label>
                <button
                  type="submit"
                  className="button"
                  disabled={busy || !paste.trim()}
                  style={{ justifySelf: "start" }}
                >
                  {busy ? "Working…" : "Extract from paste"}
                </button>
              </form>
            ) : null}

            {inputMode === "upload" ? (
              <div className="console-form">
                <label>
                  PDF / DOCX / XLSX / CSV / image
                  <input
                    className="input"
                    type="file"
                    accept=".pdf,.docx,.xlsx,.csv,.html,.htm,image/*"
                    disabled={busy}
                    onChange={(e) => void onFile(e.target.files?.[0] || null)}
                  />
                </label>
                <p className="help-text" style={{ margin: 0 }}>
                  Excel, PDF, Word, pasted text, or an image — AI reads any of these and drafts
                  sessions for your review. Excel also offers a no-AI column-mapping route. Legacy
                  .doc/.xls aren’t supported: save as .docx or .xlsx first.
                </p>
                {pendingXlsxFile ? (
                  // E31: the workbook waits while the organizer picks a route —
                  // AI extraction (reads sheet names for timeslot context) or
                  // the exact-control column mapper.
                  <div
                    role="group"
                    aria-label="How should this workbook be imported?"
                    style={{
                      padding: 12,
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--gray-200)",
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      <strong style={{ overflowWrap: "anywhere" }}>{pendingXlsxFile.name}</strong> — how should
                      this workbook be imported?
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="button"
                        disabled={busy}
                        onClick={async () => {
                          const file = pendingXlsxFile;
                          setPendingXlsxFile(null);
                          const dataUrl = await fileToDataUrl(file);
                          await startIngest({
                            sourceKind: "XLSX",
                            fileUrl: dataUrl,
                            fileName: file.name,
                            mime: file.type || undefined,
                          });
                        }}
                      >
                        Let AI read it
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => {
                          setSpreadsheetFile(pendingXlsxFile);
                          setPendingXlsxFile(null);
                          setInputMode("csv");
                        }}
                      >
                        Map columns myself (no AI)
                      </button>
                    </div>
                    <p className="help-text" style={{ margin: "8px 0 0" }}>
                      “Let AI read it” is recommended for messy sheets — it reads every sheet, including
                      timeslots in sheet names, and you still review the changeset before anything is
                      created. Column mapping gives exact control with no AI.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {inputMode === "url" ? (
              <form onSubmit={onUrl} className="console-form">
                <label>
                  URL
                  <input
                    className="input"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </label>
                <button
                  type="submit"
                  className="button"
                  disabled={busy || !url.trim()}
                  style={{ justifySelf: "start" }}
                >
                  Extract from URL
                </button>
              </form>
            ) : null}

            {inputMode === "csv" && eventId ? (
              <SessionCsvImport eventId={eventId} bare initialFile={spreadsheetFile} />
            ) : null}
          </section>
        ) : null}

        {reviewVisible && run && sourceDisplay ? (
          <div ref={reviewRef}>
          <ReviewChangeset
            title={
              // E30.4: same wording as ingestReviewHeading, with the found
              // figure rendered proudly — the ONE earned count-up.
              run.status !== "CONFIRMED" && summary.creates + summary.updates > 0 ? (
                <>
                  Review <CountUp value={summary.creates + summary.updates} /> session
                  {summary.creates + summary.updates === 1 ? "" : "s"} found in{" "}
                  {ingestSourceName(run.sourceKind, run.sourceFileName)}
                </>
              ) : (
                ingestReviewHeading({
                  confirmed: run.status === "CONFIRMED",
                  creates: summary.creates,
                  updates: summary.updates,
                  sourceKind: run.sourceKind,
                  fileName: run.sourceFileName,
                })
              )
            }
            sourcePreview={sourceDisplay.previewText || undefined}
            // E16.1: file sources render as a compact full-width band above
            // the review; the long-preview side column stays for paste/URL.
            sourceLayout={sourceDisplay.isFile ? "band" : "column"}
            sourceInfo={
              sourceDisplay.isFile ? (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    minWidth: 0,
                  }}
                >
                  <span className="help-text" style={{ margin: 0 }}>
                    Source
                  </span>
                  {sourceDisplay.fileName ? (
                    <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{sourceDisplay.fileName}</span>
                  ) : null}
                  <span className="help-text" style={{ margin: 0 }}>
                    {[sourceDisplay.mime, sourceDisplay.sizeLabel, new Date(run.createdAt).toLocaleString()]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {sourceDisplay.previewNote ? (
                    <span className="help-text" style={{ margin: 0, fontStyle: "italic" }}>
                      {sourceDisplay.previewNote}
                    </span>
                  ) : null}
                </div>
              ) : undefined
            }
            rows={rows}
            summary={summary}
            assumptions={assumptions}
            // H2 (D2): the agenda review groups creates by day + timeslot.
            groupCreates
            onAcceptChange={(rowIndex, accepted) =>
              setRows((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, accepted } : r)))
            }
            onRemovalChange={(rowIndex, kind, id, accepted) =>
              setRows((prev) => toggleRemoval(prev, rowIndex, kind, id, accepted))
            }
            renderCreateSummary={(row) => {
              const session = "session" in row ? (row.session as { title?: string; startTime?: string; room?: string } | undefined) : undefined;
              if (session) {
                return `${session.title} · ${session.startTime || ""}${session.room ? ` · ${session.room}` : ""}`;
              }
              return ("title" in row && row.title) || `Row ${row.rowIndex + 1}`;
            }}
            confirmLabel="Confirm drafts"
            onConfirm={run.status === "READY_FOR_REVIEW" ? onConfirm : undefined}
            busy={busy}
            onCancel={() => {
              setRun(null);
              setRows([]);
            }}
          />
          </div>
        ) : null}

        <section style={{ marginTop: 32 }}>
          <h2>Ingest history</h2>
          <p className="help-text">Runs linked to the audit log for this event.</p>
          <ul style={{ paddingLeft: 18, fontSize: 14 }}>
            {(history?.runs || []).map((r) => (
              <li key={r.id} style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className="button secondary"
                  style={{ fontSize: 13, padding: "4px 8px" }}
                  onClick={async () => {
                    const full = await organizerFetch<IngestRun>(`/ai/ingest/${r.id}`, eventId);
                    setRun(full);
                    const nextRows = stripUniformConfidence(changesetToRows(full.changeset));
                    setRows(nextRows);
                    setError(full.status === "FAILED" || full.error ? friendlyIngestError(full.error) : null);
                    setEmptyResult(full.status === "READY_FOR_REVIEW" && nextRows.length === 0);
                    setAssumptions(Array.isArray(full.assumptions) ? (full.assumptions as ReviewAssumption[]) : []);
                  }}
                >
                  {new Date(r.createdAt).toLocaleString()} · {r.sourceKind} · {r.status}
                </button>
                {r.confirmedAt
                  ? ` · +${r.createdCount} / ~${r.updatedCount} / −${r.deletedCount}`
                  : null}
                {history?.audit.some((a) => a.entityId === r.id) ? (
                  <span className="help-text"> · audit linked</span>
                ) : null}
              </li>
            ))}
          </ul>
          {history?.audit?.length ? (
            <details style={{ marginTop: 12 }}>
              <summary className="help-text">Audit log entries</summary>
              <ul style={{ fontSize: 13 }}>
                {history.audit.map((a) => (
                  <li key={a.id}>
                    {new Date(a.createdAt).toLocaleString()} · {a.action} · {a.entityId}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
        </div>
      </OrganizerShell>
    </>
  );
}
