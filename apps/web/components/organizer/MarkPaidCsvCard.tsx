/**
 * PAY-T0 — "Mark paid from CSV".
 *
 * Upload the paid list your finance office or your payment provider gives you,
 * see exactly who it matched on the roster (and every email it did not), then
 * confirm to set those people to Paid. Nothing is written before the confirm,
 * and an unmatched email never creates a roster seat — it is reported and left
 * alone. This is also the honest version of an "Eventbrite integration": the
 * export from any provider is a list of emails.
 */

import {
  paidMarkSummaryLine,
  paymentStatusLabel,
  type PaidCsvRow,
} from "@event-app/shared";
import { useState } from "react";
import { ReviewChangeset, parseCsvToTable } from "../ReviewChangeset";
import { organizerFetch } from "../../lib/organizerApi";

type DryRun = {
  headers: string[];
  mapping: Record<string, string>;
  rows: PaidCsvRow[];
  summary: { creates: number; errors: number; skipped: number };
};

type BulkResponse = {
  updatedCount: number;
  unchangedCount: number;
  notOnRoster: string[];
};

const MAPPING_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "reference", label: "PO / reference" },
  { value: "skip", label: "Skip" },
];

export function MarkPaidCsvCard({
  eventId,
  onMarked,
}: {
  eventId: string;
  /** Refresh the roster once statuses land. */
  onMarked: () => Promise<void> | void;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [accepted, setAccepted] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const matched = dryRun
    ? dryRun.rows.filter(
        (row): row is Extract<PaidCsvRow, { kind: "create" }> => row.kind === "create",
      )
    : [];
  const selected = matched.filter((row) => accepted[row.rowIndex] !== false);

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
    const dry = await organizerFetch<DryRun>("/attendees/paid-dry-run", eventId, {
      method: "POST",
      body: JSON.stringify({ headers: nextHeaders, rows: nextRows, mapping: nextMapping }),
    });
    setMapping(dry.mapping);
    setDryRun(dry);
    // Every matched row starts checked; unchecking is the deliberate act.
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

  async function confirm() {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const res = await organizerFetch<BulkResponse>("/attendees/payment-bulk", eventId, {
        method: "POST",
        body: JSON.stringify({
          paymentStatus: "PAID",
          source: "csv_paid_list",
          members: selected.map((row) => ({
            userId: row.userId,
            ...(row.paymentReference ? { paymentReference: row.paymentReference } : {}),
          })),
        }),
      });
      setSummary(
        paidMarkSummaryLine({
          updatedCount: res.updatedCount,
          unchangedCount: res.unchangedCount,
          notOnRosterCount: res.notOnRoster.length,
        }),
      );
      reset();
      await onMarked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark these people as paid");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="console-panel">
      <p className="console-panel-label">Mark paid from a spreadsheet</p>
      <p className="help-text" style={{ marginTop: 0 }}>
        Upload a list of email addresses that have paid — the export from your payment provider,
        or the list your finance office keeps. Every row is matched against this roster and shown
        to you before anything changes. No money moves; this only records what you already
        collected.
      </p>
      <input
        className="input"
        type="file"
        accept=".csv,text/csv"
        aria-label="Paid list CSV file"
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
        <>
          <ReviewChangeset
            title="Review who gets marked paid"
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
            renderCreateSummary={(row) => {
              if (row.kind !== "create") return "";
              const paidRow = row as unknown as Extract<PaidCsvRow, { kind: "create" }>;
              const bits = [`${paidRow.name} <${paidRow.email}>`];
              bits.push(`now ${paymentStatusLabel(paidRow.currentStatus)}`);
              if (paidRow.paymentReference) bits.push(`ref ${paidRow.paymentReference}`);
              return bits.join(" · ");
            }}
            confirmLabel={`Mark ${selected.length} as paid`}
            onConfirm={() => confirm()}
            onCancel={reset}
          />
          <p className="help-text" style={{ marginTop: 12 }}>
            Rows listed as problems are emails this file has that the roster doesn&apos;t. They are
            left alone — add those people to the roster first if they belong here, then upload the
            file again. Anyone already showing as Paid stays as they are.
          </p>
        </>
      ) : null}
    </div>
  );
}
