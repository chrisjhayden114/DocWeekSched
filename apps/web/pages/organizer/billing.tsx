import { brand, invoiceStatusLabel, subscriptionStatusLine } from "@event-app/config";
import {
  formatDisplayPrice,
  PLAN_BY_SKU,
  PLAN_CATALOG,
  PRICE_LOCK,
  type PlanDefinition,
  type PlanSkuKey,
} from "@event-app/shared";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { HoverInfo } from "../../components/kit/HoverInfo";
import { ConsoleSubpageHeader } from "../../components/organizer/ConsoleSubpageHeader";
import { OrganizerShell } from "../../components/OrganizerShell";
import { Select } from "../../components/Select";
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

const UPGRADE_PLANS: PlanDefinition[] = PLAN_CATALOG.filter(
  (p) => p.public && !p.contactOnly && p.sku !== "free" && PLAN_BY_SKU[p.sku],
);

function planButtonLabel(plan: PlanDefinition): string {
  return `${plan.name} — ${formatDisplayPrice(plan.displayPriceCents, plan.currency, plan.interval)}`;
}

function planHoverBody(plan: PlanDefinition): string {
  const attendees =
    plan.limits.attendees == null ? "Unlimited attendees/event" : `${plan.limits.attendees.toLocaleString()} attendees/event`;
  const events =
    plan.limits.activeEvents == null
      ? "Unlimited active events"
      : `${plan.limits.activeEvents} active event${plan.limits.activeEvents === 1 ? "" : "s"}`;
  const ingest =
    plan.limits.aiIngestPerEvent == null
      ? "Unlimited AI ingests"
      : `${plan.limits.aiIngestPerEvent} AI ingest${plan.limits.aiIngestPerEvent === 1 ? "" : "s"}`;
  return `${plan.plainDescription} ${attendees}. ${events}. ${ingest}.`;
}

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

  // E24: a status line renders only when it tells the customer something —
  // NONE/ACTIVE show nothing, and the raw enum never reaches the page.
  const statusLine = summary
    ? subscriptionStatusLine({
        subscriptionStatus: summary.subscriptionStatus,
        planTier: summary.plan,
        planName: summary.planName,
      })
    : null;

  return (
    <>
      <Head>
        <title>{`Billing — ${brand.productName}`}</title>
      </Head>
      <OrganizerShell active="billing">
        <ConsoleSubpageHeader title="Billing" backTo={{ href: "/account", label: "Account" }} />
        <p className="text-meta" style={{ margin: "0 0 20px" }}>
          <Link href="/pricing">Public pricing</Link>
        </p>

        {orgs.length > 1 ? (
          <section className="console-panel">
            <div className="console-form">
              <label>
                Organization
                <Select
                  value={orgId || ""}
                  onChange={(id) => {
                    setOrgId(id);
                    window.localStorage.setItem("organizerOrgId", id);
                    void load(id).catch((err) => setError(err instanceof Error ? err.message : "Failed"));
                  }}
                  options={orgs.map((o) => ({ value: o.id, label: o.name }))}
                />
              </label>
            </div>
          </section>
        ) : null}

        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

        {summary ? (
          <section style={{ display: "grid", gap: 16 }}>
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
                  background: "var(--warning-50)",
                  border: "1px solid var(--gray-200)",
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

            <div className="console-panel">
              <p className="console-panel-label">Current plan</p>
              <h2 style={{ margin: "0 0 6px", font: "var(--text-h2)" }}>{summary.planName}</h2>
              <p className="help-text" style={{ marginTop: 0 }}>{summary.planDescription}</p>
              <p>
                <strong>{summary.displayPrice}</strong>
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
              {statusLine ? (
                <p
                  style={{
                    color:
                      statusLine.tone === "danger"
                        ? "var(--danger)"
                        : statusLine.tone === "warning"
                          ? "var(--warning)"
                          : undefined,
                  }}
                >
                  {statusLine.tone === "danger" ? <strong>{statusLine.text}</strong> : statusLine.text}
                </p>
              ) : null}
              {/* One primary action for this panel — adjacent to the payment-failed message on purpose. */}
              <button type="button" className="button" disabled={busy} onClick={() => void openPortal()}>
                Customer portal
              </button>
            </div>

            <div className="console-panel">
              <p className="console-panel-label">Upgrade / change plan</p>
              <p className="help-text" style={{ marginTop: 0 }}>{PRICE_LOCK.body}</p>
              {summary.billingConfigured ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {UPGRADE_PLANS.map((plan) => (
                    <HoverInfo key={plan.sku} title={plan.name} body={planHoverBody(plan)}>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void startCheckout(plan.sku)}
                      >
                        {planButtonLabel(plan)}
                      </button>
                    </HoverInfo>
                  ))}
                </div>
              ) : (
                <>
                  <a
                    className="button secondary"
                    href={`mailto:${brand.supportEmail}?subject=Purchase%20a%20plan`}
                  >
                    Contact {brand.supportEmail} to purchase
                  </a>
                  <p className="help-text" style={{ margin: "8px 0 0" }}>
                    Self-serve checkout is opening soon — email us and we&apos;ll set you up.
                  </p>
                </>
              )}
            </div>

            <div className="console-panel">
              <p className="console-panel-label">Invoices</p>
              {summary.invoices.length === 0 ? (
                <p className="help-text" style={{ margin: 0 }}>Invoices appear here after purchases.</p>
              ) : (
                <ul style={{ margin: 0 }}>
                  {summary.invoices.map((inv) => (
                    <li key={inv.id}>
                      {inv.createdAt.slice(0, 10)} — {(inv.amountCents / 100).toFixed(2)} {inv.currency.toUpperCase()} (
                      {invoiceStatusLabel(inv.status)})
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
      </OrganizerShell>
    </>
  );
}
