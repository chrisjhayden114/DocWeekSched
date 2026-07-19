import { brand } from "@event-app/config";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { BrandLogo } from "../../../components/BrandLogo";
import { API_URL } from "../../../lib/api";
import { writeClientStorage } from "../../../lib/clientStorage";
import { loginPathWithEvent } from "../../../lib/entryRedirects";

/**
 * Attendee entry via opaque join token.
 * Resolves through GET /event/join/:token, then sends the user to /login?event=<slug>
 * with linked context written (dual-read keys).
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
            writeClientStorage(
              window.sessionStorage,
              "linkedEventContext",
              JSON.stringify({ id: data.id, name: data.name }),
            );
          } catch {
            /* ignore */
          }
        }
        const dest = loginPathWithEvent(data.slug || data.id);
        window.location.href = dest;
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
        <meta name="robots" content="noindex" />
      </Head>
      <div className="container" style={{ paddingTop: 48, textAlign: "center" }}>
        <BrandLogo size={48} className="login-brand-logo" />
        <h1 style={{ marginTop: 16 }}>{brand.productName}</h1>
        {error ? (
          <p style={{ color: "var(--danger-700)" }}>{error}</p>
        ) : (
          <p className="muted">Opening your event…</p>
        )}
      </div>
    </>
  );
}

/** Pure helper exported for redirect-contract tests. */
export function joinTokenLoginDestination(slugOrId: string): string {
  return loginPathWithEvent(slugOrId);
}
