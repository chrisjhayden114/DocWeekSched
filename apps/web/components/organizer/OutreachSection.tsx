/**
 * SPX-0 — outreach pipeline on the Sponsors page. Draft-and-copy only:
 * we never send email from this product.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SPONSOR_PROSPECT_STATUS_LABEL,
  SPONSOR_PROSPECT_STATUS_ORDER,
  type SponsorProspectStatus,
} from "@event-app/shared";
import { AutoGrowTextarea } from "../kit";
import { ListEmpty } from "../ListState";
import { Select } from "../Select";
import { organizerFetch } from "../../lib/organizerApi";
import { OutreachImportCard } from "./OutreachImportCard";

export type SponsorProspect = {
  id: string;
  orgName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  websiteUrl?: string | null;
  notes?: string | null;
  status: SponsorProspectStatus;
  lastContactedAt?: string | null;
  sponsorId?: string | null;
};

const STATUS_OPTIONS = SPONSOR_PROSPECT_STATUS_ORDER.map((value) => ({
  value,
  label: SPONSOR_PROSPECT_STATUS_LABEL[value],
}));

export function OutreachSection({ eventId }: { eventId: string }) {
  const [prospects, setProspects] = useState<SponsorProspect[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingSponsorId, setAddingSponsorId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const rows = await organizerFetch<SponsorProspect[]>("/outreach/prospects", eventId);
    setProspects(rows);
    setNotesDraft(Object.fromEntries(rows.map((r) => [r.id, r.notes || ""])));
    setError(null);
  }, [eventId]);

  useEffect(() => {
    void load().catch((e) => {
      setError(e instanceof Error ? e.message : "Could not load prospects");
    });
  }, [load]);

  const grouped = useMemo(() => {
    return SPONSOR_PROSPECT_STATUS_ORDER.map((status) => ({
      status,
      rows: prospects.filter((p) => p.status === status),
    }));
  }, [prospects]);

  async function createProspect(form: HTMLFormElement) {
    const fd = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await organizerFetch("/outreach/prospects", eventId, {
        method: "POST",
        body: JSON.stringify({
          orgName: String(fd.get("orgName") || "").trim(),
          contactName: String(fd.get("contactName") || "").trim() || null,
          contactEmail: String(fd.get("contactEmail") || "").trim() || null,
          websiteUrl: String(fd.get("websiteUrl") || "").trim() || null,
          notes: String(fd.get("notes") || "").trim() || null,
        }),
      });
      form.reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add prospect");
    } finally {
      setBusy(false);
    }
  }

  async function patchProspect(id: string, body: Record<string, unknown>) {
    setError(null);
    try {
      const row = await organizerFetch<SponsorProspect>(`/outreach/prospects/${id}`, eventId, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setProspects((prev) => prev.map((p) => (p.id === id ? row : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update prospect");
    }
  }

  async function addAsSponsor(id: string) {
    if (addingSponsorId) return;
    setAddingSponsorId(id);
    setError(null);
    try {
      const result = await organizerFetch<{ prospect: SponsorProspect }>(
        `/outreach/prospects/${id}/add-as-sponsor`,
        eventId,
        { method: "POST" },
      );
      setProspects((prev) => prev.map((p) => (p.id === id ? result.prospect : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add as sponsor");
    } finally {
      setAddingSponsorId(null);
    }
  }

  return (
    <section className="outreach-section" aria-labelledby="outreach-heading">
      <h2 id="outreach-heading" style={{ fontSize: 18, margin: "0 0 8px" }}>
        Outreach
      </h2>
      <p className="help-text" style={{ marginTop: 0 }}>
        Sponsors hear from you, not from us. Track who you want to ask; write and send from your
        own address. We never send outreach email from this product.
      </p>
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

      <form
        className="console-form console-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void createProspect(e.currentTarget);
        }}
      >
        <p className="console-panel-label">Add prospect</p>
        <label>
          Organization
          <input className="input" name="orgName" required />
        </label>
        <label>
          Contact name
          <input className="input" name="contactName" />
        </label>
        <label>
          Email
          <input className="input" name="contactEmail" type="email" />
        </label>
        <label>
          Website
          <input className="input" name="websiteUrl" />
        </label>
        <label>
          Notes
          <AutoGrowTextarea className="textarea" name="notes" minRows={2} />
        </label>
        <button type="submit" className="button" disabled={busy} style={{ justifySelf: "start" }}>
          Add prospect
        </button>
      </form>

      <OutreachImportCard eventId={eventId} onImported={load} />

      {prospects.length === 0 ? (
        <ListEmpty
          title="No prospects yet"
          body="Add an organization above, or import a spreadsheet. When you are ready to write, you send from your own inbox — we do not mail these for you. A draft-and-copy composer is next."
        />
      ) : (
        grouped.map(({ status, rows }) => (
          <div key={status} style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>
              {SPONSOR_PROSPECT_STATUS_LABEL[status]}{" "}
              <span className="help-text">({rows.length})</span>
            </h3>
            {rows.length === 0 ? (
              <p className="help-text" style={{ margin: 0 }}>
                None
              </p>
            ) : (
              <div className="console-table-wrap">
                <table className="console-table">
                  <thead>
                    <tr>
                      <th>Organization</th>
                      <th>Contact</th>
                      <th>Status</th>
                      <th>Notes</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.orgName}</strong>
                          {row.websiteUrl ? (
                            <div>
                              <a href={row.websiteUrl} target="_blank" rel="noreferrer">
                                {row.websiteUrl}
                              </a>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {row.contactName || "—"}
                          {row.contactEmail ? (
                            <div className="help-text">{row.contactEmail}</div>
                          ) : null}
                        </td>
                        <td>
                          <Select
                            aria-label={`Status for ${row.orgName}`}
                            value={row.status}
                            onChange={(value) =>
                              void patchProspect(row.id, { status: value as SponsorProspectStatus })
                            }
                            options={STATUS_OPTIONS}
                            className="select-compact"
                            style={{ maxWidth: 200 }}
                          />
                        </td>
                        <td>
                          <AutoGrowTextarea
                            className="textarea"
                            aria-label={`Notes for ${row.orgName}`}
                            minRows={1}
                            value={notesDraft[row.id] ?? ""}
                            onChange={(e) =>
                              setNotesDraft((prev) => ({ ...prev, [row.id]: e.target.value }))
                            }
                            onBlur={() => {
                              const next = (notesDraft[row.id] ?? "").trim();
                              const prev = (row.notes || "").trim();
                              if (next !== prev) void patchProspect(row.id, { notes: next || null });
                            }}
                          />
                        </td>
                        <td>
                          {row.status === "CONFIRMED" ? (
                            row.sponsorId ? (
                              <span className="help-text">Added as sponsor</span>
                            ) : (
                              <button
                                type="button"
                                className="button secondary"
                                disabled={addingSponsorId === row.id}
                                onClick={() => void addAsSponsor(row.id)}
                              >
                                Add as sponsor
                              </button>
                            )
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}
