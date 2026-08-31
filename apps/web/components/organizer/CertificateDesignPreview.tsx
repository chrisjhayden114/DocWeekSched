import { useEffect, useRef, useState } from "react";
import {
  CERTIFICATE_PREVIEW_SAMPLE_NAME,
  certificateNamePlacement,
  certificatePageAspectRatio,
  normalizeCertificateNameBox,
  type CertificateNameBox,
  type CertificateOrientation,
} from "@event-app/shared";

/**
 * CERT-2 — what the organizer's design will actually look like with a name on it.
 *
 * This is a preview rather than a designer: there is no draggable box and no
 * WYSIWYG surface, because v1 gives exactly one placement control (a vertical
 * slider) and centres the name horizontally. What makes it trustworthy is that
 * it does not draw its own approximation — it calls the same
 * `certificateNamePlacement` helper the PDF renderer calls, with the preview's
 * width in CSS pixels instead of the page's width in PDF points. Every number
 * comes back already scaled, so the two cannot drift.
 *
 * The name is positioned from its vertical centre (`translateY(-50%)`), which
 * is the same anchor the renderer uses, so nudging the font size does not move
 * the name off the slider position the organizer chose.
 */

/** Fallback width before the first measurement (and in jsdom, which has no ResizeObserver). */
const FALLBACK_PREVIEW_WIDTH = 640;

function usePreviewWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(FALLBACK_PREVIEW_WIDTH);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width || FALLBACK_PREVIEW_WIDTH);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

export function CertificateDesignPreview({
  backgroundImageUrl,
  nameBox,
  orientation,
  sampleName = CERTIFICATE_PREVIEW_SAMPLE_NAME,
}: {
  backgroundImageUrl: string | null;
  nameBox: CertificateNameBox;
  orientation: CertificateOrientation;
  sampleName?: string;
}) {
  const { ref, width } = usePreviewWidth<HTMLDivElement>();
  const placement = certificateNamePlacement({ orientation, nameBox, surfaceWidth: width });
  const box = normalizeCertificateNameBox(nameBox);

  return (
    <div
      ref={ref}
      className="cert-preview"
      style={{ aspectRatio: `1 / ${certificatePageAspectRatio(orientation)}` }}
    >
      {backgroundImageUrl ? (
        // object-fit: cover mirrors pdfkit's `cover` — same crop, same result.
        <img className="cert-preview-art" src={backgroundImageUrl} alt="" />
      ) : (
        <p className="cert-preview-placeholder">
          Upload your design to see it here with a name on it.
        </p>
      )}
      <span
        className="cert-preview-name"
        style={{
          left: placement.x,
          width: placement.width,
          top: placement.centerY,
          fontSize: placement.fontSize,
          color: box.color,
          textAlign: box.align,
        }}
      >
        {sampleName}
      </span>
    </div>
  );
}
