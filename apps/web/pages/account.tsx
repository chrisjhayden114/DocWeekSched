import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { apiFetch, clearAuthClientState } from "../lib/api";

type DeletionStatus =
  | { pending: false }
  | { pending: true; scheduledFor: string; requestedAt: string };

/**
 * Account self-service: GDPR JSON export + account deletion (7-day grace).
 */
export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deletion, setDeletion] = useState<DeletionStatus | null>(null);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  const refreshDeletion = useCallback(async () => {
    try {
      const status = await apiFetch<DeletionStatus>("/account/deletion");
      setDeletion(status);
    } catch {
      setDeletion({ pending: false });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiFetch<{ id: string; email: string; name: string }>("/auth/me");
        if (!cancelled) {
          setEmail(me.email);
          setDeleteEmail(me.email);
          window.localStorage.setItem("user", JSON.stringify(me));
        }
        await refreshDeletion();
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
  }, [refreshDeletion]);

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

  const requestDeletion = useCallback(async () => {
    setDeleting(true);
    setError(null);
    setDeleteMessage(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        scheduledFor: string;
        message: string;
        code?: string;
        organizationIds?: string[];
        error?: string;
      }>("/account/deletion", {
        method: "POST",
        body: JSON.stringify({ email: deleteEmail, password: deletePassword }),
      });
      setDeleteMessage(
        res.message ||
          "Your account is deactivated and will be permanently deleted in 7 days unless you cancel by signing in again.",
      );
      clearAuthClientState();
      window.setTimeout(() => {
        window.location.href = "/login";
      }, 2500);
    } catch (e) {
      const err = e as Error & { body?: { code?: string; organizationIds?: string[]; error?: string } };
      if (err.body?.code === "SOLE_OWNER") {
        setError(
          "You are the only owner of one or more organizations. Transfer ownership or close those orgs before deleting your account.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Deletion request failed");
      }
    } finally {
      setDeleting(false);
    }
  }, [deleteEmail, deletePassword]);

  const cancelDeletion = useCallback(async () => {
    setCancelling(true);
    setError(null);
    setDeleteMessage(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>("/account/deletion/cancel", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setDeleteMessage(res.message || "Account deletion cancelled.");
      await refreshDeletion();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }, [refreshDeletion]);

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

        <section className="card" style={{ marginTop: 24, padding: 20 }}>
          <h2 className="text-display-sm" style={{ marginTop: 0 }}>
            Delete account
          </h2>
          {deletion?.pending ? (
            <>
              <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
                Deletion is scheduled for{" "}
                <strong>{new Date(deletion.scheduledFor).toLocaleString()}</strong>. Your account is
                deactivated until then. Signing in again or cancelling below restores access.
              </p>
              <button
                type="button"
                className="button"
                disabled={cancelling}
                onClick={() => void cancelDeletion()}
              >
                {cancelling ? "Cancelling…" : "Cancel deletion"}
              </button>
            </>
          ) : (
            <>
              <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
                Requesting deletion deactivates your account immediately (login blocked for normal
                use, hidden from directory/matching, notifications stopped). Permanent deletion runs
                after a 7-day grace period. Signing in during that window cancels the request. If you
                are the only owner of an organization, transfer ownership first.
              </p>
              <form
                className="grid"
                style={{ gap: 10 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void requestDeletion();
                }}
              >
                <label className="text-meta">
                  Confirm email
                  <input
                    className="input"
                    type="email"
                    autoComplete="username"
                    value={deleteEmail}
                    onChange={(e) => setDeleteEmail(e.target.value)}
                    required
                  />
                </label>
                <label className="text-meta">
                  Confirm password
                  <input
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    required
                  />
                </label>
                <button type="submit" className="button button-danger" disabled={deleting || !email}>
                  {deleting ? "Scheduling…" : "Delete my account"}
                </button>
              </form>
            </>
          )}
          {deleteMessage ? <p className="text-body-md">{deleteMessage}</p> : null}
        </section>

        <p className="text-meta" style={{ marginTop: 24 }}>
          <Link href="/dashboard">Back to dashboard</Link>
          {" · "}
          <Link href="/security">Security</Link>
          {" · "}
          <Link href="/privacy">Privacy</Link>
        </p>
      </div>
    </>
  );
}
