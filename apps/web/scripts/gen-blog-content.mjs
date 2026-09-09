/**
 * Regenerates lib/blog/blogSource.ts from content/blog/*.md so the two stay
 * byte-identical (see __tests__/blog.test.tsx). Run from apps/web.
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const CONTENT_DIR = join(process.cwd(), "content/blog");
const OUT = join(process.cwd(), "lib/blog/blogSource.ts");

const HEADER = `/**
 * Blog post markdown, bundled into the server build.
 *
 * WHY: \`content/blog/*.md\` is not traced into the serverless bundle on
 * Netlify, so runtime \`fs\` reads silently return nothing — the same failure
 * that once rendered /help empty (see lib/help/helpContent.ts). The markdown
 * files remain the human-editable source; a test asserts this module matches
 * them byte-for-byte.
 *
 * To publish or edit a post: edit the .md file, then run \`npm run gen:blog\`.
 */

export const BLOG_SOURCE: Record<string, string> = {
`;

function escapeTemplate(raw) {
  return raw.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function keyFor(slug) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(slug) ? slug : JSON.stringify(slug);
}

function dateOf(raw) {
  const m = /^date:\s*(.+?)\s*$/m.exec(raw);
  return m ? m[1].replace(/^["']|["']$/g, "") : "";
}

// Newest first, matching listPosts() — the order a reader sees on /blog.
const entries = readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const slug = f.replace(/\.md$/, "");
    const raw = readFileSync(join(CONTENT_DIR, f), "utf8");
    return { slug, raw, date: dateOf(raw) };
  })
  .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));

const body = entries
  .map(({ slug, raw }) => `  ${keyFor(slug)}: \`${escapeTemplate(raw)}\`,\n`)
  .join("");

writeFileSync(OUT, `${HEADER}${body}};\n`, "utf8");
console.log(`Wrote ${entries.length} posts to lib/blog/blogSource.ts`);
