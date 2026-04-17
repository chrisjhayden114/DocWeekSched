import { useRouter } from "next/router";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type PublicEvent = { id: string; name: string; slug: string };

export default function EventJoinLinkPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : null;
  const [error, setError] = useState<string | null>(null);

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
        window.localStorage.setItem("activeEventId", ev.id);
        window.location.replace("/");
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

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 480 }}>
        <h1 style={{ marginTop: 0 }}>Opening event…</h1>
        {error ? (
          <p style={{ color: "#b42318" }}>{error}</p>
        ) : (
          <p className="help-text" style={{ margin: 0 }}>
            We&apos;re loading <strong>{slug}</strong> and switching your active conference.
          </p>
        )}
      </div>
    </div>
  );
}
