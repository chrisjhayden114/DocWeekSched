/**
 * Session-scoped persistence for the create-event wizard (fix plan E4).
 * The wizard page can remount mid-entry (query hydration, auth settling);
 * holding the typed values in sessionStorage means a remount — or a Back/Next
 * hop across steps — never loses input. Per-tab, cleared on create.
 */

export const WIZARD_DRAFT_STORAGE_KEY = "eventWizard.draft.v1";

/** Steps 0–3 collect input; step 4 is the "Draft created" screen and is never persisted. */
const MAX_PERSISTED_STEP = 3;

/**
 * W-5 — snapshot of AI-mapped wizard fields at the last "Switch to manual"
 * handoff. A later restore treats a field as organizer-edited only when it
 * differs from this snapshot, so a leftover draft cannot clobber the AI form
 * and an untouched field cannot lose the draft.
 */
export type WizardAiHandoff = {
  name: string;
  timezone: string;
  startDate: string;
  endDate: string;
  venueName: string;
  venueAddress: string;
  onlineUrl: string;
  description: string;
  featureOverrides: Record<string, unknown>;
};

export type WizardDraft = {
  step: number;
  organizationId: string;
  name: string;
  slug: string;
  slugTouched: boolean;
  description: string;
  timezone: string;
  startDate: string;
  endDate: string;
  venueName: string;
  venueAddress: string;
  onlineUrl: string;
  brandColor: string;
  logoUrl: string;
  bannerUrl: string;
  featureOverrides: Record<string, unknown>;
  aiHandoff?: WizardAiHandoff;
};

/** True when the user hasn't typed anything worth restoring. */
export function isEmptyWizardDraft(draft: WizardDraft): boolean {
  return (
    !draft.name.trim() &&
    !(draft.slugTouched && draft.slug.trim()) &&
    !draft.description.trim() &&
    !draft.startDate &&
    !draft.endDate &&
    !draft.venueName.trim() &&
    !draft.venueAddress.trim() &&
    !draft.onlineUrl.trim() &&
    !draft.brandColor.trim() &&
    !persistableImage(draft.logoUrl) &&
    !persistableImage(draft.bannerUrl) &&
    Object.keys(draft.featureOverrides).length === 0
  );
}

/**
 * BRAND-2: an uploaded logo or banner is a data URL of up to a few megabytes.
 * Writing one here risks a sessionStorage quota error, which would throw away
 * the ENTIRE draft — name, dates, everything typed. Typed links are tiny and
 * always persist; an upload lives in component state for as long as the wizard
 * stays mounted, and a remount shows an honestly empty field.
 */
function persistableImage(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("data:") ? "" : trimmed;
}

export function clearWizardDraft(): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function serializeWizardDraft(draft: WizardDraft): string {
  return JSON.stringify({
    ...draft,
    step: clampStep(draft.step),
    logoUrl: persistableImage(draft.logoUrl),
    bannerUrl: persistableImage(draft.bannerUrl),
  });
}

function clampStep(step: number): number {
  if (!Number.isInteger(step) || step < 0) return 0;
  return Math.min(step, MAX_PERSISTED_STEP);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Parse a stored draft. Returns null for garbage, wrong shape, or a draft
 * with nothing worth restoring — callers can restore unconditionally on a
 * non-null result.
 */
export function parseWizardDraft(raw: string | null): WizardDraft | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const overrides =
    o.featureOverrides && typeof o.featureOverrides === "object" && !Array.isArray(o.featureOverrides)
      ? (o.featureOverrides as Record<string, unknown>)
      : {};
  const aiHandoff = parseAiHandoff(o.aiHandoff);
  const draft: WizardDraft = {
    step: clampStep(typeof o.step === "number" ? o.step : 0),
    organizationId: str(o.organizationId),
    name: str(o.name),
    slug: str(o.slug),
    slugTouched: o.slugTouched === true,
    description: str(o.description),
    timezone: str(o.timezone),
    startDate: str(o.startDate),
    endDate: str(o.endDate),
    venueName: str(o.venueName),
    venueAddress: str(o.venueAddress),
    onlineUrl: str(o.onlineUrl),
    brandColor: str(o.brandColor),
    logoUrl: persistableImage(str(o.logoUrl)),
    bannerUrl: persistableImage(str(o.bannerUrl)),
    featureOverrides: overrides,
    ...(aiHandoff ? { aiHandoff } : {}),
  };
  return isEmptyWizardDraft(draft) ? null : draft;
}

function parseAiHandoff(raw: unknown): WizardAiHandoff | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const overrides =
    o.featureOverrides && typeof o.featureOverrides === "object" && !Array.isArray(o.featureOverrides)
      ? (o.featureOverrides as Record<string, unknown>)
      : {};
  return {
    name: str(o.name),
    timezone: str(o.timezone),
    startDate: str(o.startDate),
    endDate: str(o.endDate),
    venueName: str(o.venueName),
    venueAddress: str(o.venueAddress),
    onlineUrl: str(o.onlineUrl),
    description: str(o.description),
    featureOverrides: overrides,
  };
}
