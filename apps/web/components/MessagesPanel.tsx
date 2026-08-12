import { messagesCopy } from "@event-app/config";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DELETED_PARTICIPANT_LABEL } from "@event-app/shared";
import { apiFetch, apiFetchAll } from "../lib/api";
import {
  conversationPreview,
  conversationSecondaryLine,
  conversationTimestamp,
  conversationTitle,
  draftStorageKey,
  filterConversations,
  groupMessagesForThread,
  initialsFor,
  isAwaitingReply,
  isIncomingRequest,
  isMessagingConversation,
  mergeServerMessages,
  messageGroupTime,
  otherMember,
  sortConversationsByActivity,
  type ConversationView,
  type MessageView,
} from "../lib/messagesView";
import { AutolinkText } from "./AutolinkText";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSkeleton } from "./ListState";
import { EmptyState, PageHeader } from "./kit";
import { Portal } from "./kit/Portal";
import { KebabMenu } from "./KebabMenu";
import { SearchableMultiSelect, type SelectablePerson } from "./SearchableMultiSelect";

const REPORT_REASONS = ["Harassment", "Spam", "Impersonation", "Other"] as const;

/**
 * Messages, phase 1 (Chunk E18) — 1:1 and small named-group correspondence.
 * Low-volume, calm by design: polling (visibility-gated), no sockets, no read
 * receipts, no typing indicators. See ux-audit-capture/RESEARCH_MESSAGING.md.
 */

const LIST_POLL_MS = 20_000;
const THREAD_POLL_MS = 8_000;

type PanelUser = { id: string; name: string; role: string };

type Props = {
  token: string;
  user: PanelUser;
  attendees: SelectablePerson[];
  isAdmin: boolean;
  directoryEnabled: boolean;
  groupsEnabled: boolean;
  dmsEnabled: boolean;
  activeEventId: string | null;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  conversations: ConversationView[];
  onConversationsChange: (list: ConversationView[]) => void;
  activeConversationId: string | null;
  onSelectConversation: (id: string | null) => void;
  unreadConversationIds: Set<string>;
  /** Called when a conversation is opened so the parent can clear its unread state. */
  onConversationOpened: (conversationId: string) => void;
  messagePrefill: string | null;
  onPrefillConsumed: () => void;
  onBrowseAttendees: () => void;
  /** Fired after a successful send (parent refreshes engagement points etc.). */
  onMessageSent?: () => void;
  /** Open the attendee directory focused on this user (DIRECT thread menu). */
  onViewProfile?: (userId: string) => void;
};

function tabIsVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/** Small bell / bell-off for per-conversation mute (M2). */
function MuteBellIcon({ off }: { off?: boolean }) {
  if (off) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
        <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
        <path d="M18 8a6 6 0 0 0-9.33-5" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function MessagesPanel({
  token,
  user,
  attendees,
  isAdmin,
  directoryEnabled,
  groupsEnabled,
  dmsEnabled,
  activeEventId,
  withEventHeaders,
  conversations,
  onConversationsChange,
  activeConversationId,
  onSelectConversation,
  unreadConversationIds,
  onConversationOpened,
  messagePrefill,
  onPrefillConsumed,
  onBrowseAttendees,
  onMessageSent,
  onViewProfile,
}: Props) {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newConversationMode, setNewConversationMode] = useState<null | "direct" | "group">(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageBody, setEditingMessageBody] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newIncomingCount, setNewIncomingCount] = useState(0);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [isOffline, setIsOffline] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<(typeof REPORT_REASONS)[number]>("Harassment");
  const [reportDetails, setReportDetails] = useState("");
  const [reportAlsoBlock, setReportAlsoBlock] = useState(true);
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const threadHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const focusThreadOnOpenRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const prevLastMessageIdRef = useRef<string | null>(null);

  const messagingConversations = useMemo(
    () => sortConversationsByActivity(conversations.filter(isMessagingConversation)),
    [conversations],
  );
  const visibleConversations = useMemo(
    () => filterConversations(messagingConversations, searchQuery, user.id),
    [messagingConversations, searchQuery, user.id],
  );
  /* M4b: incoming requests sit in a quiet section below the regular list. */
  const regularConversations = useMemo(
    () => visibleConversations.filter((c) => !isIncomingRequest(c)),
    [visibleConversations],
  );
  const requestConversations = useMemo(
    () => visibleConversations.filter(isIncomingRequest),
    [visibleConversations],
  );
  const activeConversation = useMemo(
    () => messagingConversations.find((c) => c.id === activeConversationId) ?? null,
    [messagingConversations, activeConversationId],
  );

  /* ——— offline awareness ——— */
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOffline(!window.navigator.onLine);
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  /* ——— conversation list: fetch on mount, poll every 20s while visible ——— */
  const refreshConversations = useCallback(async () => {
    try {
      const list = await apiFetch<ConversationView[]>("/conversations", withEventHeaders(), token);
      onConversationsChange(list);
    } catch {
      /* transient — the next poll retries */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeEventId]);

  useEffect(() => {
    void refreshConversations();
    const interval = window.setInterval(() => {
      if (!tabIsVisible()) return;
      void refreshConversations();
    }, LIST_POLL_MS);
    const onVisible = () => {
      if (tabIsVisible()) void refreshConversations();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshConversations]);

  /* ——— auto-select the most recent conversation when none is chosen ———
   * If an id is set but not (yet) in the list, leave it alone — it may be a
   * conversation created a moment ago that the next list refresh will include.
   * Only redirect away from ids that resolve to non-messaging types. */
  useEffect(() => {
    const selected = activeConversationId ? conversations.find((c) => c.id === activeConversationId) : null;
    if (selected && !isMessagingConversation(selected)) {
      onSelectConversation(messagingConversations[0]?.id ?? null);
      return;
    }
    if (!activeConversationId && messagingConversations.length > 0) {
      onSelectConversation(messagingConversations[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, messagingConversations, activeConversationId]);

  /* ——— thread: load on open, poll every 8s while visible ——— */
  const loadThread = useCallback(
    async (opts?: { background?: boolean }) => {
      if (!activeConversationId) return;
      if (!opts?.background) setThreadLoading(true);
      try {
        const rows = await apiFetchAll<MessageView>(
          `/conversations/${activeConversationId}/messages`,
          withEventHeaders(),
          token,
        );
        setMessages((prev) => mergeServerMessages(prev, rows));
      } catch {
        /* transient — the next poll retries */
      } finally {
        if (!opts?.background) setThreadLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeConversationId, token, activeEventId],
  );

  useEffect(() => {
    setMessages([]);
    setEditingMessageId(null);
    setNewIncomingCount(0);
    setThreadError(null);
    stickToBottomRef.current = true;
    prevLastMessageIdRef.current = null;
    if (!activeConversationId) return;
    void loadThread();
    const interval = window.setInterval(() => {
      if (!tabIsVisible()) return;
      void loadThread({ background: true });
    }, THREAD_POLL_MS);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, loadThread]);

  /* Opening a conversation clears its unread state; re-clears if new message
   * notifications arrive while the thread stays open. */
  useEffect(() => {
    if (activeConversationId && unreadConversationIds.has(activeConversationId)) {
      onConversationOpened(activeConversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, unreadConversationIds]);

  /* ——— scroll + announce behaviour ——— */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    const last = messages[messages.length - 1]!;
    const lastId = last.clientId ?? last.id;
    const isNewTail = prevLastMessageIdRef.current !== lastId;
    prevLastMessageIdRef.current = lastId;
    if (!isNewTail) return;

    const fromSomeoneElse = last.user?.id !== user.id && !last.localStatus;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setNewIncomingCount(0);
    } else if (fromSomeoneElse) {
      setNewIncomingCount((n) => n + 1);
    }
    if (fromSomeoneElse) {
      setLiveAnnouncement(`New message from ${last.user?.name ?? DELETED_PARTICIPANT_LABEL}`);
    }
  }, [messages, user.id]);

  const handleThreadScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickToBottomRef.current = atBottom;
    if (atBottom) setNewIncomingCount(0);
  };

  /* ——— focus the thread heading when a conversation is chosen from the list ——— */
  useEffect(() => {
    if (!focusThreadOnOpenRef.current) return;
    focusThreadOnOpenRef.current = false;
    threadHeadingRef.current?.focus();
  }, [activeConversationId]);

  const selectConversation = (id: string) => {
    if (id !== activeConversationId) {
      focusThreadOnOpenRef.current = true;
      onSelectConversation(id);
    }
  };

  /* ——— sending ——— */
  const [composerBody, setComposerBody] = useState("");
  const [composerBlockedNotice, setComposerBlockedNotice] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  /* Draft per conversation (E18.4): restore on open, persist on change. */
  useEffect(() => {
    setComposerBlockedNotice(null);
    setReportOpen(false);
    setReportReason("Harassment");
    setReportDetails("");
    setReportAlsoBlock(true);
    if (!activeConversationId || typeof window === "undefined") {
      setComposerBody("");
      return;
    }
    if (messagePrefill != null && messagePrefill.trim()) {
      setComposerBody(messagePrefill);
      onPrefillConsumed();
      return;
    }
    setComposerBody(window.localStorage.getItem(draftStorageKey(activeConversationId)) ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  /* Sync blocked / awaiting-reply composer notice from list state (M3 + M4b). */
  useEffect(() => {
    if (!activeConversation) return;
    if (activeConversation.blocked) {
      setComposerBlockedNotice("You can't send messages to this person.");
      return;
    }
    if (isAwaitingReply(activeConversation, user.id)) {
      const name = otherMember(activeConversation, user.id)?.name ?? "them";
      setComposerBlockedNotice(
        `Waiting for a reply. You can send another message once ${name} responds.`,
      );
      return;
    }
    setComposerBlockedNotice((prev) => {
      if (
        prev === "You can't send messages to this person." ||
        (typeof prev === "string" && prev.startsWith("Waiting for a reply."))
      ) {
        return null;
      }
      return prev;
    });
  }, [activeConversation, user.id]);

  const updateComposerBody = (value: string) => {
    setComposerBody(value);
    if (!activeConversationId || typeof window === "undefined") return;
    const key = draftStorageKey(activeConversationId);
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  };

  const postMessage = async (conversationId: string, clientId: string, body: string) => {
    try {
      const saved = await apiFetch<MessageView>(
        `/conversations/${conversationId}/messages`,
        withEventHeaders({ method: "POST", body: JSON.stringify({ body }) }),
        token,
      );
      setMessages((prev) => prev.map((m) => (m.clientId === clientId ? saved : m)));
      setThreadError(null);
      setLiveAnnouncement("Message sent");
      onMessageSent?.();
      // Accepting reply: promote REQUESTED → ACTIVE locally; refresh confirms.
      const prior = conversations.find((c) => c.id === conversationId);
      if (prior?.status === "REQUESTED" && !prior.initiatedByMe) {
        onConversationsChange(
          conversations.map((c) => (c.id === conversationId ? { ...c, status: "ACTIVE" } : c)),
        );
      }
      void refreshConversations();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 403) {
        // Opt-in style rejection: drop the optimistic row, quiet the composer.
        setMessages((prev) => prev.filter((m) => m.clientId !== clientId));
        setComposerBlockedNotice(
          err instanceof Error && err.message ? err.message : "You can't send messages to this person.",
        );
        return;
      }
      setMessages((prev) =>
        prev.map((m) => (m.clientId === clientId ? { ...m, localStatus: "failed" as const } : m)),
      );
    }
  };

  const sendCurrentBody = () => {
    if (!activeConversationId) return;
    const trimmed = composerBody.trim();
    if (!trimmed) return;
    const clientId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: MessageView = {
      id: clientId,
      clientId,
      body: trimmed,
      createdAt: new Date().toISOString(),
      user: { id: user.id, name: user.name, role: user.role },
      localStatus: "sending",
    };
    stickToBottomRef.current = true;
    setMessages((prev) => [...prev, optimistic]);
    updateComposerBody("");
    composerRef.current?.focus();
    void postMessage(activeConversationId, clientId, trimmed);
  };

  const retryMessage = (message: MessageView) => {
    if (!activeConversationId || !message.clientId) return;
    setMessages((prev) =>
      prev.map((m) => (m.clientId === message.clientId ? { ...m, localStatus: "sending" as const } : m)),
    );
    void postMessage(activeConversationId, message.clientId, message.body);
  };

  const discardFailedMessage = (message: MessageView) => {
    setMessages((prev) => prev.filter((m) => m.clientId !== message.clientId));
  };

  /* ——— derived thread view ——— */
  const dayGroups = useMemo(() => groupMessagesForThread(messages, user.id), [messages, user.id]);
  const activeTitle = activeConversation ? conversationTitle(activeConversation, user.id) : null;
  const activeSecondary = activeConversation
    ? activeConversation.type === "GROUP"
      ? activeConversation.members.map((m) => m.user.name).join(", ")
      : conversationSecondaryLine(activeConversation, user.id)
    : null;
  const activeOther = activeConversation ? otherMember(activeConversation, user.id) : null;

  const emptyInbox = messagingConversations.length === 0;
  const hasUnread = conversations.some((c) => c.unread);

  const markAllAsRead = useCallback(async () => {
    try {
      await apiFetch("/conversations/read-all", withEventHeaders({ method: "POST" }), token);
    } catch {
      /* ignore — still clear local unread so the UI stays calm */
    }
    onConversationsChange(conversations.map((c) => ({ ...c, unread: false })));
  }, [conversations, onConversationsChange, token, withEventHeaders]);

  const toggleMute = useCallback(
    async (c: ConversationView) => {
      const next = !c.muted;
      try {
        await apiFetch(
          `/conversations/${c.id}/mute`,
          withEventHeaders({ method: "POST", body: JSON.stringify({ muted: next }) }),
          token,
        );
      } catch {
        return;
      }
      onConversationsChange(
        conversations.map((row) =>
          row.id === c.id ? { ...row, muted: next, unread: next ? false : row.unread } : row,
        ),
      );
    },
    [conversations, onConversationsChange, token, withEventHeaders],
  );

  const otherUserId = activeConversation ? otherMember(activeConversation, user.id)?.id : undefined;

  const toggleBlock = useCallback(async () => {
    if (!activeConversation || !otherUserId) return;
    const nextBlocked = !activeConversation.blocked;
    try {
      if (nextBlocked) {
        await apiFetch(
          "/moderation/block",
          withEventHeaders({ method: "POST", body: JSON.stringify({ userId: otherUserId }) }),
          token,
        );
      } else {
        await apiFetch(
          `/moderation/block/${otherUserId}`,
          withEventHeaders({ method: "DELETE" }),
          token,
        );
      }
    } catch {
      return;
    }
    onConversationsChange(
      conversations.map((row) => (row.id === activeConversation.id ? { ...row, blocked: nextBlocked } : row)),
    );
    if (nextBlocked) {
      setComposerBlockedNotice("You can't send messages to this person.");
    } else {
      setComposerBlockedNotice(null);
    }
  }, [activeConversation, conversations, onConversationsChange, otherUserId, token, withEventHeaders]);

  const submitReport = useCallback(async () => {
    if (!otherUserId || !activeConversationId || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      await apiFetch(
        "/moderation/report",
        withEventHeaders({
          method: "POST",
          body: JSON.stringify({
            userId: otherUserId,
            reason: reportReason,
            details: reportDetails.trim() || undefined,
            conversationId: activeConversationId,
          }),
        }),
        token,
      );
      if (reportAlsoBlock) {
        try {
          await apiFetch(
            "/moderation/block",
            withEventHeaders({ method: "POST", body: JSON.stringify({ userId: otherUserId }) }),
            token,
          );
          onConversationsChange(
            conversations.map((row) =>
              row.id === activeConversationId ? { ...row, blocked: true } : row,
            ),
          );
          setComposerBlockedNotice("You can't send messages to this person.");
        } catch {
          /* report already succeeded */
        }
      }
      setReportOpen(false);
      setReportDetails("");
      setReportAlsoBlock(true);
      setThreadError("Reported to organizers.");
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : "Couldn't submit that report.");
    } finally {
      setReportSubmitting(false);
    }
  }, [
    activeConversationId,
    conversations,
    onConversationsChange,
    otherUserId,
    reportAlsoBlock,
    reportDetails,
    reportReason,
    reportSubmitting,
    token,
    withEventHeaders,
  ]);

  return (
    <div className="kit-page-stack">
      {/* F3.3 — light touch only: the kit wayfinding header (the "New
          message" toggle moves up here); phase-1 behavior is unchanged. */}
      <PageHeader
        title={messagesCopy.title}
        action={
          <div className="msg-header-actions">
            {hasUnread ? (
              <button type="button" className="button secondary" onClick={() => void markAllAsRead()}>
                Mark all as read
              </button>
            ) : null}
            <button
              type="button"
              className="button"
              onClick={() => setNewConversationMode((prev) => (prev ? null : "direct"))}
            >
              {newConversationMode ? messagesCopy.closeNew : messagesCopy.newMessage}
            </button>
          </div>
        }
      />
    <div className="grid messages-layout">
      {/* ——— conversation list pane ——— */}
      <div className="card message-sidebar-card">
        {newConversationMode ? (
          <div className="new-chat-panel">
            {groupsEnabled && dmsEnabled ? (
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  className={newConversationMode === "direct" ? "button" : "button secondary"}
                  onClick={() => setNewConversationMode("direct")}
                >
                  One person
                </button>
                <button
                  type="button"
                  className={newConversationMode === "group" ? "button" : "button secondary"}
                  onClick={() => setNewConversationMode("group")}
                >
                  Group
                </button>
              </div>
            ) : null}
            {newConversationMode === "direct" && dmsEnabled ? (
              <NewDirectConversationForm
                attendees={attendees}
                currentUserId={user.id}
                token={token}
                withEventHeaders={withEventHeaders}
                onCreated={(c) => {
                  // Creator is always the initiator; GET list will confirm via refresh.
                  const row = { ...c, initiatedByMe: true };
                  if (!conversations.some((existing) => existing.id === c.id)) {
                    onConversationsChange([row, ...conversations]);
                  }
                  selectConversation(c.id);
                  setNewConversationMode(null);
                  void refreshConversations();
                }}
              />
            ) : (
              <NewGroupConversationForm
                attendees={attendees}
                currentUserId={user.id}
                token={token}
                withEventHeaders={withEventHeaders}
                onCreated={(c) => {
                  onConversationsChange([c, ...conversations]);
                  selectConversation(c.id);
                  setNewConversationMode(null);
                }}
              />
            )}
          </div>
        ) : null}

        <label className="sr-only" htmlFor="message-search">
          Search names or messages
        </label>
        <input
          id="message-search"
          className="input"
          type="search"
          placeholder="Search names or messages"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {emptyInbox ? (
          <EmptyState
            title={messagesCopy.empty.title}
            body={messagesCopy.empty.body}
            actionLabel={directoryEnabled ? messagesCopy.empty.action : undefined}
            onAction={directoryEnabled ? onBrowseAttendees : undefined}
          />
        ) : visibleConversations.length === 0 ? (
          <p className="help-text" style={{ marginTop: 16 }}>
            No conversations match &ldquo;{searchQuery.trim()}&rdquo;.
          </p>
        ) : (
          <ul className="conversation-list motion-stagger">
            {regularConversations.map((c) => {
              const unread = unreadConversationIds.has(c.id);
              const muted = !!c.muted;
              const title = conversationTitle(c, user.id);
              const secondary = conversationSecondaryLine(c, user.id);
              const preview = conversationPreview(c, user.id);
              const lastAt = c.messages?.[0]?.createdAt ?? c.createdAt ?? null;
              const photoUrl = c.type === "DIRECT" ? otherMember(c, user.id)?.photoUrl : null;
              return (
                <li key={c.id} className={`conversation-row-wrap${muted ? " is-muted" : ""}`}>
                  <button
                    type="button"
                    className={`conversation-row${unread ? " is-unread" : ""}`}
                    aria-current={activeConversationId === c.id ? "true" : undefined}
                    onClick={() => selectConversation(c.id)}
                  >
                    <span className="conversation-row-gutter" aria-hidden>
                      {unread ? <span className="conversation-unread-dot" /> : null}
                    </span>
                    <span className="msg-avatar" aria-hidden>
                      {photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photoUrl} alt="" />
                      ) : (
                        initialsFor(title)
                      )}
                    </span>
                    <span className="conversation-row-main">
                      <span className="conversation-row-top">
                        <span className="conversation-row-name">
                          {title}
                          {muted ? (
                            <span className="conversation-muted-icon" aria-hidden title="Muted">
                              <MuteBellIcon off />
                            </span>
                          ) : null}
                        </span>
                        {lastAt ? (
                          <time className="conversation-row-time" dateTime={lastAt} title={new Date(lastAt).toLocaleString()}>
                            {conversationTimestamp(lastAt)}
                          </time>
                        ) : null}
                      </span>
                      {secondary ? <span className="conversation-row-secondary">{secondary}</span> : null}
                      {preview ? (
                        <span className="conversation-row-preview">{preview}</span>
                      ) : (
                        <span className="conversation-row-preview conversation-row-preview--empty">No messages yet</span>
                      )}
                      {unread ? <span className="sr-only">Unread</span> : null}
                      {muted ? <span className="sr-only">Muted</span> : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="conversation-mute-btn button ghost"
                    aria-label={muted ? "Unmute conversation" : "Mute conversation"}
                    aria-pressed={muted}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleMute(c);
                    }}
                  >
                    <MuteBellIcon off={muted} />
                  </button>
                </li>
              );
            })}
            {requestConversations.length > 0 ? (
              <>
                <li className="conversation-requests-heading" aria-label={`Requests, ${requestConversations.length}`}>
                  Requests · {requestConversations.length}
                </li>
                {requestConversations.map((c) => {
                  // Requests never show an unread dot (server already returns unread false).
                  const muted = !!c.muted;
                  const title = conversationTitle(c, user.id);
                  const secondary = conversationSecondaryLine(c, user.id);
                  const preview = conversationPreview(c, user.id);
                  const lastAt = c.messages?.[0]?.createdAt ?? c.createdAt ?? null;
                  const photoUrl = c.type === "DIRECT" ? otherMember(c, user.id)?.photoUrl : null;
                  return (
                    <li key={c.id} className={`conversation-row-wrap${muted ? " is-muted" : ""}`}>
                      <button
                        type="button"
                        className="conversation-row"
                        aria-current={activeConversationId === c.id ? "true" : undefined}
                        onClick={() => selectConversation(c.id)}
                      >
                        <span className="conversation-row-gutter" aria-hidden />
                        <span className="msg-avatar" aria-hidden>
                          {photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={photoUrl} alt="" />
                          ) : (
                            initialsFor(title)
                          )}
                        </span>
                        <span className="conversation-row-main">
                          <span className="conversation-row-top">
                            <span className="conversation-row-name">
                              {title}
                              {muted ? (
                                <span className="conversation-muted-icon" aria-hidden title="Muted">
                                  <MuteBellIcon off />
                                </span>
                              ) : null}
                            </span>
                            {lastAt ? (
                              <time
                                className="conversation-row-time"
                                dateTime={lastAt}
                                title={new Date(lastAt).toLocaleString()}
                              >
                                {conversationTimestamp(lastAt)}
                              </time>
                            ) : null}
                          </span>
                          {secondary ? <span className="conversation-row-secondary">{secondary}</span> : null}
                          {preview ? (
                            <span className="conversation-row-preview">{preview}</span>
                          ) : (
                            <span className="conversation-row-preview conversation-row-preview--empty">
                              No messages yet
                            </span>
                          )}
                          {muted ? <span className="sr-only">Muted</span> : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="conversation-mute-btn button ghost"
                        aria-label={muted ? "Unmute conversation" : "Mute conversation"}
                        aria-pressed={muted}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleMute(c);
                        }}
                      >
                        <MuteBellIcon off={muted} />
                      </button>
                    </li>
                  );
                })}
              </>
            ) : null}
          </ul>
        )}
      </div>

      {/* ——— thread pane ——— */}
      <div className="card message-thread-card">
        <div
          className="msg-thread-header"
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3 ref={threadHeadingRef} tabIndex={-1} style={{ margin: 0 }}>
              {activeTitle ?? "Select a conversation"}
            </h3>
            {activeSecondary ? (
              <p className="text-meta" style={{ margin: "2px 0 0" }}>
                {activeSecondary}
              </p>
            ) : null}
          </div>
          {activeConversation?.type === "DIRECT" && otherUserId ? (
            <KebabMenu
              label="Conversation actions"
              items={[
                {
                  id: "profile",
                  label: "View profile",
                  onSelect: () => onViewProfile?.(otherUserId),
                },
                {
                  id: "mute",
                  label: activeConversation.muted ? "Unmute" : "Mute",
                  onSelect: () => void toggleMute(activeConversation),
                },
                {
                  id: "block",
                  label: activeConversation.blocked ? "Unblock" : "Block",
                  onSelect: () => void toggleBlock(),
                },
                {
                  id: "report",
                  label: "Report",
                  onSelect: () => {
                    setReportAlsoBlock(true);
                    setReportOpen(true);
                  },
                },
              ]}
            />
          ) : null}
        </div>

        <div
          ref={scrollRef}
          className="message-thread-scroll"
          role="log"
          aria-label={activeTitle ? `Conversation with ${activeTitle}` : "Conversation"}
          onScroll={handleThreadScroll}
        >
          {!activeConversation ? (
            emptyInbox ? (
              <EmptyState title={messagesCopy.empty.title} body={messagesCopy.empty.body} />
            ) : (
              <p className="msg-thread-placeholder">Select a conversation</p>
            )
          ) : threadLoading && messages.length === 0 ? (
            <ListSkeleton rows={3} />
          ) : messages.length === 0 ? (
            <p className="msg-thread-placeholder">
              This is the start of your conversation with {activeConversation.type === "GROUP" ? "this group" : activeTitle}.
            </p>
          ) : (
            dayGroups.map((day) => (
              <div key={day.dayKey}>
                <h4 className="msg-day-divider">
                  <span>{day.label}</span>
                </h4>
                {day.groups.map((group, groupIdx) => (
                  <div
                    key={`${day.dayKey}-${groupIdx}`}
                    className={`msg-group${group.isSelf ? " is-self" : ""}`}
                  >
                    {group.messages.map((m) => {
                      const canManage = !m.localStatus && (isAdmin || (m.user?.id != null && m.user.id === user.id));
                      return (
                        <div key={m.clientId ?? m.id} className="msg-row">
                          <div
                            className={`msg-bubble${group.isSelf ? " is-self" : ""}${
                              m.localStatus === "failed" ? " is-failed" : ""
                            }${m.localStatus === "sending" ? " is-sending" : ""}`}
                          >
                            <span className="sr-only">
                              {group.isSelf ? "You" : group.senderName}, {messageGroupTime(m.createdAt)}:{" "}
                            </span>
                            {editingMessageId === m.id ? (
                              <form
                                className="grid"
                                style={{ gap: 8 }}
                                onSubmit={async (e) => {
                                  e.preventDefault();
                                  if (!activeConversationId) return;
                                  try {
                                    const updated = await apiFetch<MessageView>(
                                      `/conversations/${activeConversationId}/messages/${m.id}`,
                                      withEventHeaders({
                                        method: "PATCH",
                                        body: JSON.stringify({ body: editingMessageBody }),
                                      }),
                                      token,
                                    );
                                    setMessages((prev) => prev.map((row) => (row.id === m.id ? updated : row)));
                                    setEditingMessageId(null);
                                  } catch (err) {
                                    setThreadError(err instanceof Error ? err.message : "Couldn't save that edit.");
                                  }
                                }}
                              >
                                <textarea
                                  className="textarea"
                                  value={editingMessageBody}
                                  onChange={(e) => setEditingMessageBody(e.target.value)}
                                  rows={3}
                                  required
                                />
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button className="button" type="submit">
                                    Save
                                  </button>
                                  <button className="button secondary" type="button" onClick={() => setEditingMessageId(null)}>
                                    Cancel
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <AutolinkText text={m.body} />
                            )}
                          </div>
                          {canManage && editingMessageId !== m.id ? (
                            <div className="msg-row-actions">
                              <KebabMenu
                                label="Message actions"
                                items={[
                                  {
                                    id: "edit",
                                    label: "Edit",
                                    onSelect: () => {
                                      setEditingMessageId(m.id);
                                      setEditingMessageBody(m.body);
                                    },
                                  },
                                  {
                                    id: "delete",
                                    label: "Delete",
                                    tone: "danger",
                                    onSelect: () => setDeleteConfirmId(m.id),
                                  },
                                ]}
                              />
                            </div>
                          ) : null}
                          {m.localStatus === "failed" ? (
                            <div className="msg-send-failed" role="alert">
                              Not sent.{" "}
                              <button type="button" className="msg-inline-action" onClick={() => retryMessage(m)}>
                                Retry
                              </button>{" "}
                              ·{" "}
                              <button type="button" className="msg-inline-action" onClick={() => discardFailedMessage(m)}>
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    <p className={`msg-group-meta${group.isSelf ? " is-self" : ""}`}>
                      {group.isSelf ? "You" : group.senderName} ·{" "}
                      <time dateTime={group.lastAt} title={new Date(group.lastAt).toLocaleString()}>
                        {messageGroupTime(group.lastAt)}
                      </time>
                      {group.isSelf && group.messages[group.messages.length - 1]?.localStatus === "sending"
                        ? " · Sending…"
                        : group.isSelf && !group.messages[group.messages.length - 1]?.localStatus
                          ? " ✓"
                          : ""}
                    </p>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {newIncomingCount > 0 ? (
          <button
            type="button"
            className="msg-new-messages-btn"
            onClick={() => {
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
              stickToBottomRef.current = true;
              setNewIncomingCount(0);
            }}
          >
            {newIncomingCount} new {newIncomingCount === 1 ? "message" : "messages"} ↓
          </button>
        ) : null}

        <div aria-live="polite" className="sr-only">
          {liveAnnouncement}
        </div>

        {isOffline ? (
          <p className="msg-offline-strip">You&apos;re offline. Messages will send when you reconnect.</p>
        ) : null}

        {threadError ? (
          <div className="msg-thread-error" role="alert">
            <span>{threadError}</span>
            <button type="button" className="msg-inline-action" onClick={() => setThreadError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        {activeConversation && isIncomingRequest(activeConversation) ? (
          <p className="msg-thread-notice" role="status">
            Replying will let {activeOther?.name ?? "them"} message you.
          </p>
        ) : null}

        {activeConversation ? (
          composerBlockedNotice ? (
            <p className="help-text" role="status" style={{ margin: "8px 0 0" }}>
              {composerBlockedNotice}
            </p>
          ) : (
            <form
              className="msg-composer"
              onSubmit={(e) => {
                e.preventDefault();
                sendCurrentBody();
              }}
            >
              <label className="sr-only" htmlFor="message-composer-body">
                Write a message to {activeOther?.name ?? activeTitle ?? "this conversation"}
              </label>
              <textarea
                id="message-composer-body"
                ref={composerRef}
                className="textarea msg-composer-textarea"
                placeholder="Write a message…"
                rows={2}
                value={composerBody}
                onChange={(e) => updateComposerBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendCurrentBody();
                  }
                }}
              />
              <div className="msg-composer-footer">
                <span className="text-meta">Enter to send · Shift + Enter for a new line</span>
                <button className="button" type="submit" disabled={!composerBody.trim()}>
                  Send
                </button>
              </div>
            </form>
          )
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(deleteConfirmId && activeConversationId)}
        title="Delete message?"
        body="This removes the message from the conversation for everyone. This cannot be undone."
        confirmLabel="Delete message"
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={async () => {
          if (!deleteConfirmId || !activeConversationId) return;
          try {
            await apiFetch(
              `/conversations/${activeConversationId}/messages/${deleteConfirmId}`,
              withEventHeaders({ method: "DELETE" }),
              token,
            );
            setMessages((prev) => prev.filter((m) => m.id !== deleteConfirmId));
            setDeleteConfirmId(null);
          } catch (err) {
            // Close the dialog so the inline thread notice is visible.
            setDeleteConfirmId(null);
            setThreadError(err instanceof Error ? err.message : "Couldn't delete that message.");
          }
        }}
      />

      {reportOpen && otherUserId ? (
        <Portal>
          <div
            className="agenda-add-modal-overlay"
            role="presentation"
            onClick={() => {
              if (!reportSubmitting) setReportOpen(false);
            }}
          >
            <div
              className="agenda-add-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="msg-report-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h4 id="msg-report-title">Report</h4>
              <p className="help-text" style={{ marginTop: 0 }}>
                Organizers will review this report. The other person is not notified.
              </p>
              <label className="help-text" style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                Reason
                <select
                  className="input"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value as (typeof REPORT_REASONS)[number])}
                  disabled={reportSubmitting}
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="help-text" style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                Details (optional)
                <textarea
                  className="textarea"
                  rows={3}
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  disabled={reportSubmitting}
                />
              </label>
              <label
                className="help-text"
                style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}
              >
                <input
                  type="checkbox"
                  checked={reportAlsoBlock}
                  onChange={(e) => setReportAlsoBlock(e.target.checked)}
                  disabled={reportSubmitting}
                />
                Also block {activeOther?.name ?? "this person"}
              </label>
              <div className="agenda-add-modal-actions">
                <button
                  type="button"
                  className="button"
                  disabled={reportSubmitting}
                  onClick={() => void submitReport()}
                >
                  {reportSubmitting ? "Submitting…" : "Submit"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={reportSubmitting}
                  onClick={() => setReportOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </Portal>
      ) : null}
    </div>
    </div>
  );
}

function NewDirectConversationForm({
  attendees,
  currentUserId,
  token,
  withEventHeaders,
  onCreated,
}: {
  attendees: SelectablePerson[];
  currentUserId: string;
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onCreated: (c: ConversationView) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userId = selectedIds[0];
    if (!userId) return;
    setError(null);
    try {
      const conversation = await apiFetch<ConversationView>(
        "/conversations/direct",
        withEventHeaders({ method: "POST", body: JSON.stringify({ userId }) }),
        token,
      );
      onCreated(conversation);
      setSelectedIds([]);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const name = attendees.find((a) => a.id === userId)?.name;
      setError(
        status === 403 && name
          ? `${name} hasn't opted into direct messages`
          : err instanceof Error && err.message
            ? err.message
            : "Couldn't start the conversation",
      );
    }
  }

  return (
    <form className="grid" onSubmit={handleSubmit} style={{ gap: 8 }}>
      <p className="help-text" style={{ margin: 0 }}>
        Pick one person to message privately.
      </p>
      <SearchableMultiSelect
        label="Person"
        people={attendees}
        selectedIds={selectedIds}
        excludeIds={[currentUserId]}
        placeholder="Search people…"
        onChange={(ids) => setSelectedIds(ids.length <= 1 ? ids : [ids[ids.length - 1]!])}
      />
      {error ? (
        <p className="help-text" role="status" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <button className="button secondary" type="submit" disabled={selectedIds.length !== 1}>
        Start conversation
      </button>
    </form>
  );
}

function NewGroupConversationForm({
  attendees,
  currentUserId,
  token,
  withEventHeaders,
  onCreated,
}: {
  attendees: SelectablePerson[];
  currentUserId: string;
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onCreated: (c: ConversationView) => void;
}) {
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = memberIds.filter((id) => id && id !== currentUserId);
    if (!name.trim() || cleaned.length === 0) return;
    setError(null);
    try {
      const conversation = await apiFetch<ConversationView>(
        "/conversations/group",
        withEventHeaders({ method: "POST", body: JSON.stringify({ name: name.trim(), memberIds: cleaned }) }),
        token,
      );
      onCreated(conversation);
      setName("");
      setMemberIds([]);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't create the group");
    }
  }

  return (
    <form className="grid" onSubmit={handleSubmit} style={{ gap: 8 }}>
      <p className="help-text" style={{ margin: 0 }}>
        Name the group and pick the people in it. Only members see these messages.
      </p>
      <input
        className="input"
        name="name"
        placeholder="Group name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <SearchableMultiSelect
        label="Members"
        people={attendees}
        selectedIds={memberIds}
        excludeIds={[currentUserId]}
        placeholder="Search people…"
        onChange={setMemberIds}
      />
      {error ? (
        <p className="help-text" role="status" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <button className="button secondary" type="submit" disabled={!name.trim() || memberIds.length === 0}>
        Create group
      </button>
    </form>
  );
}
