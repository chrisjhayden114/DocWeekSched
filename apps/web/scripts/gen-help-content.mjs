/**
 * Regenerates lib/help/helpContent.ts from content/help/*.md so the two stay
 * byte-identical (see __tests__/helpContent.test.ts). Run from apps/web.
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const CONTENT_DIR = join(process.cwd(), "content/help");
const OUT = join(process.cwd(), "lib/help/helpContent.ts");

const HEADER = `/**
 * Help article markdown, bundled into the server build.
 *
 * WHY: \`content/help/*.md\` is not traced into the serverless bundle on
 * Netlify, so runtime \`fs\` reads silently returned nothing and /help rendered
 * empty in production. The markdown files remain the human-editable source;
 * a test asserts this module matches them byte-for-byte (body content).
 *
 * To update an article: edit the .md file, then run \`npm run gen:help\`.
 */

export const HELP_SOURCE: Record<string, string> = {
`;

function escapeTemplate(raw) {
  return raw.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function keyFor(slug) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(slug) ? slug : JSON.stringify(slug);
}

function orderOf(raw) {
  const m = /^order:\s*(\d+)\s*$/m.exec(raw);
  return m ? Number(m[1]) : 100;
}

const entries = readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const slug = f.replace(/\.md$/, "");
    const raw = readFileSync(join(CONTENT_DIR, f), "utf8");
    return { slug, raw, order: orderOf(raw) };
  })
  .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

const body = entries
  .map(({ slug, raw }) => `  ${keyFor(slug)}: \`${escapeTemplate(raw)}\`,\n`)
  .join("");

writeFileSync(OUT, `${HEADER}${body}};\n`, "utf8");
console.log(`Wrote ${entries.length} articles to lib/help/helpContent.ts`);
