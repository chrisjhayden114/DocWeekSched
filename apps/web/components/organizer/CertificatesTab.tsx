import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CERTIFICATE_BACKGROUND_ACCEPT,
  CERTIFICATE_BACKGROUND_GUIDANCE,
  CERTIFICATE_BACKGROUND_MAX_BYTES,
  CERTIFICATE_NAME_COLORS,
  CERTIFICATE_NAME_FONT_SIZE_MAX,
  CERTIFICATE_NAME_FONT_SIZE_MIN,
  CERTIFICATE_NAME_FONT_SIZE_STEP,
  CERTIFICATE_NAME_ONLY_NOTE,
  CERTIFICATE_NAME_Y_PCT_MAX,
  CERTIFICATE_NAME_Y_PCT_MIN,
  normalizeCertificateNameBox,
  type CertificateNameBox,
  type CertificateOrientation,
  type CertificateTemplateKind,
} from "@event-app/shared";
import { AutoGrowTextarea } from "../kit";
import { ListEmpty, ListError } from "../ListState";
import { SearchableMultiSelect } from "../SearchableMultiSelect";
import { SegmentedToggle } from "../SegmentedToggle";
import { Select } from "../Select";
import { UploadDropzone } from "../UploadDropzone";
import { CertificateDesignPreview } from "./CertificateDesignPreview";
import { organizerFetch } from "../../lib/organizerApi";

/**
 * CERT-2 — where certificate templates are designed.
 *
 * Two kinds sit behind one switch. The built-in layout is the path for an
 * organizer with no design to bring; "your own design" is the Canva-export
 * reality — they upload the finished PNG/JPG and we place each attendee's name
 * on it. Nothing else about certificates changes between the two: eligibility,
 * batch issue, the ready email, and the public verify page are shared.
 *
 * Deliberately not a designer. The only placement control is a vertical
 * slider, the name is always centred horizontally, and the preview is
 * read-only — no draggable box, no WYSIWYG canvas.
 */

type EligibilityRule = "ANY_CHECKIN" | "MIN_SESSIONS" | "REQUIRED_SESSIONS";

export type CertificateTemplateRow = {
  id: string;
  name: string;
  titleText: string;
  bodyText: string | null;
  signatureImageUrl: string | null;
  hours: number | null;
  eligibilityRule: EligibilityRule;
  minSessions: number | null;
  requiredSessionIds: string[];
  kind: CertificateTemplateKind;
  backgroundImageUrl: string | null;
  nameBox: unknown;
  orientation: CertificateOrientation;
};

type TemplatesResponse = {
  templates: CertificateTemplateRow[];
  sessionEligibilityNote?: string;
};

type FormState = {
  id: string | null;
  name: string;
  titleText: string;
  bodyText: string;
  signatureImageUrl: string;
  hours: string;
  eligibilityRule: EligibilityRule;
  minSessions: string;
  requiredSessionIds: string[];
  kind: CertificateTemplateKind;
  backgroundImageUrl: string | null;
  /**
   * True once the organizer uploads or removes artwork in this editing
   * session. Only then does `backgroundImageUrl` go in the payload — omitting
   * it means "leave the design alone", so saving a slider nudge does not
   * resend megabytes of base64 (see lib/certificates/design.ts).
   */
  backgroundDirty: boolean;
  nameBox: CertificateNameBox;
  orientation: CertificateOrientation;
};

const RULE_OPTIONS = [
  { value: "ANY_CHECKIN", label: "Checked in at the event" },
  { value: "MIN_SESSIONS", label: "Joined at least N sessions" },
  { value: "REQUIRED_SESSIONS", label: "Joined every required session" },
];

const RULE_LABELS: Record<EligibilityRule, string> = {
  ANY_CHECKIN: "Any check-in",
  MIN_SESSIONS: "Minimum sessions",
  REQUIRED_SESSIONS: "Required sessions",
};

function emptyForm(): FormState {
  return {
    id: null,
    name: "",
    titleText: "Certificate of Attendance",
    bodyText: "",
    signatureImageUrl: "",
    hours: "",
    eligibilityRule: "ANY_CHECKIN",
    minSessions: "",
    requiredSessionIds: [],
    kind: "TEXT",
    backgroundImageUrl: null,
    backgroundDirty: false,
    nameBox: normalizeCertificateNameBox({}),
    orientation: "LANDSCAPE",
  };
}

function formFromRow(row: CertificateTemplateRow): FormState {
  return {
    id: row.id,
    name: row.name,
    titleText: row.titleText,
    bodyText: row.bodyText || "",
    signatureImageUrl: row.signatureImageUrl || "",
    hours: row.hours == null ? "" : String(row.hours),
    eligibilityRule: row.eligibilityRule,
    minSessions: row.minSessions == null ? "" : String(row.minSessions),
    requiredSessionIds: row.requiredSessionIds || [],
    kind: row.kind || "TEXT",
    backgroundImageUrl: row.backgroundImageUrl,
    backgroundDirty: false,
    nameBox: normalizeCertificateNameBox(row.nameBox),
    orientation: row.orientation || "LANDSCAPE",
  };
}

/**
 * The upload, byte-for-byte.
 *
 * Unlike an event logo (EventBrandingFields#fileToDataUrl resizes and
 * re-encodes to JPEG), a certificate design is passed through untouched: it is
 * the finished artwork, often with crisp type and a logo, and JPEG-ing it at
 * 512px would visibly wreck the thing the organizer came here to use.
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read that file"));
    reader.readAsDataURL(file);
  });
}

export function CertificatesTab({
  eventId,
  sessions,
}: {
  eventId: string;
  sessions: { id: string; title: string }[];
}) {
  const [data, setData] = useState<TemplatesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(
        await organizerFetch<TemplatesResponse>(
          `/certificates/event/${eventId}/templates`,
          eventId,
        ),
      );
    } catch (e) {
      const err = e as Error & { body?: { error?: string } };
      setLoadError(err.body?.error || err.message || "Could not load certificate templates");
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  function patch(next: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...next } : f));
    setNotice(null);
  }

  function patchNameBox(next: Partial<CertificateNameBox>) {
    setForm((f) => (f ? { ...f, nameBox: { ...f.nameBox, ...next } } : f));
    setNotice(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setNotice(null);

    if (!form.name.trim()) {
      setError("Give the template a name so you can tell it apart from the others.");
      return;
    }
    if (form.kind === "IMAGE_BACKGROUND" && !form.backgroundImageUrl) {
      setError("Upload your certificate design, or switch back to the built-in layout.");
      return;
    }

    const hours = form.hours.trim();
    if (hours !== "" && !Number.isFinite(Number(hours))) {
      setError("Hours needs to be a number, like 6 or 7.5 — or leave it empty.");
      return;
    }
    if (form.eligibilityRule === "MIN_SESSIONS") {
      const min = Number(form.minSessions.trim());
      if (!Number.isInteger(min) || min < 1) {
        setError("Set the minimum number of sessions to a whole number of 1 or more.");
        return;
      }
    }
    if (form.eligibilityRule === "REQUIRED_SESSIONS" && form.requiredSessionIds.length === 0) {
      setError("Pick at least one session people have to join.");
      return;
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      // The built-in layout draws titleText; an uploaded design does not, but
      // the column is required, so a design-only template stores its own name.
      titleText: form.titleText.trim() || form.name.trim(),
      bodyText: form.bodyText.trim() || null,
      signatureImageUrl: form.signatureImageUrl || null,
      hours: hours === "" ? null : Number(hours),
      eligibilityRule: form.eligibilityRule,
      minSessions:
        form.eligibilityRule === "MIN_SESSIONS" && form.minSessions.trim() !== ""
          ? Number(form.minSessions)
          : null,
      requiredSessionIds:
        form.eligibilityRule === "REQUIRED_SESSIONS" ? form.requiredSessionIds : [],
      kind: form.kind,
      orientation: form.orientation,
      nameBox: form.nameBox,
    };
    // Absent means untouched. Present-and-null means the artwork was removed.
    if (form.backgroundDirty || !form.id) {
      payload.backgroundImageUrl = form.backgroundImageUrl;
    }

    setBusy(true);
    try {
      await organizerFetch(
        form.id
          ? `/certificates/templates/${form.id}`
          : `/certificates/event/${eventId}/templates`,
        eventId,
        { method: form.id ? "PUT" : "POST", body: JSON.stringify(payload) },
      );
      setForm(null);
      setNotice(form.id ? "Template saved." : "Template created.");
      await load();
    } catch (err) {
      const e2 = err as Error & { body?: { error?: string } };
      setError(e2.body?.error || e2.message || "Could not save the template");
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !data) return <ListError message={loadError} onRetry={() => void load()} />;
  if (!data) return <p className="help-text">Loading certificate templates…</p>;

  const templates = data.templates || [];

  return (
    <section className="console-panel">
      <div className="console-panel-head">
        <p className="console-panel-label">Certificates</p>
        {!form ? (
          <button type="button" className="button" onClick={() => setForm(emptyForm())}>
            New template
          </button>
        ) : null}
      </div>

      <p className="help-text" style={{ marginTop: 0 }}>
        A template says what the certificate looks like and who is eligible. Use the built-in
        layout if you have no design of your own, or upload a finished design and we will place
        each attendee&apos;s name on it. Issuing happens on <strong>Recap</strong> after the event
        ends; the link in the ready email opens the{" "}
        <Link href="/help/certificates">public verify page</Link>.
      </p>

      {notice ? <p className="help-text">{notice}</p> : null}

      {form ? (
        <form onSubmit={(e) => void save(e)} className="console-form" style={{ marginTop: 12 }}>
          {error ? (
            <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
              {error}
            </p>
          ) : null}

          <label>
            Template name
            <input
              className="input"
              value={form.name}
              maxLength={200}
              placeholder="Spring PD day — 6 hours"
              onChange={(e) => patch({ name: e.target.value })}
            />
            <span className="help-text">Only you see this. It never appears on the PDF.</span>
          </label>

          <div>
            <span className="field-label-text">Design</span>
            <SegmentedToggle
              className="cert-seg"
              ariaLabel="Certificate design"
              value={form.kind}
              onChange={(kind) => patch({ kind })}
              options={[
                { id: "TEXT", label: "Built-in layout" },
                { id: "IMAGE_BACKGROUND", label: "Your own design" },
              ]}
            />
            <span className="help-text">
              {form.kind === "TEXT"
                ? "We lay out the certificate using your event's accent colour and logo. Nothing to design."
                : CERTIFICATE_NAME_ONLY_NOTE}
            </span>
          </div>

          {form.kind === "TEXT" ? (
            <>
              <label>
                Title on the certificate
                <input
                  className="input"
                  value={form.titleText}
                  maxLength={500}
                  onChange={(e) => patch({ titleText: e.target.value })}
                />
              </label>
              <label>
                Body text (optional)
                <AutoGrowTextarea
                  className="input"
                  minRows={4}
                  value={form.bodyText}
                  maxLength={8000}
                  placeholder="This certifies that {attendeeName} attended {eventName} on {dates}."
                  onChange={(e) => patch({ bodyText: e.target.value })}
                />
                <span className="help-text">
                  You can use {"{attendeeName}"}, {"{eventName}"}, {"{dates}"}, {"{hours}"} and{" "}
                  {"{certificateId}"}. Each is replaced when the certificate is issued.
                </span>
              </label>
              <div>
                <span className="field-label-text">Signature image (optional)</span>
                {form.signatureImageUrl ? (
                  <p style={{ margin: "0 0 8px" }}>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => patch({ signatureImageUrl: "" })}
                    >
                      Remove signature image
                    </button>
                  </p>
                ) : null}
                <UploadDropzone
                  variant="compact"
                  label="Signature upload"
                  accept={CERTIFICATE_BACKGROUND_ACCEPT}
                  maxBytes={350_000}
                  onFile={async (file) => {
                    patch({ signatureImageUrl: await readFileAsDataUrl(file) });
                  }}
                />
              </div>
            </>
          ) : (
            <div className="cert-design-grid">
              <div style={{ minWidth: 0, display: "grid", gap: 12 }}>
                <CertificateDesignPreview
                  backgroundImageUrl={form.backgroundImageUrl}
                  nameBox={form.nameBox}
                  orientation={form.orientation}
                />
                <UploadDropzone
                  variant={form.backgroundImageUrl ? "compact" : "default"}
                  label={form.backgroundImageUrl ? "Replace design" : "Certificate design"}
                  accept={CERTIFICATE_BACKGROUND_ACCEPT}
                  maxBytes={CERTIFICATE_BACKGROUND_MAX_BYTES}
                  hint={CERTIFICATE_BACKGROUND_GUIDANCE}
                  onFile={async (file) => {
                    patch({
                      backgroundImageUrl: await readFileAsDataUrl(file),
                      backgroundDirty: true,
                    });
                  }}
                />
                {form.backgroundImageUrl ? (
                  <p style={{ margin: 0 }}>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        patch({ backgroundImageUrl: null, backgroundDirty: true, kind: "TEXT" })
                      }
                    >
                      Remove design and use the built-in layout
                    </button>
                  </p>
                ) : null}
              </div>

              <div className="cert-design-controls">
                <div>
                  <span className="field-label-text">Page</span>
                  <SegmentedToggle
                    className="cert-seg"
                    ariaLabel="Page orientation"
                    value={form.orientation}
                    onChange={(orientation) => patch({ orientation })}
                    options={[
                      { id: "LANDSCAPE", label: "Landscape" },
                      { id: "PORTRAIT", label: "Portrait" },
                    ]}
                  />
                </div>

                <label>
                  Name position
                  <input
                    className="cert-slider"
                    type="range"
                    min={CERTIFICATE_NAME_Y_PCT_MIN}
                    max={CERTIFICATE_NAME_Y_PCT_MAX}
                    step={1}
                    value={form.nameBox.yPct}
                    onChange={(e) => patchNameBox({ yPct: Number(e.target.value) })}
                  />
                  <span className="help-text">
                    Slide the name up or down. It is always centred left-to-right.
                  </span>
                </label>

                <div>
                  <span className="field-label-text">Name size</span>
                  <div className="cert-stepper">
                    <button
                      type="button"
                      className="button secondary"
                      aria-label="Smaller name"
                      disabled={form.nameBox.fontSize <= CERTIFICATE_NAME_FONT_SIZE_MIN}
                      onClick={() =>
                        patchNameBox({
                          fontSize: Math.max(
                            CERTIFICATE_NAME_FONT_SIZE_MIN,
                            form.nameBox.fontSize - CERTIFICATE_NAME_FONT_SIZE_STEP,
                          ),
                        })
                      }
                    >
                      −
                    </button>
                    <output>{form.nameBox.fontSize}pt</output>
                    <button
                      type="button"
                      className="button secondary"
                      aria-label="Larger name"
                      disabled={form.nameBox.fontSize >= CERTIFICATE_NAME_FONT_SIZE_MAX}
                      onClick={() =>
                        patchNameBox({
                          fontSize: Math.min(
                            CERTIFICATE_NAME_FONT_SIZE_MAX,
                            form.nameBox.fontSize + CERTIFICATE_NAME_FONT_SIZE_STEP,
                          ),
                        })
                      }
                    >
                      +
                    </button>
                  </div>
                </div>

                <div>
                  <span className="field-label-text">Name colour</span>
                  <div className="cert-swatches">
                    <button
                      type="button"
                      aria-label="Dark text"
                      aria-pressed={form.nameBox.color === CERTIFICATE_NAME_COLORS.dark}
                      className={`cert-swatch${form.nameBox.color === CERTIFICATE_NAME_COLORS.dark ? " is-active" : ""}`}
                      style={{ background: CERTIFICATE_NAME_COLORS.dark }}
                      onClick={() => patchNameBox({ color: CERTIFICATE_NAME_COLORS.dark })}
                    />
                    <button
                      type="button"
                      aria-label="Light text"
                      aria-pressed={form.nameBox.color === CERTIFICATE_NAME_COLORS.light}
                      className={`cert-swatch${form.nameBox.color === CERTIFICATE_NAME_COLORS.light ? " is-active" : ""}`}
                      style={{ background: CERTIFICATE_NAME_COLORS.light }}
                      onClick={() => patchNameBox({ color: CERTIFICATE_NAME_COLORS.light })}
                    />
                  </div>
                  <span className="help-text">Dark for pale designs, light for dark ones.</span>
                </div>
              </div>
            </div>
          )}

          <label>
            Hours (optional)
            <input
              className="input"
              value={form.hours}
              inputMode="decimal"
              placeholder="6"
              onChange={(e) => patch({ hours: e.target.value })}
            />
            <span className="help-text">
              Recorded on every certificate this template issues and shown on the public verify
              page. On your own design, print the hours into the design as well — we only place the
              name.
            </span>
          </label>

          <label>
            Who is eligible
            <Select
              options={RULE_OPTIONS}
              value={form.eligibilityRule}
              aria-label="Eligibility rule"
              onChange={(value) => patch({ eligibilityRule: value as EligibilityRule })}
            />
            {data.sessionEligibilityNote ? (
              <span className="help-text">{data.sessionEligibilityNote}</span>
            ) : null}
          </label>

          {form.eligibilityRule === "MIN_SESSIONS" ? (
            <label>
              Minimum sessions joined
              <input
                className="input"
                value={form.minSessions}
                inputMode="numeric"
                placeholder="3"
                onChange={(e) => patch({ minSessions: e.target.value })}
              />
            </label>
          ) : null}

          {form.eligibilityRule === "REQUIRED_SESSIONS" ? (
            <div>
              <SearchableMultiSelect
                label="Required sessions"
                placeholder="Search sessions…"
                emptyLabel="No sessions match"
                people={sessions.map((s) => ({ id: s.id, name: s.title }))}
                selectedIds={form.requiredSessionIds}
                onChange={(ids) => patch({ requiredSessionIds: ids })}
              />
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" className="button" disabled={busy}>
              {busy ? "Saving…" : form.id ? "Save template" : "Create template"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setForm(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : templates.length === 0 ? (
        <ListEmpty
          title="No certificate templates yet"
          body="Create one to define what the certificate says and who is eligible. You can use our built-in layout or upload a design you already made."
          actionLabel="New template"
          onAction={() => setForm(emptyForm())}
        />
      ) : (
        <div className="console-table-wrap" style={{ marginTop: 12 }}>
          <table className="console-table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Design</th>
                <th>Eligibility</th>
                <th>Hours</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>
                    {t.kind === "IMAGE_BACKGROUND"
                      ? `Your design · ${t.orientation === "PORTRAIT" ? "portrait" : "landscape"}`
                      : "Built-in layout"}
                  </td>
                  <td>{RULE_LABELS[t.eligibilityRule] || t.eligibilityRule}</td>
                  <td>{t.hours == null ? "—" : t.hours}</td>
                  <td>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setForm(formFromRow(t));
                        setError(null);
                        setNotice(null);
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
