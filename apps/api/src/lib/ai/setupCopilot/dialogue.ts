/**
 * Deterministic setup dialogue (mock provider path).
 * One plain question at a time; every answer fills form state.
 */

import {
  EVENT_TYPE_PRESET,
  applyPreset,
  emptySetupFormState,
  type ConfigDiffCard,
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
  parseEventType,
  parseFeatureRequests,
  parseNetworkingChoice,
  parseSize,
  parseVenue,
  parseYesNo,
} from "./parse";
import { buildSkeleton, type SkeletonBundle } from "./skeleton";

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
  /** Prompt text sent through the A0 gateway for metering (mock returns canned). */
  gatewayUserPrompt: string;
};

const OPENING_CREATE =
  "I'll help you set up your event — a few short questions, under two minutes of typing. What's the event called?";

const OPENING_SETTINGS =
  "Tell me what you'd like to change about attendee features. For example: “turn off ice-breakers” or “everyone's local — hide timezone conversion.” I'll show a review card before anything changes.";

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

function applyTypePreset(form: SetupCopilotFormState): SetupCopilotFormState {
  if (!form.eventType) return form;
  const preset = EVENT_TYPE_PRESET[form.eventType];
  return {
    ...form,
    suggestedPreset: preset,
    featureOverrides: { ...form.featureOverrides, ...applyPreset(preset) },
  };
}

export function runCreateTurn(state: DialogueState, userText: string): TurnResult {
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

  // Custom feature requests can arrive at networking step (or anytime after type)
  const featureReq = parseFeatureRequests(text);

  switch (step) {
    case "name": {
      const name = text.slice(0, 200);
      if (!name) {
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
    gatewayUserPrompt: `__MOCK_CHAT__ setup_copilot step=${step} :: ${reply}`,
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
    reply =
      "Try something like “turn off ice-breakers and timezone conversion,” or “full networking,” or “keep it focused on the schedule.”";
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
    gatewayUserPrompt: `__MOCK_CHAT__ setup_copilot_settings :: ${reply}`,
  };
}
