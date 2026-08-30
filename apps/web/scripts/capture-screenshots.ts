/**
 * SHOT-CI — drives a real browser over the seeded Northbridge events and saves
 * one screenshot per Feature Guide entry.
 *
 * Usage (from apps/web, with the API and a production `next start` both up):
 *   npx tsx scripts/capture-screenshots.ts --seed ../../screenshot-seed.json
 *
 * Options:
 *   --seed <path>   JSON written by `npm run seed:screenshots --workspace @event-app/api`
 *   --base <url>    web origin (default http://localhost:3000)
 *   --out <dir>     output directory (default public/feature-guide/auto)
 *   --only <keys>   comma-separated feature keys, for debugging one shot
 *
 * Every shot is clipped to SCREENSHOT_WIDTH so the hover cards, which crop the
 * art slot to a fixed height, cannot end up with wildly different scales.
 *
 * A shot that throws is reported, not fatal: the run keeps going and only exits
 * non-zero below SCREENSHOT_MIN_PASS_RATIO, so one broken surface cannot stop
 * the workflow from committing every image that did come out.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { FeatureKey } from "@event-app/shared";
import {
  SCREENSHOT_MANIFEST,
  SCREENSHOT_MAX_HEIGHT,
  SCREENSHOT_MIN_HEIGHT,
  SCREENSHOT_MIN_PASS_RATIO,
  SCREENSHOT_VIEWPORT,
  SCREENSHOT_WIDTH,
  captureRunPassed,
  eligibleScreenshotKeys,
  tokensInPath,
  type FeatureShot,
} from "../screenshot-manifest";

type SeedFile = {
  password: string;
  organizerEmail: string;
  attendeeEmail: string;
  tokens: Record<string, string>;
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value) throw new Error(`--${name} needs a value`);
  return value;
}

function optionalArg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

function interpolate(path: string, tokens: Record<string, string>): string {
  for (const token of tokensInPath(path)) {
    if (!tokens[token]) {
      throw new Error(
        `Manifest path "${path}" wants {${token}} but the seed did not provide it. ` +
          `Seed tokens: ${Object.keys(tokens).join(", ")}`,
      );
    }
  }
  return path.replace(/\{(\w+)\}/g, (_, token: string) => tokens[token]!);
}

async function signIn(page: Page, base: string, email: string, password: string): Promise<void> {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click('form button[type="submit"]');
  // Auth is cookie-based; the redirect off /login is the signal it took.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/** Attendee surfaces resolve their event from localStorage, not the URL. */
async function setActiveEvent(page: Page, eventId: string): Promise<void> {
  await page.evaluate((id) => window.localStorage.setItem("activeEventId", id), eventId);
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // Skeletons unmount a tick after their fetch resolves.
  await page.waitForTimeout(600);
}

async function capture(page: Page, shot: FeatureShot, outPath: string): Promise<void> {
  const target = page.locator(shot.selector).first();
  await target.waitFor({ state: "visible", timeout: 30_000 });
  await target.scrollIntoViewIfNeeded();
  await settle(page);

  const box = await target.boundingBox();
  if (!box) throw new Error(`"${shot.selector}" has no bounding box (not rendered?)`);

  const page_ = await page.evaluate(() => ({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));

  // boundingBox is viewport-relative; clip is document-relative.
  const width = Math.min(SCREENSHOT_WIDTH, page_.width);
  const height = Math.round(
    Math.min(SCREENSHOT_MAX_HEIGHT, Math.max(SCREENSHOT_MIN_HEIGHT, box.height)),
  );
  const x = Math.max(0, Math.min(box.x + page_.scrollX, page_.width - width));
  const y = Math.max(0, Math.min(box.y + page_.scrollY, Math.max(0, page_.height - height)));

  await page.screenshot({
    path: outPath,
    clip: { x, y, width, height },
    fullPage: true,
    animations: "disabled",
    scale: "css",
  });
}

async function contextFor(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { ...SCREENSHOT_VIEWPORT },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
    // The check-in scanner opens a camera stream; without permission the video
    // stage renders as a black rectangle.
    permissions: ["camera"],
  });
}

async function main() {
  const base = arg("base", "http://localhost:3000").replace(/\/$/, "");
  const seedPath = resolve(process.cwd(), arg("seed", "../../screenshot-seed.json"));
  const outDir = resolve(process.cwd(), arg("out", "public/feature-guide/auto"));
  const only = optionalArg("only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;

  const seed: SeedFile = JSON.parse(readFileSync(seedPath, "utf8"));

  const keys = eligibleScreenshotKeys().filter((key) => !only || only.includes(key));
  const missing = eligibleScreenshotKeys().filter((key) => !SCREENSHOT_MANIFEST[key]);
  if (missing.length) {
    throw new Error(`No manifest entry for: ${missing.join(", ")}`);
  }

  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });

  const failures: string[] = [];
  const written: string[] = [];

  try {
    for (const as of ["attendee", "organizer"] as const) {
      const forThisUser = keys.filter((key) => SCREENSHOT_MANIFEST[key]!.as === as);
      if (!forThisUser.length) continue;

      const context = await contextFor(browser);
      const page = await context.newPage();
      const email = as === "organizer" ? seed.organizerEmail : seed.attendeeEmail;
      await signIn(page, base, email, seed.password);

      for (const key of forThisUser) {
        const shot = SCREENSHOT_MANIFEST[key]!;
        const eventId =
          shot.event === "breakouts" ? seed.tokens.breakoutEventId! : seed.tokens.eventId!;
        try {
          if (shot.viewport) await page.setViewportSize(shot.viewport);
          else await page.setViewportSize({ ...SCREENSHOT_VIEWPORT });

          await setActiveEvent(page, eventId);
          await page.goto(`${base}${interpolate(shot.path, seed.tokens)}`, {
            waitUntil: "domcontentloaded",
          });
          await settle(page);

          for (const selector of shot.clicks ?? []) {
            await page.locator(selector).first().click({ timeout: 30_000 });
            await settle(page);
          }
          if (shot.waitFor) {
            await page.locator(shot.waitFor).first().waitFor({ state: "visible", timeout: 30_000 });
          }

          await capture(page, shot, join(outDir, `${key}.png`));
          written.push(key);
          console.log(`captured ${key}`);
        } catch (err) {
          const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
          failures.push(`${key} (${shot.path}): ${reason}`);
          console.error(`FAILED  ${key}: ${reason}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (!only) {
    // A stale PNG for a key that left the manifest would keep being served, so
    // a full run owns the whole set. A key that failed this run keeps its PNG:
    // last week's picture of a working surface beats no picture at all. Only
    // PNGs go — .gitkeep keeps the directory in git when the set is empty.
    for (const name of readdirSync(outDir)) {
      if (!name.endsWith(".png")) continue;
      if (keys.includes(name.replace(/\.png$/, "") as FeatureKey)) continue;
      rmSync(join(outDir, name), { force: true });
    }
  }

  const percent = keys.length ? Math.round((written.length / keys.length) * 100) : 100;
  console.log(`\n${written.length}/${keys.length} captured (${percent}%) into ${outDir}`);

  if (failures.length) {
    console.error(`\n${failures.length} shot(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error("Each keeps its previous image, or falls back to category art if it had none.");
  }

  // One broken surface used to sink the whole run, which threw away every good
  // image with it. Below the floor the set is too thin to be worth committing.
  if (!captureRunPassed(written.length, keys.length)) {
    console.error(
      `\nOnly ${percent}% captured, under the ${Math.round(SCREENSHOT_MIN_PASS_RATIO * 100)}% floor.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
