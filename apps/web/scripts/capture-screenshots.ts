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
 * Every shot lands on a SCREENSHOT_WIDTH-wide frame so the hover cards, which
 * crop the art slot to a fixed height, cannot end up with wildly different
 * scales. Component-scoped shots are photographed as elements and re-staged
 * onto that frame (see screenshot-frame.ts); page-scoped ones are clipped out
 * of the document, which is what they mean.
 *
 * A shot that throws is reported, not fatal: the run keeps going and only exits
 * non-zero below SCREENSHOT_MIN_PASS_RATIO, so one broken surface cannot stop
 * the workflow from committing every image that did come out.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import type { FeatureKey } from "@event-app/shared";
import {
  ALIGN_TOP_PAD,
  DOCKED_BODY_CLASSES,
  cleanStageCss,
  composedFrame,
  composedFrameHtml,
  isAssistantOpenStorageKey,
  isPageScopeSelector,
  needsComposedFrame,
  pngSize,
  subjectTopClip,
  topAlignedClip,
} from "../screenshot-frame";
import {
  SCREENSHOT_MANIFEST,
  SCREENSHOT_MIN_PASS_RATIO,
  SCREENSHOT_VIEWPORT,
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

/**
 * Take the floating chrome off the stage. The FAB and the docked assistant
 * panel are `position: fixed`, so they sit over whatever a shot is aimed at,
 * and a docked panel also steals a 384px gutter out of .shell-content. The
 * shot's own family is left alone, so the concierge card still gets its panel.
 */
async function clearStage(page: Page, shot: FeatureShot): Promise<void> {
  await page.addStyleTag({ content: cleanStageCss(shot.selector) });
  if (shot.stageCss) await page.addStyleTag({ content: shot.stageCss });
}

/** Scroll the window and every overflow ancestor so the subject's top is at 0. */
async function scrollSubjectToTop(page: Page, target: Locator): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await target.evaluate((el) => {
    el.scrollTop = 0;
    let node: Element | null = el;
    while (node) {
      if (node instanceof HTMLElement) node.scrollTop = 0;
      node = node.parentElement;
    }
  });
}

/**
 * Forget any assistant that was opened by an earlier shot. Both assistants
 * restore their open state from storage on mount, so the concierge shot's click
 * used to reopen the panel on every attendee surface captured after it.
 */
async function resetFloatingChrome(page: Page): Promise<void> {
  await page.evaluate(
    ({ dockedClasses, prefixes }) => {
      for (const store of [window.sessionStorage, window.localStorage]) {
        try {
          for (const key of Object.keys(store)) {
            if (prefixes.some((prefix) => key.startsWith(prefix))) store.removeItem(key);
          }
        } catch {
          /* private mode / blocked storage */
        }
      }
      document.body.classList.remove(...dockedClasses);
    },
    {
      dockedClasses: DOCKED_BODY_CLASSES,
      // The predicate can't cross into the browser, so its prefixes do.
      prefixes: ["conciergeOpen", "copilotOpen", "copilotDockEventId"],
    },
  );
}

async function documentBox(page: Page, target: Locator, selector: string) {
  const box = await target.boundingBox();
  if (!box) throw new Error(`"${selector}" has no bounding box (not rendered?)`);
  const doc = await page.evaluate(() => ({
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  return {
    box: { x: box.x + doc.scrollX, y: box.y + doc.scrollY, width: box.width, height: box.height },
    doc: { width: doc.width, height: doc.height },
  };
}

async function clipDocument(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  return page.screenshot({
    clip,
    fullPage: true,
    animations: "disabled",
    scale: "css",
  });
}

/**
 * A document clip around a page-scope element: the element IS the content
 * column, so its exact bounds would shave off the page around it. Padded at the
 * top so a section heading is never flush against the first row of pixels.
 */
async function pageScopeClip(page: Page, target: Locator, selector: string): Promise<Buffer> {
  const { box, doc } = await documentBox(page, target, selector);
  return clipDocument(page, topAlignedClip(box, doc, { pad: ALIGN_TOP_PAD }));
}

/**
 * The colour a composed frame's gutters wear: the nearest painted background
 * behind the element, so the frame reads as more of the same surface instead of
 * a cut-out pasted onto a different page.
 */
async function stageBackground(target: Locator): Promise<string> {
  return target.evaluate((el) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && color !== "transparent" && !/^rgba\(0,\s*0,\s*0,\s*0\)$/.test(color)) {
        return color;
      }
    }
    return "#ffffff";
  });
}

/**
 * Re-stage an element PNG as a uniform frame, using the browser we already have
 * instead of an image library: the shot goes back in as a data URL on a page
 * sized to the frame, and that page is screenshotted.
 */
async function composeFrame(
  stage: Page,
  png: Buffer,
  background: string,
  outPath: string,
): Promise<void> {
  const frame = composedFrame(pngSize(png));
  const src = `data:image/png;base64,${png.toString("base64")}`;
  await stage.setViewportSize(frame.stage);
  await stage.setContent(composedFrameHtml(src, frame, background), { waitUntil: "load" });
  await stage.locator("img.shot").waitFor({ state: "visible", timeout: 30_000 });
  await stage.screenshot({ path: outPath, animations: "disabled", scale: "css" });
}

async function capture(
  page: Page,
  stage: Page,
  shot: FeatureShot,
  outPath: string,
): Promise<void> {
  const target = page.locator(shot.selector).first();
  await target.waitFor({ state: "visible", timeout: 30_000 });
  if (shot.alignTop || isPageScopeSelector(shot.selector)) {
    await scrollSubjectToTop(page, target);
  } else {
    await target.scrollIntoViewIfNeeded();
  }
  await settle(page);
  // After the scroll and before any measurement: releasing the docked gutter
  // moves the content the clip is about to be measured against.
  await clearStage(page, shot);

  let png: Buffer;
  if (shot.clipHeight != null) {
    const { box } = await documentBox(page, target, shot.selector);
    png = await clipDocument(page, subjectTopClip(box, shot.clipHeight));
  } else if (shot.alignTop || isPageScopeSelector(shot.selector)) {
    png = await pageScopeClip(page, target, shot.selector);
  } else {
    // Playwright scrolls the element into frame and bounds it exactly, which
    // is the whole point: headings included, no neighbouring column, no
    // shaved top from a rectangle that only happened to start there.
    png = await target.screenshot({ animations: "disabled", scale: "css" });
  }

  if (!needsComposedFrame(pngSize(png))) {
    writeFileSync(outPath, png);
    return;
  }
  await composeFrame(stage, png, await stageBackground(target), outPath);
}

async function contextFor(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { ...SCREENSHOT_VIEWPORT },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  // tsx/esbuild keepNames wraps functions with a __name helper. Playwright
  // serializes evaluate callbacks into the browser, where that helper does not
  // exist — define it as a no-op before any page loads.
  await context.addInitScript("globalThis.__name = (fn) => fn;");
  return context;
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

  // No shot photographs a camera stage any more (see the `checkin` note), so
  // the fake-media device flags are gone with it.
  const browser = await chromium.launch();

  const failures: string[] = [];
  const written: string[] = [];

  try {
    for (const as of ["attendee", "organizer"] as const) {
      const forThisUser = keys.filter((key) => SCREENSHOT_MANIFEST[key]!.as === as);
      if (!forThisUser.length) continue;

      const context = await contextFor(browser);
      const page = await context.newPage();
      // A second page does the frame composition, so a shot's own page keeps
      // its scroll position and its signed-in surface.
      const stage = await context.newPage();
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
          await resetFloatingChrome(page);
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
          for (const field of shot.fills ?? []) {
            await page.fill(field.selector, field.value);
          }

          await capture(page, stage, shot, join(outDir, `${key}.png`));
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
