/**
 * RUNBOOK-FIX — stop a third accidental truncation of RUNBOOK.md from shipping.
 *
 * Two unrelated edits already chopped everything after §10 (lost §12 DB suites,
 * §13 billing go-live, §14 Neon password rotation). Listing every required
 * heading by title means a cut file fails CI instead of silently losing ops
 * procedure. Numbering jumps 10 → 12: the 90c101a renumber that cleared
 * duplicate §9/§10 never assigned §11.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RUNBOOK = readFileSync(join(__dirname, "..", "..", "..", "RUNBOOK.md"), "utf8");

const REQUIRED_SECTION_HEADINGS = [
  "## 1. Architecture at a glance",
  "## 2. Backups (Neon)",
  "## 3. Restore drill (do this before launch, then per S2 cadence)",
  "## 4. Deploy",
  "## 5. Background jobs & kill-switch map",
  "## 6. Destructive-DB guard (`apps/api/src/lib/destructiveGuard.ts`)",
  "## 7. Rate limiting — single-instance assumption",
  "## 8. Provider account list",
  '## 9. "Someone else takes over" (skeleton — complete before launch)',
  "## 10. Production environment reference",
  "## 12. Running the database test suites",
  "## 13. Billing go-live (test mode → live mode)",
  "## 14. Rotating a Neon database password (causes downtime if done wrong)",
] as const;

describe("RUNBOOK.md section headings", () => {
  const headings = [...RUNBOOK.matchAll(/^## \d+\. .+$/gm)].map((m) => m[0]);

  it("has every required section heading by title (truncation fails CI)", () => {
    for (const heading of REQUIRED_SECTION_HEADINGS) {
      expect(RUNBOOK).toContain(heading);
    }
  });

  it("section count matches the required 1–14 list (13 numbered headings; no §11)", () => {
    expect(REQUIRED_SECTION_HEADINGS).toHaveLength(13);
    expect(headings).toHaveLength(REQUIRED_SECTION_HEADINGS.length);
    expect(headings).toEqual([...REQUIRED_SECTION_HEADINGS]);
  });
});
