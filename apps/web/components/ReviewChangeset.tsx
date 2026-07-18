import { useMemo } from "react";

export type ReviewChangeRow =
  | {
      kind: "create";
      rowIndex: number;
      email?: string;
      name?: string;
      title?: string;
      confidence?: number;
      day?: string;
      accepted?: boolean;
      [key: string]: unknown;
    }
  | {
      kind: "error";
      rowIndex: number;
      message: string;
      raw?: Record<string, string>;
    }
  | {
      kind: "update" | "skip";
      rowIndex: number;
      message?: string;
      title?: string;
      confidence?: number;
      day?: string;
      accepted?: boolean;
      [key: string]: unknown;
    }
  | {
      kind: "delete";
      rowIndex: number;
      message?: string;
      title?: string;
      /** Deletes default unchecked. */
      accepted?: boolean;
      [key: string]: unknown;
    };

export type ReviewAssumption = {
  id: string;
  question: string;
  defaultAnswer?: string;
  answer?: string;
  appliesTo?: string;
};

export type ReviewChangesetProps = {
  title?: string;
  headers?: string[];
  mapping?: Record<string, string>;
  onMappingChange?: (mapping: Record<string, string>) => void;
  mappingOptions?: { value: string; label: string }[];
  rows: ReviewChangeRow[];
  summary?: { creates?: number; errors?: number; skipped?: number; updates?: number; deletes?: number };
  confirmLabel?: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  busy?: boolean;
  /** Render primary fields for a create/update row */
  renderCreateSummary?: (row: ReviewChangeRow) => string;
  /** Toggle accept for update/delete/create rows (ingest). */
  onAcceptChange?: (rowIndex: number, accepted: boolean) => void;
  assumptions?: ReviewAssumption[];
  onAssumptionAnswer?: (id: string, answer: string) => void;
  /** Amber threshold for confidence (default 0.8). */
  lowConfidence?: number;
  /** Optional left-column source preview (ingest). */
  sourcePreview?: string;
};

function rowAccepted(row: ReviewChangeRow): boolean {
  if (row.kind === "delete") return row.accepted === true;
  if (row.kind === "create" || row.kind === "update") return row.accepted !== false;
  return false;
}

/**
 * Reusable dry-run review surface (CSV invites + Agenda Ingest).
 * Shows column mapping, per-row create/update/delete list, confirm/cancel.
 */
export function ReviewChangeset({
  title = "Review changes",
  headers,
  mapping,
  onMappingChange,
  mappingOptions,
  rows,
  summary,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
  busy,
  renderCreateSummary,
  onAcceptChange,
  assumptions,
  onAssumptionAnswer,
  lowConfidence = 0.8,
  sourcePreview,
}: ReviewChangesetProps) {
  const creates = useMemo(() => rows.filter((r) => r.kind === "create"), [rows]);
  const updates = useMemo(() => rows.filter((r) => r.kind === "update"), [rows]);
  const deletes = useMemo(() => rows.filter((r) => r.kind === "delete"), [rows]);
  const errors = useMemo(() => rows.filter((r) => r.kind === "error"), [rows]);
  const acceptedCount = useMemo(() => rows.filter(rowAccepted).length, [rows]);
  const canConfirm = acceptedCount > 0 && !busy && Boolean(onConfirm);

  const body = (
    <>
      <h4 style={{ margin: "0 0 8px" }}>{title}</h4>
      {summary ? (
        <p className="help-text" style={{ marginTop: 0 }}>
          {summary.creates != null ? (
            <>
              <strong>{summary.creates}</strong> create
            </>
          ) : null}
          {summary.updates != null && summary.updates > 0 ? (
            <>
              {summary.creates != null ? " · " : null}
              <strong>{summary.updates}</strong> update
            </>
          ) : null}
          {summary.deletes != null && summary.deletes > 0 ? (
            <>
              {" · "}
              <strong>{summary.deletes}</strong> delete proposed
            </>
          ) : null}
          {summary.errors != null ? (
            <>
              {(summary.creates != null || summary.updates != null) ? " · " : null}
              <strong style={{ color: "#b42318" }}>{summary.errors}</strong> errors
            </>
          ) : null}
          {summary.skipped != null && summary.skipped > 0 ? (
            <>
              {" · "}
              {summary.skipped} skipped
            </>
          ) : null}
        </p>
      ) : null}

      {headers && mapping && onMappingChange && mappingOptions ? (
        <div style={{ marginBottom: 16 }}>
          <p className="help-text" style={{ marginBottom: 8 }}>
            Column mapping
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {headers.map((h) => (
              <label key={h} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                <span style={{ minWidth: 120, color: "var(--text-secondary, #41506D)" }}>{h}</span>
                <select
                  className="input"
                  value={mapping[h] || "skip"}
                  onChange={(e) => onMappingChange({ ...mapping, [h]: e.target.value })}
                  style={{ maxWidth: 220 }}
                >
                  {mappingOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {assumptions && assumptions.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Assumptions</p>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {assumptions.map((a) => (
              <li key={a.id} style={{ fontSize: 14 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span>{a.question}</span>
                  <input
                    className="input"
                    value={a.answer ?? a.defaultAnswer ?? ""}
                    onChange={(e) => onAssumptionAnswer?.(a.id, e.target.value)}
                    placeholder="Your answer"
                  />
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600, color: "#b42318" }}>Validation errors</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {errors.map((row) => (
              <li key={`err-${row.rowIndex}-${row.message}`}>
                {row.rowIndex >= 0 ? `Row ${row.rowIndex + 1}: ` : null}
                {row.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {creates.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Will create</p>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, maxHeight: 280, overflow: "auto" }}>
            {creates.map((row) => {
              const low =
                typeof row.confidence === "number" && row.confidence < lowConfidence;
              return (
                <li
                  key={`create-${row.rowIndex}`}
                  style={low ? { color: "#b54708", background: "#fffaeb", padding: "2px 4px" } : undefined}
                >
                  {onAcceptChange ? (
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        checked={row.accepted !== false}
                        onChange={(e) => onAcceptChange(row.rowIndex, e.target.checked)}
                      />
                      <span>
                        {row.day ? <span className="help-text">{row.day} · </span> : null}
                        {renderCreateSummary
                          ? renderCreateSummary(row)
                          : row.email
                            ? `${row.name || ""} <${row.email}>`.trim()
                            : row.title || `Row ${row.rowIndex + 1}`}
                        {low ? ` (confidence ${row.confidence!.toFixed(2)})` : null}
                      </span>
                    </label>
                  ) : (
                    <>
                      {renderCreateSummary
                        ? renderCreateSummary(row)
                        : row.email
                          ? `${row.name || ""} <${row.email}>`.trim()
                          : row.title || `Row ${row.rowIndex + 1}`}
                      {low ? ` (confidence ${row.confidence!.toFixed(2)})` : null}
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {updates.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Will update</p>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 14, maxHeight: 200, overflow: "auto" }}>
            {updates.map((row) => (
              <li key={`update-${row.rowIndex}`} style={{ marginBottom: 6 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  {onAcceptChange ? (
                    <input
                      type="checkbox"
                      checked={row.accepted !== false}
                      onChange={(e) => onAcceptChange(row.rowIndex, e.target.checked)}
                    />
                  ) : null}
                  <span>
                    {row.day ? <span className="help-text">{row.day} · </span> : null}
                    <strong>{row.title || `Row ${row.rowIndex + 1}`}</strong>
                    {row.message ? ` — ${row.message}` : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {deletes.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Propose delete (unchecked by default)</p>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 14 }}>
            {deletes.map((row) => (
              <li key={`delete-${row.rowIndex}`} style={{ marginBottom: 6 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  {onAcceptChange ? (
                    <input
                      type="checkbox"
                      checked={row.accepted === true}
                      onChange={(e) => onAcceptChange(row.rowIndex, e.target.checked)}
                    />
                  ) : null}
                  <span>
                    {row.title || `Session ${row.rowIndex + 1}`}
                    {row.message ? ` — ${row.message}` : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {creates.length === 0 && updates.length === 0 && deletes.length === 0 ? (
        <p className="help-text">Nothing valid to create yet. Fix errors or adjust column mapping.</p>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {onConfirm ? (
          <button type="button" className="button" disabled={!canConfirm} onClick={() => void onConfirm()}>
            {busy ? "Working…" : confirmLabel}
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </>
  );

  if (sourcePreview) {
    return (
      <div className="review-changeset" style={{ marginTop: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
            gap: 16,
          }}
          className="review-changeset-split"
        >
          <div>
            <h4 style={{ margin: "0 0 8px" }}>Source</h4>
            <pre
              style={{
                margin: 0,
                padding: 12,
                maxHeight: 480,
                overflow: "auto",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                background: "var(--surface-muted, #f4f6f9)",
                borderRadius: 8,
              }}
            >
              {sourcePreview}
            </pre>
          </div>
          <div>{body}</div>
        </div>
        <style>{`
          @media (max-width: 800px) {
            .review-changeset-split { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="review-changeset" style={{ marginTop: 16 }}>
      {body}
    </div>
  );
}

/** Client-side CSV parse into header + row objects (no validation). */
export function parseCsvToTable(text: string): { headers: string[]; rows: Record<string, string>[] } | { error: string } {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return { error: "CSV needs a header row and at least one data row" };

  function splitLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  const headers = splitLine(lines[0]).map((h) => h.trim());
  if (!headers.length || headers.every((h) => !h)) return { error: "Missing header row" };
  const rows = lines.slice(1).map((line) => {
    const cols = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
  return { headers, rows };
}
