import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, AuthResponse, clearAuthClientState } from "../../lib/api";
import { OrgSummary, OrganizerEvent, organizerFetch } from "../../lib/organizerApi";

export default function OrganizerDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<AuthResponse["user"] | null>(null);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await apiFetch<AuthResponse["user"]>("/auth/me");
      setUser(me);
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
        const list = await organizerFetch<OrganizerEvent[]>(`/organizations/${preferred}/events`, null);
        setEvents(list);
      } else {
        setEvents([]);
      }
    } catch (err) {
      clearAuthClientState();
      setError(err instanceof Error ? err.message : "Unable to load organizer dashboard");
      if (String(err).includes("401") || String(err).toLowerCase().includes("unauthorized")) {
        void router.push("/");
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function selectOrg(id: string) {
    setOrgId(id);
    window.localStorage.setItem("organizerOrgId", id);
    const list = await organizerFetch<OrganizerEvent[]>(`/organizations/${id}/events`, null);
    setEvents(list);
    void router.replace({ pathname: "/organizer", query: { org: id } }, undefined, { shallow: true });
  }

  return (
    <>
      <Head>
        <title>Organizer — {brand.productName}</title>
      </Head>
      <main className="page" style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 64px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <div>
            <p className="help-text" style={{ margin: 0 }}>
              <Link href="/dashboard">Attendee app</Link>
              {" · "}
              <Link href="/organizer/billing">Billing</Link>
              {" · "}
              <Link href="/organizer/ai-usage">AI usage</Link>
              {" · "}
              <Link href="/pricing">Pricing</Link>
              {" · "}
              Organizer
            </p>
            <h1 style={{ margin: "4px 0 0" }}>Your events</h1>
            {user ? (
              <p className="help-text" style={{ marginTop: 4 }}>
                Signed in as {user.name}
              </p>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="button secondary" href="/organizer/org/new">
              New organization
            </Link>
            <Link
              className="button"
              href={orgId ? `/organizer/events/new?org=${encodeURIComponent(orgId)}` : "/organizer/org/new"}
            >
              Create event
            </Link>
          </div>
        </header>

        {error ? (
          <p style={{ color: "#b42318", marginTop: 16 }}>
            {error}. <Link href="/">Sign in</Link>
          </p>
        ) : null}

        {loading ? <p className="help-text">Loading…</p> : null}

        {!loading && orgs.length === 0 ? (
          <section style={{ marginTop: 32 }}>
            <h2 style={{ marginTop: 0 }}>Create your organization</h2>
            <p className="help-text">
              Organizations own events. Start here, then add your first draft event.
            </p>
            <Link className="button" href="/organizer/org/new">
              Create organization
            </Link>
          </section>
        ) : null}

        {orgs.length > 0 ? (
          <section style={{ marginTop: 24 }}>
            <label className="help-text" style={{ display: "block", marginBottom: 6 }}>
              Organization
            </label>
            <select
              className="input"
              value={orgId || ""}
              onChange={(e) => void selectOrg(e.target.value)}
              style={{ maxWidth: 360 }}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.role})
                </option>
              ))}
            </select>
          </section>
        ) : null}

        {!loading && orgId && events.length === 0 ? (
          <section style={{ marginTop: 32 }}>
            <h2 style={{ marginTop: 0 }}>No events yet</h2>
            <p className="help-text">Create a draft event, add sessions and speakers, then publish when you&apos;re ready.</p>
            <Link className="button" href={`/organizer/events/new?org=${encodeURIComponent(orgId)}`}>
              Create your first event
            </Link>
          </section>
        ) : null}

        {events.length > 0 ? (
          <ul style={{ listStyle: "none", padding: 0, margin: "24px 0 0", display: "grid", gap: 12 }}>
            {events.map((ev) => (
              <li
                key={ev.id}
                style={{
                  border: "1px solid var(--border, #D9E1EE)",
                  borderRadius: 8,
                  padding: "14px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  <Link href={`/organizer/events/${ev.id}`} style={{ fontWeight: 700, fontSize: 18 }}>
                    {ev.name}
                  </Link>
                  <p className="help-text" style={{ margin: "4px 0 0" }}>
                    <StatusBadge status={ev.uiStatus} />
                    {" · "}/e/{ev.slug}
                    {" · "}
                    {new Date(ev.startDate).toLocaleDateString()} – {new Date(ev.endDate).toLocaleDateString()}
                  </p>
                </div>
                <Link className="button secondary" href={`/organizer/events/${ev.id}`}>
                  Manage
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "Published"
      ? "#0a7a3e"
      : status === "Draft"
        ? "#41506D"
        : status === "Past"
          ? "#0033A0"
          : "#7a3e0a";
  return (
    <span style={{ color, fontWeight: 600 }}>
      {status}
    </span>
  );
}
