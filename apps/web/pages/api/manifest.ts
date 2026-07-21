import { brand } from "@event-app/config";
import type { NextApiRequest, NextApiResponse } from "next";

/** Dynamic web manifest — name/colors from branding config. */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).json({
    name: brand.productName,
    short_name: brand.productName,
    description: `${brand.productName} — event agenda, maps, and calm notifications.`,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fafafa",
    theme_color: brand.colors.primary,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  });
}
