import { describe, expect, it } from "vitest";
import {
  conversationPreview,
  conversationSecondaryLine,
  conversationTimestamp,
  conversationTitle,
  dayDividerLabel,
  draftStorageKey,
  filterConversations,
  groupMessagesForThread,
  initialsFor,
  isAwaitingReply,
  isIncomingRequest,
  isMessagingConversation,
  mergeServerMessages,
  roleLabel,
  sortConversationsByActivity,
  unreadConversationIdSet,
  type ConversationView,
  type MessageView,
} from "../lib/messagesView";

const ME = "user-me";

function direct(overrides: Partial<ConversationView> = {}): ConversationView {
  return {
    id: "c1",
    type: "DIRECT",
    createdAt: "2026-08-01T10:00:00.000Z",
    members: [
      { user: { id: ME, name: "Chris Hayden", role: "ATTENDEE" } },
      {
        user: {
          id: "user-aisha",
          name: "Aisha Rahman",
          role: "SPEAKER",
          affiliation: "University of Leeds",
        },
      },
    ],
    messages: [],
    ...overrides,
  };
}

function msg(overrides: Partial<MessageView> & { id: string; createdAt: string }): MessageView {
  return {
    body: "hello",
    user: { id: "user-aisha", name: "Aisha Rahman" },
    ...overrides,
  };
}

describe("conversation surface membership (E18.1)", () => {
  it("keeps only direct and group conversations — event chat is gone", () => {
    expect(isMessagingConversation({ type: "DIRECT" })).toBe(true);
    expect(isMessagingConversation({ type: "GROUP" })).toBe(true);
    expect(isMessagingConversation({ type: "EVENT" })).toBe(false);
    expect(isMessagingConversation({ type: "SESSION" })).toBe(false);
  });
});

describe("conversation rows (E18.2)", () => {
  it("titles a direct conversation with the other person's name", () => {
    expect(conversationTitle(direct(), ME)).toBe("Aisha Rahman");
  });

  it("titles an unnamed group with the other members' names", () => {
    const group = direct({
      type: "GROUP",
      name: null,
      members: [
        { user: { id: ME, name: "Chris Hayden", role: "ATTENDEE" } },
        { user: { id: "u2", name: "Tom Field", role: "ATTENDEE" } },
        { user: { id: "u3", name: "J. Okafor", role: "ATTENDEE" } },
      ],
    });
    expect(conversationTitle(group, ME)).toBe("Tom Field, J. Okafor");
  });

  it("builds the Affiliation · Role secondary line", () => {
    expect(conversationSecondaryLine(direct(), ME)).toBe("University of Leeds · Speaker");
  });

  it("only chips Speaker and Organizer roles", () => {
    expect(roleLabel("SPEAKER")).toBe("Speaker");
    expect(roleLabel("ADMIN")).toBe("Organizer");
    expect(roleLabel("ATTENDEE")).toBeNull();
  });

  it("omits the secondary line when there is nothing to say", () => {
    const c = direct({
      members: [
        { user: { id: ME, name: "Chris Hayden", role: "ATTENDEE" } },
        { user: { id: "u2", name: "Plain Person", role: "ATTENDEE", affiliation: null } },
      ],
    });
    expect(conversationSecondaryLine(c, ME)).toBeNull();
  });

  it("shows participant count for groups", () => {
    const group = direct({
      type: "GROUP",
      members: [
        { user: { id: ME, name: "Chris", role: "ATTENDEE" } },
        { user: { id: "u2", name: "Tom", role: "ATTENDEE" } },
        { user: { id: "u3", name: "Jo", role: "ATTENDEE" } },
      ],
    });
    expect(conversationSecondaryLine(group, ME)).toBe("3 people");
  });

  it("prefixes the preview with You: when the last message is mine", () => {
    const mine = direct({
      messages: [{ id: "m1", body: "See you\nthere", createdAt: "2026-08-04T10:00:00.000Z", user: { id: ME, name: "Chris" } }],
    });
    expect(conversationPreview(mine, ME)).toBe("You: See you there");
    const theirs = direct({
      messages: [{ id: "m1", body: "Happy to send the pre-print", createdAt: "2026-08-04T10:00:00.000Z", user: { id: "user-aisha", name: "Aisha" } }],
    });
    expect(conversationPreview(theirs, ME)).toBe("Happy to send the pre-print");
  });

  it("derives initials with a single-word fallback", () => {
    expect(initialsFor("Aisha Rahman")).toBe("AR");
    expect(initialsFor("Aisha Binte Rahman")).toBe("AR");
    expect(initialsFor("Cher")).toBe("C");
    expect(initialsFor("  ")).toBe("?");
  });
});

describe("list timestamps", () => {
  const now = new Date(2026, 7, 4, 12, 0); // Tue Aug 4 2026, local time

  it("shows the time for today", () => {
    expect(conversationTimestamp(new Date(2026, 7, 4, 11, 4).toISOString(), now)).toBe("11:04 AM");
  });

  it("shows the weekday within the last week", () => {
    expect(conversationTimestamp(new Date(2026, 7, 3, 9, 0).toISOString(), now)).toBe("Mon");
  });

  it("shows the date beyond a week, adding the year when it differs", () => {
    expect(conversationTimestamp(new Date(2026, 6, 15, 9, 0).toISOString(), now)).toBe("Jul 15");
    expect(conversationTimestamp(new Date(2025, 8, 3, 9, 0).toISOString(), now)).toBe("Sep 3, 2025");
  });
});

describe("thread grouping (E18.3)", () => {
  const now = new Date(2026, 7, 4, 12, 0);

  it("labels day dividers Today / Yesterday / full date", () => {
    expect(dayDividerLabel(new Date(2026, 7, 4, 9, 0).toISOString(), now)).toBe("Today");
    expect(dayDividerLabel(new Date(2026, 7, 3, 9, 0).toISOString(), now)).toBe("Yesterday");
    expect(dayDividerLabel(new Date(2026, 6, 15, 9, 0).toISOString(), now)).toBe("Wednesday, July 15");
    expect(dayDividerLabel(new Date(2025, 6, 15, 9, 0).toISOString(), now)).toBe("Tuesday, July 15, 2025");
  });

  it("collapses consecutive same-sender messages within five minutes", () => {
    const t = (m: number) => new Date(2026, 7, 4, 9, m).toISOString();
    const days = groupMessagesForThread(
      [
        msg({ id: "m1", createdAt: t(0) }),
        msg({ id: "m2", createdAt: t(3) }),
        msg({ id: "m3", createdAt: t(10) }), // > 5 min after m2 → new group
        msg({ id: "m4", createdAt: t(11), user: { id: ME, name: "Chris" } }),
      ],
      ME,
      now,
    );
    expect(days).toHaveLength(1);
    expect(days[0]!.groups).toHaveLength(3);
    expect(days[0]!.groups[0]!.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(days[0]!.groups[1]!.messages.map((m) => m.id)).toEqual(["m3"]);
    expect(days[0]!.groups[2]!.isSelf).toBe(true);
  });

  it("starts a new day group across midnight", () => {
    const days = groupMessagesForThread(
      [
        msg({ id: "m1", createdAt: new Date(2026, 7, 3, 23, 50).toISOString() }),
        msg({ id: "m2", createdAt: new Date(2026, 7, 4, 0, 5).toISOString() }),
      ],
      ME,
      now,
    );
    expect(days).toHaveLength(2);
    expect(days[0]!.label).toBe("Yesterday");
    expect(days[1]!.label).toBe("Today");
  });
});

describe("unread is counted by conversation, never by message", () => {
  it("collapses many message notifications into one conversation", () => {
    const set = unreadConversationIdSet([
      { kind: "MESSAGE", readAt: null, conversationId: "c1" },
      { kind: "MESSAGE", readAt: null, conversationId: "c1" },
      { kind: "MESSAGE", readAt: null, conversationId: "c1" },
      { kind: "MESSAGE", readAt: null, conversationId: "c2" },
      { kind: "MESSAGE", readAt: "2026-08-04T10:00:00.000Z", conversationId: "c3" },
      { kind: "ANNOUNCEMENT", readAt: null, conversationId: null },
    ]);
    expect(set.size).toBe(2);
    expect(set.has("c1")).toBe(true);
    expect(set.has("c2")).toBe(true);
    expect(set.has("c3")).toBe(false);
  });
});

describe("list ordering and search", () => {
  it("sorts by last activity, falling back to creation time", () => {
    const quiet = direct({ id: "quiet", createdAt: "2026-08-02T10:00:00.000Z", messages: [] });
    const busy = direct({
      id: "busy",
      createdAt: "2026-08-01T10:00:00.000Z",
      messages: [{ id: "m", body: "hi", createdAt: "2026-08-04T10:00:00.000Z", user: { id: "x", name: "X" } }],
    });
    expect(sortConversationsByActivity([quiet, busy]).map((c) => c.id)).toEqual(["busy", "quiet"]);
  });

  it("matches names, affiliations, and last-message text", () => {
    const c = direct({
      messages: [{ id: "m", body: "pre-print attached", createdAt: "2026-08-04T10:00:00.000Z", user: { id: "user-aisha", name: "Aisha" } }],
    });
    expect(filterConversations([c], "rahman", ME)).toHaveLength(1);
    expect(filterConversations([c], "leeds", ME)).toHaveLength(1);
    expect(filterConversations([c], "pre-print", ME)).toHaveLength(1);
    expect(filterConversations([c], "zebra", ME)).toHaveLength(0);
    expect(filterConversations([c], "  ", ME)).toHaveLength(1);
  });
});

describe("message request gate helpers (M4b)", () => {
  const theirMessage = {
    id: "m1",
    body: "hi there",
    createdAt: "2026-08-04T10:00:00.000Z",
    user: { id: "user-aisha", name: "Aisha Rahman" },
  };
  const myMessage = {
    id: "m2",
    body: "hello!",
    createdAt: "2026-08-04T10:01:00.000Z",
    user: { id: ME, name: "Chris Hayden" },
  };

  it("flags an incoming request only when REQUESTED and initiated by someone else", () => {
    expect(isIncomingRequest(direct({ status: "REQUESTED", initiatedByMe: false }))).toBe(true);
    expect(isIncomingRequest(direct({ status: "REQUESTED", initiatedByMe: true }))).toBe(false);
    expect(isIncomingRequest(direct({ status: "ACTIVE", initiatedByMe: false }))).toBe(false);
    expect(isIncomingRequest(direct({}))).toBe(false);
  });

  it("awaits a reply only when I initiated and the last message is mine", () => {
    expect(
      isAwaitingReply(direct({ status: "REQUESTED", initiatedByMe: true, messages: [myMessage] }), ME),
    ).toBe(true);
  });

  it("does not await a reply before I have sent anything", () => {
    expect(
      isAwaitingReply(direct({ status: "REQUESTED", initiatedByMe: true, messages: [] }), ME),
    ).toBe(false);
  });

  it("does not await a reply once they have responded", () => {
    expect(
      isAwaitingReply(direct({ status: "REQUESTED", initiatedByMe: true, messages: [theirMessage] }), ME),
    ).toBe(false);
  });

  it("does not await a reply for incoming requests or ACTIVE conversations", () => {
    expect(
      isAwaitingReply(direct({ status: "REQUESTED", initiatedByMe: false, messages: [myMessage] }), ME),
    ).toBe(false);
    expect(
      isAwaitingReply(direct({ status: "ACTIVE", initiatedByMe: true, messages: [myMessage] }), ME),
    ).toBe(false);
    expect(isAwaitingReply(direct({ messages: [myMessage] }), ME)).toBe(false);
  });
});

describe("optimistic send bookkeeping (E18.4)", () => {
  it("keys drafts per conversation", () => {
    expect(draftStorageKey("c1")).toBe("messageDraft:c1");
    expect(draftStorageKey("c1")).not.toBe(draftStorageKey("c2"));
  });

  it("keeps failed and still-pending rows when merging a server page", () => {
    const failed = msg({
      id: "local-1",
      clientId: "local-1",
      createdAt: "2026-08-04T10:00:00.000Z",
      body: "never made it",
      user: { id: ME, name: "Chris" },
      localStatus: "failed",
    });
    const pending = msg({
      id: "local-2",
      clientId: "local-2",
      createdAt: "2026-08-04T10:01:00.000Z",
      body: "on the way",
      user: { id: ME, name: "Chris" },
      localStatus: "sending",
    });
    const server = [msg({ id: "s1", createdAt: "2026-08-04T09:00:00.000Z", body: "hello" })];
    const merged = mergeServerMessages([failed, pending], server);
    expect(merged.map((m) => m.id)).toEqual(["s1", "local-1", "local-2"]);
  });

  it("drops a pending row once the server page contains it", () => {
    const pending = msg({
      id: "local-2",
      clientId: "local-2",
      createdAt: "2026-08-04T10:01:00.000Z",
      body: "on the way",
      user: { id: ME, name: "Chris" },
      localStatus: "sending",
    });
    const server = [
      msg({ id: "s1", createdAt: "2026-08-04T09:00:00.000Z", body: "hello" }),
      msg({ id: "s2", createdAt: "2026-08-04T10:01:02.000Z", body: "on the way", user: { id: ME, name: "Chris" } }),
    ];
    const merged = mergeServerMessages([pending], server);
    expect(merged.map((m) => m.id)).toEqual(["s1", "s2"]);
  });
});
