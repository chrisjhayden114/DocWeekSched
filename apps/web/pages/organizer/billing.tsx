import { brand } from "@event-app/config";
import { PRICE_LOCK, type PlanSkuKey } from "@event-app/shared";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { OrganizerShell } from "../../components/OrganizerShell";
import { apiFetch, clearAuthClientState } from "../../lib/api";
import { OrgSummary } from "../../lib/organizerApi";

type BillingSummary = {
  orgId: string;
  plan: string;
  planSku: string;
  planName: string;
  planDescription: string;
  displayPrice: string;
  subscriptionStatus: string;
  eventAllowance: number | null;
  eventsUsed: number;
  readOnly: boolean;
  inGracePeriod: boolean;
  gracePeriodEndsAt: string | null;
  showPoweredByBadge: boolean;
  billingConfigured: boolean;
  limits: { activeEvents: number | null; attendees: number | null; aiIngestPerEvent: number | null };
  invoices: Array<{ id: string; status: string; amountCents: number; currency: string; createdAt: string; url?: string }>;
};

const UPGRADE_SKUS: { key: PlanSkuKey; label: string }[] = [
  { key: "per_event_250", label: "Per-event 250" },
  { key: "per_event_500", label: "Per-event 500" },
  { key: "per_event_1000", label: "Per-event 1,000" },
  { key: "pro_monthly", label: "Pro monthly" },
  { key: "pro_annual", label: "Pro annual" },
];

export default function OrganizerBillingPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    setError(null);
    const s = await apiFetch<BillingSummary>(`/billing/summary?organizationId=${encodeURIComponent(id)}`);
    setSummary(s);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const mine = await apiFetch<OrgSummary[]>("/organizations/mine");
        setOrgs(mine);
        const preferred =
          (typeof router.query.org === "string" && router.query.org) ||
          window.localStorage.getItem("organizerOrgId") ||
          mine[0]?.id ||
          null;
        setOrgId(preferred);
        if (preferred) {
          window.localStorage.setItem("organizerOrgId", preferred);
          await load(preferred);
        }
      } catch {
        clearAuthClientState();
        void router.push("/");
      }
    })();
  }, [router, load]);

  async function startCheckout(planKey: PlanSkuKey) {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ url: string }>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ organizationId: orgId, planKey }),
      });
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  }

  async function openPortal() {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ url: string }>("/billing/portal", {
        method: "POST",
        body: JSON.stringify({ organizationId: orgId }),
      });
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open portal");
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>{`Billing — ${brand.productName}`}</title>
      </Head>
      <OrganizerShell active="billing">
        <div style={{ maxWidth: 720 }}>
        <p className="help-text" style={{ marginTop: 0 }}>
          <Link href="/pricing">Public pricing</Link>
        </p>
        <h1 style={{ margin: "0 0 8px", font: "var(--text-h1)" }}>Billing</h1>

        {orgs.length > 1 ? (
          <label>
            Organization
            <select
              className="input"
              value={orgId || ""}
              onChange={(e) => {
                const id = e.target.value;
                setOrgId(id);
                window.localStorage.setItem("organizerOrgId", id);
                void load(id).catch((err) => setError(err instanceof Error ? err.message : "Failed"));
              }}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

        {summary ? (
          <section style={{ display: "grid", gap: 16, marginTop: 16 }}>
            {summary.readOnly ? (
              <div
                style={{
                  padding: 14,
                  borderRadius: "var(--radius-md)",
                  background: "var(--danger-50)",
                  border: "1px solid var(--gray-200)",
                }}
              >
                <strong>Read-only</strong>
                <p className="help-text" style={{ margin: "6px 0 0" }}>
                  Payment failed and the 7-day grace period ended. Update your card in the customer portal to
                  restore edits and invites. Existing data is kept.
                </p>
              </div>
            ) : null}
            {summary.inGracePeriod ? (
              <div
                style={{
                  padding: 14,
                  borderRadius: "var(--radius-md)",
                  background: "#fffaeb",
                  border: "1px solid #fedf89",
                }}
              >
                <strong>Payment issue — grace period</strong>
                <p className="help-text" style={{ margin: "6px 0 0" }}>
                  You have until{" "}
                  {summary.gracePeriodEndsAt
                    ? new Date(summary.gracePeriodEndsAt).toLocaleString()
                    : "soon"}{" "}
                  to update payment before the org becomes read-only.
                </p>
              </div>
            ) : null}

            <div className="card" style={{ padding: 18 }}>
              <h2 style={{ marginTop: 0 }}>{summary.planName}</h2>
              <p className="help-text">{summary.planDescription}</p>
              <p>
                <strong>{summary.displayPrice}</strong>
                {" · "}
                Status: {summary.subscriptionStatus}
              </p>
              <p className="help-text">
                Active events: {summary.eventsUsed}
                {summary.limits.activeEvents == null ? " / unlimited" : ` / ${summary.limits.activeEvents}`}
                <br />
                Attendees / event:{" "}
                {summary.limits.attendees == null ? "Unlimited" : summary.limits.attendees.toLocaleString()}
                {summary.showPoweredByBadge ? (
                  <>
                    <br />
                    Free plan includes a “Powered by {brand.productName}” badge on attendee pages.
                  </>
                ) : null}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="button secondary" disabled={busy} onClick={() => void openPortal()}>
                  Customer portal
                </button>
              </div>
            </div>

            <div className="card" style={{ padding: 18 }}>
              <h3 style={{ marginTop: 0 }}>Upgrade / change plan</h3>
              <p className="help-text">{PRICE_LOCK.body}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {UPGRADE_SKUS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => void startCheckout(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card" style={{ padding: 18 }}>
              <h3 style={{ marginTop: 0 }}>Invoices</h3>
              {summary.invoices.length === 0 ? (
                <p className="help-text">Invoices appear here from Lemon Squeezy after purchases.</p>
              ) : (
                <ul>
                  {summary.invoices.map((inv) => (
                    <li key={inv.id}>
                      {inv.createdAt.slice(0, 10)} — {(inv.amountCents / 100).toFixed(2)} {inv.currency} (
                      {inv.status})
                      {inv.url ? (
                        <>
                          {" "}
                          <a href={inv.url} target="_blank" rel="noreferrer">
                            View
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : (
          <p className="help-text">Loading billing…</p>
        )}
        </div>
      </OrganizerShell>
    </>
  );
}
