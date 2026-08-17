import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { EventHero } from "../../components/EventHero";
import { StatusChip } from "../../components/StatusChip";
import { API_URL } from "../../lib/api";
import { eventAccentStyle } from "../../lib/eventAccent";
import { chipForStatus, type ReadinessStatus } from "../../lib/readinessView";

type PortalRequirement = {
  label: string;
  helpText: string | null;
  kind: string;
  config: Record<string, unknown>;
  required: boolean;
};

type PortalSubmission = {
  id: string;
  value?: unknown;
  fileName?: string | null;
  submittedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
};

type PortalAssignment = {
  id: string;
  requirement: PortalRequirement;
  dueAt: string | null;
  status: ReadinessStatus;
  latestSubmission: PortalSubmission | null;
};

type PortalView = {
  event: { name: string; dates: string; logoUrl: string | null; brandColor: string | null };
  speakerName: string;
  assignments: PortalAssignment[];
};

const INPUT_STYLE: CSSProperties = { fontSize: 16 };

function fileLimitCopy(config: Record<string, unknown>): string {
  const max =
    typeof config.maxBytes === "number" && config.maxBytes > 0 ? config.maxBytes : 20_000_000;
  const mb = Math.round(max / 1_000_000);
  return `PDF, PowerPoint, Word, or image — up to ${mb} MB. Bigger file? Ask the organizer to add a link requirement instead.`;
}

function optionsOf(config: Record<string, unknown>): string[] {
  return Array.isArray(config.options)
    ? config.options.filter((o): o is string => typeof o === "string")
    : [];
}

function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function isLate(dueAt: string | null, status: ReadinessStatus): boolean {
  if (!dueAt) return false;
  if (status === "READY" || status === "WAIVED" || status === "NOT_APPLICABLE") return false;
  return new Date(dueAt).getTime() < Date.now();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function RequirementInput({
  assignment,
  disabled,
  draft,
  onChange,
  onFile,
}: {
  assignment: PortalAssignment;
  disabled: boolean;
  draft: unknown;
  onChange: (value: unknown) => void;
  onFile: (file: { fileUrl: string; fileName: string; mime: string } | null) => void;
}) {
  const { kind, config, label } = assignment.requirement;
  const options = optionsOf(config);

  if (kind === "long_text") {
    return (
      <textarea
        className="input"
        rows={5}
        disabled={disabled}
        value={typeof draft === "string" ? draft : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        style={INPUT_STYLE}
      />
    );
  }
  if (kind === "confirm" || kind === "agreement") {
    return (
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {(["yes", "no"] as const).map((opt) => (
          <label key={opt} style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, margin: 0 }}>
            <input
              type="radio"
              name={`confirm-${assignment.id}`}
              checked={draft === opt || draft === (opt === "yes")}
              disabled={disabled}
              onChange={() => onChange(opt === "yes")}
            />
            {opt === "yes" ? "Yes" : "No"}
          </label>
        ))}
      </div>
    );
  }
  if (kind === "select") {
    return (
      <select
        className="input"
        disabled={disabled}
        value={typeof draft === "string" ? draft : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        style={INPUT_STYLE}
      >
        <option value="">Choose…</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (kind === "multi_select") {
    const selected = Array.isArray(draft) ? (draft as string[]) : [];
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {options.map((opt) => (
          <label key={opt} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, margin: 0 }}>
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              disabled={disabled}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...selected, opt]
                  : selected.filter((s) => s !== opt);
                onChange(next);
              }}
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }
  if (kind === "date") {
    const value = typeof draft === "string" ? draft.slice(0, 10) : "";
    return (
      <input
        className="input"
        type="date"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        style={INPUT_STYLE}
      />
    );
  }
  if (kind === "url") {
    return (
      <input
        className="input"
        type="url"
        inputMode="url"
        placeholder="https://"
        disabled={disabled}
        value={typeof draft === "string" ? draft : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        style={INPUT_STYLE}
      />
    );
  }
  if (kind === "file") {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <p className="help-text" style={{ margin: 0 }}>
          {fileLimitCopy(config)}
        </p>
        <input
          className="input"
          type="file"
          disabled={disabled}
          accept=".pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/png,image/jpeg"
          aria-label={label}
          style={INPUT_STYLE}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) {
              onFile(null);
              return;
            }
            void readFileAsDataUrl(file).then((fileUrl) =>
              onFile({ fileUrl, fileName: file.name, mime: file.type || "application/octet-stream" }),
            );
          }}
        />
      </div>
    );
  }
  return (
    <input
      className="input"
      type="text"
      disabled={disabled}
      value={typeof draft === "string" ? draft : ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      style={INPUT_STYLE}
    />
  );
}

export default function PresenterPortalPage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";
  const [view, setView] = useState<PortalView | null>(null);
  const [denial, setDenial] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [files, setFiles] = useState<Record<string, { fileUrl: string; fileName: string; mime: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_URL}/portal/${encodeURIComponent(token)}`);
    const json = (await res.json().catch(() => ({}))) as PortalView & { error?: string; reason?: string };
    if (!res.ok) {
      setDenial(
        typeof json.error === "string"
          ? json.error
          : "This link has expired — contact the event organizer for a fresh one.",
      );
      setView(null);
      return;
    }
    setDenial(null);
    setView(json);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const a of json.assignments) {
        if (next[a.id] !== undefined) continue;
        if (a.latestSubmission?.value != null && a.requirement.kind !== "file") {
          next[a.id] = a.latestSubmission.value;
        }
      }
      return next;
    });
  }, [token]);

  useEffect(() => {
    if (!token || !router.isReady) return;
    setLoadError(null);
    load().catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load this page."));
  }, [token, router.isReady, load]);

  async function submit(assignment: PortalAssignment) {
    setBusyId(assignment.id);
    setRowError((prev) => {
      const next = { ...prev };
      delete next[assignment.id];
      return next;
    });
    try {
      const body: Record<string, unknown> =
        assignment.requirement.kind === "file"
          ? { ...files[assignment.id] }
          : { value: drafts[assignment.id] };
      const res = await fetch(
        `${API_URL}/portal/${encodeURIComponent(token)}/assignments/${encodeURIComponent(assignment.id)}/submission`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Could not submit.");
      }
      await load();
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [assignment.id]: err instanceof Error ? err.message : "Could not submit.",
      }));
    } finally {
      setBusyId(null);
    }
  }

  const title = view ? `${view.event.name} — materials` : "Presenter portal";

  return (
    <div style={eventAccentStyle(view?.event.brandColor)} className="container">
      <Head>
        <title>{title}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px 48px", display: "grid", gap: 16 }}>
        {denial ? (
          <section className="card" style={{ padding: 24 }}>
            <h1 className="text-display-sm" style={{ marginTop: 0 }}>
              This link isn’t available
            </h1>
            <p className="text-body-md" style={{ margin: 0 }}>
              {denial}
            </p>
          </section>
        ) : null}

        {loadError && !denial ? (
          <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
            {loadError}
          </p>
        ) : null}

        {view && !denial ? (
          <>
            <EventHero
              name={view.event.name}
              dateRange={view.event.dates}
              logoUrl={view.event.logoUrl}
              accentColor={view.event.brandColor}
            />
            <p className="text-body-md" style={{ margin: 0 }}>
              Hi {view.speakerName} — please complete the items below.
            </p>
            {view.assignments.map((a) => {
              const chip = chipForStatus(a.status);
              const due = formatDue(a.dueAt);
              const late = isLate(a.dueAt, a.status);
              const approved = Boolean(a.latestSubmission?.approvedAt);
              const rejected = Boolean(a.latestSubmission?.rejectedAt);
              const submitted = Boolean(a.latestSubmission) && !rejected && !approved;
              const locked = approved;
              return (
                <section
                  key={a.id}
                  className="card"
                  style={{ padding: 16, display: "grid", gap: 10 }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                    }}
                  >
                    <strong>{a.requirement.label}</strong>
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <StatusChip status={chip.chipStatus} label={chip.label} />
                    </span>
                  </div>
                  {a.requirement.helpText ? (
                    <p className="help-text" style={{ margin: 0 }}>
                      {a.requirement.helpText}
                    </p>
                  ) : null}
                  {due ? (
                    <p
                      className="text-meta"
                      style={{ margin: 0, color: late ? "var(--danger)" : undefined }}
                    >
                      {late ? `Late — was due ${due}` : `Due ${due}`}
                    </p>
                  ) : null}
                  {submitted ? (
                    <p className="text-meta" style={{ margin: 0, color: "var(--success)" }}>
                      Submitted ✓
                    </p>
                  ) : null}
                  {approved ? (
                    <p className="text-meta" style={{ margin: 0, color: "var(--success)" }}>
                      Approved ✓
                    </p>
                  ) : null}
                  {rejected ? (
                    <p role="status" style={{ margin: 0, color: "var(--danger)" }}>
                      The organizer asked you to resubmit
                      {a.latestSubmission?.rejectedReason
                        ? `: ${a.latestSubmission.rejectedReason}`
                        : "."}
                    </p>
                  ) : null}
                  {!locked ? (
                    <>
                      <RequirementInput
                        assignment={a}
                        disabled={busyId === a.id}
                        draft={drafts[a.id]}
                        onChange={(value) => setDrafts((prev) => ({ ...prev, [a.id]: value }))}
                        onFile={(file) =>
                          setFiles((prev) => {
                            const next = { ...prev };
                            if (file) next[a.id] = file;
                            else delete next[a.id];
                            return next;
                          })
                        }
                      />
                      {rowError[a.id] ? (
                        <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
                          {rowError[a.id]}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className="button"
                        style={{ justifySelf: "start", minHeight: 44 }}
                        disabled={busyId === a.id}
                        onClick={() => void submit(a)}
                      >
                        {busyId === a.id ? "Submitting…" : a.latestSubmission ? "Resubmit" : "Submit"}
                      </button>
                    </>
                  ) : a.latestSubmission?.fileName ? (
                    <p className="text-meta" style={{ margin: 0 }}>
                      {a.latestSubmission.fileName}
                    </p>
                  ) : a.latestSubmission?.value != null ? (
                    <p style={{ margin: 0, overflowWrap: "anywhere" }}>
                      {typeof a.latestSubmission.value === "string"
                        ? a.latestSubmission.value
                        : JSON.stringify(a.latestSubmission.value)}
                    </p>
                  ) : null}
                </section>
              );
            })}
          </>
        ) : null}

        {!view && !denial && !loadError && token ? (
          <p className="help-text" style={{ margin: 0 }}>
            Loading…
          </p>
        ) : null}
      </main>
    </div>
  );
}
