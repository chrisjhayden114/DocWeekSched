import type { ReactNode } from "react";
import { initialsFor } from "./kitHelpers";

export type PillTone = "neutral" | "primary" | "success" | "warning" | "danger" | "live";

export type FeedCardPill = { label: string; tone?: PillTone };

export type FeedCardProps = {
  /** Display name shown in the byline. */
  name: string;
  /** Meta line beside the name: "Presenter · 2h ago". */
  meta: string;
  /** Avatar initials; derived from the name when omitted. */
  initials?: string;
  /** Optional status pill in role colors, e.g. { label: "Organizer", tone: "primary" }. */
  pill?: FeedCardPill;
  /** The card body (title, caption). Omitted for photo-only untitled posts. */
  children?: ReactNode;
  /** Optional media (photo grid) — sits after the body, or first when `photoFirst`. */
  media?: ReactNode;
  /**
   * Photo-only / untitled posts: media, then the author line, then any
   * remaining body. Title is never rendered by this flag — the caller omits it.
   */
  photoFirst?: boolean;
  /** Inline action row — usually ghost buttons ("Reply", "Agree"). */
  actions?: ReactNode;
};

export { initialsFor };

/**
 * F1.2 #3 — the rich, scannable card: a glance says who, what and what
 * you can do. Avatar/initials + name + meta + optional status pill +
 * body + inline actions.
 */
export function FeedCard({ name, meta, initials, pill, children, media, photoFirst, actions }: FeedCardProps) {
  const head = (
    <div className="kit-feed-card-head">
      <span className="kit-avatar" aria-hidden>
        {initials ?? initialsFor(name)}
      </span>
      <div className="kit-feed-card-byline">
        <p className="kit-feed-card-name">{name}</p>
        <p className="kit-feed-card-meta">{meta}</p>
      </div>
      {pill ? <span className={`kit-status-pill kit-status-pill--${pill.tone ?? "neutral"}`}>{pill.label}</span> : null}
    </div>
  );
  const className = ["kit-feed-card", photoFirst ? "kit-feed-card--photo-first" : ""].filter(Boolean).join(" ");
  return (
    <article className={className}>
      {photoFirst && media ? <div className="kit-feed-card-media">{media}</div> : null}
      {head}
      {children ? <div className="kit-feed-card-body">{children}</div> : null}
      {!photoFirst && media ? <div className="kit-feed-card-media">{media}</div> : null}
      {actions ? <div className="kit-feed-card-actions">{actions}</div> : null}
    </article>
  );
}
