/**
 * Phase 6 — entry redirect contract + forbidden brand literals.
 */

import { describe, expect, it } from "vitest";
import { brand } from "@event-app/config";
import { homeEventQueryRedirect, loginPathWithEvent } from "@event-app/shared";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

describe("Phase 6 entry redirect contract", () => {
  it("/?event=x → /login?event=x (temporary redirect target)", () => {
    expect(homeEventQueryRedirect("my-conf")).toBe("/login?event=my-conf");
    expect(homeEventQueryRedirect("a b")).toBe(`/login?event=${encodeURIComponent("a b")}`);
    expect(homeEventQueryRedirect(undefined)).toBeNull();
    expect(homeEventQueryRedirect("")).toBeNull();
  });

  it("join token flow destinations use /login?event=<slug>", () => {
    expect(loginPathWithEvent("demo")).toBe("/login?event=demo");
    expect(loginPathWithEvent("annual-2026")).toBe("/login?event=annual-2026");
  });
});

describe("forbidden brand literals", () => {
  const ROOT = join(__dirname, "../../../..");
  const SCAN_ROOTS = ["apps/api/src", "apps/web", "packages/config/src", "packages/shared/src"];
  const ALLOW_PATH_SUBSTR = [
    // Legacy dual-read keys live only in config
    "packages/config/src/index.ts",
    // Tests that assert the forbidden strings / legacy keys
    "apps/api/src/__tests__/phase6.marketing.unit.test.ts",
    "apps/api/src/__tests__/clientStorage.unit.test.ts",
  ];
  const EXT = new Set([".ts", ".tsx", ".js", ".css", ".json", ".webmanifest", ".mdc"]);

  function walk(dir: string, out: string[] = []): string[] {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".next" || name === "dist") continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, out);
      else if (EXT.has(name.slice(name.lastIndexOf(".")))) out.push(full);
    }
    return out;
  }

  it("does not hardcode EventPilot outside allowlisted legacy config keys", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = join(ROOT, root);
      for (const file of walk(abs)) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        const text = readFileSync(file, "utf8");
        const lines = text.split("\n");
        lines.forEach((line, idx) => {
          if (!/EventPilot|eventPilot/.test(line)) return;
          if (ALLOW_PATH_SUBSTR.some((a) => rel.endsWith(a) || rel.includes(a))) {
            return; // entire allowlisted files may mention legacy keys / the ban itself
          }
          offenders.push(`${rel}:${idx + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("brand config exposes Colloquium working name and demo slug", () => {
    expect(brand.productName).toBe("Colloquium");
    expect(brand.demoEventSlug).toBe("demo");
    expect(brand.domain).toBeTruthy();
    expect(brand.primaryUrl).toContain(brand.domain);
  });
});
