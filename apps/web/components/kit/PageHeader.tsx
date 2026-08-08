import type { ReactNode } from "react";

export type IconTone = "primary" | "success" | "warning" | "danger" | "live" | "neutral";

export type PageHeaderProps = {
  title: string;
  /** One-line state under the title: "Draft · Jun 8–10 · 3 steps from publishing." */
  state?: string;
  /** Primary action, right-aligned — usually one `.button`. */
  action?: ReactNode;
  /** Optional section-identity icon, rendered in a tinted tile. */
  icon?: ReactNode;
  iconTone?: IconTone;
};

/**
 * F1.2 #1 — the wayfinding header for every page (audit Theme B: no
 * consistent header exists today). Title + one-line state + primary
 * action; the tinted icon tile gives sections a stable identity using
 * the existing role tints only.
 */
export function PageHeader({ title, state, action, icon, iconTone = "primary" }: PageHeaderProps) {
  return (
    <header className="kit-page-header">
      {icon ? (
        <span className={`kit-icon-tile kit-icon-tile--${iconTone}`} aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="kit-page-header-titles">
        <h1 className="text-h1" style={{ margin: 0 }}>
          {title}
        </h1>
        {state ? <p className="kit-page-header-state">{state}</p> : null}
      </div>
      {action ? <div className="kit-page-header-action">{action}</div> : null}
    </header>
  );
}
