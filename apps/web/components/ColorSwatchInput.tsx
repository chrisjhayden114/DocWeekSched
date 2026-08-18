import { useEffect, useState } from "react";

type Props = {
  value: string;
  onChange: (hex: string) => void;
  /** Accessible name for the pair, e.g. "Brand color". */
  label?: string;
  disabled?: boolean;
  /**
   * BRAND-2: pass a hex to make "no color" a legitimate state. The text field
   * may then be cleared (propagating ""), and the swatch shows this color as
   * the stand-in for what the UI will actually render. Omit it where a color
   * is required (a track's color, for example).
   */
  emptyHex?: string;
};

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Accepts 3- or 6-digit hex, with or without `#`; returns lowercase `#rrggbb`. */
function normalizeHex(raw: string): string | null {
  const m = HEX_RE.exec(raw.trim());
  if (!m) return null;
  const digits = m[1].toLowerCase();
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((c) => c + c)
          .join("")
      : digits;
  return `#${full}`;
}

/**
 * E15.4: a native colour input stretched by `.input` (width: 100%) reads as a
 * decorative strip, not a control. This pairs a fixed-size swatch with a hex
 * text field so the colour is both visible and editable. Never apply `.input`
 * to `type="color"`.
 */
export function ColorSwatchInput({ value, onChange, label = "Color", disabled, emptyHex }: Props) {
  const [text, setText] = useState(value);

  // Reflect external changes (e.g. picking via the swatch) into the hex field.
  useEffect(() => {
    setText(value);
  }, [value]);

  const normalized = normalizeHex(value);
  const clearable = emptyHex !== undefined;

  /** Settle the text field: a valid hex canonicalizes, a cleared field stays cleared. */
  function settleText() {
    const hex = normalizeHex(text);
    if (hex) setText(hex);
    else if (clearable && !text.trim()) setText("");
    else setText(normalized ?? value);
  }

  return (
    <span className="color-swatch-row">
      <input
        type="color"
        className="color-swatch"
        // A colour input demands a valid #rrggbb. With no colour chosen, show
        // the colour the UI actually uses rather than an arbitrary black.
        value={normalized ?? emptyHex ?? "#000000"}
        disabled={disabled}
        aria-label={`${label} swatch`}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        className="input"
        value={text}
        disabled={disabled}
        aria-label={`${label} hex value`}
        placeholder={emptyHex ?? "#0033a0"}
        onChange={(e) => {
          setText(e.target.value);
          const hex = normalizeHex(e.target.value);
          if (hex) onChange(hex);
          else if (clearable && !e.target.value.trim()) onChange("");
        }}
        onBlur={settleText}
      />
    </span>
  );
}
