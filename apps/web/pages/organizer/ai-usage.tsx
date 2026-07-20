import { brand } from "@event-app/config";
import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { OrganizerShell } from "../../components/OrganizerShell";
import { apiFetch, clearAuthClientState } from "../../lib/api";
import { OrgSummary } from "../../lib/organizerApi";

type UsageSummary = {
  organizationId: string;
  since: string;
  days: number;
  totals: { calls: number; tokensIn: number; tokensOut: number; costEstimateCents: number };
  byFeature: Array<{
    feature: string;
    calls: number;
    tokensIn: number;
    tokensOut: number;
    costEstimateCents: number;
  }>;
  recent: Array<{
    id: string;
    feature: string;
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costEstimateCents: number;
    latencyMs: number;
    eventId: string | null;
    createdAt: string;
  }>;
};

export default function OrganizerAiUsagePage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setError(null);
    const s = await apiFetch<UsageSummary>(`/ai/usage?organizationId=${encodeURIComponent(id)}&days=30`);
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

  return (
    <>
      <Head>
        <title>AI usage — {brand.productName}</title>
      </Head>
      <OrganizerShell active="ai-usage">
        <div className="card" style={{ marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, font: "var(--text-h2)" }}>AI usage (30 days)</h1>
            <p className="help-text" style={{ margin: "8px 0 0" }}>
              Metered gateway calls for your organization — tokens and estimated cost.
            </p>
          </div>
          <label className="help-text" style={{ display: "grid", gap: 6, marginTop: 16, maxWidth: 360 }}>
            Organization
            <select
              className="select"
              value={orgId || ""}
              onChange={(e) => {
                const id = e.target.value || null;
                setOrgId(id);
                if (id) {
                  window.localStorage.setItem("organizerOrgId", id);
                  void load(id);
                }
              }}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        </div>

        {summary ? (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 className="text-display-sm" style={{ marginTop: 0 }}>
                Totals
              </h2>
              <p className="text-body-md" style={{ margin: 0 }}>
                {summary.totals.calls} calls · {summary.totals.tokensIn.toLocaleString()} in /{" "}
                {summary.totals.tokensOut.toLocaleString()} out · ~$
                {(summary.totals.costEstimateCents / 100).toFixed(2)}
              </p>
              <ul style={{ marginTop: 12, paddingLeft: "1.2rem" }}>
                {summary.byFeature.map((row) => (
                  <li key={row.feature} className="text-body-md">
                    <strong>{row.feature}</strong>: {row.calls} calls · {row.tokensIn + row.tokensOut} tokens · ~$
                    {(row.costEstimateCents / 100).toFixed(2)}
                  </li>
                ))}
                {summary.byFeature.length === 0 ? <li className="help-text">No AI usage in this window.</li> : null}
              </ul>
            </div>
            <div className="card">
              <h2 className="text-display-sm" style={{ marginTop: 0 }}>
                Recent calls
              </h2>
              <div className="invite-status-table-wrap">
                <table className="invite-status-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Feature</th>
                      <th>Model</th>
                      <th>Tokens</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recent.map((r) => (
                      <tr key={r.id}>
                        <td data-label="When">{new Date(r.createdAt).toLocaleString()}</td>
                        <td data-label="Feature">{r.feature}</td>
                        <td data-label="Model">
                          {r.provider}/{r.model}
                        </td>
                        <td data-label="Tokens">
                          {r.tokensIn}/{r.tokensOut}
                        </td>
                        <td data-label="Cost">${(r.costEstimateCents / 100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <p className="help-text">Select an organization to view usage.</p>
        )}
      </OrganizerShell>
    </>
  );
}
