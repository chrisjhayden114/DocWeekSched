import { useEffect, useState } from "react";

/**
 * E30.4 — the ONE earned count-up in the app: the ingest result figure.
 * Duration comes from the --motion-countup token, which collapses to 0ms
 * under prefers-reduced-motion (tokens.css), so reduced-motion users see
 * the final value instantly with no movement.
 */
export function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--motion-countup").trim();
    const duration = raw.endsWith("ms")
      ? parseFloat(raw)
      : raw.endsWith("s")
        ? parseFloat(raw) * 1000
        : NaN;
    if (!Number.isFinite(duration) || duration <= 0 || value <= 0) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(eased * value));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{display}</span>;
}
