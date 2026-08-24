import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Portal } from "./kit/Portal";
import { useAnchoredPopup } from "./kit/useAnchoredPopup";

export type KebabItem = {
  id: string;
  label: string;
  onSelect: () => void;
  tone?: "danger" | "default";
  disabled?: boolean;
  title?: string;
};

const PANEL_MAX_HEIGHT = 320;

/**
 * Row-level overflow actions. The panel renders through kit/Portal as a
 * fixed-position layer anchored to the trigger (W-1) — inside the scrolling
 * table wrappers it lives in, an absolutely positioned panel was clipped.
 */
export function KebabMenu({ items, label = "Actions" }: { items: KebabItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel is in a portal, so it is outside the wrapper but still part of
      // the menu for the purposes of closing on an outside click.
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const panelStyle = useAnchoredPopup({
    open,
    triggerRef,
    popupRef: panelRef,
    align: "end",
    maxHeight: PANEL_MAX_HEIGHT,
    onClose: close,
  });

  return (
    <div className="kebab-menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="kebab-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && panelStyle ? (
        <Portal>
          <ul id={menuId} ref={panelRef} className="kebab-panel" role="menu" style={panelStyle}>
            {items.map((item) => (
              <li key={item.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={`kebab-item${item.tone === "danger" ? " is-danger" : ""}`}
                  disabled={item.disabled}
                  title={item.title}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </Portal>
      ) : null}
    </div>
  );
}
