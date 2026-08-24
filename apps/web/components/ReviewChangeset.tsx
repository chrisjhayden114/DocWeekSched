import { useMemo, type ReactNode } from "react";
import { createRowSession, groupCreateRows, removalsOf, type RemovalKind } from "../lib/ingestReview";
import { Select } from "./Select";

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

/**
 * E13.2: assumptions are displayed read-only. Editing them here used to be
 * offered but the edits were never applied to the changeset — an editable
 * control that silently does nothing is worse than no control.
 */

export type ReviewChangesetProps = {
  /** Plain string, or a node (E30.4: the ingest heading counts up its figure). */
  title?: ReactNode;
  headers?: string[];
  mapping?: Record<string, string>;
  onMappingChange?: (mapping: Record<string, string>) => void;
  mappingOptions?: { value: string; label: string }[];
  rows: ReviewChangeRow[];
  summary?: { creates?: number; errors?: number; skipped?: number; updates?: number; deletes?: number };
  confirmLabel?: string;
  onConfirm?: () => void | Promise<void>;
  /**
   * W-2: a second, equally explicit confirm beside the primary one — the
   * roster import offers "Add to roster" (no email) and "Add and send invites".
   */
  secondaryConfirmLabel?: string;
  onSecondaryConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  busy?: boolean;
  /** Render primary fields for a create/update row */
  renderCreateSummary?: (row: ReviewChangeRow) => string;
  /**
   * W-2: an extra control rendered beside a create row — the roster import
   * puts each row's participant-label select here.
   */
  renderCreateExtra?: (row: ReviewChangeRow) => ReactNode;
  /** Toggle accept for update/delete/create rows (ingest). */
  onAcceptChange?: (rowIndex: number, accepted: boolean) => void;
  /**
   * E13.3: toggle one child-removal proposal on an update row
   * (kind "item" = paper, "speaker" = speaker link).
   */
  onRemovalChange?: (rowIndex: number, kind: RemovalKind, id: string, accepted: boolean) => void;
  /** Read-only (E13.2). */
  assumptions?: ReviewAssumption[];
  /** Amber threshold for confidence (default 0.8). */
  lowConfidence?: number;
  /** Optional left-column source preview (ingest). */
  sourcePreview?: string;
  /**
   * Optional structured source description (file name, type, size) rendered
   * above the text preview — used instead of a preview for binary uploads
   * (E11.1: never show internal placeholders as provenance).
   */
  sourceInfo?: ReactNode;
  /**
   * E16.1: "column" (default) keeps the side-by-side Source column — right
   * for paste/URL runs where the preview is long. "band" renders the source
   * as a compact full-width strip above the review — right for file runs,
   * whose source is four short lines that would otherwise sit beside
   * hundreds of pixels of empty space.
   */
  sourceLayout?: "column" | "band";
  /**
   * H2 (D2): group create rows by day + timeslot with per-group counts, and
   * offer select all/none. Opt-in — only the agenda ingest page passes true;
   * the CSV/invite/CFP callers keep the flat list.
   */
  groupCreates?: boolean;
  /**
   * Select all / none above a flat create list. Implied by groupCreates;
   * W-2's roster import opts in without grouping.
   */
  selectAll?: boolean;
};

function rowAccepted(row: ReviewChangeRow): boolean {
  if (row.kind === "delete") return row.accepted === true;
  if (row.kind === "create" || row.kind === "update") return row.accepted !== false;
  return false;
}

/**
 * H2 (D2): the grouped view's row line — everything an organizer needs to
 * verify a session against the source at a glance.
 */
function enrichedCreateLine(row: Extract<ReviewChangeRow, { kind: "create" }>): string {
  const session = createRowSession(row);
  const time = session?.startTime
    ? `${session.startTime}${session.endTime ? `–${session.endTime}` : ""}`
    : null;
  return [time, session?.title || row.title || `Row ${row.rowIndex + 1}`, session?.room, session?.speakers?.[0]]
    .filter(Boolean)
    .join(" · ");
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
  secondaryConfirmLabel,
  onSecondaryConfirm,
  onCancel,
  busy,
  renderCreateSummary,
  renderCreateExtra,
  onAcceptChange,
  onRemovalChange,
  assumptions,
  lowConfidence = 0.8,
  sourcePreview,
  sourceInfo,
  sourceLayout = "column",
  groupCreates = false,
  selectAll = false,
}: ReviewChangesetProps) {
  const creates = useMemo(
    () => rows.filter((r): r is Extract<ReviewChangeRow, { kind: "create" }> => r.kind === "create"),
    [rows],
  );
  const updates = useMemo(
    () => rows.filter((r): r is Extract<ReviewChangeRow, { kind: "update" | "skip" }> => r.kind === "update"),
    [rows],
  );
  const deletes = useMemo(
    () => rows.filter((r): r is Extract<ReviewChangeRow, { kind: "delete" }> => r.kind === "delete"),
    [rows],
  );
  const errors = useMemo(
    () => rows.filter((r): r is Extract<ReviewChangeRow, { kind: "error" }> => r.kind === "error"),
    [rows],
  );
  const acceptedCount = useMemo(() => rows.filter(rowAccepted).length, [rows]);
  const canConfirm = acceptedCount > 0 && !busy && Boolean(onConfirm);
  // H2 (D2): group creates by day + timeslot. Only when the caller opts in
  // AND grouping actually splits the list — a single slot stays flat.
  const createGroups = useMemo(
    () => (groupCreates ? groupCreateRows(creates) : []),
    [groupCreates, creates],
  );
  const useGroupedCreates = groupCreates && createGroups.length > 1;
  // ≤12 rows: everything visible at once. More: closed groups keep the page scannable.
  const groupsDefaultOpen = creates.length <= 12;

  /** Select all / none for a section — opt-in (agenda ingest, roster import). */
  const selectAllControls = (sectionRows: { rowIndex: number }[]) =>
    (groupCreates || selectAll) && onAcceptChange && sectionRows.length > 1 ? (
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className="button secondary"
          style={{ fontSize: 13, padding: "2px 10px" }}
          onClick={() => sectionRows.forEach((r) => onAcceptChange(r.rowIndex, true))}
        >
          Select all
        </button>
        <button
          type="button"
          className="button secondary"
          style={{ fontSize: 13, padding: "2px 10px" }}
          onClick={() => sectionRows.forEach((r) => onAcceptChange(r.rowIndex, false))}
        >
          Select none
        </button>
      </div>
    ) : null;

  const createRowItem = (row: Extract<ReviewChangeRow, { kind: "create" }>, enriched: boolean) => {
    const low = typeof row.confidence === "number" && row.confidence < lowConfidence;
    const line = (
      <>
        {enriched
          ? enrichedCreateLine(row)
          : renderCreateSummary
            ? renderCreateSummary(row)
            : row.email
              ? `${row.name || ""} <${row.email}>`.trim()
              : row.title || `Row ${row.rowIndex + 1}`}
        {low ? ` (confidence ${row.confidence!.toFixed(2)})` : null}
      </>
    );
    const extra = renderCreateExtra?.(row);
    return (
      <li
        key={`create-${row.rowIndex}`}
        style={{
          ...(enriched ? { fontSize: 15 } : null),
          ...(low ? { color: "var(--warning)", background: "var(--warning-50)", padding: "2px 4px" } : null),
        }}
      >
        {onAcceptChange ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", flex: "1 1 auto" }}>
              <input
                type="checkbox"
                checked={row.accepted !== false}
                onChange={(e) => onAcceptChange(row.rowIndex, e.target.checked)}
              />
              <span>
                {/* Grouped rows live under a day/time header — no per-row day prefix. */}
                {!enriched && row.day ? <span className="help-text">{row.day} · </span> : null}
                {line}
              </span>
            </label>
            {extra}
          </div>
        ) : (
          <>
            {line}
            {extra}
          </>
        )}
      </li>
    );
  };
  // A run that creates nothing but proposes deletions reads as data loss if
  // the deletions lead. Lead with the empty-state explanation instead and
  // tuck the delete list behind a disclosure.
  const zeroCreateWithDeletes = creates.length === 0 && updates.length === 0 && deletes.length > 0;

  const deletesList = (
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
  );

  const body = (
    <>
      <h4 style={{ margin: "0 0 8px" }}>{title}</h4>
      {zeroCreateWithDeletes ? (
        <div
          role="status"
          style={{
            padding: 12,
            marginBottom: 12,
            borderRadius: "var(--radius-sm)",
            background: "var(--warning-50)",
            border: "1px solid var(--gray-200)",
          }}
        >
          <strong>No new sessions were found in this import.</strong>
          <p className="help-text" style={{ margin: "6px 0 0" }}>
            Include times like “9:00–10:15” and one session per line, then try again. Nothing is deleted unless
            you tick it below and confirm.
          </p>
        </div>
      ) : null}
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
              <strong style={{ color: "var(--danger)" }}>{summary.errors}</strong> errors
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
                <span style={{ minWidth: 120, color: "var(--text-color)" }}>{h}</span>
                <Select
                  value={mapping[h] || "skip"}
                  onChange={(v) => onMappingChange({ ...mapping, [h]: v })}
                  style={{ maxWidth: 220 }}
                  options={mappingOptions}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {assumptions && assumptions.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Assumptions the AI made</p>
          <p className="help-text" style={{ margin: "0 0 8px" }}>
            These can’t be edited here — the extraction has already happened. If one is wrong, untick the
            affected rows and correct the source before re-importing, or fix the sessions in the Program tab
            after confirming.
          </p>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 6 }}>
            {assumptions.map((a) => (
              <li key={a.id} style={{ fontSize: 14 }}>
                {a.question}
                {a.answer || a.defaultAnswer ? (
                  <span className="help-text"> — assumed: {a.answer ?? a.defaultAnswer}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--danger)" }}>Validation errors</p>
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
          {selectAllControls(creates)}
          {useGroupedCreates ? (
            <div style={{ display: "grid", gap: 8 }}>
              {createGroups.map((group) => {
                const slot = [group.day, group.startTime].filter(Boolean).join(" · ") || "Other";
                const counts = [`${group.rows.length} session${group.rows.length === 1 ? "" : "s"}`];
                if (group.roomCount > 0) {
                  counts.push(`${group.roomCount} room${group.roomCount === 1 ? "" : "s"}`);
                }
                return (
                  <details key={group.key} className="review-group" open={groupsDefaultOpen}>
                    <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                      {slot} — {counts.join(" · ")}
                    </summary>
                    <ol className="motion-stagger" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                      {group.rows.map((row) => createRowItem(row, true))}
                    </ol>
                  </details>
                );
              })}
            </div>
          ) : (
            <ol className="motion-stagger" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              {creates.map((row) => createRowItem(row, false))}
            </ol>
          )}
        </div>
      ) : null}

      {updates.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Will update</p>
          {selectAllControls(updates)}
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 14 }}>
            {updates.map((row) => {
              const itemRemovals = removalsOf(row, "item");
              const speakerRemovals = removalsOf(row, "speaker");
              return (
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
                  {/* E13.3: children the import doesn't mention. Nothing is
                      removed unless the organiser ticks it here. */}
                  {itemRemovals.length > 0 || speakerRemovals.length > 0 ? (
                    <div style={{ margin: "4px 0 0 26px", display: "grid", gap: 4 }}>
                      <span className="help-text">
                        Not in this import — kept unless you tick to remove:
                      </span>
                      {itemRemovals.map((r) => (
                        <label
                          key={`item-removal-${row.rowIndex}-${r.itemId}`}
                          style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
                        >
                          <input
                            type="checkbox"
                            checked={r.accepted === true}
                            disabled={!onRemovalChange}
                            onChange={(e) =>
                              onRemovalChange?.(row.rowIndex, "item", r.itemId || "", e.target.checked)
                            }
                          />
                          <span>Remove paper “{r.title}”</span>
                        </label>
                      ))}
                      {speakerRemovals.map((r) => (
                        <label
                          key={`speaker-removal-${row.rowIndex}-${r.speakerId}`}
                          style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
                        >
                          <input
                            type="checkbox"
                            checked={r.accepted === true}
                            disabled={!onRemovalChange}
                            onChange={(e) =>
                              onRemovalChange?.(row.rowIndex, "speaker", r.speakerId || "", e.target.checked)
                            }
                          />
                          <span>Remove speaker {r.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* H2 (D3): deletions are ALWAYS quarantined behind a disclosure — a
          partial import proposing deletes must never read as pending data loss. */}
      {deletes.length > 0 ? (
        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            {deletes.length} existing session{deletes.length === 1 ? " wasn’t" : "s weren’t"} in this import —
            review proposed deletions
          </summary>
          <p className="help-text" style={{ margin: "6px 0" }}>
            Import files are often partial. These sessions stay unless you check them.
          </p>
          {deletesList}
        </details>
      ) : null}

      {creates.length === 0 && updates.length === 0 && deletes.length === 0 ? (
        <p className="help-text">Nothing valid to create yet. Fix errors or adjust column mapping.</p>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {onConfirm ? (
          <button type="button" className="button" disabled={!canConfirm} onClick={() => void onConfirm()}>
            {busy ? "Working…" : confirmLabel}
          </button>
        ) : null}
        {onSecondaryConfirm && secondaryConfirmLabel ? (
          <button
            type="button"
            className="button secondary"
            disabled={acceptedCount === 0 || busy}
            onClick={() => void onSecondaryConfirm()}
          >
            {secondaryConfirmLabel}
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

  if ((sourcePreview || sourceInfo) && sourceLayout === "band") {
    // E16.1: file-sourced runs — source metadata as a compact full-width band
    // above the review; the changeset gets the whole content width.
    return (
      <div className="review-changeset" style={{ marginTop: 16 }}>
        <div
          style={{
            padding: "10px 12px",
            marginBottom: 16,
            border: "1px solid var(--gray-200)",
            borderRadius: "var(--radius-sm)",
            background: "var(--gray-50)",
          }}
        >
          {sourceInfo}
          {sourcePreview ? (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer", font: "var(--text-meta)", color: "var(--gray-600)" }}>
                Show extracted text
              </summary>
              <pre
                style={{
                  margin: "6px 0 0",
                  padding: 12,
                  maxHeight: 240,
                  overflow: "auto",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  background: "var(--surface-inner)",
                  borderRadius: 8,
                }}
              >
                {sourcePreview}
              </pre>
            </details>
          ) : null}
        </div>
        {body}
      </div>
    );
  }

  if (sourcePreview || sourceInfo) {
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
            {sourceInfo}
            {sourcePreview ? (
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  maxHeight: 480,
                  overflow: "auto",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  background: "var(--surface-inner)",
                  borderRadius: 8,
                }}
              >
                {sourcePreview}
              </pre>
            ) : null}
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

// Moved to lib/csvTable.ts (a .ts module) so node-environment unit tests can
// import it without JSX transforms; re-exported here for existing importers.
export { parseCsvToTable } from "../lib/csvTable";
