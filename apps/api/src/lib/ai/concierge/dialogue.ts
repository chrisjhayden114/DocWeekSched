/**
 * Deterministic Concierge dialogue (mock provider path).
 *
 * IMPORTANT: Tool proposals are derived ONLY from the attendee’s user message.
 * Session descriptions, FAQ answers, and other corpus text are NEVER scanned
 * for tool instructions (prompt-injection safety).
 */

import type {
  ConciergeHandoffStub,
  ConciergeLink,
  ConciergeMapHint,
  ConciergeToolName,
} from "@event-app/shared";
import { isConciergeMutatingTool } from "@event-app/shared";
import { prisma } from "../../db";
import type { GroundingContext } from "../types";
import { isOutOfCorpusQuery, REFUSAL_MESSAGE } from "../grounding";
import { formatSessionTime } from "./format";
import { runReadOnlyTool, type ToolArgs } from "./tools";

export type DialogueProposal = {
  tool: ConciergeToolName;
  args: ToolArgs;
};

export type DialogueTurnResult = {
  assistantMessage: string;
  /** Read-only tools already executed. */
  readResults: Array<{ tool: ConciergeToolName; summary: string; data?: Record<string, unknown> }>;
  /** Mutating proposals — caller must mint ConciergePendingAction. */
  mutationProposals: DialogueProposal[];
  mapHint: ConciergeMapHint | null;
  handoff: ConciergeHandoffStub | null;
  /** E19.3 — in-app navigation offers built from grounded session ids only. */
  links: ConciergeLink[];
  refused: boolean;
  gatewayUserPrompt: string;
};

function findSessionByTitleHint(grounding: GroundingContext, text: string) {
  const lower = text.toLowerCase();
  const ranked = grounding.sessions
    .map((s) => ({ s, idx: lower.indexOf(s.title.toLowerCase()) }))
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx || b.s.title.length - a.s.title.length);
  return ranked[0]?.s || null;
}

function topicFromBuildRequest(text: string): string {
  const m =
    text.match(/around\s+(.+)$/i) ||
    text.match(/about\s+(.+)$/i) ||
    text.match(/topic[:\s]+(.+)$/i);
  return (m?.[1] || text).replace(/[?.!]+$/, "").trim().slice(0, 80);
}

/**
 * Run one concierge turn from **userText only** (+ grounding for lookups).
 * Never parses grounding.textBlob / session descriptions for tools.
 */
export async function runConciergeDialogue(params: {
  userText: string;
  grounding: GroundingContext;
  userId: string;
  /** Injectable for tests; defaults to the real clock. */
  now?: Date;
}): Promise<DialogueTurnResult> {
  const userText = params.userText.trim();
  const { grounding, userId } = params;
  const now = params.now ?? new Date();
  const gatewayUserPrompt = `Concierge turn for event ${grounding.eventId}: ${userText.slice(0, 500)}`;

  const empty = {
    readResults: [] as DialogueTurnResult["readResults"],
    mutationProposals: [] as DialogueProposal[],
    mapHint: null as ConciergeMapHint | null,
    handoff: null as ConciergeHandoffStub | null,
    links: [] as ConciergeLink[],
    refused: false,
    gatewayUserPrompt,
  };

  if (!userText) {
    return {
      ...empty,
      assistantMessage: "Ask me about the schedule, your agenda, rooms, or the FAQ — or tap a starter chip.",
    };
  }

  // A4 handoff — Matchmaker is live; point attendees to the Meet tab
  if (/who should i meet|people (to|i should) meet|match me/i.test(userText)) {
    return {
      ...empty,
      assistantMessage:
        "Open the Meet tab for interest-based suggestions. Draft intros open your DM composer pre-filled — nothing sends until you press Send.",
      handoff: {
        agent: "A4",
        message: "Matchmaker (A4) — Meet tab",
      },
    };
  }

  if (isOutOfCorpusQuery(userText)) {
    return {
      ...empty,
      assistantMessage: REFUSAL_MESSAGE,
      refused: true,
    };
  }

  const mutationProposals: DialogueProposal[] = [];
  const readResults: DialogueTurnResult["readResults"] = [];
  let mapHint: ConciergeMapHint | null = null;
  const replies: string[] = [];
  const links: ConciergeLink[] = [];
  const linkToSession = (id: string, label: string) => {
    if (!grounding.sessionIds.has(id)) return;
    if (links.some((l) => l.href === `/session/${id}`)) return;
    links.push({ label, href: `/session/${id}` });
  };

  // "When is X?" / "What time is X?" — wayfinding (E19.3)
  if (/\b(when|what time)\b/i.test(userText) && !/\b(morning|afternoon|after lunch)\b/i.test(userText)) {
    const session = findSessionByTitleHint(grounding, userText);
    if (session) {
      const when = formatSessionTime(session.startsAt, session.endsAt, grounding.event.timezone);
      const where = session.roomName ? ` in ${session.roomName}` : "";
      replies.push(`“${session.title}” is ${when}${where}.`);
      linkToSession(session.id, `Open “${session.title}”`);
    }
  }

  // "Who is presenting X?" — wayfinding (E19.3)
  if (/\bwho('s| is)?\s+(presenting|speaking|leading|running|teaching)\b|\bwho presents\b/i.test(userText)) {
    const session = findSessionByTitleHint(grounding, userText);
    if (session) {
      const names = session.speakerNames || [];
      replies.push(
        names.length
          ? `“${session.title}” is presented by ${names.join(", ")}.`
          : `No speakers are listed for “${session.title}” yet.`,
      );
      linkToSession(session.id, `Open “${session.title}”`);
    } else {
      replies.push(
        "Tell me which session you mean (use a few words from its title) and I’ll look up the speakers.",
      );
    }
  }

  // Export ICS
  if (/\b(export|ics|calendar feed|subscribe.*(calendar|agenda))\b/i.test(userText)) {
    mutationProposals.push({ tool: "exportICS", args: {} });
    replies.push("I can create a private calendar feed for your agenda — confirm below.");
  }

  // Remove from agenda
  if (/\b(remove|drop|leave)\b/i.test(userText) && /\b(agenda|schedule|session)\b/i.test(userText)) {
    const session = findSessionByTitleHint(grounding, userText);
    if (session) {
      mutationProposals.push({
        tool: "removeFromMyAgenda",
        args: { sessionId: session.id },
      });
      replies.push(`I can remove “${session.title}” from your agenda — confirm below.`);
    } else {
      replies.push("Tell me which session to remove (use the exact title from the schedule).");
    }
  }

  // Waitlist
  if (/\bwaitlist\b/i.test(userText)) {
    const session = findSessionByTitleHint(grounding, userText);
    if (session) {
      const mode = /\bvirtual\b/i.test(userText) ? "VIRTUAL" : "IN_PERSON";
      mutationProposals.push({
        tool: "joinWaitlist",
        args: { sessionId: session.id, mode },
      });
      replies.push(`I can put you on the waitlist for “${session.title}” — confirm below.`);
    } else {
      replies.push("Which session should I waitlist you for? Include the session title.");
    }
  }

  // Add to agenda
  if (
    /\b(add|join|put me on|sign me up)\b/i.test(userText) &&
    !/\bwaitlist\b/i.test(userText) &&
    !/\b(remove|drop|leave)\b/i.test(userText)
  ) {
    const session = findSessionByTitleHint(grounding, userText);
    if (session) {
      const mode = /\bvirtual\b/i.test(userText)
        ? "VIRTUAL"
        : /\basync\b/i.test(userText)
          ? "ASYNC"
          : "IN_PERSON";
      mutationProposals.push({
        tool: "addToMyAgenda",
        args: { sessionId: session.id, mode },
      });
      replies.push(`I can add “${session.title}” to your agenda — confirm the card below.`);
    }
  }

  // Propose meeting
  if (/\b(propose|request)\b.*\bmeet/i.test(userText) || /\bmeet with\b/i.test(userText)) {
    replies.push(
      "To propose a meeting, open someone’s directory profile and use Request meeting — or tell me their name once Matchmaker (A4) is live.",
    );
  }

  // Map — resolve room by name in the **user message** only
  if (/\b(map|where is|find (the )?room|show on map)\b/i.test(userText)) {
    const rooms = grounding.roomIds.size
      ? await prisma.room.findMany({
          where: { eventId: grounding.eventId },
          select: { id: true, name: true },
        })
      : [];
    const lower = userText.toLowerCase();
    const roomMatch = rooms.find((r) => lower.includes(r.name.toLowerCase())) || null;
    if (roomMatch && grounding.roomIds.has(roomMatch.id)) {
      const result = await runReadOnlyTool({
        tool: "showOnMap",
        args: { roomId: roomMatch.id },
        grounding,
        userId,
      });
      readResults.push({ tool: "showOnMap", summary: result.summary, data: result.data });
      mapHint = {
        roomId: roomMatch.id,
        mapId: (result.data?.mapId as string | null) || null,
        label: (result.data?.label as string) || roomMatch.name,
      };
      replies.push(result.summary);
    } else {
      replies.push("I couldn’t match a room name — try “where is Ballroom A?” or open Maps.");
    }
  }

  // My agenda
  if (/\b(my agenda|my schedule|what am i (going to|doing))\b/i.test(userText)) {
    const result = await runReadOnlyTool({
      tool: "getMyAgenda",
      args: {},
      grounding,
      userId,
    });
    readResults.push({ tool: "getMyAgenda", summary: result.summary, data: result.data });
    replies.push(result.summary);
  }

  // Search / morning / afternoon / topic schedule
  if (
    /\b(what('s| is) on|this morning|tomorrow morning|after lunch|this afternoon|sessions? (about|on)|build me a schedule|around )\b/i.test(
      userText,
    ) ||
    /\b(morning|afternoon)\b/i.test(userText)
  ) {
    const morning = /\bmorning\b/i.test(userText);
    const afternoon = !morning && /\b(afternoon|after lunch)\b/i.test(userText);
    const query = topicFromBuildRequest(userText);
    const q =
      (morning || afternoon) && /what|on this (morning|afternoon)|this (morning|afternoon)|after lunch/i.test(userText)
        ? ""
        : query.length > 2 &&
            !/^(what|this|morning|afternoon|lunch|schedule|build|me|a|around)$/i.test(query)
          ? query
          : "";
    const result = await runReadOnlyTool({
      tool: "searchSessions",
      args: { query: q, morning, afternoon },
      grounding,
      userId,
      now,
    });
    readResults.push({ tool: "searchSessions", summary: result.summary, data: result.data });
    replies.push(result.summary);
    const foundIds = Array.isArray(result.data?.sessionIds)
      ? (result.data!.sessionIds as string[])
      : [];
    for (const id of foundIds.slice(0, 3)) {
      const title = grounding.sessions.find((s) => s.id === id)?.title;
      if (title) linkToSession(id, `Open “${title}”`);
    }
    if (q && foundIds.length) {
      const firstId = foundIds[0];
      if (firstId && /build me a schedule|add|join/i.test(userText)) {
        mutationProposals.push({
          tool: "addToMyAgenda",
          args: { sessionId: firstId, mode: "IN_PERSON" },
        });
        const title = grounding.sessions.find((s) => s.id === firstId)?.title;
        if (title) replies.push(`Want me to add “${title}”? Confirm below.`);
      }
    }
  }

  // FAQ keyword lookup (corpus answer, no tools)
  if (/\b(wifi|parking|badge|registration|faq|where do i)\b/i.test(userText)) {
    const lower = userText.toLowerCase();
    const hit = grounding.faq.find(
      (f) =>
        lower.includes(f.question.toLowerCase().slice(0, 20)) ||
        f.question.toLowerCase().split(/\s+/).some((w) => w.length > 3 && lower.includes(w)) ||
        f.answer.toLowerCase().includes(lower.replace(/[?]/g, "").slice(0, 12)),
    );
    if (hit) {
      replies.push(`${hit.question}\n${hit.answer}`);
    }
  }

  // Deduplicate mutation proposals
  const seen = new Set<string>();
  const uniqueMutations = mutationProposals.filter((p) => {
    const key = `${p.tool}:${JSON.stringify(p.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return isConciergeMutatingTool(p.tool);
  });

  if (!replies.length && !uniqueMutations.length) {
    // Decline-and-redirect, never improvise: this assistant only answers from
    // this event's published schedule, rooms/maps, announcements, and FAQ.
    if (grounding.faq.length) {
      return {
        ...empty,
        assistantMessage: `I can only answer from this event’s schedule, your agenda, maps, and the organizer FAQ — I don’t guess beyond it. Try “What’s on this morning?” or ask: ${grounding.faq[0].question}`,
      };
    }
    return {
      ...empty,
      assistantMessage:
        "I can only answer from this event’s schedule, your agenda, and rooms/maps — I don’t guess beyond it. Try a starter chip, or ask “when is …” with a session title.",
    };
  }

  return {
    assistantMessage: replies.join("\n\n"),
    readResults,
    mutationProposals: uniqueMutations,
    mapHint,
    handoff: null,
    links,
    refused: false,
    gatewayUserPrompt,
  };
}
