import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { ListEmpty, ListError, ListSkeleton } from "../../components/ListState";
import { OrganizerShell } from "../../components/OrganizerShell";
import { StatusChip } from "../../components/StatusChip";
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
    setError(null);
    try {
      const list = await organizerFetch<OrganizerEvent[]>(`/organizations/${id}/events`, null);
      setEvents(list);
      void router.replace({ pathname: "/organizer", query: { org: id } }, undefined, { shallow: true });
    } catch (err) {
      setEvents([]);
      setError(err instanceof Error ? err.message : "Could not load events");
    }
  }

  return (
    <>
      <Head>
        <title>{`Organizer — ${brand.productName}`}</title>
      </Head>
      <OrganizerShell active="events" userName={user?.name}>
        <header className="console-page-header">
          <div>
            <h1>Your events</h1>
            {user ? (
              <p className="text-meta" style={{ margin: "4px 0 0" }}>
                Signed in as {user.name}
              </p>
            ) : null}
          </div>
          <div className="console-page-actions">
            <Link className="button secondary" href="/organizer/org/new">
              New organization
            </Link>
            <Link
              className="button secondary"
              href={orgId ? `/organizer/events/new?org=${encodeURIComponent(orgId)}&mode=ai` : "/organizer/org/new"}
            >
              Set up with AI
            </Link>
            <Link
              className="button"
              href={orgId ? `/organizer/events/new?org=${encodeURIComponent(orgId)}` : "/organizer/org/new"}
            >
              New event
            </Link>
          </div>
        </header>

        {error ? <ListError message={error} onRetry={() => void load()} /> : null}

        {loading ? <ListSkeleton rows={4} /> : null}

        {!loading && orgs.length === 0 ? (
          <ListEmpty
            title="Create your organization"
            body="Organizations own events. Start here, then add your first draft event."
            actionLabel="Create organization"
            onAction={() => void router.push("/organizer/org/new")}
          />
        ) : null}

        {orgs.length > 0 ? (
          <section className="console-panel" style={{ marginBottom: 16 }}>
            <p className="console-panel-label">Organization</p>
            <select
              className="input"
              value={orgId || ""}
              onChange={(e) => void selectOrg(e.target.value)}
              style={{ maxWidth: 360 }}
              aria-label="Organization"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.role})
                </option>
              ))}
            </select>
          </section>
        ) : null}

        {!loading && orgId && events.length === 0 && !error ? (
          <ListEmpty
            title="No events yet"
            body="Create a draft, add sessions and speakers, then publish when you’re ready."
            actionLabel="New event"
            onAction={() => void router.push(`/organizer/events/new?org=${encodeURIComponent(orgId)}`)}
          />
        ) : null}

        {events.length > 0 ? (
          <section className="console-panel" style={{ padding: 0 }}>
            <div className="console-table-wrap">
              <table className="console-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Dates</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td>
                        <Link href={`/organizer/events/${ev.id}`}>{ev.name}</Link>
                        <div className="text-meta">/e/{ev.slug}</div>
                      </td>
                      <td>
                        {new Date(ev.startDate).toLocaleDateString()} – {new Date(ev.endDate).toLocaleDateString()}
                      </td>
                      <td>
                        <StatusChip status={ev.uiStatus} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link className="button secondary" href={`/organizer/events/${ev.id}`} style={{ minHeight: 32, padding: "4px 10px" }}>
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </OrganizerShell>
    </>
  );
}
