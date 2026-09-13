/**
 * READY-SHARE-1 — the requirement `config` contract.
 *
 * The organizer's requirement editor writes one key, `shareByDefault`, into a
 * blob that also carries the Speaker pack's `deck` flag, a `multi_select`'s
 * `options`, and any hand-set `maxBytes` / `allowedMimeTypes`. These tests
 * pin the two rules that keep those writers out of each other's way: the
 * PATCH merges rather than replaces, and the one typed key must be a real
 * boolean because `sharesOnApproval` ignores anything else.
 */

import { describe, expect, it } from "vitest";
import {
  mergeRequirementConfig,
  requirementConfigSchema,
} from "../lib/readiness/requirementConfig";

describe("mergeRequirementConfig", () => {
  it("keeps the keys the caller said nothing about", () => {
    // The editor sends only shareByDefault when an organizer saves a label
    // edit. Replacing here would drop a deck's upload rules.
    expect(
      mergeRequirementConfig(
        { deck: true, maxBytes: 50_000_000, allowedMimeTypes: ["application/pdf"] },
        { shareByDefault: true },
      ),
    ).toEqual({
      deck: true,
      maxBytes: 50_000_000,
      allowedMimeTypes: ["application/pdf"],
      shareByDefault: true,
    });
  });

  it("lets the patch win on a key both sides carry, in both directions", () => {
    expect(mergeRequirementConfig({ shareByDefault: true }, { shareByDefault: false })).toEqual({
      shareByDefault: false,
    });
    expect(mergeRequirementConfig({ shareByDefault: false }, { shareByDefault: true })).toEqual({
      shareByDefault: true,
    });
  });

  it("treats anything that is not an object as no existing config", () => {
    // Prisma hands back Json, so null is normal and a hand-edited row could
    // hold a scalar or an array. None of them may throw or leak through.
    for (const existing of [null, undefined, "{}", 7, true, ["deck"]]) {
      expect(mergeRequirementConfig(existing, { shareByDefault: true })).toEqual({
        shareByDefault: true,
      });
    }
  });

  it("changes nothing on an empty patch, and never mutates the stored object", () => {
    const existing = { deck: true };
    expect(mergeRequirementConfig(existing, {})).toEqual({ deck: true });
    const merged = mergeRequirementConfig(existing, { shareByDefault: false });
    merged.deck = false;
    expect(existing.deck).toBe(true);
  });
});

describe("requirementConfigSchema", () => {
  it("accepts the editor's key and passes every other key through untouched", () => {
    expect(requirementConfigSchema.parse({ shareByDefault: true })).toEqual({
      shareByDefault: true,
    });
    expect(requirementConfigSchema.parse({})).toEqual({});
    const withOthers = { deck: true, options: ["a"], maxBytes: 1024, shareByDefault: false };
    expect(requirementConfigSchema.parse(withOthers)).toEqual(withOthers);
  });

  it("rejects a shareByDefault that is not a boolean", () => {
    // sharesOnApproval honours a real boolean only, so a stringly-typed
    // "true" has to fail as a 400 rather than persist as silently off.
    for (const bad of ["true", 1, null, {}]) {
      expect(requirementConfigSchema.safeParse({ shareByDefault: bad }).success).toBe(false);
    }
  });
});
