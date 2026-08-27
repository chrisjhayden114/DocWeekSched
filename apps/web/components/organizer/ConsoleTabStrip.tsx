import { useCallback, useEffect, useRef, useState } from "react";

export type ConsoleTab<Id extends string> = {
  id: Id;
  label: string;
};

export type ConsoleTabStripProps<Id extends string> = {
  tabs: readonly ConsoleTab<Id>[];
  activeId: Id;
  onSelect: (id: Id) => void;
  /** Names the strip for screen readers, e.g. "Event sections". */
  ariaLabel: string;
};

/**
 * UX-3 #2 — the organizer console tab strip. Ten tabs used to wrap into an
 * orphan second row; now it is one horizontal row that scrolls, with a fade on
 * whichever edge still has tabs behind it so the overflow is visible without a
 * scrollbar. Selecting a tab off-screen scrolls it into view.
 */
export function ConsoleTabStrip<Id extends string>({
  tabs,
  activeId,
  onSelect,
  ariaLabel,
}: ConsoleTabStripProps<Id>) {
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const syncEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 1px slack: fractional layout widths otherwise leave a permanent end fade.
    setEdges({ start: el.scrollLeft > 1, end: max > 1 && el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    syncEdges();
    const el = scrollerRef.current;
    if (!el) return;
    window.addEventListener("resize", syncEdges);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      // The tab set itself changes (Readiness appears with the feature).
      observer = new ResizeObserver(syncEdges);
      observer.observe(el);
    }
    return () => {
      window.removeEventListener("resize", syncEdges);
      observer?.disconnect();
    };
  }, [syncEdges, tabs.length]);

  // Bring the selected tab into view by scrolling the row only — scrollIntoView
  // would be free to move the page vertically as well.
  useEffect(() => {
    const el = scrollerRef.current;
    const active = el?.querySelector<HTMLElement>("button.active");
    if (!el || !active) return;
    const row = el.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.left < row.left) el.scrollLeft -= row.left - tab.left + 8;
    else if (tab.right > row.right) el.scrollLeft += tab.right - row.right + 8;
  }, [activeId]);

  const className = [
    "console-tabstrip",
    edges.start ? "has-fade-start" : "",
    edges.end ? "has-fade-end" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <nav
        ref={scrollerRef}
        className="nav console-event-tabs"
        aria-label={ariaLabel}
        onScroll={syncEdges}
      >
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={activeId === id ? "active" : ""}
            onClick={() => onSelect(id)}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
