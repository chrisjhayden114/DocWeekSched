/**
 * SPX-1 — OutreachTemplate CRUD. Nothing is seeded; a starter ask is
 * offered in the composer and can be copied here to save.
 */

import { useState } from "react";
import { OUTREACH_STARTER_TEMPLATE } from "@event-app/shared";
import { AutoGrowTextarea } from "../kit";
import { organizerFetch } from "../../lib/organizerApi";

export type OutreachTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
};

export function OutreachTemplatesCard({
  eventId,
  templates,
  onChanged,
}: {
  eventId: string;
  templates: OutreachTemplate[];
  onChanged: () => Promise<void> | void;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function beginNew(fromStarter: boolean) {
    setEditingId("new");
    setName(fromStarter ? OUTREACH_STARTER_TEMPLATE.name : "");
    setSubject(fromStarter ? OUTREACH_STARTER_TEMPLATE.subject : "");
    setBody(fromStarter ? OUTREACH_STARTER_TEMPLATE.body : "");
    setError(null);
  }

  function beginEdit(row: OutreachTemplate) {
    setEditingId(row.id);
    setName(row.name);
    setSubject(row.subject);
    setBody(row.body);
    setError(null);
  }

  function cancel() {
    setEditingId(null);
    setError(null);
  }

  async function save() {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId === "new") {
        await organizerFetch("/outreach/templates", eventId, {
          method: "POST",
          body: JSON.stringify({ name, subject, body }),
        });
      } else {
        await organizerFetch(`/outreach/templates/${editingId}`, eventId, {
          method: "PATCH",
          body: JSON.stringify({ name, subject, body }),
        });
      }
      setEditingId(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save template");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await organizerFetch(`/outreach/templates/${id}`, eventId, { method: "DELETE" });
      if (editingId === id) setEditingId(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete template");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="console-panel" aria-labelledby="outreach-templates-heading">
      <div className="console-panel-head">
        <p className="console-panel-label" id="outreach-templates-heading">
          Email templates
        </p>
        {editingId == null ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="button secondary" onClick={() => beginNew(false)}>
              New template
            </button>
            {templates.length === 0 ? (
              <button type="button" className="button secondary" onClick={() => beginNew(true)}>
                Start from starter ask
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="help-text" style={{ marginTop: 0 }}>
        Merge fields: {"{orgName}"}, {"{contactName}"}, {"{eventName}"}, {"{eventDates}"}, {"{eventUrl}"}.
        We do not seed a template — a starter ask appears the first time you write an email.
      </p>
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

      {templates.length === 0 && editingId == null ? (
        <p className="help-text" style={{ margin: 0 }}>
          No saved templates yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {templates.map((row) => (
            <li key={row.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span>
                <strong>{row.name}</strong>
                <span className="help-text"> — {row.subject}</span>
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                <button type="button" className="button secondary" onClick={() => beginEdit(row)} disabled={busy}>
                  Edit
                </button>
                <button type="button" className="button secondary" onClick={() => void remove(row.id)} disabled={busy}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {editingId != null ? (
        <form
          className="console-form"
          style={{ marginTop: 12, maxWidth: "100%" }}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Template name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Subject
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </label>
          <label>
            Body
            <AutoGrowTextarea className="textarea" minRows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="button" disabled={busy}>
              Save template
            </button>
            <button type="button" className="button secondary" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
