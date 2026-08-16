/**
 * Session-scoped persistence for the create-event wizard (fix plan E4).
 * The wizard page can remount mid-entry (query hydration, auth settling);
 * holding the typed values in sessionStorage means a remount — or a Back/Next
 * hop across steps — never loses input. Per-tab, cleared on create.
 */

export const WIZARD_DRAFT_STORAGE_KEY = "eventWizard.draft.v1";

/** Steps 0–3 collect input; step 4 is the "Draft created" screen and is never persisted. */
const MAX_PERSISTED_STEP = 3;

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
  featureOverrides: Record<string, unknown>;
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
    Object.keys(draft.featureOverrides).length === 0
  );
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
  return JSON.stringify({ ...draft, step: clampStep(draft.step) });
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
    featureOverrides: overrides,
  };
  return isEmptyWizardDraft(draft) ? null : draft;
}
