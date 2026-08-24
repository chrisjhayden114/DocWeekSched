/**
 * CSV invite dry-run: column mapping + per-row validation.
 * Pure logic — shared by API dry-run endpoint and unit tests; UI ReviewChangeset renders the result.
 */

export type CsvColumnKey = "email" | "name" | "description" | "bio" | "photoUrl" | "label" | "skip";

export type CsvColumnMapping = Record<string, CsvColumnKey>;

export type CsvInviteRowInput = Record<string, string>;

export type CsvRowChange =
  | {
      kind: "create";
      rowIndex: number;
      email: string;
      name: string;
      description?: string;
      researchInterests?: string;
      bio?: string;
      photoUrl?: string;
      /** W-2: validated against the event's participant labels. */
      participantLabel?: string;
    }
  | { kind: "error"; rowIndex: number; message: string; raw?: Record<string, string> };

export type CsvDryRunResult = {
  headers: string[];
  mapping: CsvColumnMapping;
  rows: CsvRowChange[];
  summary: { creates: number; errors: number; skipped: number };
};

const EMAIL_ALIASES = ["email", "e-mail", "mail"];
const NAME_ALIASES = ["name", "full name", "fullname", "participant", "attendee"];
const DESC_ALIASES = ["description", "desc", "title", "role"];
const BIO_ALIASES = ["bio", "biography", "about"];
const PHOTO_ALIASES = ["photo_url", "photo", "photo url", "avatar", "image"];
/** Deliberately narrow: an unrelated "department" column must not become a
 *  wall of unknown-label row errors on an existing CSV. Anything else is
 *  mapped by hand. */
const LABEL_ALIASES = ["label", "participant label"];

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/_/g, " ");
}

/**
 * W-2: a `label` column is only ever suggested when the event actually defines
 * participant labels — otherwise every value in it would be a row error.
 */
export function suggestCsvMapping(headers: string[], eventLabels: string[] = []): CsvColumnMapping {
  const mapping: CsvColumnMapping = {};
  const used = new Set<CsvColumnKey>();
  for (const h of headers) {
    const n = normHeader(h);
    let key: CsvColumnKey = "skip";
    if (!used.has("email") && EMAIL_ALIASES.includes(n)) key = "email";
    else if (!used.has("name") && NAME_ALIASES.includes(n)) key = "name";
    else if (!used.has("description") && DESC_ALIASES.includes(n)) key = "description";
    else if (!used.has("bio") && BIO_ALIASES.includes(n)) key = "bio";
    else if (!used.has("photoUrl") && PHOTO_ALIASES.includes(n)) key = "photoUrl";
    else if (!used.has("label") && eventLabels.length > 0 && LABEL_ALIASES.includes(n)) key = "label";
    if (key !== "skip") used.add(key);
    mapping[h] = key;
  }
  return mapping;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type MappedRow = {
  email?: string;
  name?: string;
  description?: string;
  bio?: string;
  photoUrl?: string;
  label?: string;
};

function applyMapping(row: CsvInviteRowInput, mapping: CsvColumnMapping): MappedRow {
  const out: MappedRow = {};
  for (const [header, key] of Object.entries(mapping)) {
    if (key === "skip") continue;
    const val = (row[header] ?? "").trim();
    if (!val) continue;
    if (key === "email") out.email = val.toLowerCase();
    else if (key === "name") out.name = val;
    else if (key === "description") out.description = val;
    else if (key === "bio") out.bio = val;
    else if (key === "photoUrl") out.photoUrl = val;
    else if (key === "label") out.label = val;
  }
  return out;
}

/**
 * W-2: a mapped label must be one of the event's participant labels, matched
 * case-insensitively but stored in the event's own casing. Unknown values are
 * a row error in the dry-run — never a silent drop, and never an invented label.
 */
export function matchEventLabel(
  value: string,
  eventLabels: string[],
): { ok: true; label: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, label: "" };
  if (eventLabels.length === 0) {
    return {
      ok: false,
      error: `Label “${trimmed}” — this event has no participant labels yet. Add it under Participant labels, or map this column to Skip.`,
    };
  }
  const match = eventLabels.find((l) => l.toLowerCase() === trimmed.toLowerCase());
  if (!match) {
    return {
      ok: false,
      error: `Unknown label “${trimmed}” — this event's labels are: ${eventLabels.join(", ")}. Add it under Participant labels, or map this column to Skip.`,
    };
  }
  return { ok: true, label: match };
}

export function dryRunCsvInvites(opts: {
  headers: string[];
  rows: CsvInviteRowInput[];
  mapping?: CsvColumnMapping;
  existingEmails?: Set<string> | string[];
  /** W-2: the event's participant labels — the only accepted values for a mapped label column. */
  eventLabels?: string[];
}): CsvDryRunResult {
  const eventLabels = opts.eventLabels ?? [];
  const mapping = opts.mapping ?? suggestCsvMapping(opts.headers, eventLabels);
  const existing = opts.existingEmails instanceof Set
    ? opts.existingEmails
    : new Set((opts.existingEmails || []).map((e) => e.toLowerCase()));

  const mappedKeys = new Set(Object.values(mapping));
  if (!mappedKeys.has("email")) {
    return {
      headers: opts.headers,
      mapping,
      rows: [{ kind: "error", rowIndex: -1, message: "Map at least one column to email" }],
      summary: { creates: 0, errors: 1, skipped: 0 },
    };
  }

  const seen = new Set<string>();
  const changes: CsvRowChange[] = [];
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
    if (!mapped.email) {
      errors += 1;
      changes.push({ kind: "error", rowIndex, message: "Missing email", raw });
      return;
    }
    if (!EMAIL_RE.test(mapped.email)) {
      errors += 1;
      changes.push({ kind: "error", rowIndex, message: `Invalid email: ${mapped.email}`, raw });
      return;
    }
    if (existing.has(mapped.email) || seen.has(mapped.email)) {
      errors += 1;
      changes.push({
        kind: "error",
        rowIndex,
        message: seen.has(mapped.email) ? `Duplicate in file: ${mapped.email}` : `Already on roster: ${mapped.email}`,
        raw,
      });
      return;
    }
    let participantLabel: string | undefined;
    if (mapped.label) {
      const matched = matchEventLabel(mapped.label, eventLabels);
      if (!matched.ok) {
        errors += 1;
        changes.push({ kind: "error", rowIndex, message: matched.error, raw });
        return;
      }
      participantLabel = matched.label || undefined;
    }
    seen.add(mapped.email);
    creates += 1;
    changes.push({
      kind: "create",
      rowIndex,
      email: mapped.email,
      name: mapped.name || mapped.email.split("@")[0] || "Participant",
      description: mapped.description,
      researchInterests: mapped.description || mapped.bio,
      bio: mapped.bio,
      photoUrl: mapped.photoUrl,
      participantLabel,
    });
  });

  return {
    headers: opts.headers,
    mapping,
    rows: changes,
    summary: { creates, errors, skipped },
  };
}
