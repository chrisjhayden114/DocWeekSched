/**
 * Markdown-driven help articles (Phase 6 seed; S1 expands search/assistant).
 * Front matter: title, description, order (optional).
 */

import fs from "fs";
import path from "path";
import { brand } from "@event-app/config";

export type HelpArticleMeta = {
  slug: string;
  title: string;
  description: string;
  order: number;
};

export type HelpArticle = HelpArticleMeta & {
  bodyHtml: string;
  bodyMarkdown: string;
};

const CONTENT_DIR = path.join(__dirname, "../../content/help");

function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) {
    return { meta: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, "");
  const meta: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    meta[key] = value;
  }
  return { meta, body };
}

/** Minimal markdown → HTML for help articles (headings, lists, links, paragraphs, code). */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  const flushLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  for (const line of lines) {
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      flushLists();
      const level = h[1]!.length;
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      continue;
    }
    const ul = /^[-*]\s+(.+)$/.exec(line);
    if (ul) {
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inline(ul[1]!)}</li>`);
      continue;
    }
    const ol = /^\d+\.\s+(.+)$/.exec(line);
    if (ol) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inline(ol[1]!)}</li>`);
      continue;
    }
    if (!line.trim()) {
      flushLists();
      continue;
    }
    flushLists();
    out.push(`<p>${inline(line)}</p>`);
  }
  flushLists();
  return out.join("\n");
}

export function listHelpArticles(): HelpArticleMeta[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));
  const articles: HelpArticleMeta[] = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
    const { meta } = parseFrontMatter(raw);
    articles.push({
      slug,
      title: meta.title || slug,
      description: meta.description || `${brand.productName} help`,
      order: Number(meta.order || 100),
    });
  }
  return articles.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

export function getHelpArticle(slug: string): HelpArticle | null {
  const safe = slug.replace(/[^a-z0-9-]/gi, "");
  if (!safe || safe !== slug) return null;
  const file = path.join(CONTENT_DIR, `${safe}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const { meta, body } = parseFrontMatter(raw);
  return {
    slug: safe,
    title: meta.title || safe,
    description: meta.description || `${brand.productName} help`,
    order: Number(meta.order || 100),
    bodyMarkdown: body,
    bodyHtml: markdownToHtml(body),
  };
}

export function helpArticlePaths(): string[] {
  return listHelpArticles().map((a) => `/help/${a.slug}`);
}
