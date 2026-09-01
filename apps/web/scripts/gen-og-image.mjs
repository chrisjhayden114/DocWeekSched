/**
 * Regenerate the social preview card at public/brand/og-image.png.
 *
 *   npm --workspace apps/web run gen:og
 *
 * The card is a committed PNG rather than a route because og:image is fetched
 * by crawlers that do not run our redirects, retry, or wait: a static file on
 * the CDN is the one version of this that cannot fail at share time. Rendering
 * it from source keeps the name, tagline, and mark in step with the brand
 * config — re-run this after editing either, and commit the result.
 *
 * Text is laid out by satori (via next/og) using its bundled font, so the
 * output is byte-stable across machines with no extra dependency and no
 * network access.
 */

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// "next/og.js", not "next/og": the package has no ESM export map entry for it.
const { ImageResponse } = require("next/og.js");
const { brand } = require("@event-app/config");

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, "..", "public");
const LOGO_PATH = resolve(PUBLIC_DIR, `.${brand.assets.logo}`);
const OUT_PATH = resolve(PUBLIC_DIR, `.${brand.assets.ogImage}`);

/** Facebook/LinkedIn/X all crop from 1200×630; anything else gets letterboxed. */
const WIDTH = 1200;
const HEIGHT = 630;

const logoDataUrl = `data:image/png;base64,${readFileSync(LOGO_PATH).toString("base64")}`;

/** satori takes React elements; these are the same shape without a JSX step. */
const el = (type, props, ...children) => ({
  type,
  key: null,
  props: { ...props, children: children.length <= 1 ? children[0] : children },
});

const card = el(
  "div",
  {
    style: {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      backgroundColor: "#ffffff",
      fontFamily: "sans-serif",
    },
  },
  el("div", { style: { display: "flex", height: 18, backgroundColor: brand.colors.primary } }),
  el(
    "div",
    {
      style: {
        display: "flex",
        flex: 1,
        alignItems: "center",
        gap: 56,
        padding: "0 84px",
      },
    },
    el("img", { src: logoDataUrl, width: 268, height: 268 }),
    el(
      "div",
      { style: { display: "flex", flexDirection: "column", flex: 1 } },
      el(
        "div",
        {
          style: {
            fontSize: 104,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: brand.colors.ink,
            lineHeight: 1.05,
          },
        },
        brand.productName,
      ),
      el(
        "div",
        { style: { marginTop: 18, fontSize: 38, lineHeight: 1.3, color: "#475569" } },
        brand.shortTagline,
      ),
      el(
        "div",
        { style: { marginTop: 28, fontSize: 30, color: brand.colors.primary } },
        brand.domain,
      ),
    ),
  ),
);

const png = Buffer.from(
  await new ImageResponse(card, { width: WIDTH, height: HEIGHT }).arrayBuffer(),
);
writeFileSync(OUT_PATH, png);
console.log(`wrote ${OUT_PATH} (${WIDTH}×${HEIGHT}, ${png.length} bytes)`);
