/**
 * ORG-1 — the request shape of PUT /organizations/:orgId, and the two rules the
 * route leans on entirely.
 *
 * Rule one is the patchFields contract: a caller that says nothing about a
 * field must not erase it. The name is the deliberate exception — the column is
 * NOT NULL and a nameless organization is broken everywhere it appears, so an
 * emptied name is a 400 rather than a clear.
 *
 * Rule two is that the organization's logo is a read-time FALLBACK, never a
 * write: an event's own logo always wins, and an event that never chose one
 * borrows without owning.
 */

import { describe, expect, it } from "vitest";
import {
  ORG_SUPPORT_EMAIL_MESSAGE,
  ORG_WEBSITE_URL_MESSAGE,
  canEditOrgIdentity,
  eventLogoWithOrgFallback,
  normalizeOrgSupportEmail,
  normalizeOrgWebsiteUrl,
  orgSupportMailto,
} from "@event-app/shared";
import { orgIdentityUpdateData, orgUpdateSchema } from "../lib/orgIdentity";

/** Parse like the route does: zod first, so absent keys are actually absent. */
function update(body: unknown) {
  const parsed = orgUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return { zodFailed: true as const, issues: parsed.error.issues.map((i) => i.message) };
  }
  return { zodFailed: false as const, result: orgIdentityUpdateData(parsed.data) };
}

/** The route's real path: a JSON string, so "not sent" cannot be faked. */
function updateFromJson(json: string) {
  return update(JSON.parse(json));
}

describe("normalizeOrgWebsiteUrl", () => {
  it("takes a bare domain at its word and gives it https", () => {
    expect(normalizeOrgWebsiteUrl("northbridge.edu")).toEqual({
      ok: true,
      value: "https://northbridge.edu",
    });
  });

  it("keeps an address that already has a scheme, untouched", () => {
    expect(normalizeOrgWebsiteUrl("  http://northbridge.edu/events  ")).toEqual({
      ok: true,
      value: "http://northbridge.edu/events",
    });
  });

  it("treats blank as no website rather than an error", () => {
    for (const blank of ["", "   ", null, undefined]) {
      expect(normalizeOrgWebsiteUrl(blank)).toEqual({ ok: true, value: null });
    }
  });

  it("refuses anything that is not http(s) — this renders as a public link", () => {
    for (const hostile of ["javascript:alert(1)", "data:text/html,<script>", "ftp://files.example.com"]) {
      expect(normalizeOrgWebsiteUrl(hostile), hostile).toEqual({
        ok: false,
        error: ORG_WEBSITE_URL_MESSAGE,
      });
    }
  });

  it("refuses a hostname that cannot be a domain", () => {
    expect(normalizeOrgWebsiteUrl("not a url").ok).toBe(false);
    // A bare word would otherwise become https://localhost-style nonsense.
    expect(normalizeOrgWebsiteUrl("northbridge").ok).toBe(false);
  });
});

describe("normalizeOrgSupportEmail", () => {
  it("stores one address, lowercased and trimmed", () => {
    expect(normalizeOrgSupportEmail("  Events@Northbridge.EDU ")).toEqual({
      ok: true,
      value: "events@northbridge.edu",
    });
  });

  it("treats blank as no contact address", () => {
    for (const blank of ["", "  ", null, undefined]) {
      expect(normalizeOrgSupportEmail(blank)).toEqual({ ok: true, value: null });
    }
  });

  it("refuses a non-address, including a list of them", () => {
    for (const bad of ["events", "events@northbridge", "a@b.com, c@d.com", "two @ signs@@x.com"]) {
      expect(normalizeOrgSupportEmail(bad), bad).toEqual({
        ok: false,
        error: ORG_SUPPORT_EMAIL_MESSAGE,
      });
    }
  });

  it("mints a mailto only when there is an address", () => {
    expect(orgSupportMailto("events@northbridge.edu")).toBe("mailto:events@northbridge.edu");
    expect(orgSupportMailto("  ")).toBeNull();
    expect(orgSupportMailto(null)).toBeNull();
  });
});

describe("PUT /organizations/:orgId — patchFields semantics", () => {
  it("a name-only save touches nothing else", () => {
    const out = updateFromJson('{"name":"Northbridge Schools"}');
    expect(out.zodFailed).toBe(false);
    expect(out.zodFailed ? null : out.result).toEqual({
      ok: true,
      data: { name: "Northbridge Schools" },
    });
  });

  it("an empty body is a legal no-op, not a wipe", () => {
    const out = updateFromJson("{}");
    expect(out.zodFailed ? null : out.result).toEqual({ ok: true, data: {} });
  });

  it("an explicit null clears exactly the field it names", () => {
    const out = updateFromJson('{"websiteUrl":null,"logoUrl":null}');
    expect(out.zodFailed ? null : out.result).toEqual({
      ok: true,
      data: { websiteUrl: null, logoUrl: null },
    });
  });

  it("an emptied text box clears too — a wiped field means no value", () => {
    const out = updateFromJson(
      '{"websiteUrl":"","supportEmail":"   ","logoUrl":"","description":"  "}',
    );
    expect(out.zodFailed ? null : out.result).toEqual({
      ok: true,
      data: { websiteUrl: null, supportEmail: null, logoUrl: null, description: null },
    });
  });

  it("normalizes the website and support email on the way in", () => {
    const out = updateFromJson('{"websiteUrl":"northbridge.edu","supportEmail":"Events@NB.edu"}');
    expect(out.zodFailed ? null : out.result).toEqual({
      ok: true,
      data: { websiteUrl: "https://northbridge.edu", supportEmail: "events@nb.edu" },
    });
  });

  it("stores the description trimmed, and keeps its newlines", () => {
    const out = updateFromJson('{"description":"  Two lines\\nof notes  "}');
    expect(out.zodFailed ? null : out.result).toEqual({
      ok: true,
      data: { description: "Two lines\nof notes" },
    });
  });

  it("rejects a blank name instead of storing one — a clear it can never be", () => {
    for (const blank of ['{"name":""}', '{"name":"   "}']) {
      const out = updateFromJson(blank);
      expect(out.zodFailed).toBe(false);
      expect(out.zodFailed ? null : out.result.ok).toBe(false);
    }
  });

  it("trims a real name", () => {
    const out = updateFromJson('{"name":"  Northbridge  "}');
    expect(out.zodFailed ? null : out.result).toEqual({ ok: true, data: { name: "Northbridge" } });
  });

  it("400s on a hostile website or a broken email, keyed to the field", () => {
    expect(update({ websiteUrl: "javascript:alert(1)" }).issues).toEqual([ORG_WEBSITE_URL_MESSAGE]);
    expect(update({ supportEmail: "not-an-address" }).issues).toEqual([ORG_SUPPORT_EMAIL_MESSAGE]);
  });

  it("cannot reach slug, plan, or any billing column, whatever the body carries", () => {
    const out = update({
      name: "Northbridge",
      slug: "somebody-elses-slug",
      plan: "PRO",
      eventAllowance: 9999,
      billingCustomerId: "cus_hijack",
    });
    expect(out.zodFailed ? null : out.result).toEqual({ ok: true, data: { name: "Northbridge" } });
  });
});

describe("the org logo is a fallback, never a write", () => {
  const ORG = "https://cdn.example.com/org-crest.png";
  const EVENT = "https://cdn.example.com/event-mark.png";

  it("the event's own logo always wins", () => {
    expect(eventLogoWithOrgFallback(EVENT, ORG)).toBe(EVENT);
  });

  it("an event with no logo borrows the organization's", () => {
    expect(eventLogoWithOrgFallback(null, ORG)).toBe(ORG);
    expect(eventLogoWithOrgFallback("   ", ORG)).toBe(ORG);
  });

  it("neither one set means no logo at all — never a platform stand-in", () => {
    expect(eventLogoWithOrgFallback(null, null)).toBeNull();
    expect(eventLogoWithOrgFallback("", "  ")).toBeNull();
    expect(eventLogoWithOrgFallback(undefined, undefined)).toBeNull();
  });
});

describe("who may edit the organization", () => {
  it("owners and admins may; staff may look", () => {
    expect(canEditOrgIdentity("OWNER")).toBe(true);
    expect(canEditOrgIdentity("ADMIN")).toBe(true);
    expect(canEditOrgIdentity("STAFF")).toBe(false);
  });

  it("an unknown or missing role never may", () => {
    expect(canEditOrgIdentity(null)).toBe(false);
    expect(canEditOrgIdentity(undefined)).toBe(false);
    expect(canEditOrgIdentity("MEMBER")).toBe(false);
  });
});
