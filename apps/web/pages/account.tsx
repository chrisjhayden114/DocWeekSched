import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AccountEmailPasswordCard } from "../components/account/AccountEmailPasswordCard";
import { AccountNotificationDefaultsCard } from "../components/account/AccountNotificationDefaultsCard";
import { AccountOrganizationsCard, AccountPlanBillingCard } from "../components/account/AccountOrgSections";
import { BrandLogo } from "../components/BrandLogo";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ProfileEditor, type ProfileUser } from "../components/ProfileEditor";
import { apiFetch, clearAuthClientState } from "../lib/api";
import type { AccountOrg, AccountPlanRow } from "../lib/accountSettings";
import type { OrgSummary } from "../lib/organizerApi";

type DeletionStatus =
  | { pending: false }
  | { pending: true; scheduledFor: string; requestedAt: string };

type MeUser = ProfileUser & { email: string };

/**
 * Account self-service: profile, credentials, notification defaults, orgs,
 * GDPR JSON export + account deletion (7-day grace).
 */
export default function AccountPage() {
  const [user, setUser] = useState<MeUser | null>(null);
  const [orgs, setOrgs] = useState<AccountOrg[]>([]);
  const [plans, setPlans] = useState<AccountPlanRow[]>([]);
  // Each card reports its own failure: a refused deletion used to surface up in
  // the export card, nowhere near the button that was pressed.
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** ORG-2 — where to go when deletion is blocked by a sole-owner organization. */
  const [soleOwnerPath, setSoleOwnerPath] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deletion, setDeletion] = useState<DeletionStatus | null>(null);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
        const me = await apiFetch<MeUser>("/auth/me");
        if (!cancelled) {
          setUser(me);
          setDeleteEmail(me.email);
          window.localStorage.setItem("user", JSON.stringify(me));
        }
        await refreshDeletion();
        try {
          const mine = await apiFetch<OrgSummary[]>("/organizations/mine");
          if (cancelled) return;
          const memberships = mine.map((o) => ({ id: o.id, name: o.name, role: o.role }));
          setOrgs(memberships);
          if (memberships.length) {
            const summaries = await Promise.all(
              memberships.map(async (org) => {
                try {
                  const s = await apiFetch<{ planName: string }>(
                    `/billing/summary?organizationId=${encodeURIComponent(org.id)}`,
                  );
                  return { orgId: org.id, orgName: org.name, planName: s.planName };
                } catch {
                  return { orgId: org.id, orgName: org.name, planName: "" };
                }
              }),
            );
            if (!cancelled) setPlans(summaries);
          }
        } catch {
          if (!cancelled) {
            setOrgs([]);
            setPlans([]);
          }
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
  }, [refreshDeletion]);

  const downloadExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
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
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, []);

  const requestDeletion = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    setDeleteMessage(null);
    setSoleOwnerPath(null);
    setConfirmOpen(false);
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
      const err = e as Error & {
        body?: { code?: string; organizationIds?: string[]; error?: string; resolvePath?: string };
      };
      if (err.body?.code === "SOLE_OWNER") {
        // ORG-2 — this used to be the dead end: the copy said "transfer
        // ownership or close those orgs" against a product that could do
        // neither. The server now names the organizations and where to go, so
        // show its message and put the door next to it.
        setDeleteError(err.body.error || "One or more organizations still need an owner.");
        setSoleOwnerPath(err.body.resolvePath || "/organizer/org/settings");
      } else {
        setDeleteError(err instanceof Error ? err.message : "Deletion request failed");
      }
    } finally {
      setDeleting(false);
    }
  }, [deleteEmail, deletePassword]);

  const cancelDeletion = useCallback(async () => {
    setCancelling(true);
    setDeleteError(null);
    setDeleteMessage(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>("/account/deletion/cancel", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setDeleteMessage(res.message || "Account deletion cancelled.");
      await refreshDeletion();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }, [refreshDeletion]);

  const email = user?.email ?? null;

  return (
    <>
      <Head>
        <title>{`Account — ${brand.productName}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="container" style={{ paddingTop: 32, maxWidth: 640 }}>
        {/* UX-3 #3 — the way out sits above the heading, not in the footer
            underneath a delete form (founder live-test: back-nav buried). */}
        <p style={{ margin: "0 0 20px" }}>
          <Link className="button secondary" href="/dashboard">
            ← Back to dashboard
          </Link>
        </p>
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

        {user ? (
          <div style={{ marginTop: 24 }}>
            <ProfileEditor
              surface="account"
              token=""
              user={user}
              adminEvents={[]}
              activeEventId={null}
              participantLabels={[]}
              withEventHeaders={(extra) => extra ?? {}}
              onSaved={(updated) => {
                const next = { ...user, ...updated };
                setUser(next);
                window.localStorage.setItem("user", JSON.stringify(next));
              }}
              onEventSelected={() => undefined}
              onEventCreated={() => undefined}
            />
          </div>
        ) : null}

        <AccountEmailPasswordCard email={email} />
        <AccountNotificationDefaultsCard ready={Boolean(email)} />
        <AccountPlanBillingCard orgs={orgs} plans={plans} />
        <AccountOrganizationsCard orgs={orgs} />

        {/* The export sits directly above the danger zone: it is the thing to do
            BEFORE deleting, and deletion stays last on the page. */}
        <section className="card" style={{ marginTop: 24, padding: 20 }}>
          <h2 className="text-display-sm" style={{ marginTop: 0 }}>
            Data &amp; privacy
          </h2>
          <h3 className="text-display-sm" style={{ marginTop: 0 }}>
            Download your data
          </h3>
          <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
            Export a JSON file with your profile, memberships, attendance, check-ins, and message
            metadata (your messages only — no other users&apos; PII). See the{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
          <button type="button" className="button" disabled={exporting || !email} onClick={() => void downloadExport()}>
            {exporting ? "Preparing…" : "Download JSON export"}
          </button>
          {exportError ? <p style={{ color: "var(--danger-700)" }}>{exportError}</p> : null}
        </section>

        <section className="card danger-zone" style={{ marginTop: 24, padding: 20 }}>
          <p className="danger-zone-label">Danger zone</p>
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
                are the only owner of an organization, first hand it to an admin or close it in{" "}
                <Link href="/organizer/org/settings">Organization settings</Link>.
              </p>
              <form
                className="grid"
                style={{ gap: 10 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  // Re-auth first (the fields are `required`, so the browser has
                  // already checked them), then the consequences, then the act.
                  setConfirmOpen(true);
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
          {deleteError ? (
            <p role="alert" style={{ color: "var(--danger-700)" }}>
              {deleteError}
              {soleOwnerPath ? (
                <>
                  {" "}
                  <Link href={soleOwnerPath}>Open Organization settings</Link>
                </>
              ) : null}
            </p>
          ) : null}
          {deleteMessage ? <p className="text-body-md">{deleteMessage}</p> : null}
        </section>

        <ConfirmDialog
          open={confirmOpen}
          tone="danger"
          title="Schedule deletion of your account?"
          body="Deactivates immediately; permanently deleted after 7 days including profile, memberships, and messages. Sign in during the 7 days to cancel."
          confirmLabel="Schedule deletion"
          cancelLabel="Keep my account"
          busy={deleting}
          onConfirm={() => void requestDeletion()}
          onCancel={() => setConfirmOpen(false)}
        />

        <p className="text-meta" style={{ marginTop: 24 }}>
          <Link href="/security">Security</Link>
          {" · "}
          <Link href="/privacy">Privacy</Link>
        </p>
      </div>
    </>
  );
}
