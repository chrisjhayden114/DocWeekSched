import { describe, expect, it } from "vitest";
import {
  NO_PREVIEW_NOTE,
  describeIngestSource,
  formatBytes,
  ingestReviewHeading,
} from "../lib/ingestSource";

describe("formatBytes", () => {
  it("formats byte counts human-readably", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(188181)).toBe("184 KB");
    expect(formatBytes(50_000)).toBe("48.8 KB");
    expect(formatBytes(5_000_000)).toBe("4.8 MB");
  });

  it("returns empty string for invalid input", () => {
    expect(formatBytes(-1)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
  });
});

describe("describeIngestSource", () => {
  const pdfStub =
    "[Binary application/pdf upload, 188181 bytes — extract from stored bytes / OCR stub]";

  it("never exposes the binary stub for a PDF run; shows real metadata instead", () => {
    const d = describeIngestSource({
      sourceKind: "PDF",
      sourceFileName: "2026 DocWeek Schedule and Session Overview.pdf",
      sourceMime: "application/pdf",
      sourceBytes: 188181,
      sourceTextPreview: pdfStub,
    });
    expect(d.isFile).toBe(true);
    expect(d.fileName).toBe("2026 DocWeek Schedule and Session Overview.pdf");
    expect(d.mime).toBe("application/pdf");
    expect(d.sizeLabel).toBe("184 KB");
    expect(d.previewText).toBeNull();
    expect(d.previewNote).toBe(NO_PREVIEW_NOTE);
  });

  it("suppresses the stored-file stub too", () => {
    const d = describeIngestSource({
      sourceKind: "DOCX",
      sourceFileName: "programme.docx",
      sourceTextPreview: "[Stored file programme.docx]",
    });
    expect(d.previewText).toBeNull();
    expect(d.previewNote).toBe(NO_PREVIEW_NOTE);
  });

  it("keeps the genuine text preview for PASTE runs", () => {
    const d = describeIngestSource({
      sourceKind: "PASTE",
      sourceTextPreview: "9:00–10:15 Welcome\n10:30–12:00 Hot Topics",
    });
    expect(d.isFile).toBe(false);
    expect(d.previewText).toContain("Welcome");
    expect(d.previewNote).toBeNull();
  });

  it("shows both metadata and preview for a text-format file (CSV)", () => {
    const d = describeIngestSource({
      sourceKind: "CSV",
      sourceFileName: "sessions.csv",
      sourceMime: "text/csv",
      sourceBytes: 2048,
      sourceTextPreview: "title,start,end\nWelcome,9:00,10:15",
    });
    expect(d.isFile).toBe(true);
    expect(d.fileName).toBe("sessions.csv");
    expect(d.sizeLabel).toBe("2 KB");
    expect(d.previewText).toContain("Welcome");
    expect(d.previewNote).toBeNull();
  });

  it("notes when a binary file has no preview at all", () => {
    const d = describeIngestSource({
      sourceKind: "PDF",
      sourceFileName: "deck.pdf",
      sourceTextPreview: null,
    });
    expect(d.previewText).toBeNull();
    expect(d.previewNote).toBe(NO_PREVIEW_NOTE);
  });
});

describe("ingestReviewHeading", () => {
  it("names the file and states the count", () => {
    expect(
      ingestReviewHeading({
        creates: 22,
        updates: 0,
        sourceKind: "PDF",
        fileName: "2026 DocWeek Schedule and Session Overview.pdf",
      }),
    ).toBe("Review 22 sessions found in 2026 DocWeek Schedule and Session Overview.pdf");
  });

  it("counts updates as found sessions and singularizes", () => {
    expect(ingestReviewHeading({ creates: 0, updates: 1, sourceKind: "PDF", fileName: "a.pdf" })).toBe(
      "Review 1 session found in a.pdf",
    );
  });

  it("describes paste and URL sources without a file name", () => {
    expect(ingestReviewHeading({ creates: 3, updates: 0, sourceKind: "PASTE" })).toBe(
      "Review 3 sessions found in pasted text",
    );
    expect(ingestReviewHeading({ creates: 2, updates: 0, sourceKind: "URL" })).toBe(
      "Review 2 sessions found in the fetched URL",
    );
  });

  it("states plainly when nothing was found", () => {
    expect(ingestReviewHeading({ creates: 0, updates: 0, sourceKind: "PDF", fileName: "a.pdf" })).toBe(
      "No sessions found in a.pdf",
    );
  });

  it("uses the confirmed label after confirm", () => {
    expect(
      ingestReviewHeading({ confirmed: true, creates: 22, updates: 0, sourceKind: "PDF", fileName: "a.pdf" }),
    ).toBe("Confirmed drafts");
  });
});
