/**
 * SPX-0 — sponsor outreach pipeline types and CSV dry-run.
 * UKEDL never sends these emails (DESIGN_PHASE_K D1).
 */

export const SPONSOR_PROSPECT_STATUSES = [
  "TO_CONTACT",
  "CONTACTED",
  "IN_CONVERSATION",
  "CONFIRMED",
  "DECLINED",
] as const;

export type SponsorProspectStatus = (typeof SPONSOR_PROSPECT_STATUSES)[number];

export const SPONSOR_PROSPECT_STATUS_LABEL: Record<SponsorProspectStatus, string> = {
  TO_CONTACT: "To contact",
  CONTACTED: "Contacted",
  IN_CONVERSATION: "In conversation",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined",
};

export const SPONSOR_PROSPECT_STATUS_ORDER: SponsorProspectStatus[] = [
  "TO_CONTACT",
  "CONTACTED",
  "IN_CONVERSATION",
  "CONFIRMED",
  "DECLINED",
];

/** Stamp lastContactedAt only when moving into CONTACTED, not on a re-save. */
export function lastContactedAtForStatusChange(
  previous: SponsorProspectStatus,
  next: SponsorProspectStatus,
  now: Date,
): Date | undefined {
  if (next === "CONTACTED" && previous !== "CONTACTED") return now;
  return undefined;
}

export type OutreachCsvColumnKey = "org" | "contactName" | "email" | "website" | "notes" | "skip";

export type OutreachCsvMapping = Record<string, OutreachCsvColumnKey>;

export type OutreachCsvRow =
  | {
      kind: "create";
      rowIndex: number;
      orgName: string;
      contactName?: string;
      contactEmail?: string;
      websiteUrl?: string;
      notes?: string;
    }
  | { kind: "error"; rowIndex: number; message: string; raw?: Record<string, string> };

export type OutreachCsvDryRunResult = {
  headers: string[];
  mapping: OutreachCsvMapping;
  rows: OutreachCsvRow[];
  summary: { creates: number; errors: number; skipped: number };
};

const ORG_ALIASES = [
  "org",
  "org name",
  "organization",
  "organisation",
  "company",
  "company name",
  "sponsor",
  "sponsor name",
  "name",
];
const CONTACT_ALIASES = ["contact", "contact name", "contactname", "person", "name of contact"];
const EMAIL_ALIASES = ["email", "e-mail", "mail", "contact email", "contact e-mail"];
const WEBSITE_ALIASES = ["website", "url", "web", "site", "homepage", "website url"];
const NOTES_ALIASES = ["notes", "note", "comments", "comment"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normHeader(header: string): string {
  return header.trim().toLowerCase().replace(/_/g, " ");
}

export function normalizeOrgName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function orgNameKey(value: string): string {
  return normalizeOrgName(value).toLowerCase();
}

export function suggestOutreachCsvMapping(headers: string[]): OutreachCsvMapping {
  const mapping: OutreachCsvMapping = {};
  const used = new Set<OutreachCsvColumnKey>();
  for (const header of headers) {
    const n = normHeader(header);
    let key: OutreachCsvColumnKey = "skip";
    if (!used.has("org") && ORG_ALIASES.includes(n)) key = "org";
    else if (!used.has("contactName") && CONTACT_ALIASES.includes(n)) key = "contactName";
    else if (!used.has("email") && EMAIL_ALIASES.includes(n)) key = "email";
    else if (!used.has("website") && WEBSITE_ALIASES.includes(n)) key = "website";
    else if (!used.has("notes") && NOTES_ALIASES.includes(n)) key = "notes";
    if (key !== "skip") used.add(key);
    mapping[header] = key;
  }
  return mapping;
}

export function normalizeWebsiteUrl(value: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, url: "" };
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProto);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: `Invalid website: ${trimmed}` };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: `Invalid website: ${trimmed}` };
  }
}

type MappedRow = {
  orgName?: string;
  contactName?: string;
  contactEmail?: string;
  websiteUrl?: string;
  notes?: string;
};

function applyMapping(row: Record<string, string>, mapping: OutreachCsvMapping): MappedRow {
  const out: MappedRow = {};
  for (const [header, key] of Object.entries(mapping)) {
    if (key === "skip") continue;
    const val = (row[header] ?? "").trim();
    if (!val) continue;
    if (key === "org") out.orgName = normalizeOrgName(val);
    else if (key === "contactName") out.contactName = val;
    else if (key === "email") out.contactEmail = val.toLowerCase();
    else if (key === "website") out.websiteUrl = val;
    else if (key === "notes") out.notes = val;
  }
  return out;
}

/**
 * W-2-shaped dry-run: mapping preview, per-row errors, nothing persisted.
 * Duplicates are by orgName within the event (and within the file).
 */
export function dryRunOutreachCsv(opts: {
  headers: string[];
  rows: Record<string, string>[];
  mapping?: OutreachCsvMapping;
  existingOrgNames?: Set<string> | string[];
}): OutreachCsvDryRunResult {
  const mapping = opts.mapping ?? suggestOutreachCsvMapping(opts.headers);
  const existing = new Set(
    (opts.existingOrgNames instanceof Set
      ? [...opts.existingOrgNames]
      : opts.existingOrgNames || []
    ).map(orgNameKey),
  );

  const mappedKeys = new Set(Object.values(mapping));
  if (!mappedKeys.has("org")) {
    return {
      headers: opts.headers,
      mapping,
      rows: [{ kind: "error", rowIndex: -1, message: "Map at least one column to organization" }],
      summary: { creates: 0, errors: 1, skipped: 0 },
    };
  }

  const seen = new Set<string>();
  const changes: OutreachCsvRow[] = [];
  let creates = 0;
  let errors = 0;
  let skipped = 0;

  opts.rows.forEach((raw, rowIndex) => {
    const allEmpty = opts.headers.every((h) => !(raw[h] ?? "").trim());
    if (allEmpty) {
      skipped += 1;
      return;
    }
    const mapped = applyMapping(raw, mapping);
    if (!mapped.orgName) {
      errors += 1;
      changes.push({ kind: "error", rowIndex, message: "Missing organization name", raw });
      return;
    }
    const key = orgNameKey(mapped.orgName);
    if (existing.has(key) || seen.has(key)) {
      errors += 1;
      changes.push({
        kind: "error",
        rowIndex,
        message: seen.has(key)
          ? `Duplicate in file: ${mapped.orgName}`
          : `Already in this pipeline: ${mapped.orgName}`,
        raw,
      });
      return;
    }
    if (mapped.contactEmail && !EMAIL_RE.test(mapped.contactEmail)) {
      errors += 1;
      changes.push({
        kind: "error",
        rowIndex,
        message: `Invalid email: ${mapped.contactEmail}`,
        raw,
      });
      return;
    }
    let websiteUrl: string | undefined;
    if (mapped.websiteUrl) {
      const website = normalizeWebsiteUrl(mapped.websiteUrl);
      if (!website.ok) {
        errors += 1;
        changes.push({ kind: "error", rowIndex, message: website.error, raw });
        return;
      }
      websiteUrl = website.url || undefined;
    }
    seen.add(key);
    creates += 1;
    changes.push({
      kind: "create",
      rowIndex,
      orgName: mapped.orgName,
      contactName: mapped.contactName,
      contactEmail: mapped.contactEmail,
      websiteUrl,
      notes: mapped.notes,
    });
  });

  return {
    headers: opts.headers,
    mapping,
    rows: changes,
    summary: { creates, errors, skipped },
  };
}
