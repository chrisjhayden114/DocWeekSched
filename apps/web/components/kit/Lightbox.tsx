import { useCallback, useEffect, useRef } from "react";
import { Portal } from "./Portal";

export type LightboxProps = {
  images: string[];
  index: number | null;              // null = closed
  onClose: () => void;
  onIndexChange: (i: number) => void;
  label?: string;                    // e.g. the post title, for screen readers
};

export function Lightbox({ images, index, onClose, onIndexChange, label }: LightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const open = index !== null && index >= 0 && index < images.length;

  const go = useCallback(
    (delta: number) => {
      if (index === null || images.length === 0) return;
      onIndexChange((index + delta + images.length) % images.length);
    },
    [index, images.length, onIndexChange],
  );

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, go, onClose]);

  if (!open || index === null) return null;
  const total = images.length;
  const alt = label ? `${label} — photo ${index + 1} of ${total}` : `Photo ${index + 1} of ${total}`;

  return (
    <Portal>
      <div className="kit-lightbox-overlay" role="presentation" onClick={onClose}>
        <div
          ref={dialogRef}
          className="kit-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="kit-lightbox-close" aria-label="Close" onClick={onClose}>×</button>
          {total > 1 && (
            <button type="button" className="kit-lightbox-nav kit-lightbox-prev" aria-label="Previous photo" onClick={() => go(-1)}>‹</button>
          )}
          <img className="kit-lightbox-img" src={images[index]} alt={alt} />
          {total > 1 && (
            <button type="button" className="kit-lightbox-nav kit-lightbox-next" aria-label="Next photo" onClick={() => go(1)}>›</button>
          )}
          {total > 1 && <div className="kit-lightbox-counter">{index + 1} / {total}</div>}
        </div>
      </div>
    </Portal>
  );
}
