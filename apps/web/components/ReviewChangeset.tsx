import { useMemo, useState } from "react";

export type ReviewChangeRow =
  | {
      kind: "create";
      rowIndex: number;
      email?: string;
      name?: string;
      title?: string;
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
      [key: string]: unknown;
    };

export type ReviewChangesetProps = {
  title?: string;
  headers?: string[];
  mapping?: Record<string, string>;
  onMappingChange?: (mapping: Record<string, string>) => void;
  mappingOptions?: { value: string; label: string }[];
  rows: ReviewChangeRow[];
  summary?: { creates?: number; errors?: number; skipped?: number; updates?: number };
  confirmLabel?: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  busy?: boolean;
  /** Render primary fields for a create/update row */
  renderCreateSummary?: (row: ReviewChangeRow) => string;
};

/**
 * Reusable dry-run review surface (CSV invites now; Agenda Ingest later).
 * Shows column mapping, per-row create/error list, confirm/cancel.
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
}: ReviewChangesetProps) {
  const creates = useMemo(() => rows.filter((r) => r.kind === "create"), [rows]);
  const errors = useMemo(() => rows.filter((r) => r.kind === "error"), [rows]);
  const canConfirm = creates.length > 0 && !busy && Boolean(onConfirm);

  return (
    <div className="review-changeset" style={{ marginTop: 16 }}>
      <h4 style={{ margin: "0 0 8px" }}>{title}</h4>
      {summary ? (
        <p className="help-text" style={{ marginTop: 0 }}>
          {summary.creates != null ? (
            <>
              <strong>{summary.creates}</strong> ready
            </>
          ) : null}
          {summary.errors != null ? (
            <>
              {summary.creates != null ? " · " : null}
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
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, maxHeight: 240, overflow: "auto" }}>
            {creates.map((row) => (
              <li key={`create-${row.rowIndex}`}>
                {renderCreateSummary
                  ? renderCreateSummary(row)
                  : row.email
                    ? `${row.name || ""} <${row.email}>`.trim()
                    : row.title || `Row ${row.rowIndex + 1}`}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="help-text">Nothing valid to create yet. Fix errors or adjust column mapping.</p>
      )}

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
