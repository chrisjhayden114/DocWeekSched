/**
 * CERT-2 (DESIGN_PHASE_J §Certificates, J-C) — pure geometry and validation for
 * image-background certificates, shared by the API renderer and the web preview.
 *
 * The reality this serves: organizers design certificates in Canva and export a
 * finished PNG/JPG. They do not want a designer inside our product, they want
 * their design with each attendee's name on it. So a template is one of two
 * kinds — the built-in TEXT layout (no design needed, unchanged) or
 * IMAGE_BACKGROUND, where the uploaded artwork IS the certificate and the only
 * thing we draw is the name.
 *
 * Everything here is deliberately pure. `certificateNamePlacement` is the single
 * source of truth for where the name lands: the renderer calls it with the page
 * width in PDF points, the organizer's preview calls it with the preview width
 * in CSS pixels, and both get the same proportional answer. That is what makes
 * the preview honest rather than a drawing that resembles the output.
 */

export const CERTIFICATE_TEMPLATE_KINDS = ["TEXT", "IMAGE_BACKGROUND"] as const;
export type CertificateTemplateKind = (typeof CERTIFICATE_TEMPLATE_KINDS)[number];

export const CERTIFICATE_ORIENTATIONS = ["LANDSCAPE", "PORTRAIT"] as const;
export type CertificateOrientation = (typeof CERTIFICATE_ORIENTATIONS)[number];

export const CERTIFICATE_NAME_ALIGNS = ["left", "center", "right"] as const;
export type CertificateNameAlign = (typeof CERTIFICATE_NAME_ALIGNS)[number];

/** LETTER in PDF points, portrait. pdfkit's own "LETTER" size. */
export const CERTIFICATE_PAGE_POINTS = { width: 612, height: 792 } as const;

/**
 * Upload ceilings. The binary limit is what the organizer is promised; the
 * character limit is the base64 envelope that same file arrives in (4/3 plus
 * the `data:image/png;base64,` prefix and a little slack), because uploads are
 * stored as data URLs exactly like event logos.
 */
export const CERTIFICATE_BACKGROUND_MAX_BYTES = 10_000_000;
export const CERTIFICATE_BACKGROUND_URL_MAX_CHARS = 14_000_000;

/** What we tell organizers to export from Canva. Used in UI copy and help. */
export const CERTIFICATE_BACKGROUND_RECOMMENDED_WIDTH_PX = 2000;

export const CERTIFICATE_BACKGROUND_ACCEPT = "image/png,image/jpeg";

/** The two colours the v1 picker offers. Stored as the hex, not the token. */
export const CERTIFICATE_NAME_COLORS = {
  dark: "#1F2933",
  light: "#FFFFFF",
} as const;

export const CERTIFICATE_NAME_FONT_SIZE_MIN = 12;
export const CERTIFICATE_NAME_FONT_SIZE_MAX = 72;
export const CERTIFICATE_NAME_FONT_SIZE_STEP = 2;

/** Kept off the very edge so a long name still wraps inside the artwork. */
export const CERTIFICATE_NAME_Y_PCT_MIN = 5;
export const CERTIFICATE_NAME_Y_PCT_MAX = 95;

/**
 * Horizontal inset of the name's text box, as a fraction of page width per
 * side. Not organizer-configurable in v1 — it exists so that "centered" means
 * centered in a box that a two-line name can wrap inside without touching the
 * border of someone's design.
 */
export const CERTIFICATE_NAME_SIDE_INSET = 0.08;

export const CERTIFICATE_NAME_BOX_DEFAULT: CertificateNameBox = {
  yPct: 50,
  fontSize: 32,
  color: CERTIFICATE_NAME_COLORS.dark,
  align: "center",
};

/** The sample the preview overlays, so nobody previews an empty design. */
export const CERTIFICATE_PREVIEW_SAMPLE_NAME = "Priya Raghunathan";

/**
 * Where the attendee's name goes on an IMAGE_BACKGROUND certificate.
 *
 * `yPct` is the vertical CENTRE of the name line as a percentage of page
 * height — a slider position, which is the one control v1 gives. Horizontal
 * placement is not a stored coordinate: `align` positions the name inside the
 * inset box, and v1's UI only ever writes "center".
 */
export type CertificateNameBox = {
  yPct: number;
  /** Points at LETTER scale. The preview scales this; it never stores px. */
  fontSize: number;
  color: string;
  align: CertificateNameAlign;
};

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isCertificateTemplateKind(value: unknown): value is CertificateTemplateKind {
  return (CERTIFICATE_TEMPLATE_KINDS as readonly unknown[]).includes(value);
}

export function isCertificateOrientation(value: unknown): value is CertificateOrientation {
  return (CERTIFICATE_ORIENTATIONS as readonly unknown[]).includes(value);
}

/** Page box in PDF points for an orientation. LANDSCAPE swaps LETTER's axes. */
export function certificatePageSize(
  orientation: CertificateOrientation | null | undefined,
): { width: number; height: number } {
  const { width, height } = CERTIFICATE_PAGE_POINTS;
  return orientation === "PORTRAIT" ? { width, height } : { width: height, height: width };
}

/** Height/width of the page, for sizing a preview from its width alone. */
export function certificatePageAspectRatio(
  orientation: CertificateOrientation | null | undefined,
): number {
  const page = certificatePageSize(orientation);
  return page.height / page.width;
}

/**
 * A stored `nameBox` Json blob → a box we can draw with.
 *
 * Read-time normalization is not belt-and-braces here: the column defaults to
 * `{}` for every row that existed before CERT-2, and a template saved by an
 * older client can be missing any field. Anything absent, non-finite, or out of
 * range falls back to the default rather than throwing, because a certificate
 * batch must never fail on a cosmetic value.
 */
export function normalizeCertificateNameBox(value: unknown): CertificateNameBox {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<
    string,
    unknown
  >;

  const yPct =
    typeof raw.yPct === "number" && Number.isFinite(raw.yPct)
      ? clamp(raw.yPct, CERTIFICATE_NAME_Y_PCT_MIN, CERTIFICATE_NAME_Y_PCT_MAX)
      : CERTIFICATE_NAME_BOX_DEFAULT.yPct;

  const fontSize =
    typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)
      ? clamp(raw.fontSize, CERTIFICATE_NAME_FONT_SIZE_MIN, CERTIFICATE_NAME_FONT_SIZE_MAX)
      : CERTIFICATE_NAME_BOX_DEFAULT.fontSize;

  const color =
    typeof raw.color === "string" && HEX_COLOR_RE.test(raw.color.trim())
      ? raw.color.trim().toUpperCase()
      : CERTIFICATE_NAME_BOX_DEFAULT.color;

  const align = (CERTIFICATE_NAME_ALIGNS as readonly unknown[]).includes(raw.align)
    ? (raw.align as CertificateNameAlign)
    : CERTIFICATE_NAME_BOX_DEFAULT.align;

  return { yPct, fontSize, color, align };
}

export type CertificateNamePlacement = {
  /** Left edge of the name's text box, in surface units. */
  x: number;
  /** Width of that box, in surface units. */
  width: number;
  /** Vertical centre of the name line, in surface units. */
  centerY: number;
  /** Font size in surface units — already scaled from points. */
  fontSize: number;
  align: CertificateNameAlign;
  color: string;
  /** Height of the surface, derived from the page's aspect ratio. */
  surfaceHeight: number;
};

/**
 * Resolve the name's position on a surface of a given width.
 *
 * `surfaceWidth` is PDF points for the renderer and CSS pixels for the preview;
 * every returned number is in those same units, including `fontSize`. Callers
 * do not scale anything themselves, which is precisely why the preview and the
 * PDF agree.
 *
 * `centerY` is a centre rather than a top because a top would move whenever the
 * font size changed, and the organizer is dragging a slider that should mean
 * "the name sits here". The renderer subtracts the real measured line height.
 */
export function certificateNamePlacement(input: {
  orientation: CertificateOrientation | null | undefined;
  nameBox: unknown;
  surfaceWidth: number;
}): CertificateNamePlacement {
  const box = normalizeCertificateNameBox(input.nameBox);
  const page = certificatePageSize(input.orientation);
  const surfaceWidth = Number.isFinite(input.surfaceWidth) ? Math.max(0, input.surfaceWidth) : 0;
  const scale = surfaceWidth / page.width;
  const surfaceHeight = surfaceWidth * (page.height / page.width);

  return {
    x: surfaceWidth * CERTIFICATE_NAME_SIDE_INSET,
    width: surfaceWidth * (1 - CERTIFICATE_NAME_SIDE_INSET * 2),
    centerY: surfaceHeight * (box.yPct / 100),
    fontSize: box.fontSize * scale,
    align: box.align,
    color: box.color,
    surfaceHeight,
  };
}

/**
 * Honest copy about what the upload has to be, kept next to the numbers it
 * quotes so the two cannot drift. A design in a different shape is covered to
 * the page rather than squashed, and cropping is the visible cost of that.
 */
export const CERTIFICATE_BACKGROUND_GUIDANCE = [
  `Export your finished design as a PNG or JPG about ${CERTIFICATE_BACKGROUND_RECOMMENDED_WIDTH_PX}px wide`,
  "in the same shape as the page you pick (landscape is 11 × 8.5in, portrait 8.5 × 11in).",
  "A design in a different shape is scaled to cover the page, so its edges may be cropped.",
].join(" ");

/**
 * The v1 limit, said plainly. Dates, hours and signatures are not overlaid on
 * an uploaded design — they belong in the design itself, where the organizer
 * already controls how they look. The built-in TEXT layout remains the path for
 * anyone who has no design to bring.
 */
export const CERTIFICATE_NAME_ONLY_NOTE =
  "The attendee's name is the only thing we place on your design. Put the event name, dates, hours and signatures into the design itself.";
