/**
 * Phase 5 — Organizer sponsor CRUD + lead CSV export.
 */

import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { brand } from "@event-app/config";
import { ListEmpty } from "../../../../components/ListState";
import { OrganizerShell } from "../../../../components/OrganizerShell";
import { apiFetch } from "../../../../lib/api";

type Sponsor = {
  id: string;
  name: string;
  logoUrl?: string | null;
  url?: string | null;
  tier: string;
  sortOrder: number;
  boothLabel?: string | null;
  description?: string | null;
};

export default function EventSponsorsPage() {
  const router = useRouter();
  const eventId = String(router.query.eventId || "");
  const [token, setToken] = useState<string | null>(null);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const headers = useCallback(
    (extra?: RequestInit): RequestInit => ({
      ...extra,
      headers: {
        ...(extra?.headers || {}),
        "x-event-id": eventId,
        "Content-Type": "application/json",
      },
    }),
    [eventId],
  );

  useEffect(() => {
    try {
      setToken(window.localStorage.getItem("token") || "session");
    } catch {
      setToken("session");
    }
  }, []);

  const load = useCallback(async () => {
    if (!token || !eventId) return;
    try {
      const rows = await apiFetch<Sponsor[]>("/sponsors", headers(), token);
      setSponsors(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sponsors");
    }
  }, [token, eventId, headers]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createSponsor(form: HTMLFormElement) {
    if (!token) return;
    const fd = new FormData(form);
    setBusy(true);
    try {
      await apiFetch(
        "/sponsors",
        headers({
          method: "POST",
          body: JSON.stringify({
            name: String(fd.get("name") || "").trim(),
            tier: String(fd.get("tier") || "Standard").trim(),
            url: String(fd.get("url") || "").trim() || null,
            boothLabel: String(fd.get("boothLabel") || "").trim() || null,
            description: String(fd.get("description") || "").trim() || null,
            sortOrder: Number(fd.get("sortOrder") || 0),
          }),
        }),
        token,
      );
      form.reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create sponsor");
    } finally {
      setBusy(false);
    }
  }

  async function removeSponsor(id: string) {
    if (!token || !confirm("Remove this sponsor?")) return;
    await apiFetch(`/sponsors/${id}`, headers({ method: "DELETE" }), token);
    await load();
  }

  async function downloadLeads(id: string, name: string) {
    if (!token) return;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/sponsors/${id}/leads.csv`,
      {
        credentials: "include",
        headers: {
          "x-event-id": eventId,
          ...(token !== "session" ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) {
      setError("Could not export leads");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[^\w\- ]+/g, "") || "sponsor"}-leads.csv`;
    a.click();
  }

  if (!eventId) return <main style={{ padding: 24 }}>Missing event id.</main>;

  return (
    <>
      <Head>
        <title>{`Sponsors — ${brand.productName}`}</title>
      </Head>
      <OrganizerShell active="sponsors" eventId={eventId}>
        <h1 style={{ margin: 0, font: "var(--text-h1)" }}>Sponsors</h1>
        <p className="help-text">Shown to attendees by tier / sort order. Capture leads at the booth and export CSV.</p>
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

        <form
          className="console-form console-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void createSponsor(e.currentTarget);
          }}
        >
          <p className="console-panel-label">Add sponsor</p>
          <label>
            Sponsor name
            <input className="input" name="name" required />
          </label>
          <label>
            Tier
            <input className="input" name="tier" placeholder="e.g. Gold" defaultValue="Standard" />
          </label>
          <label>
            Website URL
            <input className="input" name="url" />
          </label>
          <label>
            Booth label
            <input className="input" name="boothLabel" />
          </label>
          <label>
            Sort order
            <input className="input" name="sortOrder" type="number" defaultValue={0} />
          </label>
          <label>
            Short description
            <textarea className="textarea" name="description" rows={2} />
          </label>
          <button type="submit" className="button" disabled={busy} style={{ justifySelf: "start" }}>
            Add sponsor
          </button>
        </form>

        <ul style={{ listStyle: "none", padding: 0 }}>
          {sponsors.map((s) => (
            <li
              key={s.id}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--gray-200)",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong>{s.name}</strong>
                  <span className="help-text">
                    {" "}
                    · {s.tier}
                    {s.boothLabel ? ` · ${s.boothLabel}` : ""}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="button secondary" onClick={() => void downloadLeads(s.id, s.name)}>
                    Leads CSV
                  </button>
                  <button type="button" className="button secondary" onClick={() => void removeSponsor(s.id)}>
                    Remove
                  </button>
                </div>
              </div>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.url}
                </a>
              ) : null}
              {s.description ? <p className="help-text" style={{ margin: 0 }}>{s.description}</p> : null}
            </li>
          ))}
        </ul>
        {sponsors.length === 0 ? (
          <ListEmpty title="No sponsors yet" body="Add a sponsor above to show them on the public event page." />
        ) : null}
      </OrganizerShell>
    </>
  );
}
