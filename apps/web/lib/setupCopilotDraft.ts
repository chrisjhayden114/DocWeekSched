/**
 * Session-scoped persistence for the Setup assistant (create-event AI mode).
 * Mirrors wizardDraft: per-tab sessionStorage, versioned key, try/catch-guarded,
 * cleared on successful /complete or a deliberate Start over.
 *
 * Also holds the pure manual ↔ AI field-mapping used when switching modes
 * (the client-side equivalent of POST /ai/setup-copilot/to-manual, which
 * only validates and echoes the form — no API change).
 */

import {
  emptySetupFormState,
  type SetupCopilotFormState,
  type SetupCopilotMessage,
  type SetupCopilotStep,
  type SetupEventType,
} from "@event-app/shared";

export const SETUP_COPILOT_DRAFT_STORAGE_KEY = "setupCopilot.draft.v1";
export const SETUP_COPILOT_DRAFT_VERSION = 1 as const;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SetupCopilotDraft = {
  v: typeof SETUP_COPILOT_DRAFT_VERSION;
  form: SetupCopilotFormState;
  history: SetupCopilotMessage[];
  savedAt: number;
  step?: SetupCopilotStep;
};

export type SetupHandoffWizardFields = {
  name: string;
  timezone: string;
  startDate: string;
  endDate: string;
  venueName: string;
  venueAddress: string;
  onlineUrl: string;
  description: string;
  featureOverrides: SetupCopilotFormState["featureOverrides"];
};

const EVENT_TYPES: readonly SetupEventType[] = ["conference", "academic_program", "meetup", "internal"];
const NETWORKING = ["full", "focused", "custom"] as const;
const STEPS: readonly SetupCopilotStep[] = [
  "name",
  "dates",
  "venue",
  "size",
  "type",
  "networking",
  "document",
  "ready",
  "settings_chat",
];

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function resolveStore(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** True when there is nothing worth restoring — opening greeting alone does not count. */
export function isEmptySetupCopilotDraft(draft: {
  form: SetupCopilotFormState;
  history: SetupCopilotMessage[];
}): boolean {
  const f = draft.form;
  const formEmpty =
    !f.name.trim() &&
    !f.startDate &&
    !f.endDate &&
    !f.venueName.trim() &&
    !f.venueAddress.trim() &&
    !f.onlineUrl.trim() &&
    !f.estimatedSize.trim() &&
    !f.eventType &&
    f.hasProgramDocument === null &&
    !f.networkingChoice &&
    Object.keys(f.featureOverrides).length === 0;
  const noUserTurns = !draft.history.some((m) => m.role === "user");
  return formEmpty && noUserTurns;
}

export function serializeSetupCopilotDraft(
  draft: Omit<SetupCopilotDraft, "v"> & { v?: number },
): string {
  return JSON.stringify({
    v: SETUP_COPILOT_DRAFT_VERSION,
    form: draft.form,
    history: draft.history,
    savedAt: draft.savedAt,
    ...(draft.step ? { step: draft.step } : {}),
  });
}

function parseForm(raw: unknown): SetupCopilotFormState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const base = emptySetupFormState(str(o.timezone) || "UTC");
  const overrides =
    o.featureOverrides && typeof o.featureOverrides === "object" && !Array.isArray(o.featureOverrides)
      ? (o.featureOverrides as SetupCopilotFormState["featureOverrides"])
      : {};
  const eventType = EVENT_TYPES.includes(o.eventType as SetupEventType)
    ? (o.eventType as SetupEventType)
    : "";
  const networkingChoice = NETWORKING.includes(o.networkingChoice as (typeof NETWORKING)[number])
    ? (o.networkingChoice as (typeof NETWORKING)[number])
    : null;
  return {
    ...base,
    name: str(o.name),
    startDate: str(o.startDate),
    endDate: str(o.endDate),
    timezone: str(o.timezone) || base.timezone,
    timezoneExplicit: o.timezoneExplicit === true,
    venueName: str(o.venueName),
    venueAddress: str(o.venueAddress),
    onlineUrl: str(o.onlineUrl),
    estimatedSize: str(o.estimatedSize),
    eventType,
    hasProgramDocument: o.hasProgramDocument === true ? true : o.hasProgramDocument === false ? false : null,
    featureOverrides: overrides,
    suggestedPreset:
      o.suggestedPreset === "everything" || o.suggestedPreset === "academic" || o.suggestedPreset === "focused"
        ? o.suggestedPreset
        : null,
    networkingChoice,
  };
}

function parseHistory(raw: unknown): SetupCopilotMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: SetupCopilotMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const m = item as Record<string, unknown>;
    if (m.role !== "assistant" && m.role !== "user") continue;
    if (typeof m.content !== "string") continue;
    out.push({
      role: m.role,
      content: m.content,
      ...(m.aiGenerated === true ? { aiGenerated: true as const } : {}),
    });
  }
  return out;
}

/**
 * Parse a stored draft. Returns null for garbage, wrong version, or a draft
 * with nothing worth restoring.
 */
export function parseSetupCopilotDraft(raw: string | null): SetupCopilotDraft | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (o.v !== SETUP_COPILOT_DRAFT_VERSION) return null;
  const form = parseForm(o.form);
  if (!form) return null;
  const history = parseHistory(o.history);
  const savedAt = typeof o.savedAt === "number" && Number.isFinite(o.savedAt) ? o.savedAt : 0;
  const step = STEPS.includes(o.step as SetupCopilotStep) ? (o.step as SetupCopilotStep) : undefined;
  const draft: SetupCopilotDraft = { v: SETUP_COPILOT_DRAFT_VERSION, form, history, savedAt, step };
  return isEmptySetupCopilotDraft(draft) ? null : draft;
}

export function saveSetupCopilotDraft(
  draft: Omit<SetupCopilotDraft, "v"> & { v?: number },
  storage?: StorageLike,
): void {
  if (isEmptySetupCopilotDraft(draft)) return;
  const store = resolveStore(storage);
  if (!store) return;
  try {
    store.setItem(SETUP_COPILOT_DRAFT_STORAGE_KEY, serializeSetupCopilotDraft(draft));
  } catch {
    /* storage unavailable — degrade to in-memory state only */
  }
}

export function loadSetupCopilotDraft(storage?: StorageLike): SetupCopilotDraft | null {
  const store = resolveStore(storage);
  if (!store) return null;
  try {
    return parseSetupCopilotDraft(store.getItem(SETUP_COPILOT_DRAFT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearSetupCopilotDraft(storage?: StorageLike): void {
  const store = resolveStore(storage);
  if (!store) return;
  try {
    store.removeItem(SETUP_COPILOT_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** datetime-local needs YYYY-MM-DDTHH:mm — dates-only get a default clock time. */
export function toDatetimeLocal(value: string, dateOnlyTime = "09:00"): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T${dateOnlyTime}`;
  if (value.includes("T")) return value.slice(0, 16);
  return value;
}

/** AI form → manual wizard fields. Nothing typed is dropped. */
export function copilotFormToWizardFields(
  form: SetupCopilotFormState,
  extras?: { description?: string },
): SetupHandoffWizardFields {
  return {
    name: form.name,
    timezone: form.timezone,
    startDate: toDatetimeLocal(form.startDate),
    endDate: toDatetimeLocal(form.endDate, "17:00"),
    venueName: form.venueName,
    venueAddress: form.venueAddress,
    onlineUrl: form.onlineUrl,
    description: extras?.description?.trim() || (form.estimatedSize ? `Estimated size: ~${form.estimatedSize}` : ""),
    featureOverrides: form.featureOverrides,
  };
}

/** Manual wizard → copilot form. Only fills known (non-empty) fields; never clears. */
export function wizardFieldsToCopilotForm(
  fields: Partial<SetupHandoffWizardFields>,
  base: SetupCopilotFormState,
): SetupCopilotFormState {
  const next = { ...base };
  if (fields.name?.trim()) next.name = fields.name.trim();
  if (fields.timezone?.trim()) {
    next.timezone = fields.timezone.trim();
    if (fields.startDate || fields.endDate) next.timezoneExplicit = true;
  }
  if (fields.startDate) next.startDate = fields.startDate;
  if (fields.endDate) next.endDate = fields.endDate;
  if (fields.venueName?.trim()) next.venueName = fields.venueName.trim();
  if (fields.venueAddress?.trim()) next.venueAddress = fields.venueAddress.trim();
  if (fields.onlineUrl?.trim()) next.onlineUrl = fields.onlineUrl.trim();
  if (fields.featureOverrides && Object.keys(fields.featureOverrides).length > 0) {
    next.featureOverrides = { ...next.featureOverrides, ...fields.featureOverrides };
  }
  return next;
}

export function hasKnownHandoffFields(
  form: Pick<
    SetupCopilotFormState,
    "name" | "startDate" | "endDate" | "venueName" | "venueAddress" | "onlineUrl"
  >,
  extras?: { description?: string },
): boolean {
  return Boolean(
    form.name.trim() ||
      form.startDate ||
      form.endDate ||
      form.venueName.trim() ||
      form.venueAddress.trim() ||
      form.onlineUrl.trim() ||
      extras?.description?.trim(),
  );
}

/** First still-needed create-mode step, mirroring the server stepFromForm. */
export function copilotStepFromForm(form: SetupCopilotFormState): SetupCopilotStep {
  if (!form.name.trim()) return "name";
  if (!form.startDate || !form.endDate) return "dates";
  if (!form.venueName.trim() && !form.onlineUrl.trim()) return "venue";
  if (!form.estimatedSize.trim()) return "size";
  if (!form.eventType) return "type";
  if (!form.networkingChoice) return "networking";
  if (form.hasProgramDocument === null) return "document";
  return "ready";
}

function formatHandoffDates(startDate: string, endDate: string): string {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  if (start && end) return start === end ? start : `${start}–${end}`;
  return start || end;
}

/**
 * Opening line when the assistant is seeded from a wizard draft (no model turn).
 * "I have <name>, <dates>… still needed: …"
 */
export function seededOpeningMessage(
  form: SetupCopilotFormState,
  extras?: { description?: string },
): string {
  const known: string[] = [];
  if (form.name.trim()) known.push(form.name.trim());
  const dates = formatHandoffDates(form.startDate, form.endDate);
  if (dates) known.push(dates);
  if (form.timezone && (form.timezoneExplicit || form.startDate || form.endDate)) {
    known.push(form.timezone);
  }
  const place = [form.venueName.trim(), form.onlineUrl.trim()].filter(Boolean).join(" / ");
  if (place) known.push(place);
  if (extras?.description?.trim()) known.push(extras.description.trim());

  const needed: string[] = [];
  if (!form.name.trim()) needed.push("name");
  if (!form.startDate || !form.endDate) needed.push("dates");
  if (!form.venueName.trim() && !form.onlineUrl.trim()) needed.push("place");
  if (!form.estimatedSize.trim()) needed.push("size");
  if (!form.eventType) needed.push("type");
  if (!form.networkingChoice) needed.push("networking");
  if (form.hasProgramDocument === null) needed.push("program document");

  const have = known.length > 0 ? known.join(", ") : "what you already entered";
  const still = needed.length > 0 ? needed.join(", ") : "nothing — we can create the draft when you're ready";
  return `I have ${have}… still needed: ${still}.`;
}
