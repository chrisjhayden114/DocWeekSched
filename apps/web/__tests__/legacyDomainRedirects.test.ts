/**
 * REDIR-1 / BRAND-R2 — public/_redirects sends the retired domain to the primary.
 *
 * The runbook keeps ukedl.com registered and redirecting indefinitely, so this
 * file stays load-bearing long after anyone has a reason to open it. It is also
 * the kind of file a cleanup deletes because "nothing imports it": nothing
 * does, Netlify reads it off the publish directory.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { brandTransition } from "@event-app/config";

const REDIRECTS_PATH = resolve(__dirname, "../public/_redirects");
const PRIMARY_SPLAT = "https://readyhall.com/:splat";

type Rule = { from: string; to: string; status: string };

/** Netlify's _redirects grammar: whitespace-separated, `#` comments, blanks ignored. */
function parseRules(source: string): Rule[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [from, to, status] = line.split(/\s+/);
      return { from, to, status };
    });
}

const rules = parseRules(readFileSync(REDIRECTS_PATH, "utf8"));

function ruleFrom(host: string): Rule | undefined {
  return rules.find((rule) => rule.from === `https://${host}/*`);
}

describe("REDIR-1 — legacy domain redirects", () => {
  it("covers both the apex and the www form of the retired host", () => {
    expect(ruleFrom("ukedl.com")).toBeDefined();
    expect(ruleFrom("www.ukedl.com")).toBeDefined();
  });

  it("sends each to the same path on the primary domain with a forced 301", () => {
    for (const host of ["ukedl.com", "www.ukedl.com"]) {
      const rule = ruleFrom(host);
      expect(rule?.to, host).toBe(PRIMARY_SPLAT);
      // The `!` is what beats Next.js routing; a bare 301 loses to a page that
      // still renders on the old origin.
      expect(rule?.status, host).toBe("301!");
    }
  });

  it("covers every legacy domain the transition config still allows through", () => {
    for (const domain of brandTransition.legacyWebDomains) {
      const apex = domain.replace(/^www\./, "");
      expect(ruleFrom(apex), apex).toBeDefined();
      expect(ruleFrom(`www.${apex}`), `www.${apex}`).toBeDefined();
    }
  });

  it("leaves the API host and the primary domain alone", () => {
    // api.ukedl.com is served by Render; a rule here would only shadow it if
    // the host were ever pointed at Netlify.
    expect(rules.some((rule) => rule.from.includes("api.ukedl.com"))).toBe(false);
    expect(rules.some((rule) => rule.from.includes("readyhall.com"))).toBe(false);
  });

  it("scopes every rule except the demo short links to a host, so deploy previews keep working", () => {
    const demoFrom = new Set(["/demo/presenter", "/demo/presenter-2", "/demo/attendee"]);
    for (const rule of rules) {
      if (demoFrom.has(rule.from)) continue;
      expect(rule.from, rule.from).toMatch(/^https:\/\//);
    }
  });
});

describe("DEMO-EXPLORERS-1 — short demo links", () => {
  const resetSource = readFileSync(
    resolve(__dirname, "../../../apps/api/src/lib/demoEvent/reset.ts"),
    "utf8",
  );

  function exportedToken(name: string): string {
    const match = resetSource.match(
      new RegExp(String.raw`export const ${name}\s*=\s*"([0-9a-f]{64})"`),
    );
    if (!match?.[1]) {
      throw new Error(`reset.ts does not export ${name} as a 64-hex string literal`);
    }
    return match[1];
  }

  function ruleFrom(path: string): Rule | undefined {
    return rules.find((rule) => rule.from === path);
  }

  it("redirects the three public shortcuts with a relative 302 and no force flag", () => {
    const maya = exportedToken("DEMO_PRESENTER_PORTAL_TOKEN");
    const jonas = exportedToken("DEMO_PRESENTER_PORTAL_TOKEN_2");
    expect(ruleFrom("/demo/presenter")).toEqual({
      from: "/demo/presenter",
      to: `/r/${maya}`,
      status: "302",
    });
    expect(ruleFrom("/demo/presenter-2")).toEqual({
      from: "/demo/presenter-2",
      to: `/r/${jonas}`,
      status: "302",
    });
    expect(ruleFrom("/demo/attendee")).toEqual({
      from: "/demo/attendee",
      to: "/login",
      status: "302",
    });
    for (const path of ["/demo/presenter", "/demo/presenter-2", "/demo/attendee"]) {
      expect(ruleFrom(path)?.status, path).not.toContain("!");
      expect(ruleFrom(path)?.from, path).not.toMatch(/^https:\/\//);
    }
  });
});
