import { brand } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { SetupCopilotFormState } from "@event-app/shared";
import { emptySetupFormState } from "@event-app/shared";
import { FeatureConfigPanel, type FeatureOverridesMap } from "../../../components/FeatureConfigPanel";
import { OrganizerShell } from "../../../components/OrganizerShell";
import { SetupCopilotChat } from "../../../components/SetupCopilotChat";
import { AiGeneratedChip } from "../../../components/AiGeneratedChip";
import { apiFetch } from "../../../lib/api";
import { OrgSummary } from "../../../lib/organizerApi";

const MANUAL_STORAGE_KEY = "setupCopilot.manualForm";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function formToWizardFields(form: SetupCopilotFormState) {
  return {
    name: form.name,
    timezone: form.timezone,
    startDate: form.startDate ? form.startDate.slice(0, 16).replace("T", "T") : "",
    endDate: form.endDate ? form.endDate.slice(0, 16).replace("T", "T") : "",
    venueName: form.venueName,
    venueAddress: form.venueAddress,
    onlineUrl: form.onlineUrl,
    featureOverrides: form.featureOverrides as FeatureOverridesMap,
  };
}

/** datetime-local needs YYYY-MM-DDTHH:mm — dates-only get noon. */
function toDatetimeLocal(value: string): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T09:00`;
  if (value.includes("T")) return value.slice(0, 16);
  return value;
}

export default function NewEventWizard() {
  const router = useRouter();
  const orgFromQuery = typeof router.query.org === "string" ? router.query.org : "";
  const modeAi = router.query.mode === "ai";
  const handoffIngest = router.query.handoff === "ingest";

  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [timezone, setTimezone] = useState(
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC",
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [onlineUrl, setOnlineUrl] = useState("");
  const [brandColor, setBrandColor] = useState("#0033A0");
  const [featureOverrides, setFeatureOverrides] = useState<FeatureOverridesMap>({});
  const [copilotForm, setCopilotForm] = useState<SetupCopilotFormState>(() => emptySetupFormState(timezone));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{
    id: string;
    slug: string;
    slugUrl?: string;
    joinUrl?: string;
    handoffIngestPath?: string | null;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const mine = await apiFetch<OrgSummary[]>("/organizations/mine");
        setOrgs(mine);
        const preferred = orgFromQuery || window.localStorage.getItem("organizerOrgId") || mine[0]?.id || "";
        setOrganizationId(preferred);
      } catch {
        void router.push("/");
      }
    })();
  }, [orgFromQuery, router]);

  // Restore form when switching from AI → manual
  useEffect(() => {
    if (modeAi || typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(MANUAL_STORAGE_KEY);
      if (!raw) return;
      const form = JSON.parse(raw) as SetupCopilotFormState;
      window.sessionStorage.removeItem(MANUAL_STORAGE_KEY);
      applyCopilotForm(form);
    } catch {
      /* ignore */
    }
  }, [modeAi]);

  useEffect(() => {
    if (!slugTouched && name) setSlug(slugify(name));
  }, [name, slugTouched]);

  function applyCopilotForm(form: SetupCopilotFormState) {
    setCopilotForm(form);
    const fields = formToWizardFields(form);
    setName(fields.name);
    setTimezone(fields.timezone);
    setStartDate(toDatetimeLocal(form.startDate));
    setEndDate(toDatetimeLocal(form.endDate.includes("T") ? form.endDate : form.endDate ? `${form.endDate}T17:00` : ""));
    setVenueName(fields.venueName);
    setVenueAddress(fields.venueAddress);
    setOnlineUrl(fields.onlineUrl);
    setFeatureOverrides(fields.featureOverrides);
    if (form.estimatedSize) {
      setDescription((d) => d || `Estimated size: ~${form.estimatedSize}`);
    }
  }

  const startIso = useMemo(() => (startDate ? new Date(startDate).toISOString() : ""), [startDate]);
  const endIso = useMemo(() => (endDate ? new Date(endDate).toISOString() : ""), [endDate]);

  function switchToManual() {
    const form: SetupCopilotFormState = {
      ...copilotForm,
      name,
      timezone,
      startDate: startDate || copilotForm.startDate,
      endDate: endDate || copilotForm.endDate,
      venueName,
      venueAddress,
      onlineUrl,
      featureOverrides,
    };
    window.sessionStorage.setItem(MANUAL_STORAGE_KEY, JSON.stringify(form));
    void router.push({
      pathname: "/organizer/events/new",
      query: { org: organizationId, from: "ai" },
    });
  }

  async function completeViaCopilot() {
    if (!organizationId) {
      setError("Create an organization first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form: SetupCopilotFormState = {
        ...copilotForm,
        name: name || copilotForm.name,
        timezone,
        startDate: (startDate || copilotForm.startDate).slice(0, 10),
        endDate: (endDate || copilotForm.endDate).slice(0, 10),
        venueName,
        venueAddress,
        onlineUrl,
        featureOverrides,
      };
      const result = await apiFetch<{
        eventId: string;
        slug: string;
        slugUrl: string;
        joinUrl: string;
        handoffIngestPath: string | null;
      }>("/ai/setup-copilot/complete", {
        method: "POST",
        body: JSON.stringify({ organizationId, form }),
      });
      window.localStorage.setItem("activeEventId", result.eventId);
      setCreated({
        id: result.eventId,
        slug: result.slug,
        slugUrl: result.slugUrl,
        joinUrl: result.joinUrl,
        handoffIngestPath: result.handoffIngestPath,
      });
      if (result.handoffIngestPath || form.hasProgramDocument) {
        void router.push(result.handoffIngestPath || `/organizer/events/${result.eventId}/ingest`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create event");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!organizationId) {
      setError("Create an organization first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ev = await apiFetch<{
        id: string;
        slug: string;
        slugUrl?: string;
        joinUrl?: string;
        joinToken?: string;
      }>("/event/", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          name: name.trim(),
          slug: slug.trim() || undefined,
          description: description.trim() || null,
          venueName: venueName.trim() || null,
          venueAddress: venueAddress.trim() || null,
          onlineUrl: onlineUrl.trim() || null,
          brandColor: brandColor.trim() || null,
          timezone,
          startDate: startIso,
          endDate: endIso,
        }),
      });
      window.localStorage.setItem("activeEventId", ev.id);
      if (Object.keys(featureOverrides).length > 0) {
        await apiFetch("/event/features", {
          method: "PUT",
          headers: { "x-event-id": ev.id },
          body: JSON.stringify({ overrides: featureOverrides }),
        });
      }
      setCreated(ev);
      setStep(4);
      if (handoffIngest) {
        void router.push(`/organizer/events/${ev.id}/ingest`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create event");
    } finally {
      setBusy(false);
    }
  }

  const qrUrl = created?.slugUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(created.slugUrl)}`
    : null;

  const canCompleteAi =
    Boolean(copilotForm.name && copilotForm.startDate && copilotForm.endDate && organizationId);

  return (
    <>
      <Head>
        <title>{`${modeAi ? "Set up with AI" : "Create event"} — ${brand.productName}`}</title>
      </Head>
      <OrganizerShell active="new-event">
        <div style={{ maxWidth: modeAi ? 960 : 640 }}>
        <h1 style={{ margin: "0 0 8px", font: "var(--text-h1)" }}>{modeAi ? "Set up with AI" : "Create event"}</h1>
        <p className="help-text">
          {modeAi
            ? "Answer a few short questions — the form on the right fills in as you go. Switch to manual anytime; nothing is lost."
            : "New events start as Draft — only your org can see them until you publish."}
        </p>

        {orgs.length === 0 ? (
          <p>
            You need an organization first. <Link href="/organizer/org/new">Create one</Link>.
          </p>
        ) : modeAi && !created ? (
          <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)" }}>
            <div>
              <label className="help-text" style={{ display: "block", marginBottom: 6 }}>
                Organization
              </label>
              <select
                className="input"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                style={{ marginBottom: 12, maxWidth: 360 }}
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <SetupCopilotChat
                mode="create"
                organizationId={organizationId}
                onFormChange={applyCopilotForm}
                onHandoff={(_h, form) => {
                  applyCopilotForm({ ...form, hasProgramDocument: true });
                }}
                onCompleteReady={(form) => {
                  applyCopilotForm(form);
                  if (!form.hasProgramDocument) {
                    void (async () => {
                      // User said “create” in chat — finish without a second click.
                      setBusy(true);
                      setError(null);
                      try {
                        const result = await apiFetch<{
                          eventId: string;
                          slug: string;
                          slugUrl: string;
                          joinUrl: string;
                          handoffIngestPath: string | null;
                        }>("/ai/setup-copilot/complete", {
                          method: "POST",
                          body: JSON.stringify({ organizationId, form }),
                        });
                        window.localStorage.setItem("activeEventId", result.eventId);
                        setCreated({
                          id: result.eventId,
                          slug: result.slug,
                          slugUrl: result.slugUrl,
                          joinUrl: result.joinUrl,
                          handoffIngestPath: result.handoffIngestPath,
                        });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not create event");
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="button"
                  disabled={!canCompleteAi || busy}
                  onClick={() => void completeViaCopilot()}
                >
                  {busy ? "Creating…" : "Create draft event"}
                </button>
                <button type="button" className="button secondary" onClick={switchToManual}>
                  Switch to manual entry
                </button>
              </div>
              {error ? <p style={{ color: "var(--danger-700)" }}>{error}</p> : null}
            </div>
            <aside
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 16,
                background: "var(--surface-alt)",
                alignSelf: "start",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 className="text-display-sm" style={{ margin: 0, fontSize: 16 }}>
                  Event details
                </h2>
                <AiGeneratedChip />
              </div>
              <dl style={{ margin: 0, display: "grid", gap: 10, fontSize: 14 }}>
                <div>
                  <dt className="help-text">Name</dt>
                  <dd style={{ margin: 0, fontWeight: 600 }}>{name || "—"}</dd>
                </div>
                <div>
                  <dt className="help-text">Dates</dt>
                  <dd style={{ margin: 0 }}>
                    {startDate || "—"} → {endDate || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="help-text">Timezone</dt>
                  <dd style={{ margin: 0 }}>{timezone}</dd>
                </div>
                <div>
                  <dt className="help-text">Place</dt>
                  <dd style={{ margin: 0 }}>
                    {venueName || onlineUrl || "—"}
                    {venueAddress ? ` · ${venueAddress}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="help-text">Size</dt>
                  <dd style={{ margin: 0 }}>{copilotForm.estimatedSize || "—"}</dd>
                </div>
                <div>
                  <dt className="help-text">Type</dt>
                  <dd style={{ margin: 0 }}>{copilotForm.eventType || "—"}</dd>
                </div>
                <div>
                  <dt className="help-text">Program document</dt>
                  <dd style={{ margin: 0 }}>
                    {copilotForm.hasProgramDocument === null
                      ? "—"
                      : copilotForm.hasProgramDocument
                        ? "Yes → Agenda Ingest"
                        : "No → skeleton drafts"}
                  </dd>
                </div>
                <div>
                  <dt className="help-text">Networking</dt>
                  <dd style={{ margin: 0 }}>{copilotForm.networkingChoice || "—"}</dd>
                </div>
              </dl>
            </aside>
            <style jsx>{`
              @media (max-width: 800px) {
                div[style*="grid-template-columns"] {
                  grid-template-columns: 1fr !important;
                }
              }
            `}</style>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
            {!modeAi && !created ? (
              <p>
                <Link
                  className="button secondary"
                  href={`/organizer/events/new?org=${encodeURIComponent(organizationId)}&mode=ai`}
                >
                  Set up with AI
                </Link>
              </p>
            ) : null}

            {step === 0 && !created ? (
              <>
                <label>
                  Organization
                  <select
                    className="input"
                    value={organizationId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                    required
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Event name
                  <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  Description
                  <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
                <label>
                  Public slug
                  <input
                    className="input"
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                    }}
                  />
                  <span className="help-text">Link will be /e/{slug || "…"}</span>
                </label>
                <button type="button" className="button" onClick={() => setStep(1)} disabled={!name.trim()}>
                  Next: dates &amp; place
                </button>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <label>
                  Timezone
                  <input className="input" required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                </label>
                <label>
                  Starts
                  <input
                    className="input"
                    type="datetime-local"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </label>
                <label>
                  Ends
                  <input
                    className="input"
                    type="datetime-local"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </label>
                <label>
                  Venue name
                  <input className="input" value={venueName} onChange={(e) => setVenueName(e.target.value)} />
                </label>
                <label>
                  Venue address
                  <input className="input" value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} />
                </label>
                <label>
                  Online URL
                  <input className="input" value={onlineUrl} onChange={(e) => setOnlineUrl(e.target.value)} />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="button secondary" onClick={() => setStep(0)}>
                    Back
                  </button>
                  <button type="button" className="button" onClick={() => setStep(2)} disabled={!startDate || !endDate}>
                    Next: branding
                  </button>
                </div>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <label>
                  Brand color
                  <input className="input" type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="button secondary" onClick={() => setStep(1)}>
                    Back
                  </button>
                  <button type="button" className="button" onClick={() => setStep(3)}>
                    Next: features
                  </button>
                </div>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <h2 className="text-display-sm" style={{ margin: 0 }}>
                  Features
                </h2>
                <p className="help-text" style={{ marginTop: 0 }}>
                  Choose what attendees will see. You can change this anytime after creating the event.
                </p>
                <FeatureConfigPanel
                  overrides={featureOverrides}
                  onChange={setFeatureOverrides}
                  confirmOff={false}
                  showPresets
                />
                {error ? <p style={{ color: "var(--danger-700)" }}>{error}</p> : null}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="button secondary" onClick={() => setStep(2)}>
                    Back
                  </button>
                  <button className="button" type="submit" disabled={busy}>
                    {busy ? "Creating…" : "Create draft event"}
                  </button>
                </div>
              </>
            ) : null}

            {(step === 4 || created) && created ? (
              <section>
                <h2>Draft created</h2>
                <p className="help-text">
                  Public link (works after you publish):{" "}
                  <code>{created.slugUrl || `/e/${created.slug}`}</code>
                </p>
                {qrUrl ? (
                  <p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrUrl} alt="QR code for event link" width={180} height={180} />
                  </p>
                ) : null}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link className="button" href={`/organizer/events/${created.id}`}>
                    Build the program
                  </Link>
                  {created.handoffIngestPath ? (
                    <Link className="button secondary" href={created.handoffIngestPath}>
                      Import program document
                    </Link>
                  ) : null}
                  <Link className="button secondary" href="/organizer">
                    Back to dashboard
                  </Link>
                </div>
              </section>
            ) : null}
          </form>
        )}

        {modeAi && created ? (
          <section style={{ marginTop: 24 }}>
            <h2>Draft created</h2>
            <p className="help-text">
              Public link (works after you publish): <code>{created.slugUrl || `/e/${created.slug}`}</code>
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link className="button" href={`/organizer/events/${created.id}`}>
                Build the program
              </Link>
              {created.handoffIngestPath ? (
                <Link className="button secondary" href={created.handoffIngestPath}>
                  Import program document
                </Link>
              ) : null}
              <Link className="button secondary" href="/organizer">
                Back to dashboard
              </Link>
            </div>
          </section>
        ) : null}
        </div>
      </OrganizerShell>
    </>
  );
}
