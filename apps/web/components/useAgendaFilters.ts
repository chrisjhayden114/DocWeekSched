/**
 * AGENDA-2 — agenda filter state, held in the URL.
 *
 * The query string is the single source of truth for what an attendee is
 * looking at, so a filtered agenda is a link they can send ("here are the three
 * workshops on Tuesday") and a state that survives a refresh or a back button.
 * Before this, every filter was component state and a narrowed agenda could
 * only be described in words.
 *
 * Two deliberate choices:
 *
 *   The URL leads, but only when it changed underneath us. The public page is
 *   server-rendered *unfiltered* — SSR has no business guessing a reader's
 *   filters, and rendering a filtered program on the server would mean the
 *   crawler and the unfurl see a subset of the event — so the query is applied
 *   on the client. It is re-applied whenever the query becomes something this
 *   hook did not write, which is what makes the back button work: a `shallow`
 *   replace changes the URL without remounting anything, so without this the
 *   address bar and the rail would drift apart.
 *
 *   Writes happen only on user action, never on mount. An effect that synced
 *   state → URL on every render would rewrite the URL on first paint, which
 *   both churns history and fights the read above.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import {
  EMPTY_AGENDA_FILTERS,
  FILTER_QUERY_KEYS,
  filtersFromQuery,
  filtersToQuery,
  type AgendaFilters,
} from "../lib/agendaFilters";

export type UseAgendaFilters = {
  filters: AgendaFilters;
  setFilters: (next: AgendaFilters) => void;
  /** False until the query has been read, so a page can avoid a filtered flash. */
  ready: boolean;
};

export type UseAgendaFiltersOptions = {
  /**
   * Whether this page has a "my schedule" to filter down to. False on the
   * public agenda, where `?mine=1` can only arrive by someone pasting an
   * in-app link: the filter would do nothing, but it would still light up the
   * Filters badge and claim the agenda was narrowed. Dropping it keeps the
   * badge honest.
   */
  mySchedule?: boolean;
};

export function useAgendaFilters(options?: UseAgendaFiltersOptions): UseAgendaFilters {
  const supportsMySchedule = options?.mySchedule !== false;
  const router = useRouter();
  const [filters, setFiltersState] = useState<AgendaFilters>(EMPTY_AGENDA_FILTERS);
  const [ready, setReady] = useState(false);
  /**
   * The filter query this hook last wrote, canonicalized.
   *
   * Without it the effect below would fight `setFilters`: state updates
   * synchronously while `router.query` catches up a tick later, so the effect
   * would briefly see new state alongside the old URL and reset the filters
   * the reader just set. Comparing against what we wrote — rather than against
   * current state — makes "the URL changed underneath us" the only trigger.
   */
  const lastWritten = useRef<string | null>(null);

  useEffect(() => {
    if (!router.isReady) return;
    const fromUrl = filtersFromQuery(router.query);
    if (!supportsMySchedule) fromUrl.mySchedule = false;
    const key = JSON.stringify(filtersToQuery(fromUrl));
    if (key !== lastWritten.current) {
      lastWritten.current = key;
      setFiltersState(fromUrl);
    }
    if (!ready) setReady(true);
  }, [router.isReady, router.query, ready, supportsMySchedule]);

  const setFilters = useCallback(
    (incoming: AgendaFilters) => {
      const next = supportsMySchedule ? incoming : { ...incoming, mySchedule: false };
      setFiltersState(next);
      lastWritten.current = JSON.stringify(filtersToQuery(next));
      // Keep every query key that is not ours — the public page's `slug` and
      // the dashboard's `tab` both live here.
      const preserved: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(router.query)) {
        if (value === undefined) continue;
        if ((FILTER_QUERY_KEYS as readonly string[]).includes(key)) continue;
        preserved[key] = value;
      }
      void router.replace(
        { pathname: router.pathname, query: { ...preserved, ...filtersToQuery(next) } },
        undefined,
        { shallow: true },
      );
    },
    [router, supportsMySchedule],
  );

  return { filters, setFilters, ready };
}
