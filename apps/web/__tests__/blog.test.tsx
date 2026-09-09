/**
 * @vitest-environment jsdom
 *
 * BLOG-1 — the blog loader, the rendered post, the sitemap entries, and the
 * two rules the post prose is written under (bundled copy matches the .md on
 * disk, and no em or en dashes reach it).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { brand } from "@event-app/config";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/head", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { blogPostPaths, formatPostDate, getPost, listPosts } from "../lib/blog/blogContent";
import { BLOG_SOURCE } from "../lib/blog/blogSource";
import { parseFrontMatter } from "../lib/help/articles";
import BlogPostPage, {
  getStaticPaths as postPaths,
  getStaticProps as postProps,
} from "../pages/blog/[slug]";
import BlogIndexPage from "../pages/blog/index";
import { getServerSideProps as sitemapProps } from "../pages/sitemap.xml";

const CONTENT_DIR = join(__dirname, "../content/blog");
const SLUG = "stop-chasing-conference-speakers";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

describe("blog loader", () => {
  it("returns the first post with the expected slug, title, and date", () => {
    const post = getPost(SLUG);
    expect(post).not.toBeNull();
    expect(post!.slug).toBe(SLUG);
    expect(post!.title).toBe("Stop chasing conference speakers");
    expect(post!.date).toBe("2026-09-09");
    expect(post!.dateLabel).toBe("September 9, 2026");
    expect(post!.author).toBe("Chris Hayden, EdD");
    expect(post!.description).toContain("chasing presenters for slides");
  });

  it("lists posts newest first", () => {
    const posts = listPosts();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.map((p) => p.slug)).toContain(SLUG);
    const dates = posts.map((p) => p.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(blogPostPaths()).toContain(`/blog/${SLUG}`);
  });

  it("renders the body with the help renderer and without repeating title or byline", () => {
    const post = getPost(SLUG)!;
    expect(post.bodyMarkdown.startsWith("Every conference organizer")).toBe(true);
    expect(post.bodyMarkdown).not.toContain("# Stop chasing conference speakers");
    expect(post.bodyHtml).toContain("<h2>Why the chase happens</h2>");
    expect(post.bodyHtml).toContain('<a href="https://readyhall.com">Readyhall</a>');
    expect(post.bodyHtml).toContain("<em>");
    expect(post.bodyHtml).toContain("<hr />");
  });

  it("refuses an unknown or traversing slug", () => {
    expect(getPost("no-such-post")).toBeNull();
    expect(getPost("../help/getting-started")).toBeNull();
    expect(getPost("")).toBeNull();
  });

  it("formats a front-matter date in UTC, so the day never shifts", () => {
    expect(formatPostDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatPostDate("not-a-date")).toBe("not-a-date");
  });
});

describe("bundled blog content matches content/blog/*.md", () => {
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));

  it("covers exactly the markdown files on disk", () => {
    expect(Object.keys(BLOG_SOURCE).sort()).toEqual(files.map((f) => f.replace(/\.md$/, "")).sort());
  });

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");

    it(`"${slug}" is byte-identical to its markdown file`, () => {
      expect(BLOG_SOURCE[slug]).toBe(readFileSync(join(CONTENT_DIR, file), "utf8"));
    });

    it(`"${slug}" declares a front-matter slug that matches its file name`, () => {
      expect(parseFrontMatter(readFileSync(join(CONTENT_DIR, file), "utf8")).meta.slug).toBe(slug);
    });
  }

  it("no post uses an em dash or an en dash", () => {
    for (const file of files) {
      const raw = readFileSync(join(CONTENT_DIR, file), "utf8");
      const offenders = raw
        .split("\n")
        .map((text, index) => ({ line: index + 1, text }))
        .filter(({ text }) => /[\u2014\u2013]/.test(text));
      const report = offenders.map((o) => `${file}:${o.line} — ${o.text.trim()}`).join("\n");
      expect(offenders, `em/en dash in blog prose:\n${report}`).toEqual([]);
    }
  });
});

describe("/blog/[slug] — the published post", () => {
  it("is statically generated for every post", async () => {
    const paths = await postPaths({});
    expect(paths).toMatchObject({ fallback: false });
    expect("paths" in paths ? paths.paths : []).toContainEqual({ params: { slug: SLUG } });

    const result = await postProps({ params: { slug: SLUG } } as never);
    expect("props" in result && result.props.post.slug).toBe(SLUG);
  });

  it("renders the H1, the byline, and the closing CTA links", () => {
    render(<BlogPostPage post={getPost(SLUG)!} />);

    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("Stop chasing conference speakers");
    expect(container.textContent).toContain("By Chris Hayden, EdD, September 9, 2026");

    const readiness = [...container.querySelectorAll("a")].find(
      (a) => a.textContent?.trim() === "See Speaker Readiness",
    );
    expect(readiness?.getAttribute("href")).toBe("/speaker-readiness");

    const demo = [...container.querySelectorAll("a")].find(
      (a) => a.textContent?.trim() === "Try the live demo",
    );
    expect(demo?.getAttribute("href")).toBe(`/e/${brand.demoEventSlug}`);
    expect(demo?.getAttribute("href")).toBe("/e/demo");
  });

  it("carries the post title, canonical URL, and Article JSON-LD", () => {
    render(<BlogPostPage post={getPost(SLUG)!} />);

    expect(container.querySelector("title")?.textContent).toBe(
      "Stop chasing conference speakers | Readyhall blog",
    );
    expect(container.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://readyhall.com/blog/stop-chasing-conference-speakers",
    );
    expect(container.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe(
      "summary_large_image",
    );
    expect(container.querySelector('meta[property="og:image"]')?.getAttribute("content")).toContain(
      brand.assets.ogImage,
    );

    const jsonLd = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')?.textContent ?? "{}",
    );
    expect(jsonLd["@type"]).toBe("Article");
    expect(jsonLd.headline).toBe("Stop chasing conference speakers");
    expect(jsonLd.datePublished).toBe("2026-09-09");
    expect(jsonLd.author).toEqual({ "@type": "Person", name: "Chris Hayden" });
    expect(jsonLd.publisher.name).toBe("Readyhall");
    expect(jsonLd.publisher.logo.url).toContain("/brand/logo-256.png");
    expect(jsonLd.mainEntityOfPage["@id"]).toBe(
      "https://readyhall.com/blog/stop-chasing-conference-speakers",
    );
  });
});

describe("/blog — the index", () => {
  it("leads with the eyebrow, headline, and standfirst, then a card per post", () => {
    render(<BlogIndexPage posts={listPosts()} />);

    expect(container.querySelector(".mkt-eyebrow")?.textContent).toBe("Blog");
    expect(container.querySelector("h1")?.textContent).toBe("Notes on running calmer events");
    expect(container.textContent).toContain("Field notes from an organizer who builds the tool.");

    const cards = container.querySelectorAll(".mkt-blog-card");
    expect(cards.length).toBe(listPosts().length);
    const card = cards[0]!;
    expect(card.querySelector(".mkt-blog-card-title")?.textContent).toBe(
      "Stop chasing conference speakers",
    );
    expect(card.querySelector(".mkt-blog-card-date")?.textContent).toBe("September 9, 2026");
    expect(card.textContent).toContain("chasing presenters for slides");
    expect(card.querySelector<HTMLAnchorElement>(".mkt-blog-card-more a")?.getAttribute("href")).toBe(
      `/blog/${SLUG}`,
    );
  });

  it("is reachable from the footer Resources column and the help hub", () => {
    render(<BlogIndexPage posts={listPosts()} />);
    const resources = container.querySelector('nav[aria-label="Resources"]');
    const links = [...(resources?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(links).toContain("/blog");
    expect(links.indexOf("/blog")).toBe(links.indexOf("/help") + 1);

    const helpIndex = readFileSync(join(__dirname, "../pages/help/index.tsx"), "utf8");
    expect(helpIndex).toContain('Also: <Link href="/blog">the blog</Link>');
  });
});

describe("sitemap.xml", () => {
  it("lists /blog and every post URL, with lastmod from the post date", async () => {
    const chunks: string[] = [];
    const res = {
      setHeader: vi.fn(),
      write: (chunk: string) => chunks.push(chunk),
      end: vi.fn(),
    };
    await sitemapProps({ res } as never);
    const xml = chunks.join("");

    expect(xml).toContain("<loc>https://readyhall.com/blog</loc>");
    expect(xml).toContain(`<loc>https://readyhall.com/blog/${SLUG}</loc>`);
    expect(xml).toContain(
      `<loc>https://readyhall.com/blog/${SLUG}</loc>\n    <lastmod>2026-09-09</lastmod>`,
    );
    // The pages that were already listed stay listed.
    expect(xml).toContain("<loc>https://readyhall.com/help</loc>");
    expect(xml).toContain("<loc>https://readyhall.com/speaker-readiness</loc>");
  });
});
