/**
 * BRAND-R1 — the <head> icon set and the files it points at.
 *
 * The bug this exists for is a link that survives an asset move: a
 * `<link rel="icon">` to a path that no longer ships still renders, still
 * validates, and quietly serves a 404 to every tab. So every icon reference in
 * _app.tsx and in the manifest handler is resolved against public/ on disk.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { brand } from "@event-app/config";

const WEB_ROOT = resolve(__dirname, "..");
const PUBLIC_DIR = resolve(WEB_ROOT, "public");
const APP_SRC = readFileSync(resolve(WEB_ROOT, "pages", "_app.tsx"), "utf8");
const MANIFEST_SRC = readFileSync(resolve(WEB_ROOT, "pages", "api", "manifest.ts"), "utf8");

/** Every `href`/`src`/`src:` value in a source file that looks like a public path. */
function publicPaths(source: string): string[] {
  return [...source.matchAll(/["'](\/[A-Za-z0-9._/-]+\.(?:png|ico|jpg|svg|webmanifest))["']/g)].map(
    (m) => m[1]!,
  );
}

function shipped(publicPath: string): boolean {
  return existsSync(resolve(PUBLIC_DIR, `.${publicPath}`));
}

describe("BRAND-R1 — head icon links", () => {
  it("_app.tsx links the favicon, the PNG sizes, apple-touch, and the manifest", () => {
    expect(APP_SRC).toContain('<link rel="manifest" href="/api/manifest" />');
    expect(APP_SRC).toContain('href="/favicon.ico"');
    expect(APP_SRC).toMatch(/rel="icon"[^>]*sizes="16x16"[^>]*href="\/icons\/favicon-16\.png"/);
    expect(APP_SRC).toMatch(/rel="icon"[^>]*sizes="32x32"[^>]*href="\/icons\/favicon-32\.png"/);
    expect(APP_SRC).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
  });

  it("every icon path in the head and the manifest is a file that ships", () => {
    const referenced = [...new Set([...publicPaths(APP_SRC), ...publicPaths(MANIFEST_SRC)])];
    // A regex that stops matching is the quiet failure here, not a missing file.
    expect(referenced.length).toBeGreaterThanOrEqual(5);
    for (const path of referenced) {
      expect(shipped(path), `${path} is linked but not in public/`).toBe(true);
    }
  });

  it("the manifest still declares both PWA install icons", () => {
    expect(MANIFEST_SRC).toContain('src: "/icons/icon-192.png"');
    expect(MANIFEST_SRC).toContain('src: "/icons/icon-512.png"');
  });
});

describe("BRAND-R1 — brand assets", () => {
  it("the logo and the OG card are shipped at the paths config advertises", () => {
    expect(shipped(brand.assets.logo), brand.assets.logo).toBe(true);
    expect(shipped(brand.assets.ogImage), brand.assets.ogImage).toBe(true);
  });

  it("the mark is rendered from the config path, not a literal", () => {
    const logo = readFileSync(resolve(WEB_ROOT, "components", "BrandLogo.tsx"), "utf8");
    expect(logo).toContain("brand.assets.logo");
  });

  it("brand-next is gone — the staging folder is not a second source of truth", () => {
    expect(existsSync(resolve(PUBLIC_DIR, "brand-next"))).toBe(false);
  });

  it("the service worker precaches only icons that exist", () => {
    const sw = readFileSync(resolve(PUBLIC_DIR, "sw.js"), "utf8");
    // Only the PRECACHE list: elsewhere sw.js names routes (/api/manifest,
    // /manifest.webmanifest) that are served by Next, not files in public/.
    const precache = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw)?.[1] ?? "";
    const icons = publicPaths(precache);
    expect(icons.length).toBeGreaterThanOrEqual(3);
    for (const path of icons) {
      expect(shipped(path), `${path} is precached but not in public/`).toBe(true);
    }
  });
});
