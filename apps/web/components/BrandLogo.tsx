import { brand } from "@event-app/config";

/**
 * The brand mark: the octopus holding a schedule grid (BRAND-R).
 *
 * It was hand-drawn SVG before the rename and is a raster now because the
 * artwork is a raster — tracing it back into paths would be a redraw, not a
 * conversion. Rendered from the 256px file at every size so one asset covers
 * the header (32), the auth and error pages (48), and anything in between
 * without a second file to keep in sync.
 *
 * `decorative` is the default because every current caller puts the product
 * name in text right next to the mark, where a second reading of "Readyhall"
 * is noise for a screen reader.
 */
export function BrandLogo({
  size = 52,
  className,
  decorative = true,
}: {
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      src={brand.assets.logo}
      width={size}
      height={size}
      className={className}
      alt={decorative ? "" : brand.logoAlt}
      aria-hidden={decorative || undefined}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
