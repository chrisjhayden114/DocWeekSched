import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import { useEffect } from "react";
import { BrandLogo } from "../../components/BrandLogo";
import { SiteFooter } from "../../components/marketing/SiteFooter";
import { writeClientStorage } from "../../lib/clientStorage";
import { loginPathWithEvent } from "../../lib/entryRedirects";

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

export default function PublicEventPage({ event, slug, notFound }: Props) {
  useEffect(() => {
    if (!event) return;
    try {
      window.localStorage.setItem("activeEventId", event.id);
      writeClientStorage(
        window.sessionStorage,
        "linkedEventContext",
        JSON.stringify({ id: event.id, name: event.name }),
      );
    } catch {
      /* ignore */
    }
  }, [event]);

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
            <nav className="mkt-header-nav">
              <Link href={loginHref} className="button" style={{ minHeight: 40, padding: "8px 14px" }}>
                Join / Sign in
              </Link>
            </nav>
          </div>
        </header>

        <main className="mkt-section">
          <div className="mkt-section-inner" style={{ maxWidth: 800 }}>
            <p className="text-meta" style={{ marginBottom: 8 }}>
              {formatRange(event.startDate, event.endDate, event.timezone)}
            </p>
            <h1 className="text-display-xl" style={{ marginTop: 0 }}>
              {event.name}
            </h1>
            {(event.venueName || event.venueAddress) && (
              <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
                {[event.venueName, event.venueAddress].filter(Boolean).join(" · ")}
              </p>
            )}
            {event.description ? (
              <p className="text-body-lg" style={{ whiteSpace: "pre-wrap" }}>
                {event.description}
              </p>
            ) : null}

            <p style={{ marginTop: 24 }}>
              <Link href={loginHref} className="button">
                Join this event
              </Link>
            </p>

            <h2 className="text-display-md">Schedule</h2>
            {event.sessions.length === 0 ? (
              <p className="help-text">Sessions will appear here when published.</p>
            ) : (
              <ol className="mkt-session-list">
                {event.sessions.map((s) => (
                  <li key={s.id}>
                    <p className="text-meta" style={{ marginBottom: 4 }}>
                      {formatRange(s.startsAt, s.endsAt, event.timezone)}
                      {s.trackName ? ` · ${s.trackName}` : ""}
                      {s.roomName || s.location ? ` · ${s.roomName || s.location}` : ""}
                    </p>
                    <h3 className="text-display-sm" style={{ margin: "0 0 6px" }}>
                      {s.title}
                    </h3>
                    {s.speakers.length > 0 ? (
                      <p className="text-body-md" style={{ margin: "0 0 6px", color: "var(--ink-secondary)" }}>
                        {s.speakers.map((sp) => sp.name).join(", ")}
                      </p>
                    ) : null}
                    {s.items.length > 0 ? (
                      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                        {s.items.map((it, idx) => (
                          <li key={`${s.id}-item-${idx}`} className="text-body-md">
                            {it.title}
                            {it.authors.length ? (
                              <span className="text-meta"> — {it.authors.map((a) => a.name).join(", ")}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}

            {event.speakers.length > 0 ? (
              <>
                <h2 className="text-display-md">Speakers</h2>
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
                <h2 className="text-display-md">Sponsors</h2>
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
