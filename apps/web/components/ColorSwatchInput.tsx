import { useEffect, useState } from "react";

type Props = {
  value: string;
  onChange: (hex: string) => void;
  /** Accessible name for the pair, e.g. "Brand color". */
  label?: string;
  disabled?: boolean;
};

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

function normalizeHex(raw: string): string | null {
  const m = HEX_RE.exec(raw.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

/**
 * E15.4: a native colour input stretched by `.input` (width: 100%) reads as a
 * decorative strip, not a control. This pairs a fixed-size swatch with a hex
 * text field so the colour is both visible and editable. Never apply `.input`
 * to `type="color"`.
 */
export function ColorSwatchInput({ value, onChange, label = "Color", disabled }: Props) {
  const [text, setText] = useState(value);

  // Reflect external changes (e.g. picking via the swatch) into the hex field.
  useEffect(() => {
    setText(value);
  }, [value]);

  const normalized = normalizeHex(value);

  return (
    <span className="color-swatch-row">
      <input
        type="color"
        className="color-swatch"
        // A colour input demands a valid #rrggbb; fall back to the current
        // text only when the stored value is malformed.
        value={normalized ?? "#000000"}
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
        placeholder="#0033a0"
        onChange={(e) => {
          setText(e.target.value);
          const hex = normalizeHex(e.target.value);
          if (hex) onChange(hex);
        }}
        onBlur={() => setText(normalizeHex(text) ?? normalized ?? value)}
      />
    </span>
  );
}
