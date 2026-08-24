/**
 * W-2 ROSTER-IMPORT — the Participants tab's spreadsheet card.
 *
 * Choose a file → review every row (checkboxes, per-row participant label) →
 * then pick one of two explicit actions: add to the roster with no email at
 * all, or add and send the invites. Nothing is emailed until the organizer
 * says so, and the summary line only ever claims what actually happened.
 */

import { useMemo, useState } from "react";
import { ReviewChangeset, parseCsvToTable } from "../ReviewChangeset";
import { Select } from "../Select";
import { organizerFetch } from "../../lib/organizerApi";
import {
  participantLabelSelectOptions,
  shouldShowParticipantLabelSelect,
} from "../../lib/participantLabels";
import {
  countSelected,
  importSummaryLine,
  rowLabelValue,
  selectedImportRows,
  type ImportDryRunRow,
} from "../../lib/rosterImport";

type DryRun = {
  headers: string[];
  mapping: Record<string, string>;
  rows: ImportDryRunRow[];
  summary: { creates: number; errors: number; skipped: number };
};

type ImportResponse = {
  createdCount: number;
  skippedCount: number;
  created: { userId: string; email: string; name: string }[];
  skipped: { email: string; reason: string }[];
};

type SendInvitesResponse = {
  sentCount: number;
  failedCount: number;
  alreadyActiveCount: number;
  results: {
    userId: string;
    email: string | null;
    status: "sent" | "failed" | "already-active";
    emailDelivered?: boolean;
    inviteUrl?: string;
    error?: string;
  }[];
  emailFallbackMessage?: string;
};

const BASE_MAPPING_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "name", label: "Name" },
  { value: "description", label: "Description / interests" },
  { value: "bio", label: "Bio" },
  { value: "photoUrl", label: "Photo URL" },
  { value: "skip", label: "Skip" },
];

export function RosterImportCard({
  eventId,
  participantLabels,
  onImported,
}: {
  eventId: string;
  participantLabels: string[];
  /** Refresh the roster after rows land. */
  onImported: () => Promise<void> | void;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [accepted, setAccepted] = useState<Record<number, boolean>>({});
  const [labelOverrides, setLabelOverrides] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [detail, setDetail] = useState<
    { email: string | null; text: string; inviteUrl?: string }[]
  >([]);

  const showLabels = shouldShowParticipantLabelSelect(participantLabels);
  const mappingOptions = useMemo(
    () =>
      showLabels
        ? [
            ...BASE_MAPPING_OPTIONS.slice(0, -1),
            { value: "label", label: "Participant label" },
            BASE_MAPPING_OPTIONS[BASE_MAPPING_OPTIONS.length - 1],
          ]
        : BASE_MAPPING_OPTIONS,
    [showLabels],
  );

  const selectedCount = dryRun ? countSelected(dryRun.rows, accepted) : 0;

  function reset() {
    setDryRun(null);
    setRows([]);
    setHeaders([]);
    setAccepted({});
    setLabelOverrides({});
  }

  async function runDryRun(nextHeaders: string[], nextRows: Record<string, string>[], nextMapping?: Record<string, string>) {
    const dry = await organizerFetch<DryRun>("/attendees/invite-dry-run", eventId, {
      method: "POST",
      body: JSON.stringify({ headers: nextHeaders, rows: nextRows, mapping: nextMapping }),
    });
    setMapping(dry.mapping);
    setDryRun(dry);
    // Every valid row starts checked; unchecking is the deliberate act.
    setAccepted({});
    setLabelOverrides({});
    return dry;
  }

  async function onFile(file: File) {
    setError(null);
    setSummary(null);
    setDetail([]);
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

  async function importRows(thenSendInvites: boolean) {
    if (!dryRun) return;
    const participants = selectedImportRows(dryRun.rows, accepted, labelOverrides);
    if (participants.length === 0) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    setDetail([]);
    try {
      const imported = await organizerFetch<ImportResponse>("/attendees/import", eventId, {
        method: "POST",
        body: JSON.stringify({ participants }),
      });
      let sent: SendInvitesResponse | null = null;
      if (thenSendInvites && imported.created.length > 0) {
        sent = await organizerFetch<SendInvitesResponse>("/attendees/send-invites", eventId, {
          method: "POST",
          body: JSON.stringify({ userIds: imported.created.map((c) => c.userId) }),
        });
      }
      setSummary(
        importSummaryLine(
          { createdCount: imported.createdCount, skipped: imported.skipped },
          sent
            ? {
                sentCount: sent.sentCount,
                failedCount: sent.failedCount,
                alreadyActiveCount: sent.alreadyActiveCount,
                undelivered: Boolean(sent.emailFallbackMessage),
              }
            : undefined,
        ),
      );
      // J-A #13: per-item outcomes are shown, not counted and thrown away.
      setDetail([
        ...imported.skipped.map((s) => ({ email: s.email, text: s.reason })),
        ...(sent?.results || [])
          .filter((r) => r.status !== "sent" || !r.emailDelivered)
          .map((r) => ({
            email: r.email,
            text:
              r.status === "failed"
                ? r.error || "Invite failed"
                : r.status === "already-active"
                  ? "Already finished setup — no email sent"
                  : "Email not delivered — share this link instead",
            inviteUrl: r.inviteUrl,
          })),
      ]);
      reset();
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      // A seat limit or a rejected label comes back with detail attached; show
      // what landed and what didn't rather than just the error line.
      const body = (err as { body?: Partial<ImportResponse> & { invalidLabels?: { email: string; label: string }[] } })
        .body;
      if (body?.invalidLabels?.length) {
        setDetail(
          body.invalidLabels.map((row) => ({
            email: row.email,
            text: `Label “${row.label}” isn't one of this event's participant labels`,
          })),
        );
      }
      if (typeof body?.createdCount === "number") {
        const landed = body.createdCount + (body.skipped?.length ?? 0);
        const remaining = Math.max(participants.length - landed, 0);
        setSummary(
          `${importSummaryLine({ createdCount: body.createdCount, skipped: body.skipped })}${
            remaining > 0 ? ` The remaining ${remaining} weren't added — see the message above.` : ""
          }`,
        );
        setDetail((body.skipped || []).map((s) => ({ email: s.email, text: s.reason })));
        await onImported();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="console-panel">
      <p className="console-panel-label">Add participants from a spreadsheet</p>
      <p className="help-text" style={{ marginTop: 0 }}>
        Upload a CSV and review every row before anything happens. You can add people to the roster
        without emailing anyone — invites can be sent any time afterwards, to everyone or a few
        people at a time.
      </p>
      <input
        className="input"
        type="file"
        accept=".csv,text/csv"
        aria-label="Participant CSV file"
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
        <div role="status" style={{ marginTop: 10 }}>
          <p style={{ color: "var(--success)", margin: 0 }}>{summary}</p>
          {detail.length > 0 ? (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 14 }}>
              {detail.map((d, i) => (
                <li key={`${d.email ?? "row"}-${i}`}>
                  {d.email ? `${d.email} — ` : null}
                  {d.text}
                  {d.inviteUrl ? (
                    <>
                      {" "}
                      <code style={{ overflowWrap: "anywhere" }}>{d.inviteUrl}</code>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {dryRun ? (
        <>
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
            mappingOptions={mappingOptions}
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
              row.kind === "create" ? `${row.name || ""} <${row.email || ""}>` : ""
            }
            renderCreateExtra={
              showLabels
                ? (row) => (
                    <Select
                      aria-label={`Label for ${("name" in row && row.name) || `row ${row.rowIndex + 1}`}`}
                      value={rowLabelValue(row as ImportDryRunRow, labelOverrides)}
                      onChange={(v) =>
                        setLabelOverrides((prev) => ({ ...prev, [row.rowIndex]: v }))
                      }
                      options={participantLabelSelectOptions(participantLabels)}
                      style={{ maxWidth: 200 }}
                      className="select-compact"
                    />
                  )
                : undefined
            }
            confirmLabel={`Add ${selectedCount} to the roster`}
            onConfirm={() => importRows(false)}
            secondaryConfirmLabel={`Add and send ${selectedCount} invite${selectedCount === 1 ? "" : "s"}`}
            onSecondaryConfirm={() => importRows(true)}
            onCancel={reset}
          />
          <p className="help-text" style={{ marginTop: 12 }}>
            <strong>Add to the roster</strong> creates each person&apos;s place at the event and sends
            nothing — they show as <em>Not invited</em> until you invite them.{" "}
            <strong>Add and send invites</strong> also emails each person a personal setup link (it
            names the event, asks them to choose a password, and carries their check-in code). Setup
            links expire after 7 days; sending again issues a fresh one.
          </p>
        </>
      ) : null}
    </div>
  );
}
