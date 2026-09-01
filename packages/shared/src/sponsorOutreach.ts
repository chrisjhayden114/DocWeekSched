/**
 * SPX-0 / SPX-1 — sponsor outreach pipeline types, CSV dry-run, and composer.
 * Readyhall never sends these emails (DESIGN_PHASE_K D1).
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

/** SPX-1 — composer merge fields. Unknown `{tokens}` stay literal. */
export const OUTREACH_MERGE_FIELDS = [
  "orgName",
  "contactName",
  "eventName",
  "eventDates",
  "eventUrl",
] as const;

export type OutreachMergeField = (typeof OUTREACH_MERGE_FIELDS)[number];

export type OutreachMergeValues = Partial<Record<OutreachMergeField, string | null | undefined>>;

const MERGE_FIELD_SET = new Set<string>(OUTREACH_MERGE_FIELDS);

/**
 * Replace `{orgName}`-style tokens. Known fields that are missing become "".
 * Unknown fields (and malformed braces) render literally and never throw.
 */
export function resolveOutreachMergeFields(text: string, values: OutreachMergeValues): string {
  return text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key: string) => {
    if (!MERGE_FIELD_SET.has(key)) return match;
    const value = values[key as OutreachMergeField];
    return value == null ? "" : String(value);
  });
}

export const OUTREACH_STARTER_TEMPLATE_NAME = "Starter ask";

/**
 * Client-side only — never seeded in the database. Calm, honest sponsor ask.
 * Organizer edits before saving as a template.
 */
export const OUTREACH_STARTER_TEMPLATE = {
  name: OUTREACH_STARTER_TEMPLATE_NAME,
  subject: "Would {orgName} consider supporting {eventName}?",
  body:
    `Hello {contactName},\n\n` +
    `I'm writing about {eventName} ({eventDates}). We are looking for a small number of organizations to help make the gathering possible — a direct ask, not a blast.\n\n` +
    `The public page is {eventUrl}. If this is something {orgName} might consider, I would welcome a short conversation. If the timing is wrong, no need to reply.\n\n` +
    `Thank you for reading.`,
};

export const OUTREACH_DOCTRINE =
  "Sponsors hear from you, not from us. We never send outreach email from this product.";

/** Build a mailto: URL. Subject and body are encodeURIComponent'd (newlines, &, non-ASCII). */
export function buildOutreachMailto(opts: {
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
}): string {
  const parts = [
    `subject=${encodeURIComponent(opts.subject)}`,
    `body=${encodeURIComponent(opts.body)}`,
  ];
  const cc = opts.cc?.trim();
  if (cc) parts.push(`cc=${encodeURIComponent(cc)}`);
  return `mailto:${opts.to}?${parts.join("&")}`;
}
