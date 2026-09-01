import { brand, orgSettingsCopy } from "@event-app/config";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  SetupCopilotFormState,
  SetupCopilotMessage,
  SetupCopilotStep,
  SetupFieldChange,
} from "@event-app/shared";
import {
  ASSISTANT_COPY,
  emptySetupFormState,
  setupEventTypeLabel,
  setupTimezoneFieldLabel,
} from "@event-app/shared";
import { AutoGrowTextarea } from "../../../components/kit";
import { FeatureConfigPanel, type FeatureOverridesMap } from "../../../components/FeatureConfigPanel";
import { OrganizerShell } from "../../../components/OrganizerShell";
import { SetupCopilotChat } from "../../../components/SetupCopilotChat";
import { AiGeneratedChip } from "../../../components/AiGeneratedChip";
import { EventBrandingFields } from "../../../components/organizer/EventBrandingFields";
import { Select } from "../../../components/Select";
import { TimezoneSelect } from "../../../components/TimezoneSelect";
import { apiFetch } from "../../../lib/api";
import { OrgSummary, type OrgIdentity } from "../../../lib/organizerApi";
import { EVENT_ORG_LOCKED_NOTE } from "../../../lib/eventCreationOrg";
import { orgLogoPrefill } from "../../../lib/orgLogoPrefill";
import {
  clearSetupCopilotDraft,
  copilotFormToWizardFields,
  copilotStepFromForm,
  fieldChangeMap,
  formForSetupComplete,
  loadSetupCopilotDraft,
  mergeFieldChanges,
  restoreAiFormWithWizardEdits,
  saveSetupCopilotDraft,
  wizardFieldsToCopilotForm,
} from "../../../lib/setupCopilotDraft";
import {
  WIZARD_DRAFT_STORAGE_KEY,
  clearWizardDraft,
  isEmptyWizardDraft,
  parseWizardDraft,
  serializeWizardDraft,
  type WizardAiHandoff,
  type WizardDraft,
} from "../../../lib/wizardDraft";

/**
 * W-4 — old→new highlight under a summary row, the same "current → proposed"
 * shape the review cards use, shown only for fields a resolved conflict
 * actually changed.
 */
function FieldChangeNote({ change }: { change?: SetupFieldChange }) {
  if (!change) return null;
  return (
    <span
      className="setup-field-change"
      style={{
        display: "block",
        width: "fit-content",
        marginTop: 4,
        padding: "1px 6px",
        borderRadius: 4,
        background: "var(--event-accent-tint)",
        fontSize: 12,
        fontWeight: 400,
      }}
    >
      {change.label}: {change.from} → <strong>{change.to}</strong>
    </span>
  );
}

/**
 * W-6 — hide the org picker when there is only one organization; otherwise
 * say plainly that the choice is permanent.
 */
function EventOrgField({
  orgs,
  organizationId,
  onChange,
  required,
  selectStyle,
}: {
  orgs: OrgSummary[];
  organizationId: string;
  onChange: (id: string) => void;
  required?: boolean;
  selectStyle?: CSSProperties;
}) {
  if (orgs.length === 1) {
    return <p className="help-text">Creating in {orgs[0]!.name}</p>;
  }
  return (
    <>
      <label>
        Organization
        <Select
          value={organizationId}
          onChange={onChange}
          required={required}
          style={selectStyle}
          aria-label="Organization"
          options={orgs.map((o) => ({ value: o.id, label: o.name }))}
        />
      </label>
      <p className="help-text">{EVENT_ORG_LOCKED_NOTE}</p>
    </>
  );
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export default function NewEventWizard() {
  const router = useRouter();
  const orgFromQuery = typeof router.query.org === "string" ? router.query.org : "";
  const modeAi = router.query.mode === "ai";
  const handoffIngest = router.query.handoff === "ingest";

  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const [organizationId, setOrganizationId] = useState("");
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [timezone, setTimezone] = useState(
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC",
  );
  const initialTimezoneRef = useRef(timezone);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [onlineUrl, setOnlineUrl] = useState("");
  // BRAND-2: branding starts empty, which means the neutral platform accent
  // (lib/eventAccent.ts). A new event must never be born wearing Readyhall blue.
  const [brandColor, setBrandColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  /**
   * ORG-1 — the org logo currently SUGGESTED in the field (with the org that
   * offered it, for the note), and whether the organizer has since touched the
   * field. Prefill, not seed: nothing is attached on submit that they could not
   * see and delete.
   */
  const [orgLogoSuggestion, setOrgLogoSuggestion] = useState<{ logoUrl: string; orgName: string } | null>(
    null,
  );
  const [logoUserEdited, setLogoUserEdited] = useState(false);
  const [featureOverrides, setFeatureOverrides] = useState<FeatureOverridesMap>({});
  const [copilotForm, setCopilotForm] = useState<SetupCopilotFormState>(() => emptySetupFormState(timezone));
  const [copilotHistory, setCopilotHistory] = useState<SetupCopilotMessage[]>([]);
  const [copilotStep, setCopilotStep] = useState<SetupCopilotStep>("name");
  const [fieldChanges, setFieldChanges] = useState<SetupFieldChange[]>([]);
  const [chatEpoch, setChatEpoch] = useState(0);
  const [draftsReady, setDraftsReady] = useState(false);
  /** W-5 — AI-mapped fields at the last Manual handoff; later wizard edits are diffs against this. */
  const [aiHandoff, setAiHandoff] = useState<WizardAiHandoff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{
    id: string;
    slug: string;
    slugUrl?: string;
    joinUrl?: string;
    handoffIngestPath?: string | null;
  } | null>(null);
  // Host for the live slug preview; set client-side to avoid hydration mismatch.
  const [linkHost, setLinkHost] = useState("");

  useEffect(() => {
    setLinkHost(window.location.host);
  }, []);

  // Fetch orgs once the query is hydrated. Runs a single time: re-running on
  // router identity changes used to re-set organizationId (and could redirect
  // on a transient failure) while the user was mid-entry.
  const orgsFetchedRef = useRef(false);
  useEffect(() => {
    if (!router.isReady || orgsFetchedRef.current) return;
    orgsFetchedRef.current = true;
    void (async () => {
      try {
        const mine = await apiFetch<OrgSummary[]>("/organizations/mine");
        setOrgs(mine);
        const preferred = orgFromQuery || window.localStorage.getItem("organizerOrgId") || mine[0]?.id || "";
        // Keep an org already chosen (e.g. restored from a draft) if it's still valid.
        setOrganizationId((prev) => (prev && mine.some((o) => o.id === prev) ? prev : preferred));
        setOrgsLoaded(true);
      } catch {
        void router.push("/");
      }
    })();
  }, [router.isReady, orgFromQuery, router]);

  /** Latest logo-field state for the effect below, which must not re-run per keystroke. */
  const logoFieldRef = useRef({ logoUrl, suggestion: orgLogoSuggestion, edited: logoUserEdited });
  logoFieldRef.current = { logoUrl, suggestion: orgLogoSuggestion, edited: logoUserEdited };

  // ORG-1 — offer the organization's logo when one is selected. Keyed on the
  // organization alone: the field's own state is read through the ref above so
  // typing in the box can never re-trigger a suggestion.
  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    void apiFetch<OrgIdentity>(`/organizations/${encodeURIComponent(organizationId)}`)
      .then((org) => {
        if (cancelled) return;
        const field = logoFieldRef.current;
        const next = orgLogoPrefill({
          current: field.logoUrl,
          orgLogoUrl: org.logoUrl,
          lastPrefill: field.suggestion?.logoUrl ?? null,
          organizerEdited: field.edited,
        });
        setLogoUrl(next.logoUrl);
        setOrgLogoSuggestion(next.prefilled ? { logoUrl: next.prefilled, orgName: org.name } : null);
      })
      .catch(() => {
        /* An org we can't read just means no suggestion — never a wizard error. */
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // Restore the in-progress draft so a remount mid-entry (query hydration,
  // auth settling) never loses typed input. Declared before the AI→manual
  // restore so an explicit handoff overrides the draft.
  useEffect(() => {
    const draft = parseWizardDraft(window.sessionStorage.getItem(WIZARD_DRAFT_STORAGE_KEY));
    if (!draft) return;
    setStep(draft.step);
    if (draft.organizationId) setOrganizationId((prev) => prev || draft.organizationId);
    setName(draft.name);
    setSlug(draft.slug);
    setSlugTouched(draft.slugTouched);
    setDescription(draft.description);
    if (draft.timezone) setTimezone(draft.timezone);
    setStartDate(draft.startDate);
    setEndDate(draft.endDate);
    setVenueName(draft.venueName);
    setVenueAddress(draft.venueAddress);
    setOnlineUrl(draft.onlineUrl);
    setBrandColor(draft.brandColor);
    setLogoUrl(draft.logoUrl);
    setBannerUrl(draft.bannerUrl);
    setFeatureOverrides(draft.featureOverrides as FeatureOverridesMap);
    if (draft.aiHandoff) setAiHandoff(draft.aiHandoff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI draft restore, field-wise against a later wizard edit (W-5). A leftover
  // wizard without an AI handoff snapshot never overwrites the draft.
  // Re-runs when mode flips so a same-page query change still hydrates chat.
  useEffect(() => {
    if (!router.isReady) return;
    const wizard = parseWizardDraft(window.sessionStorage.getItem(WIZARD_DRAFT_STORAGE_KEY));
    const ai = loadSetupCopilotDraft();
    if (ai) {
      const merged =
        modeAi && wizard?.aiHandoff
          ? restoreAiFormWithWizardEdits(ai.form, wizard, wizard.aiHandoff)
          : ai.form;
      setCopilotForm(merged);
      setCopilotHistory(ai.history);
      setCopilotStep(ai.step ?? copilotStepFromForm(merged));
      if (modeAi && wizard?.aiHandoff) {
        saveSetupCopilotDraft({
          form: merged,
          history: ai.history,
          savedAt: Date.now(),
          step: ai.step ?? copilotStepFromForm(merged),
        });
      }
      // Only fold AI fields into the wizard preview when we're in AI mode.
      // In manual mode the wizard draft is the source of truth (user may have
      // edited it after switching).
      if (modeAi) applyCopilotForm(merged);
    } else if (modeAi && wizard) {
      const seeded = wizardFieldsToCopilotForm(wizard, emptySetupFormState(wizard.timezone || timezone));
      setCopilotForm(seeded);
      setCopilotHistory([]);
      setCopilotStep(copilotStepFromForm(seeded));
    }
    setDraftsReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, modeAi]);

  useEffect(() => {
    if (!slugTouched && name) setSlug(slugify(name));
  }, [name, slugTouched]);

  // Persist the draft on every change. Empty drafts are never written (there
  // is nothing to lose), so the initial mount can't clobber a stored draft
  // before the restore effect's state lands.
  useEffect(() => {
    if (created) return;
    const draft: WizardDraft = {
      step,
      organizationId,
      name,
      slug,
      slugTouched,
      description,
      timezone,
      startDate,
      endDate,
      venueName,
      venueAddress,
      onlineUrl,
      brandColor,
      logoUrl,
      bannerUrl,
      featureOverrides,
      ...(aiHandoff ? { aiHandoff } : {}),
    };
    if (isEmptyWizardDraft(draft)) return;
    try {
      window.sessionStorage.setItem(WIZARD_DRAFT_STORAGE_KEY, serializeWizardDraft(draft));
    } catch {
      /* storage unavailable — degrade to in-memory state only */
    }
  }, [
    created,
    step,
    organizationId,
    name,
    slug,
    slugTouched,
    description,
    timezone,
    startDate,
    endDate,
    venueName,
    venueAddress,
    onlineUrl,
    brandColor,
    logoUrl,
    bannerUrl,
    featureOverrides,
    aiHandoff,
  ]);

  // Persist the AI conversation + form. Empty drafts (opening greeting only)
  // are never written, so a later Manual → AI seed is not blocked.
  useEffect(() => {
    if (created) return;
    saveSetupCopilotDraft({
      form: copilotForm,
      history: copilotHistory,
      savedAt: Date.now(),
      step: copilotStep,
    });
  }, [created, copilotForm, copilotHistory, copilotStep]);

  function applyCopilotForm(form: SetupCopilotFormState) {
    setCopilotForm(form);
    const fields = copilotFormToWizardFields(form, { description });
    setName(fields.name);
    setTimezone(fields.timezone);
    setStartDate(fields.startDate);
    setEndDate(fields.endDate);
    setVenueName(fields.venueName);
    setVenueAddress(fields.venueAddress);
    setOnlineUrl(fields.onlineUrl);
    setFeatureOverrides(fields.featureOverrides as FeatureOverridesMap);
    if (fields.description) {
      setDescription((d) => d || fields.description);
    }
  }

  function clearAllDrafts() {
    clearWizardDraft();
    clearSetupCopilotDraft();
  }

  function resetAllEntryState() {
    const tz = initialTimezoneRef.current;
    setStep(0);
    setName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
    setTimezone(tz);
    setStartDate("");
    setEndDate("");
    setVenueName("");
    setVenueAddress("");
    setOnlineUrl("");
    setBrandColor("");
    setLogoUrl("");
    setBannerUrl("");
    setFeatureOverrides({});
    setCopilotForm(emptySetupFormState(tz));
    setCopilotHistory([]);
    setCopilotStep("name");
    setFieldChanges([]);
    setAiHandoff(null);
    setError(null);
  }

  function startOver() {
    clearAllDrafts();
    resetAllEntryState();
    setChatEpoch((n) => n + 1);
  }

  const startIso = useMemo(() => (startDate ? new Date(startDate).toISOString() : ""), [startDate]);
  const endIso = useMemo(() => (endDate ? new Date(endDate).toISOString() : ""), [endDate]);

  function switchToManual() {
    const form: SetupCopilotFormState = {
      ...copilotForm,
      name: name || copilotForm.name,
      timezone,
      startDate: startDate || copilotForm.startDate,
      endDate: endDate || copilotForm.endDate,
      venueName: venueName || copilotForm.venueName,
      venueAddress: venueAddress || copilotForm.venueAddress,
      onlineUrl: onlineUrl || copilotForm.onlineUrl,
      featureOverrides,
    };
    applyCopilotForm(form);
    const mapped = copilotFormToWizardFields(form, { description });
    setAiHandoff(mapped);
    const draft: WizardDraft = {
      step,
      organizationId,
      name: mapped.name,
      slug,
      slugTouched,
      description: mapped.description,
      timezone: mapped.timezone,
      startDate: mapped.startDate,
      endDate: mapped.endDate,
      venueName: mapped.venueName,
      venueAddress: mapped.venueAddress,
      onlineUrl: mapped.onlineUrl,
      brandColor,
      logoUrl,
      bannerUrl,
      featureOverrides: mapped.featureOverrides as WizardDraft["featureOverrides"],
      aiHandoff: mapped,
    };
    if (!isEmptyWizardDraft(draft)) {
      try {
        window.sessionStorage.setItem(WIZARD_DRAFT_STORAGE_KEY, serializeWizardDraft(draft));
      } catch {
        /* ignore */
      }
    }
    // AI draft stays saved so returning to the assistant restores the chat.
    saveSetupCopilotDraft({
      form,
      history: copilotHistory,
      savedAt: Date.now(),
      step: copilotStep,
    });
    void router.push({
      pathname: "/organizer/events/new",
      query: { org: organizationId },
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
      const form = formForSetupComplete(copilotForm, {
        name,
        timezone,
        startDate,
        endDate,
        venueName,
        venueAddress,
        onlineUrl,
        featureOverrides,
      });
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
      clearAllDrafts();
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
          logoUrl: logoUrl.trim() || null,
          bannerUrl: bannerUrl.trim() || null,
          timezone,
          startDate: startIso,
          endDate: endIso,
        }),
      });
      window.localStorage.setItem("activeEventId", ev.id);
      clearAllDrafts();
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

  const changed = fieldChangeMap(fieldChanges);

  return (
    <>
      <Head>
        <title>{`${modeAi ? ASSISTANT_COPY.organizer.name : "Create event"} — ${brand.productName}`}</title>
      </Head>
      <OrganizerShell active="new-event">
        <div style={{ maxWidth: modeAi ? 960 : 640 }}>
        <h1 style={{ margin: "0 0 8px", font: "var(--text-h1)" }}>{modeAi ? ASSISTANT_COPY.organizer.name : "Create event"}</h1>
        <p className="help-text">
          {modeAi
            ? "Answer a few short questions — the form on the right fills in as you go. Switch to manual anytime; nothing is lost."
            : "New events start as Draft — only your org can see them until you publish."}
        </p>

        {!orgsLoaded ? (
          // Don't mount the form (or claim there's no organization) until the
          // org list has resolved — the form renders exactly once, settled.
          <p className="help-text" role="status">
            Loading your organizations…
          </p>
        ) : orgs.length === 0 ? (
          <p>
            You need an organization first. <Link href="/organizer/org/new">Create one</Link>.
          </p>
        ) : modeAi && !created ? (
          <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)" }}>
            <div>
              <EventOrgField
                orgs={orgs}
                organizationId={organizationId}
                onChange={setOrganizationId}
                selectStyle={{ marginBottom: 12, maxWidth: 360 }}
              />
              {draftsReady ? (
              <SetupCopilotChat
                key={chatEpoch}
                mode="create"
                organizationId={organizationId}
                initialForm={copilotForm}
                initialHistory={copilotHistory}
                initialStep={copilotStep}
                initialDescription={description}
                onFormChange={applyCopilotForm}
                onConversationChange={({ messages, step: nextStep }) => {
                  setCopilotHistory(messages);
                  setCopilotStep(nextStep);
                }}
                onStartOver={startOver}
                onFieldChanges={(changes) =>
                  setFieldChanges((prev) => mergeFieldChanges(prev, changes))
                }
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
                        clearAllDrafts();
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
              ) : null}
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
                  <dd style={{ margin: 0, fontWeight: 600 }}>
                    {name || "—"}
                    <FieldChangeNote change={changed.name} />
                  </dd>
                </div>
                <div>
                  <dt className="help-text">Dates</dt>
                  <dd style={{ margin: 0 }}>
                    {startDate || "—"} → {endDate || "—"}
                    <FieldChangeNote change={changed.startDate} />
                    <FieldChangeNote change={changed.endDate} />
                  </dd>
                </div>
                <div>
                  <dt className="help-text">
                    {setupTimezoneFieldLabel(
                      Boolean(copilotForm.timezoneExplicit) || timezone !== initialTimezoneRef.current,
                    )}
                  </dt>
                  <dd style={{ margin: 0 }}>
                    {timezone}
                    <FieldChangeNote change={changed.timezone} />
                  </dd>
                </div>
                <div>
                  <dt className="help-text">Place</dt>
                  <dd style={{ margin: 0 }}>
                    {venueName || onlineUrl || "—"}
                    {venueAddress ? ` · ${venueAddress}` : ""}
                    <FieldChangeNote change={changed.venueName} />
                    <FieldChangeNote change={changed.onlineUrl} />
                  </dd>
                </div>
                <div>
                  <dt className="help-text">Size</dt>
                  <dd style={{ margin: 0 }}>
                    {copilotForm.estimatedSize || "—"}
                    <FieldChangeNote change={changed.estimatedSize} />
                  </dd>
                </div>
                <div>
                  <dt className="help-text">Type</dt>
                  <dd style={{ margin: 0 }}>
                    {setupEventTypeLabel(copilotForm.eventType) || "—"}
                    <FieldChangeNote change={changed.eventType} />
                  </dd>
                </div>
                <div>
                  <dt className="help-text">Program document</dt>
                  <dd style={{ margin: 0 }}>
                    {copilotForm.hasProgramDocument === null
                      ? "—"
                      : copilotForm.hasProgramDocument
                        ? "Yes → Agenda Ingest"
                        : "No → skeleton drafts"}
                    <FieldChangeNote change={changed.hasProgramDocument} />
                  </dd>
                </div>
                <div>
                  <dt className="help-text">Networking</dt>
                  <dd style={{ margin: 0 }}>
                    {copilotForm.networkingChoice || "—"}
                    <FieldChangeNote change={changed.networkingChoice} />
                  </dd>
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
                  Use the {ASSISTANT_COPY.organizer.name}
                </Link>
              </p>
            ) : null}

            {step === 0 && !created ? (
              <>
                <EventOrgField
                  orgs={orgs}
                  organizationId={organizationId}
                  onChange={setOrganizationId}
                  required
                />
                <label>
                  Event name
                  <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
                  {name.trim() && !slugTouched ? (
                    <span className="help-text">
                      Link will be {linkHost || "…"}/e/{slug || "…"}
                    </span>
                  ) : null}
                </label>
                <label>
                  Description
                  <AutoGrowTextarea className="input" minRows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
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
                  <span className="help-text">
                    Link will be {linkHost || "…"}/e/{slug || "…"}
                    {!slugTouched ? " — generated from the event name until you edit it" : ""}
                  </span>
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
                  <TimezoneSelect value={timezone} onChange={setTimezone} required />
                  <span className="help-text">
                    Every session time attendees see follows this zone. Defaults to your browser&apos;s timezone.
                  </span>
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
                <h2 className="text-display-sm" style={{ margin: 0 }}>
                  Branding (optional)
                </h2>
                <p className="help-text" style={{ marginTop: 0 }}>
                  Skip this and your event wears the neutral platform look. You can add or change
                  any of it later in Event settings.
                </p>
                <EventBrandingFields
                  value={{ brandColor, logoUrl, bannerUrl }}
                  onChange={(patch) => {
                    if (patch.brandColor !== undefined) setBrandColor(patch.brandColor);
                    if (patch.logoUrl !== undefined) {
                      // ORG-1: any touch of the logo field — typing, uploading,
                      // or emptying it — ends the org suggestion for good.
                      setLogoUserEdited(true);
                      setLogoUrl(patch.logoUrl);
                    }
                    if (patch.bannerUrl !== undefined) setBannerUrl(patch.bannerUrl);
                  }}
                />
                {orgLogoSuggestion && logoUrl === orgLogoSuggestion.logoUrl ? (
                  <p className="help-text" style={{ margin: "-4px 0 0" }}>
                    {orgSettingsCopy.logoPrefillNote(orgLogoSuggestion.orgName)}
                  </p>
                ) : null}
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
                  <Link className="button secondary" href={`/organizer/events/${created.id}#event-settings`}>
                    Edit event details
                  </Link>
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
              <Link className="button secondary" href={`/organizer/events/${created.id}#event-settings`}>
                Edit event details
              </Link>
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
