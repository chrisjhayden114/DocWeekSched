/**
 * SPX-1 — draft-and-copy composer. UKEDL never sends these emails.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  OUTREACH_DOCTRINE,
  OUTREACH_STARTER_TEMPLATE,
  buildOutreachMailto,
  resolveOutreachMergeFields,
  type OutreachMergeValues,
} from "@event-app/shared";
import { AutoGrowTextarea } from "../kit";
import { Select } from "../Select";
import { organizerFetch } from "../../lib/organizerApi";
import {
  formatOutreachClipboard,
  readLastOutreachCc,
  rememberLastOutreachCc,
  type SponsorProspect,
} from "../../lib/outreachCompose";
import type { OutreachTemplate } from "./OutreachTemplatesCard";

const STARTER_VALUE = "__starter__";

export function OutreachComposePanel({
  eventId,
  prospect,
  templates,
  mergeValues,
  onClose,
  onMarkedContacted,
}: {
  eventId: string;
  prospect: SponsorProspect;
  templates: OutreachTemplate[];
  mergeValues: OutreachMergeValues;
  onClose: () => void;
  onMarkedContacted: (row: SponsorProspect) => void;
}) {
  const initialTemplateId = templates[0]?.id ?? STARTER_VALUE;
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const [subject, setSubject] = useState(() =>
    resolveOutreachMergeFields(
      (templates[0] ?? OUTREACH_STARTER_TEMPLATE).subject,
      mergeValues,
    ),
  );
  const [body, setBody] = useState(() =>
    resolveOutreachMergeFields((templates[0] ?? OUTREACH_STARTER_TEMPLATE).body, mergeValues),
  );
  const [cc, setCc] = useState(() => readLastOutreachCc(eventId));
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickerOptions = useMemo(
    () => [
      { value: STARTER_VALUE, label: OUTREACH_STARTER_TEMPLATE.name },
      ...templates.map((t) => ({ value: t.id, label: t.name })),
    ],
    [templates],
  );

  function applyTemplate(id: string) {
    const raw =
      id === STARTER_VALUE
        ? OUTREACH_STARTER_TEMPLATE
        : templates.find((t) => t.id === id) ?? OUTREACH_STARTER_TEMPLATE;
    setSubject(resolveOutreachMergeFields(raw.subject, mergeValues));
    setBody(resolveOutreachMergeFields(raw.body, mergeValues));
  }

  const mailto = prospect.contactEmail
    ? buildOutreachMailto({
        to: prospect.contactEmail,
        subject,
        body,
        cc,
      })
    : null;

  async function copyEmail() {
    setError(null);
    try {
      await navigator.clipboard.writeText(formatOutreachClipboard(subject, body));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select the text and copy it yourself.");
    }
  }

  async function markContacted() {
    setBusy(true);
    setError(null);
    try {
      const row = await organizerFetch<SponsorProspect>(`/outreach/prospects/${prospect.id}`, eventId, {
        method: "PATCH",
        body: JSON.stringify({ status: "CONTACTED" }),
      });
      onMarkedContacted(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark contacted");
    } finally {
      setBusy(false);
    }
  }

  async function draftWithAi() {
    setAiBusy(true);
    setError(null);
    try {
      const draft = await organizerFetch<{ subject: string; body: string }>(
        `/outreach/prospects/${prospect.id}/draft`,
        eventId,
        { method: "POST" },
      );
      setSubject(draft.subject);
      setBody(draft.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not draft with AI");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="outreach-compose console-panel" style={{ margin: "12px 0 0" }}>
      <div className="console-panel-head">
        <p className="console-panel-label">Write email — {prospect.orgName}</p>
        <button type="button" className="button secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="help-text" style={{ marginTop: 0 }}>
        {OUTREACH_DOCTRINE}
      </p>
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

      <div className="console-form" style={{ maxWidth: "100%" }}>
        <label>
          Template
          <Select
            aria-label="Outreach template"
            value={templateId}
            onChange={(value) => {
              setTemplateId(value);
              applyTemplate(value);
            }}
            options={pickerOptions}
          />
        </label>
        <label>
          Subject
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label>
          Body
          <AutoGrowTextarea className="textarea" minRows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <label>
          CC yourself/colleague
          <input
            className="input"
            type="email"
            value={cc}
            onChange={(e) => {
              setCc(e.target.value);
              rememberLastOutreachCc(eventId, e.target.value);
            }}
            placeholder="optional"
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {mailto ? (
          <a className="button" href={mailto} onClick={() => rememberLastOutreachCc(eventId, cc)}>
            Open in your email app
          </a>
        ) : (
          <button type="button" className="button" disabled>
            Open in your email app
          </button>
        )}
        <button type="button" className="button secondary" onClick={() => void copyEmail()}>
          {copied ? "Copied" : "Copy email"}
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => void markContacted()}>
          Mark contacted
        </button>
        <button type="button" className="button secondary" disabled={aiBusy} onClick={() => void draftWithAi()}>
          {aiBusy ? "Drafting…" : "Draft with AI"}
        </button>
      </div>
      <details className="outreach-mail-setup">
        <summary>
          Nothing opened? <span className="outreach-mail-setup-link">Set up your email app →</span>
        </summary>
        <div className="outreach-mail-setup-body">
          <p>
            <strong>Mac.</strong> Open Apple Mail once and it becomes the default, or in System
            Settings search &quot;default email app&quot;. Gmail users can instead allow
            mail.google.com as the email handler in Chrome or Edge — the handler icon in the address
            bar on gmail.com, or the browser&apos;s site-settings handlers page.
          </p>
          <p>
            <strong>Windows.</strong> Settings &gt; Apps &gt; Default apps &gt; Email.
          </p>
          <p>
            Either way, <strong>Copy email</strong> always works: copy, then paste into a new
            message in any mail service.
          </p>
          <p>
            <Link href="/help/send-sponsor-outreach">
              Send sponsor outreach from your own email address
            </Link>
          </p>
        </div>
      </details>
      <p className="help-text" style={{ margin: "8px 0 0" }}>
        Draft with AI lands here for review. It is not sent and is not saved as a template.
      </p>
    </div>
  );
}
