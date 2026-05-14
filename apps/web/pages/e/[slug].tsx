import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { EventPilotLogo } from "../../components/EventPilotLogo";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const LINKED_EVENT_STORAGE_KEY = "eventPilotLinkedContext";

type PublicEvent = { id: string; name: string; slug: string };

export default function EventJoinLinkPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : null;
  const [error, setError] = useState<string | null>(null);
  const [eventPreview, setEventPreview] = useState<PublicEvent | null>(null);

  useEffect(() => {
    if (!slug || router.isReady === false) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/event/slug/${encodeURIComponent(slug)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Event not found");
        }
        const ev = data as PublicEvent;
        if (cancelled) return;
        setEventPreview(ev);
        window.localStorage.setItem("activeEventId", ev.id);
        try {
          window.sessionStorage.setItem(
            LINKED_EVENT_STORAGE_KEY,
            JSON.stringify({ id: ev.id, name: ev.name }),
          );
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 400));
        if (cancelled) return;
        window.location.replace(`/?event=${encodeURIComponent(ev.id)}`);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not open this event link.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, router.isReady]);

  if (!slug) {
    return null;
  }

  const title = eventPreview ? `${eventPreview.name} — EventPilot` : "Opening event — EventPilot";

  return (
    <div className="container">
      <Head>
        <title>{title}</title>
      </Head>
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="login-brand" style={{ marginBottom: 16 }}>
          <EventPilotLogo size={48} className="login-brand-logo" />
          <div className="login-brand-text">
            <h1 style={{ marginTop: 0 }}>EventPilot</h1>
            {eventPreview ? (
              <p className="login-guest-event-name" style={{ margin: "6px 0 0" }}>
                {eventPreview.name}
              </p>
            ) : null}
          </div>
        </div>
        {error ? (
          <p style={{ color: "#b42318" }}>{error}</p>
        ) : (
          <p className="help-text" style={{ margin: 0 }}>
            {eventPreview
              ? "Taking you to sign in for this conference…"
              : `We're opening your conference link (${slug})…`}
          </p>
        )}
      </div>
    </div>
  );
}
