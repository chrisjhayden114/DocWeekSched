import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Phase D app shell (DESIGN_PHASE_D.md Part 2 "Layout architecture").
 *
 * Desktop ≥1024px: persistent 240px left sidebar with grouped, labeled nav
 * + top bar (event name, global search placeholder, avatar menu).
 * Below 1024px: bottom tab bar (up to 3 primary items + "More" sheet).
 * Content column: max-width 1040px, left-aligned, 24px padding.
 *
 * Purely presentational — navigation items are links or callbacks supplied
 * by the page; the shell adds no API calls.
 */

export type ShellNavItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  badge?: number;
};

export type ShellNavGroup = {
  id: string;
  label: string;
  items: ShellNavItem[];
};

export type ShellMenuItem = {
  id: string;
  label: string;
  href?: string;
  onSelect?: () => void;
  tone?: "danger" | "default";
};

type AppShellProps = {
  /** Event (or workspace) name shown in the top bar. */
  title: string;
  /** Small logo url shown next to the title, when the event has one. */
  logoUrl?: string | null;
  nav: ShellNavGroup[];
  /** Item ids for the mobile bottom tab bar (max 3; "More" is added). */
  mobilePrimaryIds?: string[];
  /** Initial for the avatar button, e.g. user name. */
  userName?: string | null;
  userPhotoUrl?: string | null;
  userMeta?: string | null;
  accountMenu?: ShellMenuItem[];
  /** Extra elements rendered in the top bar, left of the avatar. */
  topBarExtra?: ReactNode;
  children: ReactNode;
};

function NavItemView({ item, onNavigate }: { item: ShellNavItem; onNavigate?: () => void }) {
  const className = `shell-nav-item${item.active ? " is-active" : ""}`;
  const inner = (
    <>
      {item.icon}
      <span>{item.label}</span>
      {item.badge ? <span className="nav-unread-badge">{item.badge}</span> : null}
    </>
  );
  if (item.href) {
    return (
      <Link
        href={item.href}
        className={className}
        aria-current={item.active ? "page" : undefined}
        onClick={onNavigate}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      aria-current={item.active ? "page" : undefined}
      onClick={() => {
        item.onSelect?.();
        onNavigate?.();
      }}
    >
      {inner}
    </button>
  );
}

function AvatarMenu({
  userName,
  userPhotoUrl,
  userMeta,
  items,
}: {
  userName?: string | null;
  userPhotoUrl?: string | null;
  userMeta?: string | null;
  items: ShellMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
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

  const initial = (userName || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="shell-avatar-menu" ref={wrapRef}>
      <button
        type="button"
        className="shell-avatar-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
      >
        {userPhotoUrl ? <img src={userPhotoUrl} alt="" /> : initial}
      </button>
      {open ? (
        <ul className="shell-avatar-panel" role="menu">
          {userName ? (
            <li className="shell-avatar-panel-header" role="none">
              <span className="text-label" style={{ display: "block", color: "var(--gray-900)" }}>
                {userName}
              </span>
              {userMeta ? <span className="text-meta">{userMeta}</span> : null}
            </li>
          ) : null}
          {items.map((item) => (
            <li key={item.id} role="none">
              {item.href ? (
                <Link
                  href={item.href}
                  role="menuitem"
                  className={`kebab-item${item.tone === "danger" ? " is-danger" : ""}`}
                  style={{ display: "block", textDecoration: "none" }}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={`kebab-item${item.tone === "danger" ? " is-danger" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect?.();
                  }}
                >
                  {item.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AppShell({
  title,
  logoUrl,
  nav,
  mobilePrimaryIds,
  userName,
  userPhotoUrl,
  userMeta,
  accountMenu = [],
  topBarExtra,
  children,
}: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const allItems = nav.flatMap((group) => group.items);
  const primaryIds = (mobilePrimaryIds ?? allItems.slice(0, 3).map((i) => i.id)).slice(0, 3);
  const primaryItems = primaryIds
    .map((id) => allItems.find((i) => i.id === id))
    .filter((i): i is ShellNavItem => Boolean(i));
  const moreGroups = nav
    .map((group) => ({ ...group, items: group.items.filter((i) => !primaryIds.includes(i.id)) }))
    .filter((group) => group.items.length > 0);
  const moreHasActive = moreGroups.some((g) => g.items.some((i) => i.active));
  const moreBadge = moreGroups.reduce(
    (sum, g) => sum + g.items.reduce((s, i) => s + (i.badge || 0), 0),
    0,
  );

  return (
    <div className="shell">
      <aside className="shell-sidebar" aria-label="Main navigation">
        <Link href="/dashboard" className="shell-sidebar-brand">
          {logoUrl ? <img src={logoUrl} alt="" className="shell-topbar-logo" /> : null}
          <span className="shell-topbar-title-text">{title}</span>
        </Link>
        <nav>
          {nav.map((group) => (
            <div key={group.id} className="shell-nav-group">
              <span className="shell-nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <NavItemView key={item.id} item={item} />
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="shell-main">
        <header className="shell-topbar">
          <span className="shell-topbar-title">
            {logoUrl ? <img src={logoUrl} alt="" className="shell-topbar-logo" /> : null}
            <span className="shell-topbar-title-text">{title}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: "var(--gray-400)", flexShrink: 0 }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
          <div className="shell-topbar-search">
            <input className="input" type="search" placeholder="Search" aria-label="Search" readOnly />
          </div>
          <div className="shell-topbar-actions">
            {topBarExtra}
            <AvatarMenu userName={userName} userPhotoUrl={userPhotoUrl} userMeta={userMeta} items={accountMenu} />
          </div>
        </header>

        <main className="shell-content">{children}</main>
      </div>

      <nav className="shell-bottombar" aria-label="Main navigation">
        {primaryItems.map((item) =>
          item.href ? (
            <Link
              key={item.id}
              href={item.href}
              className={`shell-bottombar-item${item.active ? " is-active" : ""}`}
              aria-current={item.active ? "page" : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge ? <span className="nav-unread-badge shell-bottombar-badge">{item.badge}</span> : null}
            </Link>
          ) : (
            <button
              key={item.id}
              type="button"
              className={`shell-bottombar-item${item.active ? " is-active" : ""}`}
              aria-current={item.active ? "page" : undefined}
              onClick={() => item.onSelect?.()}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge ? <span className="nav-unread-badge shell-bottombar-badge">{item.badge}</span> : null}
            </button>
          ),
        )}
        {moreGroups.length > 0 ? (
          <button
            type="button"
            className={`shell-bottombar-item${moreHasActive ? " is-active" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
            <span>More</span>
            {moreBadge ? <span className="nav-unread-badge shell-bottombar-badge">{moreBadge}</span> : null}
          </button>
        ) : null}
      </nav>

      {moreOpen ? (
        <div className="shell-sheet-backdrop" role="presentation" onClick={() => setMoreOpen(false)}>
          <div
            className="shell-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            onClick={(e) => e.stopPropagation()}
          >
            {moreGroups.map((group) => (
              <div key={group.id} className="shell-nav-group">
                <span className="shell-nav-group-label">{group.label}</span>
                {group.items.map((item) => (
                  <NavItemView key={item.id} item={item} onNavigate={() => setMoreOpen(false)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
