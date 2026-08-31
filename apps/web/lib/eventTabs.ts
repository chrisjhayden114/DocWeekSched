/**
 * Organizer event-console tabs. The URL `?tab=` value is resolved here so
 * unknown or legacy ids never reach render — they fall back to Overview
 * and the query is rewritten to match.
 *
 * Participants is still the invites surface (INV-1). The strip id stays
 * `invites`; the public query spelling is `participants`. `?tab=invites`
 * is the legacy id and redirects to `participants`.
 */

export const EVENT_TABS = [
  "overview",
  "program",
  "people",
  "readiness",
  "invites",
  "maps",
  "announcements",
  "features",
  "ops",
  "recap",
  "certificates",
] as const;

export type EventTab = (typeof EVENT_TABS)[number];

/** Every id that has ever been a valid `?tab=` value, plus public aliases. */
export const HISTORICAL_EVENT_TAB_IDS = [
  "overview",
  "program",
  "people",
  "invites",
  "participants",
  "maps",
  "announcements",
  "ops",
  "readiness",
  "recap",
  "features",
  "certificates",
] as const;

const EVENT_TAB_SET = new Set<string>(EVENT_TABS);

/**
 * Legacy / alternate query spellings → current strip id.
 * `invites` stays a real tab (Participants); `participants` is the public URL.
 */
const EVENT_TAB_ALIASES: Readonly<Record<string, EventTab>> = {
  participants: "invites",
};

export type ResolvedEventTab = {
  tab: EventTab;
  /** Value to write to `?tab=` (`undefined` = omit, i.e. Overview). */
  urlTab: string | undefined;
  /** True when the incoming query does not already match `urlTab`. */
  rewrite: boolean;
};

function asTabParam(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return undefined;
}

export function isEventTab(value: string): value is EventTab {
  return EVENT_TAB_SET.has(value);
}

/** Canonical query value for a strip id. Participants publishes as `participants`. */
export function eventTabQueryValue(tab: EventTab): string | undefined {
  if (tab === "overview") return undefined;
  if (tab === "invites") return "participants";
  return tab;
}

export function applyEventTabToQuery(query: Record<string, string>, tab: EventTab): void {
  const value = eventTabQueryValue(tab);
  if (value) query.tab = value;
  else delete query.tab;
}

/**
 * Map any `?tab=` value to a tab that is safe to render. Never throws.
 * Unknown / junk values become Overview and ask the caller to drop the param.
 */
export function resolveEventTab(raw: unknown): ResolvedEventTab {
  const param = asTabParam(raw);
  if (param == null || param === "") {
    return { tab: "overview", urlTab: undefined, rewrite: false };
  }

  const aliased = EVENT_TAB_ALIASES[param];
  const tab: EventTab = aliased ?? (isEventTab(param) ? param : "overview");
  const urlTab = eventTabQueryValue(tab);
  const known = Boolean(aliased) || isEventTab(param);
  const rewrite = !known || param !== (urlTab ?? "overview");
  return { tab, urlTab, rewrite };
}
