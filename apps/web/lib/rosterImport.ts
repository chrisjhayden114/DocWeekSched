/**
 * W-2 ROSTER-IMPORT — pure helpers for the Participants tab's spreadsheet flow.
 *
 * The flow is deliberately two steps: add people to the roster (no email at
 * all), then send invites when the organizer decides. These helpers own the
 * per-row selection, the request payload, and the summary copy — so the copy
 * can never claim an email that wasn't sent.
 */

export type ImportDryRunRow = {
  kind: string;
  rowIndex: number;
  email?: string;
  name?: string;
  message?: string;
  researchInterests?: string;
  photoUrl?: string;
  /** From a mapped CSV label column; already validated by the dry-run. */
  participantLabel?: string;
};

export type ImportParticipant = {
  email: string;
  name: string;
  researchInterests?: string;
  photoUrl?: string;
  participantLabel?: string | null;
};

/**
 * Rows default to checked; only an explicit false unchecks. Labels default to
 * the CSV's own value and are overridden per row by the review's select.
 */
export function selectedImportRows(
  rows: ImportDryRunRow[],
  accepted: Record<number, boolean>,
  labelOverrides: Record<number, string> = {},
): ImportParticipant[] {
  return rows
    .filter((row) => row.kind === "create" && row.email && row.name)
    .filter((row) => accepted[row.rowIndex] !== false)
    .map((row) => {
      const override = labelOverrides[row.rowIndex];
      const label = override !== undefined ? override : row.participantLabel || "";
      return {
        email: row.email!,
        name: row.name!,
        researchInterests: row.researchInterests,
        photoUrl: row.photoUrl,
        participantLabel: label ? label : null,
      };
    });
}

/** The label a row's select should show: an override wins, else the CSV value. */
export function rowLabelValue(row: ImportDryRunRow, labelOverrides: Record<number, string>): string {
  const override = labelOverrides[row.rowIndex];
  return override !== undefined ? override : row.participantLabel || "";
}

export function countSelected(rows: ImportDryRunRow[], accepted: Record<number, boolean>): number {
  return rows.filter(
    (row) => row.kind === "create" && row.email && accepted[row.rowIndex] !== false,
  ).length;
}

export type ImportOutcome = {
  createdCount: number;
  skipped?: { email: string; reason: string }[];
};

export type SendInvitesOutcome = {
  sentCount: number;
  failedCount: number;
  alreadyActiveCount: number;
  undelivered?: boolean;
};

function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function invites(n: number): string {
  return `${n} invite${n === 1 ? "" : "s"}`;
}

/** "Added 25 to the roster. No emails sent." — and never more than happened. */
export function importSummaryLine(outcome: ImportOutcome, sent?: SendInvitesOutcome): string {
  const parts: string[] = [];
  if (sent) {
    parts.push(
      sent.sentCount > 0
        ? `Added ${people(outcome.createdCount)} to the roster and sent ${invites(sent.sentCount)}.`
        : `Added ${people(outcome.createdCount)} to the roster. No invites went out.`,
    );
  } else {
    parts.push(`Added ${people(outcome.createdCount)} to the roster. No emails sent.`);
  }
  const skipped = outcome.skipped?.length ?? 0;
  if (skipped > 0) {
    parts.push(`${skipped} skipped: ${summarizeSkipped(outcome.skipped!)}.`);
  }
  if (sent) parts.push(...sendInvitesDetail(sent));
  return parts.join(" ");
}

/** Groups skip reasons so 40 identical reasons read as one clause. */
export function summarizeSkipped(skipped: { email: string; reason: string }[]): string {
  const counts = new Map<string, number>();
  for (const row of skipped) {
    counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, n]) => `${n} ${reason.toLowerCase()}`).join(", ");
}

/** The partial-failure breakdown the UI must not swallow (J-A #13). */
export function sendInvitesDetail(sent: SendInvitesOutcome): string[] {
  const out: string[] = [];
  if (sent.failedCount > 0) {
    out.push(`${invites(sent.failedCount)} couldn't be sent — see the list below.`);
  }
  if (sent.alreadyActiveCount > 0) {
    out.push(
      `${sent.alreadyActiveCount} already finished setup, so no email was sent to them.`,
    );
  }
  if (sent.undelivered) {
    out.push("Email delivery isn't set up — copy the invite links below instead.");
  }
  return out;
}

/** Roster bulk bar: "Sent 12 invites." plus the same honest breakdown. */
export function sendInvitesSummaryLine(sent: SendInvitesOutcome): string {
  const head =
    sent.sentCount > 0 ? `Sent ${invites(sent.sentCount)}.` : "No invites were sent.";
  return [head, ...sendInvitesDetail(sent)].join(" ");
}
