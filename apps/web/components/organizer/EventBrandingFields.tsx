import { ColorSwatchInput } from "../ColorSwatchInput";
import { UploadDropzone } from "../UploadDropzone";
import { NEUTRAL_EVENT_ACCENT } from "../../lib/eventAccent";

/**
 * BRAND-2 (3) — the one branding form.
 *
 * Colour, logo, and banner are collected identically wherever they are
 * collected: the create-event wizard's optional branding step and the Event
 * settings SlideOver render this component, so the size/type limits and the
 * image treatment cannot drift between the two surfaces.
 *
 * Empty is a real answer everywhere: no colour means the neutral platform
 * accent (lib/eventAccent.ts derives it from an absent brandColor — this form
 * never substitutes a default of its own, and never UKEDL blue).
 */

export type EventBrandingValue = {
  brandColor: string;
  logoUrl: string;
  bannerUrl: string;
};

/** Byte ceiling enforced before reading, plus the resize the stored image gets. */
export const BRANDING_IMAGE_RULES = {
  logo: { maxBytes: 2_000_000, maxWidth: 512, maxHeight: 512, quality: 0.88 },
  banner: { maxBytes: 4_500_000, maxWidth: 1920, maxHeight: 720, quality: 0.82 },
} as const;

/** Image file → resized JPEG data URL. */
function fileToDataUrl(
  file: File,
  options: { maxWidth: number; maxHeight: number; quality: number },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      if (!file.type.startsWith("image/")) {
        resolve(raw);
        return;
      }
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(options.maxWidth / image.width, options.maxHeight / image.height, 1);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(raw);
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", options.quality));
      };
      image.onerror = () => resolve(raw);
      image.src = raw;
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

type Props = {
  value: EventBrandingValue;
  onChange: (patch: Partial<EventBrandingValue>) => void;
};

export function EventBrandingFields({ value, onChange }: Props) {
  const hasColor = value.brandColor.trim().length > 0;

  return (
    <>
      <label>
        Brand color
        <ColorSwatchInput
          label="Brand color"
          value={value.brandColor}
          emptyHex={NEUTRAL_EVENT_ACCENT.accent}
          onChange={(hex) => onChange({ brandColor: hex })}
        />
        <span className="help-text">
          {hasColor
            ? "Accents buttons and highlights in the console, the public page, and the attendee app. Darkened automatically if button text would be unreadable on it."
            : "Optional. Left empty, this event wears the neutral platform look."}
        </span>
      </label>
      {hasColor ? (
        <p style={{ margin: "-4px 0 0" }}>
          <button type="button" className="button secondary" onClick={() => onChange({ brandColor: "" })}>
            Use the neutral default
          </button>
        </p>
      ) : null}

      <label>
        Logo URL
        <input
          className="input"
          value={value.logoUrl}
          onChange={(e) => onChange({ logoUrl: e.target.value })}
          placeholder="https://… or upload below"
        />
      </label>
      <UploadDropzone
        variant="compact"
        label="Logo upload"
        accept="image/*"
        maxBytes={BRANDING_IMAGE_RULES.logo.maxBytes}
        onFile={async (file) => {
          onChange({ logoUrl: await fileToDataUrl(file, BRANDING_IMAGE_RULES.logo) });
        }}
      />

      <label>
        Banner URL
        <input
          className="input"
          value={value.bannerUrl}
          onChange={(e) => onChange({ bannerUrl: e.target.value })}
          placeholder="https://… or upload below"
        />
      </label>
      <UploadDropzone
        variant="compact"
        label="Banner upload"
        accept="image/*"
        maxBytes={BRANDING_IMAGE_RULES.banner.maxBytes}
        onFile={async (file) => {
          onChange({ bannerUrl: await fileToDataUrl(file, BRANDING_IMAGE_RULES.banner) });
        }}
      />
    </>
  );
}
