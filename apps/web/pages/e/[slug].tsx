import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import { useEffect, useMemo, useState } from "react";
import { AgendaFiltersSheet, DayChips, FilterGroup, dayChipLabel } from "../../components/AgendaFilterPanel";
import { BrandLogo } from "../../components/BrandLogo";
import { SiteFooter } from "../../components/marketing/SiteFooter";
import { filterSessions } from "../../lib/agendaFilters";
import { apiFetch, type AuthResponse, clearAuthClientState } from "../../lib/api";
import { loginPathWithEvent } from "../../lib/entryRedirects";
import { trackColor } from "../../lib/trackColors";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type PublicEventView = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
  venueName: string | null;
  venueAddress: string | null;
  showPoweredByBadge: boolean;
  sessions: Array<{
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    startsAt: string;
    endsAt: string;
    trackName: string | null;
    roomName: string | null;
    speakers: Array<{ name: string }>;
    items: Array<{
      title: string;
      authors: Array<{ name: string }>;
    }>;
  }>;
  speakers: Array<{ name: string; title: string | null; affiliation: string | null }>;
  sponsors: Array<{ name: string; tier: string; url: string | null }>;
};

type Props = {
  event: PublicEventView | null;
  slug: string;
  notFound: boolean;
};

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const slug = typeof ctx.params?.slug === "string" ? ctx.params.slug : "";
  if (!slug || slug === "join") {
    return { notFound: true };
  }

  try {
    const res = await fetch(`${API_URL}/event/public/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { props: { event: null, slug, notFound: true } };
    }
    const event = (await res.json()) as PublicEventView;
    return { props: { event, slug, notFound: false } };
  } catch {
    return { props: { event: null, slug, notFound: true } };
  }
};

function formatRange(startIso: string, endIso: string, timeZone: string): string {
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const d = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const t = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    });
    return `${d.format(start)} · ${t.format(start)}–${t.format(end)} (${timeZone})`;
  } catch {
    return `${startIso} – ${endIso}`;
  }
}

type PublicSession = PublicEventView["sessions"][number];

function zonedDayKey(iso: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(iso));
    const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function slotTimeLabel(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  } catch {
    return iso.slice(11, 16);
  }
}

function timeZoneAbbrev(iso: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date(iso));
    return parts.find((p) => p.type === "timeZoneName")?.value || timeZone;
  } catch {
    return timeZone;
  }
}

function rowTimeRange(startIso: string, endIso: string, timeZone: string): string {
  const fmt = (iso: string) => slotTimeLabel(iso, timeZone);
  return `${fmt(startIso)}–${fmt(endIso)}`;
}

function dayHeading(dayKey: string): { weekday: string; rest: string } {
  const [y, m, d] = dayKey.split("-").map((n) => Number(n));
  if (!y || !m || !d) return { weekday: dayKey, rest: "" };
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(date);
  const rest = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(date);
  return { weekday, rest };
}

/**
 * Public schedule (Phase D2): sticky context bar with day chips, 88px time
 * rail, dense session rows with track color bars, papers nested with authors.
 * Filters run client-side on the SSR data — no extra fetches.
 */
function PublicSchedule({ event, loginHref }: { event: PublicEventView; loginHref: string }) {
  const [query, setQuery] = useState("");
  const [day, setDay] = useState("");
  const [track, setTrack] = useState("");
  const [room, setRoom] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const timeZone = event.timezone;

  /* Map public sessions onto the shared filter shape (track/room names as ids). */
  const filterable = useMemo(
    () =>
      [...event.sessions]
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
        .map((s) => ({
          ...s,
          id: s.id,
          description: s.description,
          location: s.location,
          speakers: s.speakers.map((sp) => sp.name).join(", ") || null,
          trackId: s.trackName || null,
          roomId: s.roomName || null,
          track: s.trackName ? { id: s.trackName, name: s.trackName } : null,
          room: s.roomName ? { id: s.roomName, name: s.roomName } : null,
          items: s.items,
        })),
    [event.sessions],
  );

  const dayOptions = useMemo(
    () => [...new Set(filterable.map((s) => zonedDayKey(s.startsAt, timeZone)))],
    [filterable, timeZone],
  );
  /* First-appearance order (sessions already sorted by startsAt). */
  const trackOptions = useMemo(
    () => [...new Set(filterable.map((s) => s.trackName).filter((t): t is string => Boolean(t)))],
    [filterable],
  );
  const orderedTrackIds = trackOptions;
  const roomOptions = useMemo(
    () => [...new Set(filterable.map((s) => s.roomName).filter((r): r is string => Boolean(r)))],
    [filterable],
  );

  const filtered = useMemo(
    () =>
      filterSessions(
        filterable,
        { trackId: track || null, roomId: room || null, dayKey: day || null, query },
        (iso) => zonedDayKey(iso, timeZone),
      ),
    [filterable, track, room, day, query, timeZone],
  );

  const grouped = useMemo(() => {
    const byDay = new Map<string, typeof filtered>();
    for (const s of filtered) {
      const key = zonedDayKey(s.startsAt, timeZone);
      byDay.set(key, [...(byDay.get(key) || []), s]);
    }
    return [...byDay.entries()].map(([dayKey, daySessions]) => {
      const slots = new Map<string, typeof filtered>();
      for (const s of daySessions) {
        const label = slotTimeLabel(s.startsAt, timeZone);
        slots.set(label, [...(slots.get(label) || []), s]);
      }
      return { dayKey, slots: [...slots.entries()] };
    });
  }, [filtered, timeZone]);

  const activeFilterCount = (track ? 1 : 0) + (room ? 1 : 0) + (query.trim() ? 1 : 0);

  const filterControls = (
    <>
      <input
        className="input"
        type="search"
        placeholder="Search sessions, speakers, papers…"
        aria-label="Search sessions"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <FilterGroup
        label="Day"
        options={dayOptions.map((d) => ({ id: d, label: dayChipLabel(d) }))}
        value={day}
        onChange={setDay}
        allLabel="All days"
      />
      <FilterGroup
        label="Track"
        options={trackOptions.map((t) => ({ id: t, label: t, dot: trackColor(t, null, orderedTrackIds) }))}
        value={track}
        onChange={setTrack}
        allLabel="All tracks"
      />
      <FilterGroup
        label="Room"
        options={roomOptions.map((r) => ({ id: r, label: r }))}
        value={room}
        onChange={setRoom}
        allLabel="All rooms"
      />
    </>
  );

  return (
    <div className="schedule-layout">
      <div className="schedule-list">
        <div className="agenda-context-bar">
          <div className="agenda-context-row">
            <h2 className="text-h2" style={{ margin: 0 }}>
              Schedule
            </h2>
            <span className="agenda-context-spacer" aria-hidden />
            <span className="text-meta">{timeZone}</span>
            <button
              type="button"
              className="button secondary agenda-filters-btn"
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(true)}
            >
              Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
            </button>
          </div>
          <DayChips days={dayOptions} value={day} onChange={setDay} />
        </div>

        {grouped.length === 0 ? (
          <p className="help-text" style={{ padding: "16px 0" }}>
            {event.sessions.length === 0
              ? "Sessions will appear here when published."
              : "No sessions match these filters."}
          </p>
        ) : (
          grouped.map(({ dayKey, slots }) => {
            const { weekday, rest } = dayHeading(dayKey);
            return (
              <section key={dayKey} className="schedule-day">
                <h3 className="schedule-day-heading">
                  <strong>{weekday}</strong>
                  {rest ? `, ${rest}` : null}
                </h3>
                {slots.map(([timeLabel, slotSessions]) => (
                  <div key={`${dayKey}-${timeLabel}`} className="schedule-slot">
                    <div className="schedule-time">
                      <span>{timeLabel}</span>
                      <span className="schedule-time-tz">
                        {timeZoneAbbrev(slotSessions[0]!.startsAt, timeZone)}
                      </span>
                    </div>
                    <div className="schedule-events-wrap">
                      {slotSessions.length > 1 && (
                        <div className="schedule-concurrent-note">{slotSessions.length} concurrent sessions</div>
                      )}
                      <div className="schedule-events">
                        {slotSessions.map((s) => (
                          <article
                            key={s.id}
                            className="schedule-event"
                            style={{ ["--track-color" as string]: trackColor(s.trackName, null, orderedTrackIds) }}
                          >
                            <div className="schedule-event-main">
                              <h4 className="schedule-event-title">
                                <span className="schedule-event-title-text">{s.title}</span>
                                {s.items.length > 0 ? (
                                  <span className="schedule-option-chip">
                                    {s.items.length} paper{s.items.length === 1 ? "" : "s"}
                                  </span>
                                ) : null}
                              </h4>
                              <p className="schedule-event-meta">
                                {rowTimeRange(s.startsAt, s.endsAt, timeZone)}
                                {s.roomName || s.location ? ` · ${s.roomName || s.location}` : ""}
                                {s.trackName ? ` · ${s.trackName}` : ""}
                              </p>
                              {s.speakers ? <p className="schedule-event-speakers">{s.speakers}</p> : null}
                              {s.items.length > 0 ? (
                                <ul className="schedule-row-papers">
                                  {s.items.map((it, idx) => (
                                    <li key={`${s.id}-item-${idx}`} className="schedule-row-paper">
                                      <span className="schedule-row-paper-title">{it.title}</span>
                                      {it.authors.length ? it.authors.map((a) => a.name).join(", ") : null}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            );
          })
        )}

        <p style={{ marginTop: 16 }}>
          <Link href={loginHref} className="button secondary">
            Join to build your schedule
          </Link>
        </p>
      </div>

      <aside className="agenda-rail" aria-label="Schedule filters">
        <div className="agenda-rail-panel">{filterControls}</div>
      </aside>

      <AgendaFiltersSheet open={filtersOpen} onClose={() => setFiltersOpen(false)}>
        {filterControls}
      </AgendaFiltersSheet>
    </div>
  );
}

export default function PublicEventPage({ event, slug, notFound }: Props) {
  /**
   * Browse-only: do NOT write activeEventId / linkedEventContext here.
   * Only explicit join/switch (login?event=, /e/join, invite) may change context.
   */
  const [viewer, setViewer] = useState<AuthResponse["user"] | null>(null);
  const [viewerChecked, setViewerChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AuthResponse["user"]>("/auth/me")
      .then((me) => {
        if (!cancelled) setViewer(me);
      })
      .catch(() => {
        if (!cancelled) setViewer(null);
      })
      .finally(() => {
        if (!cancelled) setViewerChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (notFound || !event) {
    return (
      <>
        <Head>
          <title>{`Event not found — ${brand.productName}`}</title>
          <meta name="robots" content="noindex" />
        </Head>
        <div className="container" style={{ paddingTop: 48 }}>
          <BrandLogo size={48} />
          <h1 className="text-display-md">Event not found</h1>
          <p className="help-text">This link may be private, expired, or not yet published.</p>
          <p>
            <Link href="/">Home</Link>
            {" · "}
            <Link href="/login">Sign in</Link>
          </p>
        </div>
      </>
    );
  }

  const title = `${event.name} — ${brand.productName}`;
  const description =
    event.description?.trim().slice(0, 200) ||
    `${event.name} · ${formatRange(event.startDate, event.endDate, event.timezone)}`;
  const canonical = `${brand.primaryUrl}/e/${event.slug}`;
  const ogImage = event.bannerUrl || event.logoUrl || `${brand.primaryUrl}/icons/icon-512.png`;
  const loginHref = loginPathWithEvent(event.slug);

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:site_name" content={brand.productName} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <link rel="canonical" href={canonical} />
        {/* Customer events are not auto-indexed — opt-in later. Demo may be listed in sitemap. */}
        {slug === brand.demoEventSlug ? null : <meta name="robots" content="noindex, follow" />}
      </Head>

      <div className="mkt-page">
        <header className="mkt-header">
          <div className="mkt-header-inner">
            <Link href="/" className="mkt-header-brand">
              <BrandLogo size={32} />
              <span>{brand.productName}</span>
            </Link>
            <nav className="mkt-header-nav" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {viewerChecked && viewer ? (
                <>
                  <Link href="/dashboard" className="button" style={{ minHeight: 40, padding: "8px 14px" }}>
                    Open event app
                  </Link>
                  <Link
                    href="/account"
                    className="shell-avatar-button"
                    aria-label={`Account — ${viewer.name}`}
                    title={viewer.name}
                    style={{ textDecoration: "none" }}
                  >
                    {viewer.photoUrl ? (
                      <img src={viewer.photoUrl} alt="" />
                    ) : (
                      (viewer.name || "?").trim().charAt(0).toUpperCase() || "?"
                    )}
                  </Link>
                  <button
                    type="button"
                    className="button secondary"
                    style={{ minHeight: 40, padding: "8px 12px" }}
                    onClick={() => {
                      clearAuthClientState();
                      window.location.href = loginHref;
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <Link href={loginHref} className="button" style={{ minHeight: 40, padding: "8px 14px" }}>
                  Join / Sign in
                </Link>
              )}
            </nav>
          </div>
        </header>

        <main className="mkt-section" style={{ background: "var(--gray-50)" }}>
          <div className="mkt-section-inner" style={{ maxWidth: 1040 }}>
            <p className="text-meta" style={{ marginBottom: 8 }}>
              {formatRange(event.startDate, event.endDate, event.timezone)}
            </p>
            <h1 className="text-h1" style={{ marginTop: 0, marginBottom: 8 }}>
              {event.name}
            </h1>
            {(event.venueName || event.venueAddress) && (
              <p className="text-body" style={{ margin: "0 0 4px" }}>
                {[event.venueName, event.venueAddress].filter(Boolean).join(" · ")}
              </p>
            )}
            {event.description ? (
              <p className="text-body" style={{ whiteSpace: "pre-wrap", maxWidth: 720 }}>
                {event.description}
              </p>
            ) : null}

            <p style={{ margin: "16px 0 24px" }}>
              {viewer ? (
                <Link href="/dashboard" className="button">
                  Open event app
                </Link>
              ) : (
                <Link href={loginHref} className="button">
                  Join this event
                </Link>
              )}
            </p>

            <PublicSchedule event={event} loginHref={loginHref} />

            {event.speakers.length > 0 ? (
              <>
                <h2 className="text-h2" style={{ marginTop: 40 }}>Speakers</h2>
                <ul className="mkt-speaker-list">
                  {event.speakers.map((sp) => (
                    <li key={sp.name}>
                      <strong>{sp.name}</strong>
                      {(sp.title || sp.affiliation) && (
                        <span className="text-meta">
                          {" "}
                          — {[sp.title, sp.affiliation].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {event.sponsors.length > 0 ? (
              <>
                <h2 className="text-h2" style={{ marginTop: 40 }}>Sponsors</h2>
                <ul className="mkt-sponsor-list">
                  {event.sponsors.map((sp) => (
                    <li key={sp.name}>
                      {sp.url ? (
                        <a href={sp.url} rel="noopener noreferrer">
                          {sp.name}
                        </a>
                      ) : (
                        sp.name
                      )}{" "}
                      <span className="text-meta">({sp.tier})</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {event.showPoweredByBadge ? (
              <p className="text-meta" style={{ marginTop: 40, opacity: 0.75 }}>
                Powered by {brand.productName}
              </p>
            ) : null}
          </div>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
