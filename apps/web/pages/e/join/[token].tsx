import { brand } from "@event-app/config";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { EventPilotLogo } from "../../components/EventPilotLogo";
import { API_URL } from "../../lib/api";

/**
 * Attendee entry via opaque join token (permanent ID link).
 * Resolves strictly through GET /event/join/:token — never accepts raw event CUIDs as slug.
 */
export default function JoinByTokenPage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!router.isReady || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/event/join/${encodeURIComponent(token)}`, { credentials: "include" });
        const data = (await res.json().catch(() => ({}))) as { id?: string; name?: string; slug?: string };
        if (!res.ok || !data.id) {
          if (!cancelled) setError("This event link is invalid, expired, or has been revoked.");
          return;
        }
        window.localStorage.setItem("activeEventId", data.id);
        if (data.name) {
          try {
            window.sessionStorage.setItem(
              "eventPilotLinkedContext",
              JSON.stringify({ id: data.id, name: data.name }),
            );
          } catch {
            /* ignore */
          }
        }
        window.location.href = `/?event=${encodeURIComponent(data.slug || data.id)}`;
      } catch {
        if (!cancelled) setError("Could not open this event link.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router.isReady, token]);

  return (
    <>
      <Head>
        <title>{`Opening event — ${brand.productName}`}</title>
      </Head>
      <div className="container" style={{ paddingTop: 48, textAlign: "center" }}>
        <EventPilotLogo size={48} className="login-brand-logo" />
        <h1 style={{ marginTop: 16 }}>{brand.productName}</h1>
        {error ? <p style={{ color: "var(--danger, #c22f2f)" }}>{error}</p> : <p className="muted">Opening your event…</p>}
      </div>
    </>
  );
}
