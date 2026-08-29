/**
 * SPX-0 — helpers for the outreach CSV review. Same shape as W-2:
 * dry-run first, per-row checkboxes, nothing persisted until confirm.
 */

export type OutreachImportDryRunRow = {
  kind: string;
  rowIndex: number;
  orgName?: string;
  contactName?: string;
  contactEmail?: string;
  websiteUrl?: string;
  notes?: string;
  message?: string;
};

export type OutreachImportProspect = {
  orgName: string;
  contactName?: string;
  contactEmail?: string;
  websiteUrl?: string;
  notes?: string;
};

export function selectedOutreachRows(
  rows: OutreachImportDryRunRow[],
  accepted: Record<number, boolean>,
): OutreachImportProspect[] {
  return rows
    .filter((row) => row.kind === "create" && row.orgName)
    .filter((row) => accepted[row.rowIndex] !== false)
    .map((row) => ({
      orgName: row.orgName!,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      websiteUrl: row.websiteUrl,
      notes: row.notes,
    }));
}

export function countSelectedOutreach(
  rows: OutreachImportDryRunRow[],
  accepted: Record<number, boolean>,
): number {
  return rows.filter((row) => row.kind === "create" && row.orgName && accepted[row.rowIndex] !== false)
    .length;
}

export function outreachImportSummaryLine(outcome: {
  createdCount: number;
  skipped?: { orgName: string; reason: string }[];
}): string {
  const parts = [
    `Added ${outcome.createdCount} ${outcome.createdCount === 1 ? "prospect" : "prospects"}. Nothing was emailed.`,
  ];
  const skipped = outcome.skipped?.length ?? 0;
  if (skipped > 0) {
    parts.push(`${skipped} skipped — already in this pipeline.`);
  }
  return parts.join(" ");
}
