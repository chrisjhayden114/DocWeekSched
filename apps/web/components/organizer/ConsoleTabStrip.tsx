import { type FeatureKey } from "@event-app/shared";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { planTabOverflow } from "../../lib/tabOverflow";
import { HoverInfo } from "../kit/HoverInfo";
import { Portal } from "../kit/Portal";
import { useAnchoredPopup } from "../kit/useAnchoredPopup";

export type ConsoleTab<Id extends string> = {
  id: Id;
  label: string;
  /** K-6 — one-paragraph page preview; label-trigger, text-only card. */
  description?: string;
  /** When a FEATURE_GUIDE entry exists, the card always gets the guide footer. */
  featureKey?: FeatureKey;
};

export type ConsoleTabStripProps<Id extends string> = {
  tabs: readonly ConsoleTab<Id>[];
  activeId: Id;
  onSelect: (id: Id) => void;
  /** Names the strip for screen readers, e.g. "Event sections". */
  ariaLabel: string;
  /**
   * K-6 — tab ids that always live in More ▾ (Ops Inbox, Recap), even when
   * the row would fit. Further measured overflow is appended after these.
   */
  alwaysOverflowIds?: readonly Id[];
};

const MORE_FALLBACK_WIDTH = 72;

function desktopOverflowEnabled(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(min-width: 769px)").matches
    : false;
}

/**
 * UX-3 #2 + K-1 D5 — one horizontal row. On desktop, trailing tabs that do
 * not fit move into a portal-anchored More menu (active tab always stays
 * visible). On touch / narrow widths the scrolling row is the fallback.
 */
export function ConsoleTabStrip<Id extends string>({
  tabs,
  activeId,
  onSelect,
  ariaLabel,
  alwaysOverflowIds,
}: ConsoleTabStripProps<Id>) {
  const scrollerRef = useRef<HTMLElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const metricsRef = useRef<HTMLDivElement | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const morePanelRef = useRef<HTMLUListElement | null>(null);
  const moreMenuId = useId();
  const [edges, setEdges] = useState({ start: false, end: false });
  const [useOverflowMenu, setUseOverflowMenu] = useState(false);
  const [visibleIds, setVisibleIds] = useState<Id[]>(() => tabs.map((t) => t.id));
  const [overflowIds, setOverflowIds] = useState<Id[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);

  const syncEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 1px slack: fractional layout widths otherwise leave a permanent end fade.
    setEdges({ start: el.scrollLeft > 1, end: max > 1 && el.scrollLeft < max - 1 });
  }, []);

  const syncOverflow = useCallback(() => {
    const desktop = desktopOverflowEnabled();
    setUseOverflowMenu(desktop);
    if (!desktop) {
      setVisibleIds(tabs.map((t) => t.id));
      setOverflowIds([]);
      setMoreOpen(false);
      return;
    }
    const strip = stripRef.current;
    const metrics = metricsRef.current;
    if (!strip || !metrics) return;
    const buttons = [...metrics.querySelectorAll<HTMLElement>("[data-tab-id]")];
    const widths = {} as Partial<Record<Id, number>>;
    for (const btn of buttons) {
      const id = btn.dataset.tabId as Id | undefined;
      if (id && btn.offsetWidth > 0) widths[id] = btn.offsetWidth;
    }
    const moreBtn = metrics.querySelector<HTMLElement>("[data-tab-more]");
    const moreWidth = moreBtn && moreBtn.offsetWidth > 0 ? moreBtn.offsetWidth : MORE_FALLBACK_WIDTH;
    const styles = window.getComputedStyle(metrics.querySelector(".console-tabstrip-metrics-row") ?? metrics);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
    const plan = planTabOverflow({
      ids: tabs.map((t) => t.id),
      widths,
      available: strip.clientWidth,
      moreWidth,
      activeId,
      gap,
      alwaysOverflowIds,
    });
    setVisibleIds(plan.visibleIds);
    setOverflowIds(plan.overflowIds);
    if (plan.overflowIds.length === 0) setMoreOpen(false);
  }, [tabs, activeId, alwaysOverflowIds]);

  useEffect(() => {
    syncEdges();
    syncOverflow();
    const el = scrollerRef.current;
    const strip = stripRef.current;
    if (!el) return;
    const onResize = () => {
      syncEdges();
      syncOverflow();
    };
    window.addEventListener("resize", onResize);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      // The tab set itself changes (Readiness appears with the feature).
      observer = new ResizeObserver(onResize);
      observer.observe(el);
      if (strip) observer.observe(strip);
    }
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 769px)") : null;
    mq?.addEventListener("change", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
      mq?.removeEventListener("change", onResize);
    };
  }, [syncEdges, syncOverflow, tabs.length]);

  // Bring the selected tab into view by scrolling the row only — scrollIntoView
  // would be free to move the page vertically as well. Desktop overflow keeps
  // the active tab on screen, so this is the touch-row fallback.
  useEffect(() => {
    const el = scrollerRef.current;
    const active = el?.querySelector<HTMLElement>("button.active");
    if (!el || !active) return;
    const row = el.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.left < row.left) el.scrollLeft -= row.left - tab.left + 8;
    else if (tab.right > row.right) el.scrollLeft += tab.right - row.right + 8;
  }, [activeId]);

  const closeMore = useCallback(() => setMoreOpen(false), []);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (moreTriggerRef.current?.contains(target) || morePanelRef.current?.contains(target)) return;
      setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const moreStyle = useAnchoredPopup({
    open: moreOpen,
    triggerRef: moreTriggerRef,
    popupRef: morePanelRef,
    align: "end",
    maxHeight: 320,
    onClose: closeMore,
  });

  useEffect(() => {
    if (!moreOpen) return;
    const first = morePanelRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [moreOpen, overflowIds]);

  function onMoreMenuKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    const items = [...(morePanelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => {
      event.preventDefault();
      items[((index % items.length) + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") go(current + 1);
    else if (event.key === "ArrowUp") go(current - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(items.length - 1);
  }

  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const shownIds = useOverflowMenu && overflowIds.length > 0 ? visibleIds : tabs.map((t) => t.id);
  const overflowTabs = overflowIds.map((id) => byId.get(id)).filter((tab): tab is ConsoleTab<Id> => Boolean(tab));
  const showMore = useOverflowMenu && overflowTabs.length > 0;

  const className = [
    "console-tabstrip",
    edges.start ? "has-fade-start" : "",
    edges.end ? "has-fade-end" : "",
    showMore ? "has-more" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} ref={stripRef}>
      <div className="console-tabstrip-metrics" aria-hidden ref={metricsRef}>
        <div className="nav console-tabstrip-metrics-row">
          {tabs.map(({ id, label }) => (
            <button key={id} type="button" tabIndex={-1} data-tab-id={id}>
              {label}
            </button>
          ))}
          <button type="button" tabIndex={-1} data-tab-more>
            More ▾
          </button>
        </div>
      </div>
      <nav
        ref={scrollerRef}
        className="nav console-event-tabs"
        aria-label={ariaLabel}
        onScroll={syncEdges}
      >
        {shownIds.map((id) => {
          const tab = byId.get(id);
          if (!tab) return null;
          const button = (
            <button
              type="button"
              className={activeId === tab.id ? "active" : ""}
              onClick={() => onSelect(tab.id)}
            >
              {tab.label}
            </button>
          );
          if (!tab.description && !tab.featureKey) {
            return <span key={tab.id}>{button}</span>;
          }
          return (
            <HoverInfo
              key={tab.id}
              trigger="label"
              hideIcon
              title={tab.label}
              body={tab.description}
              featureKey={tab.featureKey}
            >
              {button}
            </HoverInfo>
          );
        })}
      </nav>
      {showMore ? (
        <>
          <button
            ref={moreTriggerRef}
            type="button"
            className={`console-tabstrip-more${moreOpen ? " is-open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls={moreMenuId}
            onClick={() => setMoreOpen((value) => !value)}
          >
            More ▾
          </button>
          {moreOpen && moreStyle ? (
            <Portal>
              <ul
                id={moreMenuId}
                ref={morePanelRef}
                className="console-tabstrip-more-panel"
                role="menu"
                style={moreStyle}
                onKeyDown={onMoreMenuKeyDown}
              >
                {overflowTabs.map((tab) => {
                  const item = (
                    <button
                      type="button"
                      role="menuitem"
                      className={`kebab-item${activeId === tab.id ? " is-active" : ""}`}
                      onClick={() => {
                        setMoreOpen(false);
                        onSelect(tab.id);
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                  return (
                    <li key={tab.id} role="none">
                      {tab.description || tab.featureKey ? (
                        <HoverInfo
                          trigger="label"
                          hideIcon
                          title={tab.label}
                          body={tab.description}
                          featureKey={tab.featureKey}
                        >
                          {item}
                        </HoverInfo>
                      ) : (
                        item
                      )}
                    </li>
                  );
                })}
              </ul>
            </Portal>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
