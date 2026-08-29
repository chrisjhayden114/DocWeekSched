/**
 * SPX-0 — CSV import for the outreach pipeline. W-2 shape exactly:
 * file → dry-run mapping preview → per-row checkboxes → confirm.
 * Nothing is persisted until the organizer confirms. We never email.
 */

import { useState } from "react";
import { ReviewChangeset, parseCsvToTable } from "../ReviewChangeset";
import { organizerFetch } from "../../lib/organizerApi";
import {
  countSelectedOutreach,
  outreachImportSummaryLine,
  selectedOutreachRows,
  type OutreachImportDryRunRow,
} from "../../lib/outreachImport";

type DryRun = {
  headers: string[];
  mapping: Record<string, string>;
  rows: OutreachImportDryRunRow[];
  summary: { creates: number; errors: number; skipped: number };
};

type ImportResponse = {
  createdCount: number;
  skippedCount: number;
  created: { id: string; orgName: string }[];
  skipped: { orgName: string; reason: string }[];
};

const MAPPING_OPTIONS = [
  { value: "org", label: "Organization" },
  { value: "contactName", label: "Contact name" },
  { value: "email", label: "Email" },
  { value: "website", label: "Website" },
  { value: "notes", label: "Notes" },
  { value: "skip", label: "Skip" },
];

export function OutreachImportCard({
  eventId,
  onImported,
}: {
  eventId: string;
  onImported: () => Promise<void> | void;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [accepted, setAccepted] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const selectedCount = dryRun ? countSelectedOutreach(dryRun.rows, accepted) : 0;

  function reset() {
    setDryRun(null);
    setRows([]);
    setHeaders([]);
    setAccepted({});
  }

  async function runDryRun(
    nextHeaders: string[],
    nextRows: Record<string, string>[],
    nextMapping?: Record<string, string>,
  ) {
    const dry = await organizerFetch<DryRun>("/outreach/prospects/import-dry-run", eventId, {
      method: "POST",
      body: JSON.stringify({ headers: nextHeaders, rows: nextRows, mapping: nextMapping }),
    });
    setMapping(dry.mapping);
    setDryRun(dry);
    setAccepted({});
    return dry;
  }

  async function onFile(file: File) {
    setError(null);
    setSummary(null);
    const parsed = parseCsvToTable(await file.text());
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setDryRun(null);
    await runDryRun(parsed.headers, parsed.rows);
  }

  async function importRows() {
    if (!dryRun) return;
    const prospects = selectedOutreachRows(dryRun.rows, accepted);
    if (prospects.length === 0) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const imported = await organizerFetch<ImportResponse>("/outreach/prospects/import", eventId, {
        method: "POST",
        body: JSON.stringify({ prospects }),
      });
      setSummary(outreachImportSummaryLine(imported));
      reset();
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="console-panel">
      <p className="console-panel-label">Add prospects from a spreadsheet</p>
      <p className="help-text" style={{ marginTop: 0 }}>
        Upload a CSV and review every row before anything is saved. We never email these
        organizations — you send from your own address.
      </p>
      <input
        className="input"
        type="file"
        accept=".csv,text/csv"
        aria-label="Prospect CSV file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f).catch((err) => setError(err instanceof Error ? err.message : "CSV failed"));
        }}
      />
      {error ? (
        <p role="alert" style={{ color: "var(--danger)", margin: "10px 0 0" }}>
          {error}
        </p>
      ) : null}
      {summary ? (
        <p role="status" style={{ color: "var(--success)", margin: "10px 0 0" }}>
          {summary}
        </p>
      ) : null}
      {dryRun ? (
        <ReviewChangeset
          title="Review who gets added"
          headers={headers}
          mapping={mapping}
          onMappingChange={(m) => {
            setMapping(m);
            void runDryRun(headers, rows, m).catch((err) =>
              setError(err instanceof Error ? err.message : "CSV failed"),
            );
          }}
          mappingOptions={MAPPING_OPTIONS}
          rows={
            dryRun.rows.map((row) => ({
              ...row,
              accepted: accepted[row.rowIndex] !== false,
            })) as never
          }
          summary={dryRun.summary}
          selectAll
          busy={busy}
          onAcceptChange={(rowIndex, isAccepted) =>
            setAccepted((prev) => ({ ...prev, [rowIndex]: isAccepted }))
          }
          renderCreateSummary={(row) =>
            row.kind === "create"
              ? `${("orgName" in row && row.orgName) || ""} ${
                  "contactEmail" in row && row.contactEmail ? `<${row.contactEmail}>` : ""
                }`.trim()
              : ""
          }
          confirmLabel={`Add ${selectedCount} to the pipeline`}
          onConfirm={() => importRows()}
          onCancel={reset}
        />
      ) : null}
    </div>
  );
}
