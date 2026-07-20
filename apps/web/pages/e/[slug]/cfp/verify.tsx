import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { API_URL } from "../../../../lib/api";

export default function CfpVerifyPage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";
  const [status, setStatus] = useState<"working" | "ok" | "err">("working");
  const [message, setMessage] = useState("Confirming your submission…");
  const [accessUrl, setAccessUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !router.isReady) return;
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/cfp/public/verify`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Verification failed");
        setStatus("ok");
        setMessage(`Confirmed: ${json.title || "submission"}`);
        setAccessUrl(json.accessUrl || null);
      } catch (err) {
        setStatus("err");
        setMessage(err instanceof Error ? err.message : "Verification failed");
      }
    })();
  }, [token, router.isReady]);

  return (
    <>
      <Head>
        <title>Confirm submission — {brand.productName}</title>
      </Head>
      <main className="page" style={{ maxWidth: 520, margin: "0 auto", padding: 24 }}>
        <h1>Email confirmation</h1>
        <p style={{ color: status === "err" ? "var(--danger-700)" : undefined }}>{message}</p>
        {accessUrl ? (
          <p>
            <Link className="button" href={accessUrl.replace(typeof window !== "undefined" ? window.location.origin : "", "") || accessUrl}>
              View your submission
            </Link>
          </p>
        ) : null}
        {status === "ok" && accessUrl?.includes("/e/") ? (
          <p className="help-text">
            <Link href={accessUrl.startsWith("http") ? new URL(accessUrl).pathname + new URL(accessUrl).search : accessUrl}>
              Open submission link
            </Link>
          </p>
        ) : null}
      </main>
    </>
  );
}
