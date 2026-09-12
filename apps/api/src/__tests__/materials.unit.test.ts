/**
 * AGENDA-3 — the rules that decide whether a presenter's file reaches an
 * attendee, pinned without a database.
 *
 * Everything here is a gate. The DB suite (sessionMaterials.db.test.ts) proves
 * the routes enforce them end to end; this file proves the rules themselves
 * say what we think they say, including the ones that are easiest to get
 * backwards — the share-on-approval default, and what an unrecognised
 * visibility value means.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATERIALS_VISIBILITY,
  MATERIALS_VISIBILITIES,
  MATERIALS_VISIBILITY_HELP,
  MATERIALS_VISIBILITY_LABELS,
  asMaterialsVisibility,
  materialsArePublic,
  materialsVisibilityOrDefault,
  materialsVisibilitySelectOptions,
} from "@event-app/shared";
import { READINESS_DEFAULT_MIME } from "../lib/readiness/files";
import {
  SHARED_MATERIAL_WHERE,
  assertMaterialMimeAllowed,
  isShareableSubmission,
  sharesOnApproval,
  toSharedMaterial,
} from "../lib/readiness/materials";

const fileRow = {
  id: "sub-1",
  valueText: null,
  fileName: "deck.pdf",
  fileMime: "application/pdf",
  fileSizeBytes: 2_400_000,
  fileUrl: null,
  fileStorageKey: "events/e1/readiness/a1/abc.pdf",
  assignment: {
    sessionId: "sess-1",
    speakerId: null,
    requirement: { label: "Slide deck", kind: "file", config: {} },
  },
};

describe("materialsVisibility vocabulary", () => {
  it("is two values, and ATTENDEES is the default", () => {
    expect([...MATERIALS_VISIBILITIES]).toEqual(["ATTENDEES", "PUBLIC"]);
    expect(DEFAULT_MATERIALS_VISIBILITY).toBe("ATTENDEES");
  });

  it("fails CLOSED on anything it does not recognise", () => {
    // The column is a plain String, so a hand-edited row, a partial migration
    // or a typo in a fixture can hold anything. Every one of those has to mean
    // "attendees only" — the failure mode of guessing wrong here is publishing
    // a speaker's slides to the open web.
    for (const bad of ["public", "Public", "EVERYONE", "", null, undefined, 7, {}]) {
      expect(asMaterialsVisibility(bad)).toBeNull();
      expect(materialsVisibilityOrDefault(bad)).toBe("ATTENDEES");
      expect(materialsArePublic(bad)).toBe(false);
    }
    expect(materialsArePublic("PUBLIC")).toBe(true);
  });

  it("labels and help text say who, in words an organizer can act on", () => {
    expect(materialsVisibilitySelectOptions().map((o) => o.value)).toEqual(["ATTENDEES", "PUBLIC"]);
    for (const value of MATERIALS_VISIBILITIES) {
      // No internal vocabulary in anything an organizer reads.
      expect(MATERIALS_VISIBILITY_LABELS[value]).not.toMatch(/ATTENDEES|PUBLIC/);
      expect(MATERIALS_VISIBILITY_HELP[value].length).toBeGreaterThan(40);
    }
    expect(MATERIALS_VISIBILITY_HELP.PUBLIC).toMatch(/no account and no sign-in/i);
  });
});

describe("SHARED_MATERIAL_WHERE", () => {
  it("requires shared AND approved AND current AND an openable kind", () => {
    // Pinned as a whole object rather than field by field: this clause is the
    // single chokepoint every read goes through, and a field silently dropped
    // from it is a leak that no other test would notice.
    expect(SHARED_MATERIAL_WHERE).toEqual({
      sharedWithAttendees: true,
      supersededAt: null,
      rejectedAt: null,
      approvedAt: { not: null },
      assignment: { requirement: { kind: { in: ["file", "url"] } } },
    });
  });
});

describe("toSharedMaterial", () => {
  it("titles a file by its requirement label, and falls back to the file name", () => {
    expect(toSharedMaterial(fileRow)).toEqual({
      id: "sub-1",
      title: "Slide deck",
      kind: "file",
      mime: "application/pdf",
      sizeBytes: 2_400_000,
      url: null,
    });
    const unlabelled = {
      ...fileRow,
      assignment: { ...fileRow.assignment, requirement: { label: "  ", kind: "file", config: {} } },
    };
    expect(toSharedMaterial(unlabelled)!.title).toBe("deck.pdf");
  });

  it("carries a link's URL, and no file metadata", () => {
    const link = {
      ...fileRow,
      fileName: null,
      fileMime: null,
      fileSizeBytes: null,
      fileStorageKey: null,
      valueText: "https://e.test/handout",
      assignment: { ...fileRow.assignment, requirement: { label: "Handout", kind: "url", config: {} } },
    };
    expect(toSharedMaterial(link)).toEqual({
      id: "sub-1",
      title: "Handout",
      kind: "link",
      mime: null,
      sizeBytes: null,
      url: "https://e.test/handout",
    });
  });

  it("yields nothing for a submission with nothing to open", () => {
    // Shared and approved, but empty: the agenda shows no chip rather than a
    // chip that 404s. Non-http values are dropped for the same reason, and
    // because "javascript:" in an href is a link nobody asked for.
    const empty = { ...fileRow, fileStorageKey: null, fileUrl: null };
    expect(toSharedMaterial(empty)).toBeNull();
    expect(toSharedMaterial({ ...empty, valueText: "ask me at the booth" })).toBeNull();
    expect(toSharedMaterial({ ...empty, valueText: "javascript:alert(1)" })).toBeNull();
    expect(toSharedMaterial({ ...empty, valueText: "mailto:a@b.test" })).toBeNull();
  });

  it("treats a data-URL upload as a file, like the storage-key path", () => {
    const legacy = { ...fileRow, fileStorageKey: null, fileUrl: "data:application/pdf;base64,AAAA" };
    expect(toSharedMaterial(legacy)!.kind).toBe("file");
    // The data URL itself is NEVER the href — that would put the bytes in the
    // payload. Files always go through GET /materials/:id/file.
    expect(toSharedMaterial(legacy)!.url).toBeNull();
  });
});

describe("sharesOnApproval", () => {
  it("shares a deck by default, and nothing else", () => {
    // A deck is collected in order to be presented; a signed release form is
    // collected in order to be filed. Getting this backwards publishes the
    // release form, so anything unrecognised stays private.
    expect(sharesOnApproval({ deck: true })).toBe(true);
    expect(sharesOnApproval({ isDeck: true })).toBe(true);
    expect(sharesOnApproval({ role: "deck" })).toBe(true);
    expect(sharesOnApproval({})).toBe(false);
    expect(sharesOnApproval(null)).toBe(false);
    expect(sharesOnApproval(undefined)).toBe(false);
    expect(sharesOnApproval({ maxBytes: 100 })).toBe(false);
  });

  it("lets an explicit setting win in BOTH directions", () => {
    // An organizer who turned sharing off on a deck requirement means it.
    expect(sharesOnApproval({ deck: true, shareByDefault: false })).toBe(false);
    expect(sharesOnApproval({ shareByDefault: true })).toBe(true);
    // Only a real boolean counts — a stray string does not enable sharing.
    expect(sharesOnApproval({ shareByDefault: "true" })).toBe(false);
  });
});

describe("isShareableSubmission", () => {
  const base = { valueText: null, fileUrl: null, fileStorageKey: "k", requirementKind: "file" };

  it("accepts a file or a link on a file/url requirement", () => {
    expect(isShareableSubmission(base)).toBe(true);
    expect(isShareableSubmission({ ...base, fileStorageKey: null, fileUrl: "data:application/pdf;base64,AA" })).toBe(true);
    expect(
      isShareableSubmission({ valueText: "https://e.test/x", fileUrl: null, fileStorageKey: null, requirementKind: "url" }),
    ).toBe(true);
  });

  it("refuses a requirement kind that could never be a handout", () => {
    // A confirmation or a dietary note is an organizer's record. This is what
    // stops `shareByDefault` being configurable into a leak of free text.
    for (const kind of ["confirm", "short_text", "long_text", "date", "select", "multi_select", "agreement", "internal_checklist"]) {
      expect(isShareableSubmission({ ...base, requirementKind: kind })).toBe(false);
    }
  });

  it("refuses an empty submission even on a file requirement", () => {
    expect(isShareableSubmission({ ...base, fileStorageKey: null })).toBe(false);
    expect(isShareableSubmission({ ...base, fileStorageKey: null, valueText: "not a url" })).toBe(false);
  });
});

describe("assertMaterialMimeAllowed", () => {
  const file = {
    eventId: "e1",
    fileName: "deck.pdf",
    fileMime: "application/pdf",
    fileUrl: null,
    fileStorageKey: "k",
    requirementConfig: {} as Record<string, unknown>,
  };

  it("passes the O10 allowlist, case-insensitively", () => {
    for (const mime of READINESS_DEFAULT_MIME) {
      expect(assertMaterialMimeAllowed({ ...file, fileMime: mime })).toBe(mime);
    }
    expect(assertMaterialMimeAllowed({ ...file, fileMime: "APPLICATION/PDF" })).toBe("application/pdf");
  });

  it("refuses anything off the list, and says why", () => {
    for (const mime of ["text/html", "image/svg+xml", "application/octet-stream", "", null]) {
      expect(() => assertMaterialMimeAllowed({ ...file, fileMime: mime })).toThrowError(
        /not one this event can hand out/i,
      );
    }
  });

  it("honours a requirement that NARROWED its allowlist after the file landed", () => {
    // The check runs at read time, not upload time, precisely so this works:
    // an organizer who restricts a requirement to PDFs stops the .pptx that
    // was already uploaded from being served.
    const pdfOnly = { ...file, requirementConfig: { allowedMimeTypes: ["application/pdf"] } };
    expect(assertMaterialMimeAllowed(pdfOnly)).toBe("application/pdf");
    expect(() =>
      assertMaterialMimeAllowed({ ...pdfOnly, fileMime: "image/png" }),
    ).toThrowError(/not one this event can hand out/i);
  });
});
