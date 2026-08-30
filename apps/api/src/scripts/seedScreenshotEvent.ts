/**
 * Seed the Feature Guide screenshot fixture (idempotent, destructive by slug).
 *
 * Usage: npx tsx src/scripts/seedScreenshotEvent.ts --out ../../screenshot-seed.json
 *
 * Intended for the throwaway Postgres in .github/workflows/screenshots.yml or a
 * local container. `assertDestructiveAllowed` refuses any DATABASE_URL that does
 * not look local/test, and nothing in this path overrides it (RUNBOOK.md §6).
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import dotenv from "dotenv";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

import { assertDestructiveAllowed } from "../lib/destructiveGuard";
import { seedScreenshotData } from "../lib/screenshotSeed";

function outPathFromArgv(): string | null {
  const i = process.argv.indexOf("--out");
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (!value) throw new Error("--out needs a file path");
  return resolve(process.cwd(), value);
}

async function main() {
  assertDestructiveAllowed("seed-script");
  const result = await seedScreenshotData();
  const outPath = outPathFromArgv();
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  console.log(
    JSON.stringify(
      { ok: true, out: outPath, event: `/e/${result.tokens.slug}`, tokens: Object.keys(result.tokens) },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../lib/db");
    await prisma.$disconnect();
  });
