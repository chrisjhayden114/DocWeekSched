/**
 * W-4 (SETUP-CONFLICT) — the pre-merge diff.
 *
 * Root cause (J-A #3): mergeSetupExtract applied any validated extract over
 * any field the organizer had already confirmed, silently, on both the chat
 * and the document-upload path. Here every extract is diffed against the
 * CONFIRMED fields first: non-conflicting values merge as before, conflicting
 * ones are withheld and handed back as a card the organizer resolves per
 * field. Nothing in this module is model-improvised — the question, the rows,
 * and the resolution are all deterministic.
 */

import {
  SETUP_CONFIRMABLE_FIELDS,
  SETUP_FIELD_LABEL,
  confirmedSetupFields,
  formatSetupFieldValue,
  withConfirmedSetupFields,
  type SetupConfirmableField,
  type SetupConflictCard,
  type SetupConflictChoices,
  type SetupConflictEntry,
  type SetupConflictPatch,
  type SetupCopilotFormState,
  type SetupEventType,
  type SetupFieldChange,
} from "@event-app/shared";
import {
  applyEventTypeToForm,
  applyNetworkingChoiceToForm,
  datePart,
  mergeSetupExtract,
  omitExtractFields,
  statedExtractFields,
  type SetupExtract,
  type ValidateExtractContext,
} from "./extractTypes";

/** Chat = the organizer's own words; document = a file's proposal. */
export type SetupConflictSource = "chat" | "document";

const SOURCE_PHRASE: Record<SetupConflictSource, string> = {
  chat: "what you just said",
  document: "the file you uploaded",
};

type FieldValue = SetupConflictPatch[SetupConfirmableField];

function fieldValue(form: SetupCopilotFormState, field: SetupConfirmableField): FieldValue {
  return form[field] as FieldValue;
}

/** Loose text compare: whitespace and letter case alone are not a conflict. */
function looseText(v: FieldValue): string {
  return String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * True when a proposed value says the same thing as the current one.
 * Dates compare by day when either side carries no clock time, so an extract
 * repeating a known day is not a conflict — and cannot quietly drop the hours
 * the organizer already gave (see the withheld-unchanged pass below).
 */
function sameFieldValue(field: SetupConfirmableField, current: FieldValue, proposed: FieldValue): boolean {
  if (field === "startDate" || field === "endDate") {
    const a = String(current ?? "");
    const b = String(proposed ?? "");
    if (!a.includes("T") || !b.includes("T")) return datePart(a) === datePart(b);
    return a.trim() === b.trim();
  }
  if (field === "name" || field === "venueName") return looseText(current) === looseText(proposed);
  if (field === "hasProgramDocument") return current === proposed;
  return String(current ?? "").trim() === String(proposed ?? "").trim();
}

/** A confirmed field with nothing in it has nothing to protect. */
function hasFieldValue(form: SetupCopilotFormState, field: SetupConfirmableField): boolean {
  const value = fieldValue(form, field);
  if (field === "hasProgramDocument") return value !== null && value !== undefined;
  return String(value ?? "").trim().length > 0;
}

export type ExtractConflictDiff = {
  /** Null when nothing conflicts — the caller merges as before. */
  card: SetupConflictCard | null;
  /** The extract with conflicting (and no-op) fields removed. */
  mergeable: SetupExtract;
  conflictedFields: SetupConfirmableField[];
};

/**
 * Diff a validated extract against the fields the organizer confirmed.
 * `form` must be the pre-merge form; `extract` must already be validated
 * (validateExtracted), since the proposal is what a merge would produce.
 */
export function diffExtractAgainstConfirmed(params: {
  form: SetupCopilotFormState;
  extract: SetupExtract;
  context?: ValidateExtractContext;
  source: SetupConflictSource;
}): ExtractConflictDiff {
  const { form, extract, source } = params;
  const context = params.context ?? {};
  const confirmed = confirmedSetupFields(form);
  const stated = statedExtractFields(extract);
  const candidates = stated.filter((f) => confirmed.includes(f) && hasFieldValue(form, f));
  if (candidates.length === 0) {
    return { card: null, mergeable: extract, conflictedFields: [] };
  }

  // What the merge would write, side effects and day-window included.
  const proposedForm = mergeSetupExtract(form, extract, context);

  const entries: SetupConflictEntry[] = [];
  const proposedFields: SetupConflictPatch = {};
  const conflictedFields: SetupConfirmableField[] = [];
  /** Says the same thing but isn't byte-identical (a date without its hours). */
  const noOpFields: SetupConfirmableField[] = [];

  for (const field of SETUP_CONFIRMABLE_FIELDS) {
    if (!candidates.includes(field)) continue;
    const current = fieldValue(form, field);
    const proposed = fieldValue(proposedForm, field);
    if (sameFieldValue(field, current, proposed)) {
      if (String(current ?? "") !== String(proposed ?? "")) noOpFields.push(field);
      continue;
    }
    conflictedFields.push(field);
    entries.push({
      field,
      label: SETUP_FIELD_LABEL[field],
      current: formatSetupFieldValue(field, current),
      proposed: formatSetupFieldValue(field, proposed),
      source,
    });
    Object.assign(proposedFields, { [field]: proposed });
  }

  const mergeable = omitExtractFields(extract, [...conflictedFields, ...noOpFields]);
  if (entries.length === 0) {
    return { card: null, mergeable, conflictedFields: [] };
  }

  return {
    card: {
      title: "These answers don't match",
      summary: `${entries.length} ${entries.length === 1 ? "answer you already gave disagrees" : "answers you already gave disagree"} with ${SOURCE_PHRASE[source]}. Nothing has changed — choose per field and I'll apply only what you pick.`,
      entries,
      proposedFields,
      aiGenerated: true,
    },
    mergeable,
    conflictedFields,
  };
}

/**
 * The assistant's conflict question. Deterministic on purpose: the model must
 * not improvise a claim about what was or was not updated.
 */
export function conflictQuestion(card: SetupConflictCard): string {
  const list = card.entries
    .map((e) => `${e.label.toLowerCase()} (${e.current} → ${e.proposed})`)
    .join("; ");
  const subject = card.entries.length === 1 ? "one answer" : `${card.entries.length} answers`;
  return `That gives me ${subject} different from what you already told me: ${list}. I have not changed ${card.entries.length === 1 ? "it" : "them"}. In the card above, pick Keep mine or Use new for each and I'll apply only what you choose.`;
}

export type ConflictResolution = {
  form: SetupCopilotFormState;
  /** Only the fields the organizer chose to change — for the aside highlight. */
  changes: SetupFieldChange[];
};

/**
 * Apply the organizer's per-field choices. A field with no choice is kept as
 * it is: silence never overwrites. Chosen values carry the same side effects a
 * merge would (event-type and networking presets, timezone made explicit) and
 * become confirmed, since the organizer picked them.
 */
export function applySetupConflictChoices(params: {
  form: SetupCopilotFormState;
  card: SetupConflictCard;
  choices: SetupConflictChoices;
}): ConflictResolution {
  const { card, choices } = params;
  let form = params.form;
  const changes: SetupFieldChange[] = [];

  for (const entry of card.entries) {
    if ((choices[entry.field] ?? "keep") !== "use_new") continue;
    const value = card.proposedFields[entry.field];
    if (value === undefined) continue;

    switch (entry.field) {
      case "timezone":
        form = { ...form, timezone: String(value), timezoneExplicit: true };
        break;
      case "eventType":
        form = value ? applyEventTypeToForm(form, value as SetupEventType) : form;
        break;
      case "networkingChoice":
        form = value
          ? applyNetworkingChoiceToForm(form, value as "full" | "focused" | "custom")
          : form;
        break;
      case "hasProgramDocument":
        form = { ...form, hasProgramDocument: value === true };
        break;
      case "name":
        form = { ...form, name: String(value) };
        break;
      case "startDate":
        form = { ...form, startDate: String(value) };
        break;
      case "endDate":
        form = { ...form, endDate: String(value) };
        break;
      case "venueName":
        form = { ...form, venueName: String(value) };
        break;
      case "onlineUrl":
        form = { ...form, onlineUrl: String(value) };
        break;
      case "estimatedSize":
        form = { ...form, estimatedSize: String(value) };
        break;
    }

    form = withConfirmedSetupFields(form, [entry.field]);
    changes.push({ field: entry.field, label: entry.label, from: entry.current, to: entry.proposed });
  }

  return { form, changes };
}
