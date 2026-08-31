import { brand, orgSettingsCopy } from "@event-app/config";
import {
  ORG_DESCRIPTION_MAX_CHARS,
  ORG_NAME_MAX_CHARS,
  ORG_SUPPORT_EMAIL_MAX_CHARS,
  ORG_WEBSITE_URL_MAX_CHARS,
  canEditOrgIdentity,
  normalizeOrgSupportEmail,
  normalizeOrgWebsiteUrl,
} from "@event-app/shared";
import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AutoGrowTextarea } from "../../../components/kit";
import { HoverInfo } from "../../../components/kit/HoverInfo";
import { OrganizerShell } from "../../../components/OrganizerShell";
import { ConsoleSubpageHeader } from "../../../components/organizer/ConsoleSubpageHeader";
import { OrgDangerZone } from "../../../components/organizer/OrgDangerZone";
import {
  BRANDING_IMAGE_RULES,
  fileToDataUrl,
} from "../../../components/organizer/EventBrandingFields";
import { Select } from "../../../components/Select";
import { UploadDropzone } from "../../../components/UploadDropzone";
import { apiFetch, clearAuthClientState } from "../../../lib/api";
import type { OrgIdentity, OrgSummary } from "../../../lib/organizerApi";

type FormState = {
  name: string;
  websiteUrl: string;
  supportEmail: string;
  logoUrl: string;
  description: string;
};

function initialForm(org: OrgIdentity): FormState {
  return {
    name: org.name,
    websiteUrl: org.websiteUrl || "",
    supportEmail: org.supportEmail || "",
    logoUrl: org.logoUrl || "",
    description: org.description || "",
  };
}

/**
 * ORG-1 — the organization's identity, editable at last.
 *
 * Before this page the name was set once at signup and could never be changed,
 * which is how a school ended up hosting events under a typo. The four new
 * fields are deliberately modest: this is not a public profile page (J-C
 * defers /o/<slug> and any promo gallery), it is the answer to "who is hosting
 * this and how do I reach them" plus one logo an organizer uploads once
 * instead of once per event.
 */
export default function OrganizationSettingsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [org, setOrg] = useState<OrgIdentity | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setError(null);
    setNotice(null);
    const loaded = await apiFetch<OrgIdentity>(`/organizations/${encodeURIComponent(id)}`);
    setOrg(loaded);
    setForm(initialForm(loaded));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
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
          await load(preferred);
        }
      } catch {
        clearAuthClientState();
        void router.push("/");
      }
    })();
  }, [router, load]);

  const canEdit = canEditOrgIdentity(org?.role);

  function patch(next: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...next } : f));
    setNotice(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!orgId || !form) return;
    setError(null);
    setNotice(null);

    // Pre-checked with the same functions the server uses, so a typo'd address
    // is caught before a round trip. The server remains the authority.
    const website = normalizeOrgWebsiteUrl(form.websiteUrl);
    if (!website.ok) {
      setError(website.error);
      return;
    }
    const supportEmail = normalizeOrgSupportEmail(form.supportEmail);
    if (!supportEmail.ok) {
      setError(supportEmail.error);
      return;
    }

    setBusy(true);
    try {
      // FIX-NULL: this form carries the stored value for every nullable column,
      // so it speaks for all of them on every save — an emptied field has to
      // arrive as null to actually clear.
      const saved = await apiFetch<OrgIdentity>(`/organizations/${encodeURIComponent(orgId)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name.trim(),
          websiteUrl: form.websiteUrl.trim() || null,
          supportEmail: form.supportEmail.trim() || null,
          logoUrl: form.logoUrl.trim() || null,
          description: form.description.trim() || null,
        }),
      });
      setOrg({ ...saved, role: org?.role });
      setForm(initialForm(saved));
      setOrgs((prev) => prev.map((o) => (o.id === saved.id ? { ...o, name: saved.name } : o)));
      setNotice(orgSettingsCopy.saved);
    } catch (err) {
      const failure = err as Error & { body?: { error?: string } };
      setError(failure.body?.error || failure.message || "Could not save your organization");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>{`${orgSettingsCopy.title} — ${brand.productName}`}</title>
      </Head>
      <OrganizerShell active="org-settings">
        <ConsoleSubpageHeader
          title={orgSettingsCopy.title}
          backTo={{ href: "/organizer", label: orgSettingsCopy.backLabel }}
        />
        <p className="help-text" style={{ margin: "0 0 20px", maxWidth: 640 }}>
          {orgSettingsCopy.intro}
        </p>

        {orgs.length > 1 ? (
          <section className="console-panel">
            <div className="console-form">
              <label>
                {orgSettingsCopy.pickerLabel}
                <Select
                  value={orgId || ""}
                  onChange={(id) => {
                    setOrgId(id);
                    window.localStorage.setItem("organizerOrgId", id);
                    void load(id).catch((err) =>
                      setError(err instanceof Error ? err.message : "Could not load organization"),
                    );
                  }}
                  options={orgs.map((o) => ({ value: o.id, label: o.name }))}
                />
              </label>
            </div>
          </section>
        ) : null}

        {error ? (
          <p role="alert" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}

        {form ? (
          <form onSubmit={(e) => void save(e)} className="console-form console-panel">
            {canEdit ? null : <p className="help-text">{orgSettingsCopy.readOnly}</p>}

            <label>
              <HoverInfo trigger="label" title="Organization name" body={orgSettingsCopy.fields.name}>
                Organization name
              </HoverInfo>
              <input
                className="input"
                required
                disabled={!canEdit}
                maxLength={ORG_NAME_MAX_CHARS}
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>

            <label>
              Website
              <input
                className="input"
                inputMode="url"
                disabled={!canEdit}
                maxLength={ORG_WEBSITE_URL_MAX_CHARS}
                placeholder="https://your-school.org"
                value={form.websiteUrl}
                onChange={(e) => patch({ websiteUrl: e.target.value })}
              />
              <span className="help-text">{orgSettingsCopy.fields.websiteUrl}</span>
            </label>

            <label>
              Support email
              <input
                className="input"
                type="email"
                disabled={!canEdit}
                maxLength={ORG_SUPPORT_EMAIL_MAX_CHARS}
                placeholder="events@your-school.org"
                value={form.supportEmail}
                onChange={(e) => patch({ supportEmail: e.target.value })}
              />
              <span className="help-text">{orgSettingsCopy.fields.supportEmail}</span>
            </label>

            <label>
              <HoverInfo trigger="label" title="Logo" body={orgSettingsCopy.fields.logo}>
                Logo URL
              </HoverInfo>
              <input
                className="input"
                disabled={!canEdit}
                placeholder="https://… or upload below"
                value={form.logoUrl}
                onChange={(e) => patch({ logoUrl: e.target.value })}
              />
              <span className="help-text">{orgSettingsCopy.fields.logo}</span>
            </label>
            {canEdit ? (
              <UploadDropzone
                variant="compact"
                label="Logo upload"
                accept="image/*"
                maxBytes={BRANDING_IMAGE_RULES.logo.maxBytes}
                onFile={async (file) => {
                  patch({ logoUrl: await fileToDataUrl(file, BRANDING_IMAGE_RULES.logo) });
                }}
              />
            ) : null}
            {form.logoUrl ? (
              <p style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.logoUrl}
                  alt=""
                  style={{
                    width: 56,
                    height: 56,
                    objectFit: "contain",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--gray-200)",
                    background: "#ffffff",
                  }}
                />
              </p>
            ) : null}

            <label>
              Description
              <AutoGrowTextarea
                className="input"
                minRows={3}
                disabled={!canEdit}
                maxLength={ORG_DESCRIPTION_MAX_CHARS}
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
              <span className="help-text">
                {orgSettingsCopy.fields.description} {orgSettingsCopy.descriptionPrivacyNote}
              </span>
            </label>

            {notice ? (
              <p role="status" className="help-text" style={{ color: "var(--success)", margin: 0 }}>
                {notice}
              </p>
            ) : null}

            {canEdit ? (
              <div>
                <button type="submit" className="button" disabled={busy}>
                  {busy ? orgSettingsCopy.saving : orgSettingsCopy.save}
                </button>
              </div>
            ) : null}
          </form>
        ) : null}

        {/* ORG-2 — last on the page and visually quarantined, per the UX-3
            danger-zone pattern the account page set. Owner-only inside. */}
        {org && !org.closedAt ? (
          <OrgDangerZone
            orgId={org.id}
            orgName={org.name}
            role={org.role}
            onOwnershipTransferred={(message) => {
              setNotice(message);
              setError(null);
              // The caller is an admin now, so the whole page's role gate
              // changed — re-read rather than guess at the new shape.
              void load(org.id).catch(() => undefined);
            }}
            onClosed={(message) => {
              // The org is gone from every list that feeds the console, so
              // staying on its settings page would be a lie.
              window.localStorage.removeItem("organizerOrgId");
              void router.push({ pathname: "/organizer", query: { closed: message } });
            }}
          />
        ) : null}
      </OrganizerShell>
    </>
  );
}
