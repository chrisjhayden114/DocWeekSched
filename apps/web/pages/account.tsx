import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { apiFetch, clearAuthClientState } from "../lib/api";

/**
 * Account self-service: GDPR JSON export (Chunk B).
 * Deletion UI intentionally omitted until cascade design is approved.
 */
export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiFetch<{ id: string; email: string; name: string }>("/auth/me");
        if (!cancelled) {
          setEmail(me.email);
          window.localStorage.setItem("user", JSON.stringify(me));
        }
      } catch {
        if (!cancelled) {
          clearAuthClientState();
          window.location.href = "/login";
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const downloadExport = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const data = await apiFetch<Record<string, unknown>>("/account/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `account-export-${brand.productName.toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, []);

  return (
    <>
      <Head>
        <title>{`Account — ${brand.productName}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="container" style={{ paddingTop: 32, maxWidth: 640 }}>
        <div className="login-brand" style={{ marginBottom: 16 }}>
          <BrandLogo size={40} />
          <div>
            <p className="text-meta" style={{ margin: 0 }}>
              {brand.productName}
            </p>
            <h1 className="text-display-md" style={{ margin: "4px 0 0" }}>
              Account
            </h1>
          </div>
        </div>
        <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
          {email ? (
            <>
              Signed in as <strong>{email}</strong>.
            </>
          ) : (
            "Loading…"
          )}
        </p>

        <section className="card" style={{ marginTop: 24, padding: 20 }}>
          <h2 className="text-display-sm" style={{ marginTop: 0 }}>
            Download your data
          </h2>
          <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
            Export a JSON file with your profile, memberships, attendance, check-ins, and message
            metadata (your messages only — no other users&apos; PII). See the{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
          <button type="button" className="button" disabled={exporting || !email} onClick={() => void downloadExport()}>
            {exporting ? "Preparing…" : "Download JSON export"}
          </button>
          {error ? <p style={{ color: "var(--danger-700)" }}>{error}</p> : null}
        </section>

        <p className="text-meta" style={{ marginTop: 24 }}>
          Account deletion will be available after cascade rules are reviewed.{" "}
          <Link href="/dashboard">Back to dashboard</Link>
          {" · "}
          <Link href="/security">Security</Link>
        </p>
      </div>
    </>
  );
}
