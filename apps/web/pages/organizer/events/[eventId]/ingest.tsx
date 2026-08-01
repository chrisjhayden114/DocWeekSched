import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { OrganizerShell } from "../../../../components/OrganizerShell";
import {
  ReviewChangeset,
  type ReviewAssumption,
  type ReviewChangeRow,
} from "../../../../components/ReviewChangeset";
import { SessionCsvImport } from "../../../../components/organizer/SessionCsvImport";
import { organizerFetch } from "../../../../lib/organizerApi";

type IngestRun = {
  id: string;
  sourceKind: string;
  sourceFileName?: string | null;
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

function rowsToApiChangeset(rows: ReviewChangeRow[], original: unknown): unknown[] {
  const orig = Array.isArray(original) ? (original as Record<string, unknown>[]) : [];
  return rows.map((row) => {
    const base = orig.find((o) => Number(o.rowIndex) === row.rowIndex) || {};
    return {
      ...base,
      kind: row.kind,
      rowIndex: row.rowIndex,
      accepted: "accepted" in row ? row.accepted : undefined,
      title: "title" in row ? row.title : undefined,
      message: "message" in row ? row.message : undefined,
      session: "session" in row ? row.session : base.session,
      sessionId: "sessionId" in row ? row.sessionId : base.sessionId,
      existingTitle: base.existingTitle,
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
  const [emptyResult, setEmptyResult] = useState(false);
  const [lastRequest, setLastRequest] = useState<Record<string, unknown> | null>(null);
  const [run, setRun] = useState<IngestRun | null>(null);
  const [rows, setRows] = useState<ReviewChangeRow[]>([]);
  const [assumptions, setAssumptions] = useState<ReviewAssumption[]>([]);
  const [history, setHistory] = useState<HistoryResponse | null>(null);

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

  async function startIngest(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setUpgrade(null);
    setEmptyResult(false);
    setLastRequest(body);
    setExtracting(true);
    try {
      const res = await organizerFetch<{ run: IngestRun; jobId: string }>("/ai/ingest", eventId, {
        method: "POST",
        body: JSON.stringify({ ...body, processInline: true }),
      });
      let current = res.run;
      // Poll while extracting (~40s max) — always end in a visible outcome.
      for (let i = 0; i < 100 && (current.status === "PENDING" || current.status === "EXTRACTING"); i += 1) {
        await new Promise((r) => setTimeout(r, 400));
        current = await organizerFetch<IngestRun>(`/ai/ingest/${current.id}`, eventId);
      }
      if (current.status === "PENDING" || current.status === "EXTRACTING") {
        setRun(current);
        setError(
          "Extraction is taking longer than expected and may still be running. Retry, or reopen this run from Ingest history in a minute.",
        );
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
      const changeset = rowsToApiChangeset(rows, run.changeset);
      await organizerFetch(`/ai/ingest/${run.id}`, eventId, {
        method: "PATCH",
        body: JSON.stringify({ changeset, assumptions }),
      });
      const res = await organizerFetch<ConfirmResponse>(`/ai/ingest/${run.id}/confirm`, eventId, {
        method: "POST",
        body: JSON.stringify({ changeset }),
      });
      setRun(res.run);
      setMessageSafe(
        `Created ${res.createdCount} draft session(s), updated ${res.updatedCount}, deleted ${res.deletedCount}. Drafts stay hidden from attendees until published.`,
      );
      await loadHistory();
    } catch (err) {
      const e = err as Error & { body?: { error?: string } };
      setError(e.body?.error || e.message || "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  const [message, setMessageSafe] = useState<string | null>(null);

  return (
    <>
      <Head>
        <title>{`Agenda ingest · ${brand.productName}`}</title>
      </Head>
      <OrganizerShell active="ingest" eventId={eventId}>
        <h1 style={{ marginTop: 0, font: "var(--text-h1)" }}>Agenda ingest</h1>
        <p className="help-text">
          Upload a program (≤20 MB), paste text, or fetch a URL. Review the changeset, then confirm to create{" "}
          <strong>DRAFT</strong> sessions only.
        </p>

        {extracting ? (
          <p role="status" aria-live="polite" style={{ color: "var(--gray-700)" }}>
            <span aria-hidden style={{ marginRight: 6 }}>⏳</span>
            Extracting your program… this usually takes under a minute.
          </p>
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
        {message ? <p style={{ color: "var(--success)" }}>{message}</p> : null}

        <section style={{ display: "grid", gap: 16, marginTop: 16 }}>
          <form onSubmit={onPaste} className="console-form console-panel">
            <p className="console-panel-label">Paste program text</p>
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
            <button type="submit" className="button" disabled={busy || !paste.trim()} style={{ justifySelf: "start" }}>
              {busy ? "Working…" : "Extract from paste"}
            </button>
          </form>

          <form onSubmit={onUrl} className="console-form console-panel">
            <p className="console-panel-label">Fetch URL</p>
            <label>
              URL
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </label>
            <button type="submit" className="button" disabled={busy || !url.trim()} style={{ justifySelf: "start" }}>
              Extract from URL
            </button>
          </form>

          <div className="console-form console-panel">
            <p className="console-panel-label">Upload file</p>
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
          </div>

          {eventId ? <SessionCsvImport eventId={eventId} /> : null}
        </section>

        {run && rows.length > 0 && (run.status === "READY_FOR_REVIEW" || run.status === "CONFIRMED") ? (
          <ReviewChangeset
            title={run.status === "CONFIRMED" ? "Confirmed drafts" : "Review extracted agenda"}
            sourcePreview={run.sourceTextPreview || undefined}
            rows={rows}
            summary={summary}
            assumptions={assumptions}
            onAssumptionAnswer={(id, answer) =>
              setAssumptions((prev) => prev.map((a) => (a.id === id ? { ...a, answer } : a)))
            }
            onAcceptChange={(rowIndex, accepted) =>
              setRows((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, accepted } : r)))
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
      </OrganizerShell>
    </>
  );
}
