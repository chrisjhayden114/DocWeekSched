/**
 * Deterministic FIELD LAYER of the Setup assistant (AGENT-2).
 * Parsers fill form state from every answer; the reply strings here are
 * FALLBACKS only — the route replaces them with model text from the reply
 * layer (turn.ts) unless a turn is marked deterministicReply. The model
 * never writes and its output is never parsed for field values.
 */

import {
  EVENT_TYPE_PRESET,
  applyPreset,
  emptySetupFormState,
  type ConciergeLink,
  type ConfigDiffCard,
  type FeatureKey,
  type SetupCopilotFormState,
  type SetupCopilotMessage,
  type SetupCopilotMode,
  type SetupCopilotStep,
  type SetupHandoffA1,
} from "@event-app/shared";
import { resolveFeatureEnabled } from "../../features/registry";
import { buildConfigDiffCard } from "./diffCard";
import {
  parseDatesAndTimezone,
  parseEventName,
  parseEventType,
  parseFeatureRequests,
  parseNetworkingChoice,
  parseSize,
  parseVenue,
  parseYesNo,
} from "./parse";
import { buildSkeleton, type SkeletonBundle } from "./skeleton";
import {
  hasExtractedFields,
  mergeSetupExtract,
  stepFromForm,
  validateExtracted,
  type SetupExtract,
} from "./extractTypes";

export type DialogueState = {
  step: SetupCopilotStep;
  form: SetupCopilotFormState;
  messages: SetupCopilotMessage[];
};

export type TurnResult = {
  step: SetupCopilotStep;
  form: SetupCopilotFormState;
  messages: SetupCopilotMessage[];
  assistantMessage: string;
  pendingDiff: ConfigDiffCard | null;
  handoff: SetupHandoffA1 | null;
  skeletonPreview: SkeletonBundle | null;
  aiGenerated: true;
  /**
   * True when the reply is load-bearing and the model must NOT replace it —
   * the "ready" gate's confirmation strings are matched by the frontend to
   * trigger /complete, so they stay byte-identical.
   */
  deterministicReply: boolean;
  /**
   * AGENT-3 — in-app navigation offers attached by the reply layer (settings
   * mode, Organizer Guide anchors matched in model text). Deterministic
   * turns carry none.
   */
  links: ConciergeLink[];
};

const OPENING_CREATE =
  "I'll help you set up your event — a few short questions, under two minutes of typing. What's the event called?";

const OPENING_SETTINGS =
  "Ask me anything about running this event — setup steps, what's left before you go live, features, participants, publishing. Feature changes show a review card before anything is applied.";

export function initialDialogue(
  mode: SetupCopilotMode,
  timezone?: string,
  existingForm?: Partial<SetupCopilotFormState>,
): DialogueState {
  const form = { ...emptySetupFormState(timezone || "UTC"), ...existingForm };
  const content = mode === "settings" ? OPENING_SETTINGS : OPENING_CREATE;
  return {
    step: mode === "settings" ? "settings_chat" : "name",
    form,
    messages: [{ role: "assistant", content, aiGenerated: true }],
  };
}

function assistant(text: string): SetupCopilotMessage {
  return { role: "assistant", content: text, aiGenerated: true };
}

/**
 * AGENT-2 sharp-edge fix: "what does networking mean?" typed at step 1 must
 * not become the event name. A message that reads as a question is a question
 * for the model, not a field value.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return t.endsWith("?") || /^(what|how|why|can|do|is|where)\b/i.test(t);
}

function applyTypePreset(form: SetupCopilotFormState): SetupCopilotFormState {
  if (!form.eventType) return form;
  const preset = EVENT_TYPE_PRESET[form.eventType];
  return {
    ...form,
    suggestedPreset: preset,
    featureOverrides: { ...form.featureOverrides, ...applyPreset(preset) },
  };
}

const AGENDA_INGEST_NOTE =
  "After you create the event, upload this same file in Agenda ingest and the AI will draft the full agenda.";

function readyBitsForForm(form: SetupCopilotFormState): {
  handoff: SetupHandoffA1 | null;
  skeletonPreview: SkeletonBundle | null;
} {
  if (form.hasProgramDocument === null) return { handoff: null, skeletonPreview: null };
  if (form.hasProgramDocument) {
    return {
      handoff: {
        kind: "agenda_ingest",
        message:
          "Great — I'll hand you to Agenda Ingest to extract sessions from your document. Your event details are saved; nothing is lost.",
        ingestPath: "/organizer/events/new?mode=ai&handoff=ingest",
      },
      skeletonPreview: null,
    };
  }
  const iceOn = resolveFeatureEnabled("community_icebreakers", form.featureOverrides);
  return { handoff: null, skeletonPreview: buildSkeleton(form, iceOn) };
}

function cannedReplyForStep(
  step: SetupCopilotStep,
  form: SetupCopilotFormState,
  opts: { fromUpload: boolean },
): string {
  const ingestNote =
    opts.fromUpload && form.hasProgramDocument ? `\n\n${AGENDA_INGEST_NOTE}` : "";
  switch (step) {
    case "name":
      return `What should we call the event?${ingestNote}`;
    case "dates":
      return form.name
        ? `Got it — “${form.name}.” When does it run, and what timezone? (Example: 2027-07-20 to 2027-07-22, America/Los_Angeles)${ingestNote}`
        : `When does it run, and what timezone? (Example: 2027-07-20 to 2027-07-22, America/Los_Angeles)${ingestNote}`;
    case "venue":
      return `Where is it — a venue name, online, or hybrid?${ingestNote}`;
    case "size":
      return `Roughly how many people? (A number is fine.)${ingestNote}`;
    case "type":
      return `What kind of event is this?\n1) Conference\n2) Academic program\n3) Meetup\n4) Internal${ingestNote}`;
    case "networking":
      return `Want the full networking experience — community spaces, ice-breakers, photo sharing — or keep it focused on the schedule? You can also say something specific like “no ice-breakers, and everyone's local so don't show timezone conversion.”${ingestNote}`;
    case "document":
      return `Do you already have a program document (PDF, Word, spreadsheet, or photo of the schedule)?${ingestNote}`;
    case "ready": {
      if (form.hasProgramDocument) {
        const base =
          "Great — I'll hand you to Agenda Ingest to extract sessions from your document. Your event details are saved; nothing is lost.";
        return opts.fromUpload ? `${base}\n\n${AGENDA_INGEST_NOTE}` : base;
      }
      const iceOn = resolveFeatureEnabled("community_icebreakers", form.featureOverrides);
      const skeleton = buildSkeleton(form, iceOn);
      return `I'll create a draft event with a skeleton agenda (${skeleton.sessions.length} blocks), suggested tracks, a draft invite email${
        iceOn ? ", and 2 ice-breaker draft posts" : ""
      }. Everything stays labeled as AI-generated until you publish. Ready to create it?`;
    }
    default:
      return "Let's keep going — what's next on your mind?";
  }
}

export function runCreateTurn(
  state: DialogueState,
  userText: string,
  extracted?: SetupExtract | null,
): TurnResult {
  const text = userText.trim();
  let { step, form } = state;
  const messages: SetupCopilotMessage[] = [
    ...state.messages,
    { role: "user", content: text },
  ];
  let pendingDiff: ConfigDiffCard | null = null;
  let handoff: SetupHandoffA1 | null = null;
  let skeletonPreview: SkeletonBundle | null = null;
  let reply = "";
  let deterministicReply = false;

  // Custom feature requests can arrive at networking step (or anytime after type)
  const featureReq = parseFeatureRequests(text);
  const fromUpload = /^Uploaded /i.test(text);

  // Ready-gate first — "create" is a command, never a field extract.
  // Validate before deciding the extract path so garbage-only extracts
  // (invalid timezone, year-as-size, …) fall through to regex parsers.
  const extractContext = {
    userText: text,
    knownStartDate: form.startDate,
    knownEndDate: form.endDate,
  };
  const validated = extracted ? validateExtracted(extracted, extractContext) : extracted;
  if (step !== "ready" && hasExtractedFields(validated)) {
    form = mergeSetupExtract(form, validated!, extractContext);
    const noteReq = extracted?.networkingNote
      ? parseFeatureRequests(extracted.networkingNote)
      : { isCustomRequest: false, patch: {}, requestedKeys: [] as FeatureKey[] };
    const customReq = featureReq.isCustomRequest ? featureReq : noteReq;
    if (customReq.isCustomRequest) {
      pendingDiff = buildConfigDiffCard({
        current: form.featureOverrides,
        patch: customReq.patch,
        requestedKeys: customReq.requestedKeys,
        liveEvent: false,
        summary: "Based on what you asked for — confirm to apply these settings.",
      });
      form = { ...form, networkingChoice: "custom" };
    }
    if (form.hasProgramDocument === null) {
      const yn = parseYesNo(text);
      if (yn !== null) form = { ...form, hasProgramDocument: yn };
    }
    step = stepFromForm(form, step);
    if (step === "ready") {
      const readyBits = readyBitsForForm(form);
      handoff = readyBits.handoff;
      skeletonPreview = readyBits.skeletonPreview;
    }
    reply = cannedReplyForStep(step, form, { fromUpload });
    messages.push(assistant(reply));
    return {
      step,
      form,
      messages,
      assistantMessage: reply,
      pendingDiff,
      handoff,
      skeletonPreview,
      aiGenerated: true,
      deterministicReply: false,
      links: [],
    };
  }

  switch (step) {
    case "name": {
      const name = parseEventName(text);
      // Sharp-edge fix: don't capture the name when the message reads as a
      // question or another parser recognized it (dates, feature requests) —
      // stay on this step and let the model answer + ask again.
      const otherParserMatched =
        parseDatesAndTimezone(text, form.timezone) !== null || featureReq.isCustomRequest;
      if (!name || looksLikeQuestion(text) || otherParserMatched) {
        reply = "What should we call the event?";
        break;
      }
      form = { ...form, name };
      step = "dates";
      reply = `Got it — “${name}.” When does it run, and what timezone? (Example: 2027-07-20 to 2027-07-22, America/Los_Angeles)`;
      break;
    }
    case "dates": {
      const parsed = parseDatesAndTimezone(text, form.timezone);
      if (!parsed) {
        reply =
          "I need dates I can use. Try something like “2027-07-20 to 2027-07-22, America/New_York” or “July 20–22 2027 PT”.";
        break;
      }
      form = {
        ...form,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        timezone: parsed.timezone,
        timezoneExplicit: form.timezoneExplicit || parsed.timezoneExplicit,
      };
      step = "venue";
      reply = "Where is it — a venue name, online, or hybrid?";
      break;
    }
    case "venue": {
      const v = parseVenue(text);
      form = { ...form, ...v };
      step = "size";
      reply = "Roughly how many people? (A number is fine.)";
      break;
    }
    case "size": {
      const size = parseSize(text);
      if (!size) {
        reply = "About how many attendees — for example 80 or 250?";
        break;
      }
      form = { ...form, estimatedSize: size };
      step = "type";
      reply =
        "What kind of event is this?\n1) Conference\n2) Academic program\n3) Meetup\n4) Internal";
      break;
    }
    case "type": {
      const eventType = parseEventType(text);
      if (!eventType) {
        reply = "Pick one: conference, academic program, meetup, or internal.";
        break;
      }
      form = applyTypePreset({ ...form, eventType });
      step = "networking";
      reply =
        "Want the full networking experience — community spaces, ice-breakers, photo sharing — or keep it focused on the schedule? You can also say something specific like “no ice-breakers, and everyone's local so don't show timezone conversion.”";
      break;
    }
    case "networking": {
      if (featureReq.isCustomRequest) {
        pendingDiff = buildConfigDiffCard({
          current: form.featureOverrides,
          patch: featureReq.patch,
          requestedKeys: featureReq.requestedKeys,
          liveEvent: false,
          summary: "Based on what you asked for — confirm to apply these settings.",
        });
        form = {
          ...form,
          networkingChoice: "custom",
          // Do not write overrides until the organizer confirms the diff card.
        };
        step = "document";
        reply =
          "I've drafted a settings change card for you to review (confirm it when you're ready). Do you already have a program document (PDF, Word, spreadsheet, or photo of the schedule)?";
        break;
      }
      const choice = parseNetworkingChoice(text);
      if (!choice) {
        reply =
          "Say “full networking,” “focused on the schedule,” or a specific request like “no ice-breakers.”";
        break;
      }
      if (choice === "full") {
        form = {
          ...form,
          networkingChoice: "full",
          featureOverrides: {
            ...form.featureOverrides,
            ...applyPreset("everything"),
          },
        };
      } else {
        form = {
          ...form,
          networkingChoice: "focused",
          featureOverrides: {
            ...form.featureOverrides,
            ...applyPreset("focused"),
          },
        };
      }
      step = "document";
      reply =
        "Do you already have a program document (PDF, Word, spreadsheet, or photo of the schedule)?";
      break;
    }
    case "document": {
      // Allow confirming a pending diff verbally
      if (/^(confirm|apply|yes,? apply|looks good)\b/i.test(text) && state.form.featureOverrides) {
        // Features already mirrored into form on propose; continue asking document if needed
      }
      const yn = parseYesNo(text);
      if (yn === null) {
        reply = "Do you have a program document? Yes or no is fine.";
        break;
      }
      form = { ...form, hasProgramDocument: yn };
      if (yn) {
        step = "ready";
        handoff = {
          kind: "agenda_ingest",
          message:
            "Great — I'll hand you to Agenda Ingest to extract sessions from your document. Your event details are saved; nothing is lost.",
          ingestPath: "/organizer/events/new?mode=ai&handoff=ingest",
        };
        reply = handoff.message;
      } else {
        step = "ready";
        const iceOn = resolveFeatureEnabled("community_icebreakers", form.featureOverrides);
        skeletonPreview = buildSkeleton(form, iceOn);
        reply = `I'll create a draft event with a skeleton agenda (${skeletonPreview.sessions.length} blocks), suggested tracks, a draft invite email${
          iceOn ? ", and 2 ice-breaker draft posts" : ""
        }. Everything stays labeled as AI-generated until you publish. Ready to create it?`;
      }
      break;
    }
    case "ready": {
      if (/^(y|yes|create|go|ready|do it)\b/i.test(text)) {
        // Deterministic gate: the frontend matches these exact strings to
        // trigger /complete — the model must never replace this reply.
        deterministicReply = true;
        const iceOn = resolveFeatureEnabled("community_icebreakers", form.featureOverrides);
        skeletonPreview = form.hasProgramDocument ? null : buildSkeleton(form, iceOn);
        reply = form.hasProgramDocument
          ? "Opening Agenda Ingest with your details — upload the document there."
          : "Creating your draft event with the skeleton agenda now.";
        if (form.hasProgramDocument) {
          handoff = {
            kind: "agenda_ingest",
            message: reply,
            ingestPath: "/organizer/events/new?mode=ai&handoff=ingest",
          };
        }
      } else if (/^(n|no|wait|not yet)\b/i.test(text)) {
        reply = "No problem — you can switch to manual entry anytime; your answers stay in the form. Say “create” when you're ready.";
      } else {
        reply = "Say “create” to finish, or switch to manual entry to edit the form yourself.";
      }
      break;
    }
    default: {
      reply = "Let's keep going — what's next on your mind?";
    }
  }

  messages.push(assistant(reply));
  return {
    step,
    form,
    messages,
    assistantMessage: reply,
    pendingDiff,
    handoff,
    skeletonPreview,
    aiGenerated: true,
    deterministicReply,
    links: [],
  };
}

export function runSettingsTurn(
  state: DialogueState,
  userText: string,
  liveEvent: boolean,
): TurnResult {
  const text = userText.trim();
  const messages: SetupCopilotMessage[] = [
    ...state.messages,
    { role: "user", content: text },
  ];
  let form = state.form;
  let pendingDiff: ConfigDiffCard | null = null;

  const featureReq = parseFeatureRequests(text);
  const networking = parseNetworkingChoice(text);

  let reply = "";
  if (featureReq.isCustomRequest) {
    pendingDiff = buildConfigDiffCard({
      current: form.featureOverrides,
      patch: featureReq.patch,
      requestedKeys: featureReq.requestedKeys,
      liveEvent,
      summary: liveEvent
        ? "Live event — confirm to apply. Impact notes are listed per setting."
        : "Confirm to apply these settings.",
    });
    form = { ...form, networkingChoice: "custom" };
    reply =
      pendingDiff.entries.length > 0
        ? "Here's a review card of exactly what would change. Confirm in the card when you're ready — nothing applies until then."
        : "I understood the request, but nothing would change from your current settings.";
  } else if (networking === "full") {
    pendingDiff = buildConfigDiffCard({
      current: form.featureOverrides,
      patch: applyPreset("everything"),
      requestedKeys: Object.keys(applyPreset("everything")) as never[],
      presetId: "everything",
      liveEvent,
      summary: "Full networking preset.",
    });
    form = { ...form, networkingChoice: "full" };
    reply = "Proposed the full networking preset — review the card and confirm to apply.";
  } else if (networking === "focused") {
    pendingDiff = buildConfigDiffCard({
      current: form.featureOverrides,
      patch: applyPreset("focused"),
      requestedKeys: Object.keys(applyPreset("focused")) as never[],
      presetId: "focused",
      liveEvent,
      summary: "Focused (schedule-first) preset.",
    });
    form = { ...form, networkingChoice: "focused" };
    reply = "Proposed the focused preset — review the card and confirm to apply.";
  } else {
    // E19.3 → AGENT-3: this canned decline is now only the fallback when the
    // gateway fails or returns nothing — informational turns are answered by
    // the model from the ORGANIZER GUIDE + EVENT STATE blocks (turn.ts) and
    // replace this string. It never improvises without those blocks.
    reply =
      "I can only change this event's attendee features — I can't answer questions outside its setup. Try “turn off ice-breakers and timezone conversion,” “full networking,” or “keep it focused on the schedule.”";
  }

  messages.push(assistant(reply));
  return {
    step: "settings_chat",
    form,
    messages,
    assistantMessage: reply,
    pendingDiff,
    handoff: null,
    skeletonPreview: null,
    aiGenerated: true,
    // Model text may accompany the diff card, never replace it — the card is
    // a separate response field, so the reply itself is safe to swap.
    deterministicReply: false,
    links: [],
  };
}
