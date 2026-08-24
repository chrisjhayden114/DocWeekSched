import { describe, expect, it } from "vitest";
import {
  PAYMENT_REFERENCE_MAX_CHARS,
  PAYMENT_STATUSES,
  dryRunPaidCsv,
  isPaymentStatus,
  normalizePaymentReference,
  normalizePaymentStatus,
  normalizePaymentUrl,
  suggestPaidCsvMapping,
  type PaidCsvRosterMember,
} from "../lib/paidAttendance";
import { paidMarkSummaryLine, paymentStatusLabel } from "@event-app/shared";

/**
 * PAY-T0 — the validation and matching that stand between an organizer's
 * spreadsheet and the roster. Two things are pinned here above all: a payment
 * status can only ever be one of the five documented values (the column is a
 * VARCHAR, so application code IS the constraint), and a paymentUrl is never
 * anything but http(s) — that value renders as a link button on a public page.
 */

describe("payment status validation", () => {
  it("accepts exactly the five documented statuses", () => {
    expect(PAYMENT_STATUSES).toEqual(["UNPAID", "PO_ON_FILE", "PAID", "WAIVED", "REFUNDED"]);
    for (const status of PAYMENT_STATUSES) {
      expect(normalizePaymentStatus(status)).toEqual({ ok: true, status });
      expect(isPaymentStatus(status)).toBe(true);
    }
  });

  it("treats null, undefined, empty, and whitespace as 'never tracked' — not as UNPAID", () => {
    for (const input of [null, undefined, "", "   ", "\n\t "]) {
      expect(normalizePaymentStatus(input)).toEqual({ ok: true, status: null });
    }
  });

  it("accepts a lowercase status but stores the canonical form", () => {
    expect(normalizePaymentStatus(" po_on_file ")).toEqual({ ok: true, status: "PO_ON_FILE" });
  });

  it("rejects anything else, naming the accepted values", () => {
    for (const bad of ["PENDING", "paid!", "COMPED", "0", "true"]) {
      const result = normalizePaymentStatus(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.error).toContain("PO_ON_FILE");
    }
    expect(isPaymentStatus("PENDING")).toBe(false);
    expect(isPaymentStatus(3)).toBe(false);
  });

  it("labels a null status as an em dash, never as unpaid", () => {
    expect(paymentStatusLabel(null)).toBe("—");
    expect(paymentStatusLabel(undefined)).toBe("—");
    expect(paymentStatusLabel("UNPAID")).toBe("Unpaid");
    expect(paymentStatusLabel("PO_ON_FILE")).toBe("PO on file");
  });
});

describe("payment reference validation", () => {
  it("trims, and treats blank as cleared", () => {
    expect(normalizePaymentReference("  PO-4471 ")).toEqual({ ok: true, reference: "PO-4471" });
    for (const input of [null, undefined, "", "  "]) {
      expect(normalizePaymentReference(input)).toEqual({ ok: true, reference: null });
    }
  });

  it("caps the length at the column width", () => {
    const ok = "x".repeat(PAYMENT_REFERENCE_MAX_CHARS);
    expect(normalizePaymentReference(ok)).toEqual({ ok: true, reference: ok });
    const tooLong = normalizePaymentReference("x".repeat(PAYMENT_REFERENCE_MAX_CHARS + 1));
    expect(tooLong.ok).toBe(false);
  });
});

describe("payment URL validation", () => {
  it("accepts http and https links, stored exactly as typed", () => {
    expect(normalizePaymentUrl("https://buy.stripe.com/abc123")).toEqual({
      ok: true,
      url: "https://buy.stripe.com/abc123",
    });
    // No trailing-slash rewrite: the attendee's button opens what was pasted.
    expect(normalizePaymentUrl("  https://school.example.org/store  ")).toEqual({
      ok: true,
      url: "https://school.example.org/store",
    });
    expect(normalizePaymentUrl("http://intranet.district.local/pay").ok).toBe(true);
  });

  it("treats null / blank as no link", () => {
    for (const input of [null, undefined, "", "   "]) {
      expect(normalizePaymentUrl(input)).toEqual({ ok: true, url: null });
    }
  });

  it("rejects every non-http(s) scheme — this value becomes a link on a public page", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:finance@example.org",
      "ftp://files.example.org/invoice",
      "buy.stripe.com/abc",
      "//buy.stripe.com/abc",
      "not a url",
    ]) {
      const result = normalizePaymentUrl(bad);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.error).toContain("http");
    }
  });
});

describe("mark-paid CSV match", () => {
  const roster: PaidCsvRosterMember[] = [
    { userId: "u-ada", email: "ada@school.org", name: "Ada Lovelace", paymentStatus: null },
    { userId: "u-bo", email: "Bo@School.org", name: "Bo Diaz", paymentStatus: "UNPAID" },
    { userId: "u-cy", email: "cy@school.org", name: "Cy Reyes", paymentStatus: "PAID" },
  ];

  it("suggests email and reference columns from common headings", () => {
    expect(suggestPaidCsvMapping(["Email", "PO Number", "Amount"])).toEqual({
      Email: "email",
      "PO Number": "reference",
      Amount: "skip",
    });
  });

  it("refuses to run without an email column", () => {
    const result = dryRunPaidCsv({
      headers: ["Name", "Amount"],
      rows: [{ Name: "Ada", Amount: "120" }],
      roster,
    });
    expect(result.summary).toEqual({ creates: 0, errors: 1, skipped: 0 });
    expect(result.rows[0]).toMatchObject({ kind: "error", rowIndex: -1 });
  });

  it("matches roster members case-insensitively and carries the reference", () => {
    const result = dryRunPaidCsv({
      headers: ["Email", "PO"],
      rows: [
        { Email: "ADA@school.org", PO: " PO-1 " },
        { Email: "bo@school.org", PO: "" },
      ],
      roster,
    });
    expect(result.summary).toEqual({ creates: 2, errors: 0, skipped: 0 });
    expect(result.rows[0]).toEqual({
      kind: "create",
      rowIndex: 0,
      userId: "u-ada",
      email: "ada@school.org",
      name: "Ada Lovelace",
      currentStatus: null,
      paymentReference: "PO-1",
    });
    // A blank reference cell carries nothing, so a confirm can't erase a
    // reference the organizer typed earlier.
    expect(result.rows[1]).not.toHaveProperty("paymentReference");
    expect(result.rows[1]).toMatchObject({ userId: "u-bo", currentStatus: "UNPAID" });
  });

  it("reports someone already paid as a match, with their current status visible", () => {
    const result = dryRunPaidCsv({
      headers: ["Email"],
      rows: [{ Email: "cy@school.org" }],
      roster,
    });
    expect(result.summary.creates).toBe(1);
    expect(result.rows[0]).toMatchObject({ kind: "create", currentStatus: "PAID" });
  });

  it("lists an unmatched email honestly instead of inventing a roster seat", () => {
    const result = dryRunPaidCsv({
      headers: ["Email"],
      rows: [{ Email: "stranger@elsewhere.org" }],
      roster,
    });
    expect(result.summary).toEqual({ creates: 0, errors: 1, skipped: 0 });
    expect(result.rows[0]).toMatchObject({ kind: "error", rowIndex: 0 });
    if (result.rows[0]!.kind === "error") {
      expect(result.rows[0]!.message).toContain("stranger@elsewhere.org");
      expect(result.rows[0]!.message).toContain("Not on this event's roster");
    }
  });

  it("flags missing, malformed, and duplicated emails per row", () => {
    const result = dryRunPaidCsv({
      headers: ["Email"],
      rows: [
        { Email: "" },
        { Email: "not-an-email" },
        { Email: "ada@school.org" },
        { Email: "ADA@school.org" },
      ],
      roster,
    });
    // Row 0 is entirely blank, so it is skipped rather than reported as broken.
    expect(result.summary).toEqual({ creates: 1, errors: 2, skipped: 1 });
    const messages = result.rows.filter((r) => r.kind === "error").map((r) => r.message);
    expect(messages).toEqual(["Invalid email: not-an-email", "Duplicate in file: ada@school.org"]);
  });

  it("rejects an over-long reference on the row, not the whole file", () => {
    const result = dryRunPaidCsv({
      headers: ["Email", "PO"],
      rows: [
        { Email: "ada@school.org", PO: "x".repeat(PAYMENT_REFERENCE_MAX_CHARS + 1) },
        { Email: "bo@school.org", PO: "PO-2" },
      ],
      roster,
    });
    expect(result.summary).toEqual({ creates: 1, errors: 1, skipped: 0 });
  });

  it("honours an explicit mapping that skips a column", () => {
    const result = dryRunPaidCsv({
      headers: ["Email", "PO"],
      rows: [{ Email: "ada@school.org", PO: "PO-9" }],
      mapping: { Email: "email", PO: "skip" },
      roster,
    });
    expect(result.rows[0]).not.toHaveProperty("paymentReference");
  });
});

describe("mark-paid summary copy", () => {
  it("never claims more than happened, and never implies money moved", () => {
    expect(paidMarkSummaryLine({ updatedCount: 1, unchangedCount: 0 })).toBe(
      "Marked 1 person as paid. No money moved — this only records what you already collected.",
    );
    expect(
      paidMarkSummaryLine({ updatedCount: 0, unchangedCount: 3, notOnRosterCount: 2 }),
    ).toBe(
      "No payment statuses changed. 3 already showed as paid. 2 weren't on the roster and were left alone. No money moved — this only records what you already collected.",
    );
  });
});
