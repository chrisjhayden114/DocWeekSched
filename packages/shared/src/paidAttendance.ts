/**
 * PAY-T0 (DESIGN_PHASE_J §Paid attendance) — pure helpers for organizer-run
 * registration fees, shared by API + web.
 *
 * The researched decision this encodes: attendee money never touches the
 * platform. Nothing here processes, holds, or guarantees a payment. An
 * organizer publishes their own price text, their own payment link, and their
 * own PO/check instructions; we validate what we store and track who has paid.
 * Education reality drives the status list — POs and checks are first-class,
 * not an afterthought behind a card form.
 */

export const PAYMENT_STATUSES = ["UNPAID", "PO_ON_FILE", "PAID", "WAIVED", "REFUNDED"] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** What a CSV paid-list import sets, and what the roster's bulk action sets. */
export const MARK_PAID_STATUS: PaymentStatus = "PAID";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: "Unpaid",
  PO_ON_FILE: "PO on file",
  PAID: "Paid",
  WAIVED: "Waived",
  REFUNDED: "Refunded",
};

/**
 * NULL is a real resting state, not a missing value: this event has never
 * tracked a fee for this person. It reads as an em dash everywhere.
 */
export const PAYMENT_STATUS_UNSET_LABEL = "—";

export const PAYMENT_PRICE_TEXT_MAX_CHARS = 120;
export const PAYMENT_URL_MAX_CHARS = 2000;
export const PAYMENT_INSTRUCTIONS_MAX_CHARS = 4000;
export const PAYMENT_REFERENCE_MAX_CHARS = 80;

export const PAYMENT_URL_MESSAGE =
  "The payment link must be a full http:// or https:// address (for example https://buy.stripe.com/…) — or leave it empty.";

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/** Roster copy. Anything unrecognized (or null) reads as the em dash. */
export function paymentStatusLabel(status?: string | null): string {
  return isPaymentStatus(status) ? PAYMENT_STATUS_LABELS[status] : PAYMENT_STATUS_UNSET_LABEL;
}

/** Organizer select: the five statuses plus the em dash that clears back to null. */
export function paymentStatusSelectOptions(): { value: string; label: string }[] {
  return [
    { value: "", label: PAYMENT_STATUS_UNSET_LABEL },
    ...PAYMENT_STATUSES.map((status) => ({ value: status, label: PAYMENT_STATUS_LABELS[status] })),
  ];
}

export type NormalizeStatusResult =
  | { ok: true; status: PaymentStatus | null }
  | { ok: false; error: string };

/** Write-time validation. null / blank clears back to "never tracked". */
export function normalizePaymentStatus(input: string | null | undefined): NormalizeStatusResult {
  if (input == null) return { ok: true, status: null };
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, status: null };
  const upper = trimmed.toUpperCase();
  if (!isPaymentStatus(upper)) {
    return {
      ok: false,
      error: `Payment status must be one of ${PAYMENT_STATUSES.join(", ")} — or empty to clear it.`,
    };
  }
  return { ok: true, status: upper };
}

export type NormalizeReferenceResult =
  | { ok: true; reference: string | null }
  | { ok: false; error: string };

/** PO number, check number, invoice id — free text, trimmed, capped. */
export function normalizePaymentReference(input: string | null | undefined): NormalizeReferenceResult {
  if (input == null) return { ok: true, reference: null };
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, reference: null };
  if (trimmed.length > PAYMENT_REFERENCE_MAX_CHARS) {
    return {
      ok: false,
      error: `A payment reference must be ${PAYMENT_REFERENCE_MAX_CHARS} characters or fewer.`,
    };
  }
  return { ok: true, reference: trimmed };
}

export type NormalizeUrlResult = { ok: true; url: string | null } | { ok: false; error: string };

/**
 * http(s) only, and stored exactly as typed (trimmed) so the button an attendee
 * clicks is the address the organizer pasted. Rejecting `javascript:` and
 * friends here matters: this value becomes a link on the public page.
 */
export function normalizePaymentUrl(input: string | null | undefined): NormalizeUrlResult {
  if (input == null) return { ok: true, url: null };
  const raw = input.trim();
  if (!raw) return { ok: true, url: null };
  if (raw.length > PAYMENT_URL_MAX_CHARS) {
    return { ok: false, error: `The payment link must be ${PAYMENT_URL_MAX_CHARS} characters or fewer.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: PAYMENT_URL_MESSAGE };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: PAYMENT_URL_MESSAGE };
  }
  if (!parsed.hostname) {
    return { ok: false, error: PAYMENT_URL_MESSAGE };
  }
  return { ok: true, url: raw };
}

/** The event-level fee notice shown to attendees. All three parts optional. */
export type FeeNotice = {
  priceText: string | null;
  url: string | null;
  instructions: string | null;
};

/** Nothing filled in = nothing to show. Never render an empty "how to pay" box. */
export function hasFeeNotice(notice: FeeNotice | null | undefined): boolean {
  if (!notice) return false;
  return Boolean(
    (notice.priceText && notice.priceText.trim()) ||
      (notice.url && notice.url.trim()) ||
      (notice.instructions && notice.instructions.trim()),
  );
}

/* ------------------------------------------------------------------------- *
 * "Mark paid from CSV" — the paid-list match, run as a dry-run before any
 * write. Deliberately shaped like the W-2 invite dry-run so the same review
 * card renders it: matched rows are `create`, and every email we could not
 * match is an `error` row the organizer reads before confirming. Unmatched
 * emails are never silently dropped and never invent a roster seat.
 * ------------------------------------------------------------------------- */

export type PaidCsvColumnKey = "email" | "reference" | "skip";

export type PaidCsvMapping = Record<string, PaidCsvColumnKey>;

export type PaidCsvRosterMember = {
  userId: string;
  email: string;
  name: string;
  paymentStatus?: string | null;
};

export type PaidCsvRow =
  | {
      kind: "create";
      rowIndex: number;
      userId: string;
      email: string;
      name: string;
      currentStatus: PaymentStatus | null;
      paymentReference?: string;
    }
  | { kind: "error"; rowIndex: number; message: string; raw?: Record<string, string> };

export type PaidCsvDryRunResult = {
  headers: string[];
  mapping: PaidCsvMapping;
  rows: PaidCsvRow[];
  summary: { creates: number; errors: number; skipped: number };
};

const EMAIL_ALIASES = ["email", "e-mail", "mail", "attendee email", "participant email"];
const REFERENCE_ALIASES = [
  "reference",
  "po",
  "po number",
  "po #",
  "purchase order",
  "purchase order number",
  "payment reference",
  "invoice",
  "invoice number",
  "check",
  "check number",
  "cheque",
  "receipt",
  "confirmation",
];

function normHeader(header: string): string {
  return header.trim().toLowerCase().replace(/_/g, " ");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function suggestPaidCsvMapping(headers: string[]): PaidCsvMapping {
  const mapping: PaidCsvMapping = {};
  const used = new Set<PaidCsvColumnKey>();
  for (const header of headers) {
    const n = normHeader(header);
    let key: PaidCsvColumnKey = "skip";
    if (!used.has("email") && EMAIL_ALIASES.includes(n)) key = "email";
    else if (!used.has("reference") && REFERENCE_ALIASES.includes(n)) key = "reference";
    if (key !== "skip") used.add(key);
    mapping[header] = key;
  }
  return mapping;
}

function applyPaidMapping(
  row: Record<string, string>,
  mapping: PaidCsvMapping,
): { email?: string; reference?: string } {
  const out: { email?: string; reference?: string } = {};
  for (const [header, key] of Object.entries(mapping)) {
    if (key === "skip") continue;
    const value = (row[header] ?? "").trim();
    if (!value) continue;
    if (key === "email") out.email = value.toLowerCase();
    else if (key === "reference") out.reference = value;
  }
  return out;
}

/**
 * Match a paid-list CSV against the roster. Nothing is written: this is the
 * "who would be marked paid" answer, including the emails that matched nobody.
 */
export function dryRunPaidCsv(opts: {
  headers: string[];
  rows: Record<string, string>[];
  mapping?: PaidCsvMapping;
  roster: PaidCsvRosterMember[];
}): PaidCsvDryRunResult {
  const mapping = opts.mapping ?? suggestPaidCsvMapping(opts.headers);
  const byEmail = new Map<string, PaidCsvRosterMember>();
  for (const member of opts.roster) {
    byEmail.set(member.email.trim().toLowerCase(), member);
  }

  if (!Object.values(mapping).includes("email")) {
    return {
      headers: opts.headers,
      mapping,
      rows: [{ kind: "error", rowIndex: -1, message: "Map at least one column to email" }],
      summary: { creates: 0, errors: 1, skipped: 0 },
    };
  }

  const seen = new Set<string>();
  const rows: PaidCsvRow[] = [];
  let creates = 0;
  let errors = 0;
  let skipped = 0;

  opts.rows.forEach((raw, rowIndex) => {
    const allEmpty = opts.headers.every((h) => !(raw[h] ?? "").trim());
    if (allEmpty) {
      skipped += 1;
      return;
    }
    const mapped = applyPaidMapping(raw, mapping);
    if (!mapped.email) {
      errors += 1;
      rows.push({ kind: "error", rowIndex, message: "Missing email", raw });
      return;
    }
    if (!EMAIL_RE.test(mapped.email)) {
      errors += 1;
      rows.push({ kind: "error", rowIndex, message: `Invalid email: ${mapped.email}`, raw });
      return;
    }
    if (seen.has(mapped.email)) {
      errors += 1;
      rows.push({ kind: "error", rowIndex, message: `Duplicate in file: ${mapped.email}`, raw });
      return;
    }
    const member = byEmail.get(mapped.email);
    if (!member) {
      errors += 1;
      rows.push({
        kind: "error",
        rowIndex,
        message: `Not on this event's roster: ${mapped.email} — add them to the roster first, then run this again.`,
        raw,
      });
      return;
    }
    const reference = normalizePaymentReference(mapped.reference);
    if (!reference.ok) {
      errors += 1;
      rows.push({ kind: "error", rowIndex, message: `${mapped.email} — ${reference.error}`, raw });
      return;
    }
    seen.add(mapped.email);
    creates += 1;
    rows.push({
      kind: "create",
      rowIndex,
      userId: member.userId,
      email: member.email,
      name: member.name,
      currentStatus: isPaymentStatus(member.paymentStatus) ? member.paymentStatus : null,
      ...(reference.reference ? { paymentReference: reference.reference } : {}),
    });
  });

  return { headers: opts.headers, mapping, rows, summary: { creates, errors, skipped } };
}

export type PaidMarkOutcome = {
  updatedCount: number;
  unchangedCount: number;
  notOnRosterCount?: number;
};

function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/**
 * Reports exactly what changed. "Already paid" is called out rather than
 * folded into the total, so the line can never overstate the run.
 */
export function paidMarkSummaryLine(outcome: PaidMarkOutcome): string {
  const parts: string[] = [
    outcome.updatedCount > 0
      ? `Marked ${people(outcome.updatedCount)} as paid.`
      : "No payment statuses changed.",
  ];
  if (outcome.unchangedCount > 0) {
    parts.push(`${outcome.unchangedCount} already showed as paid.`);
  }
  if (outcome.notOnRosterCount) {
    parts.push(`${outcome.notOnRosterCount} weren't on the roster and were left alone.`);
  }
  parts.push("No money moved — this only records what you already collected.");
  return parts.join(" ");
}
