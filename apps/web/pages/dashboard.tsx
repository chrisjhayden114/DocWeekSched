import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CommunityPillIcon, MainNavIcon, type CommunityPillKey } from "../components/dashboardNavIcons";
import { OnlineMeetingLink } from "../components/OnlineMeetingLink";
import { apiFetch } from "../lib/api";

type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ATTENDEE" | "SPEAKER";
  photoUrl?: string | null;
  researchInterests?: string | null;
  participantType?: "GRAD_STUDENT" | "PROFESSOR" | null;
  engagementPoints?: number;
  inviteStatus?: "ACTIVE" | "PENDING_SETUP" | "INVITE_EXPIRED";
  inviteExpiresAt?: string | null;
};

type Event = {
  id: string;
  name: string;
  slug: string;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
};

type Session = {
  id: string;
  title: string;
  description?: string;
  location?: string | null;
  speakers?: string | null;
  zoomLink?: string | null;
  recordingUrl?: string | null;
  fileUrl?: string | null;
  fileLink?: string | null;
  imageUrl?: string | null;
  startsAt: string;
  endsAt: string;
  speaker?: { name: string };
  speakerId?: string | null;
  bookmarks?: { userId: string; user: Pick<User, "id" | "name" | "email" | "photoUrl"> }[];
  attendances?: {
    userId: string;
    status: "JOINING" | "NOT_JOINING";
    joinMode?: "VIRTUAL" | "IN_PERSON" | null;
    user: Pick<User, "id" | "name" | "email" | "photoUrl">;
  }[];
  likes?: { userId: string; user: Pick<User, "id" | "name" | "email" | "photoUrl"> }[];
};

type ConversationMember = { user: { id: string; name: string; role: string } };
type Conversation = {
  id: string;
  name?: string | null;
  type: "EVENT" | "DIRECT" | "GROUP" | "SESSION";
  members: ConversationMember[];
  messages: { id: string; body: string; createdAt: string; user: { id: string; name: string } }[];
};
type Message = { id: string; body: string; createdAt: string; user: { id: string; name: string; role: string } };
type SessionAttendance = {
  sessionId: string;
  status: "JOINING" | "NOT_JOINING";
  joinMode?: "VIRTUAL" | "IN_PERSON" | null;
};
type MySessionMeta = { attendance: SessionAttendance[]; likedSessionIds: string[] };
type EventItem = {
  id: string;
  name: string;
  slug: string;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
};

type NetworkAuthor = { id: string; name: string; role: string; photoUrl?: string | null };
type NetworkReply = { id: string; body: string; createdAt: string; author: NetworkAuthor };
type NetworkThread = {
  id: string;
  title: string;
  body: string;
  channel?: "GENERAL" | "MEETUP" | "MOMENTS" | "LOCAL" | "ICEBREAKER";
  meetupMode?: "VIRTUAL" | "IN_PERSON" | null;
  meetupStartsAt?: string | null;
  meetupMeetingUrl?: string | null;
  meetupInviteEveryone?: boolean;
  meetupParticipantIds?: string[];
  taggedUserIds?: string[];
  imageUrl?: string | null;
  imageUrls?: string[];
  mapsUrl?: string | null;
  createdAt: string;
  author: NetworkAuthor;
  replies: NetworkReply[];
};

type UserNotificationRow = {
  id: string;
  kind: "COMMUNITY_THREAD" | "COMMUNITY_REPLY" | "MESSAGE";
  title: string;
  body: string | null;
  threadId: string | null;
  conversationId: string | null;
  readAt: string | null;
  createdAt: string;
};

const COMMUNITY_TAB = "Community" as const;
const PARTICIPANTS_INVITES_TAB = "Participants and Invites" as const;
const adminTabs = [
  "Agenda",
  "Attendees",
  PARTICIPANTS_INVITES_TAB,
  COMMUNITY_TAB,
  "Messages",
  "Notifications",
  "Profile",
] as const;
const participantTabs = ["Agenda", "Attendees", COMMUNITY_TAB, "Messages", "Notifications", "Profile"] as const;
type Tab = (typeof adminTabs)[number];

type CommunityChannelFilter = "ALL" | "GENERAL" | "MEETUP" | "MOMENTS" | "LOCAL" | "ICEBREAKER";

function engagementGemTier(points?: number): { tierClass: string; label: string } {
  if (points == null || points <= 0) return { tierClass: "points-gem-tier-0", label: "Quartz" };
  if (points < 10) return { tierClass: "points-gem-tier-1", label: "Sapphire" };
  if (points < 25) return { tierClass: "points-gem-tier-2", label: "Ruby" };
  if (points < 50) return { tierClass: "points-gem-tier-3", label: "Emerald" };
  return { tierClass: "points-gem-tier-4", label: "Diamond" };
}

function EngagementGemMark() {
  return (
    <svg className="points-gem-icon" viewBox="0 0 24 24" aria-hidden="true">
      {/* Faceted brilliant: table + left/right pavilions (light from upper-right) */}
      <path d="M12 4L8 9.75h8L12 4z" fill="currentColor" opacity={0.2} />
      <path d="M8 9.75L12 11.25L12 20.5L6.75 13.5L8 9.75z" fill="currentColor" opacity={0.46} />
      <path d="M16 9.75L12 11.25L12 20.5L17.25 13.5L16 9.75z" fill="currentColor" opacity={0.78} />
      <path
        d="M12 4L8 9.75M12 4L16 9.75M8 9.75h8M6.75 13.5L12 20.5L17.25 13.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={0.85}
        strokeLinejoin="round"
        opacity={0.38}
      />
    </svg>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [active, setActive] = useState<Tab>("Agenda");

  const [event, setEvent] = useState<Event | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [attendees, setAttendees] = useState<User[]>([]);
  const [networkThreads, setNetworkThreads] = useState<NetworkThread[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [agendaView, setAgendaView] = useState<"Event Schedule" | "My Schedule">("Event Schedule");
  const [myAttendance, setMyAttendance] = useState<SessionAttendance[]>([]);
  const [likedSessionIds, setLikedSessionIds] = useState<string[]>([]);
  const [adminEvents, setAdminEvents] = useState<EventItem[]>([]);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [communityChannel, setCommunityChannel] = useState<CommunityChannelFilter>("ALL");
  const [updatingEvent, setUpdatingEvent] = useState(false);
  const [sessionFormKey, setSessionFormKey] = useState(0);
  const [messageDirectoryQuery, setMessageDirectoryQuery] = useState("");
  const [eventSettingsOpen, setEventSettingsOpen] = useState(false);
  const [eventSettingsError, setEventSettingsError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<UserNotificationRow[]>([]);
  const [communityFocusThreadId, setCommunityFocusThreadId] = useState<string | null>(null);
  const clearCommunityFocus = useCallback(() => setCommunityFocusThreadId(null), []);

  const withEventHeaders = (extra: RequestInit = {}): RequestInit => {
    if (!activeEventId) return extra;
    const h = (extra.headers as Record<string, string> | undefined) || {};
    return { ...extra, headers: { ...h, "x-event-id": activeEventId } };
  };

  const refreshUser = async () => {
    if (!token) return;
    const fresh = await apiFetch<User>("/auth/me", {}, token);
    setUser(fresh);
    window.localStorage.setItem("user", JSON.stringify(fresh));
  };

  useEffect(() => {
    const storedToken = window.localStorage.getItem("token");
    const storedUser = window.localStorage.getItem("user");
    if (!storedToken || !storedUser) {
      window.location.href = "/";
      return;
    }
    setToken(storedToken);
    setUser(JSON.parse(storedUser));
  }, []);

  useEffect(() => {
    if (!token) return;
    apiFetch<Event>("/event", withEventHeaders(), token).then(setEvent).catch(() => null);
    apiFetch<User>("/auth/me", {}, token).then((freshUser) => {
      setUser(freshUser);
      window.localStorage.setItem("user", JSON.stringify(freshUser));
    }).catch(() => null);
    apiFetch<MySessionMeta>("/sessions/me", {}, token).then((meta) => {
      setMyAttendance(meta.attendance);
      setLikedSessionIds(meta.likedSessionIds);
    }).catch(() => null);
  }, [token, activeEventId]);

  useEffect(() => {
    const storedEventId = window.localStorage.getItem("activeEventId");
    if (storedEventId) {
      setActiveEventId(storedEventId);
    }
  }, []);

  const didAutoFillActiveEvent = useRef(false);
  useEffect(() => {
    if (didAutoFillActiveEvent.current || activeEventId) return;
    if (!event?.id) return;
    didAutoFillActiveEvent.current = true;
    setActiveEventId(event.id);
    window.localStorage.setItem("activeEventId", event.id);
  }, [event?.id, activeEventId]);

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      if (active === "Agenda") {
        setSessions(await apiFetch<Session[]>("/sessions", withEventHeaders(), token));
        if (user?.role === "ADMIN" && attendees.length === 0) {
          setAttendees(await apiFetch<User[]>("/attendees", {}, token));
        }
      }
      if (active === "Attendees" || active === PARTICIPANTS_INVITES_TAB) {
        setAttendees(await apiFetch<User[]>("/attendees", {}, token));
      }
      if (active === COMMUNITY_TAB) {
        const qs = communityChannel === "ALL" ? "" : `?channel=${communityChannel}`;
        setNetworkThreads(await apiFetch<NetworkThread[]>(`/network/threads${qs}`, withEventHeaders(), token));
        if (attendees.length === 0) {
          setAttendees(await apiFetch<User[]>("/attendees", {}, token));
        }
      }
      if (active === "Notifications") {
        setNotifications(await apiFetch<UserNotificationRow[]>("/notifications", withEventHeaders(), token));
      }
      if (active === "Messages") {
        const convoList = await apiFetch<Conversation[]>("/conversations", withEventHeaders(), token);
        setConversations(convoList);
        const preferred =
          convoList.find((c) => c.type === "EVENT") ?? convoList.find((c) => c.type !== "SESSION");
        if (!activeConversationId && preferred) {
          setActiveConversationId(preferred.id);
        }
        if (attendees.length === 0) {
          setAttendees(await apiFetch<User[]>("/attendees", {}, token));
        }
      }
      if (user?.role === "ADMIN") {
        const myEvents = await apiFetch<EventItem[]>("/event/mine", {}, token).catch(() => []);
        setAdminEvents(myEvents);
      }
    };
    load();
  }, [active, token, user?.role, activeConversationId, activeEventId, communityChannel]);

  useEffect(() => {
    if (!token || active !== "Messages" || !activeConversationId) return;
    setMessages([]);
    let cancelled = false;
    apiFetch<Message[]>(`/conversations/${activeConversationId}/messages`, withEventHeaders(), token)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [active, activeConversationId, token, activeEventId]);

  useEffect(() => {
    if (!token || !activeEventId) return;
    const refresh = () => {
      apiFetch<UserNotificationRow[]>("/notifications", withEventHeaders(), token)
        .then(setNotifications)
        .catch(() => null);
    };
    refresh();
    const interval = window.setInterval(refresh, 45_000);
    return () => window.clearInterval(interval);
  }, [token, activeEventId]);

  useEffect(() => {
    if (!token || !activeEventId || active !== "Notifications") return;
    let cancelled = false;
    (async () => {
      try {
        await apiFetch("/notifications/read-all", withEventHeaders({ method: "POST" }), token);
      } catch {
        /* ignore */
      }
      try {
        const list = await apiFetch<UserNotificationRow[]>("/notifications", withEventHeaders(), token);
        if (!cancelled) setNotifications(list);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, token, activeEventId]);

  useEffect(() => {
    if (active !== "Messages" || !activeConversationId) return;
    const cur = conversations.find((c) => c.id === activeConversationId);
    if (cur?.type === "SESSION") {
      const next = conversations.find((c) => c.type !== "SESSION");
      setActiveConversationId(next?.id ?? null);
    }
  }, [active, conversations, activeConversationId]);

  const isAdmin = useMemo(() => user?.role === "ADMIN", [user]);
  const availableTabs = useMemo(() => (isAdmin ? adminTabs : participantTabs), [isAdmin]);
  const unreadNotifications = useMemo(
    () => notifications.filter((row) => !row.readAt).length,
    [notifications],
  );

  useEffect(() => {
    if (!availableTabs.some((tab) => tab === active)) {
      setActive("Agenda");
    }
  }, [availableTabs, active]);
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [sessions]
  );
  const groupedAgenda = useMemo(() => groupSessionsByDayAndTime(sortedSessions), [sortedSessions]);
  const joiningSessionIds = useMemo(
    () => myAttendance.filter((item) => item.status === "JOINING").map((item) => item.sessionId),
    [myAttendance]
  );
  const myScheduledSessions = useMemo(
    () => sortedSessions.filter((session) => joiningSessionIds.includes(session.id)),
    [sortedSessions, joiningSessionIds]
  );
  const groupedMySchedule = useMemo(() => groupSessionsByDayAndTime(myScheduledSessions), [myScheduledSessions]);

  const messageSearchLower = messageDirectoryQuery.trim().toLowerCase();

  const messagingConversations = useMemo(
    () => conversations.filter((c) => c.type !== "SESSION"),
    [conversations],
  );

  const messagingConversationsOrdered = useMemo(() => {
    const list = [...messagingConversations];
    list.sort((a, b) => {
      if (a.type === "EVENT" && b.type !== "EVENT") return -1;
      if (b.type === "EVENT" && a.type !== "EVENT") return 1;
      return 0;
    });
    return list;
  }, [messagingConversations]);

  const eventWideConversation = useMemo(
    () => messagingConversationsOrdered.find((c) => c.type === "EVENT") ?? null,
    [messagingConversationsOrdered],
  );

  const directAndGroupConversations = useMemo(
    () => messagingConversationsOrdered.filter((c) => c.type !== "EVENT"),
    [messagingConversationsOrdered],
  );

  const filteredMessageAttendees = useMemo(() => {
    const uid = user?.id;
    if (!uid) return [];
    return attendees.filter((a) => {
      if (a.id === uid) return false;
      if (!messageSearchLower) return true;
      const hay = `${a.name} ${a.email || ""} ${a.researchInterests || ""}`.toLowerCase();
      return hay.includes(messageSearchLower);
    });
  }, [attendees, messageSearchLower, user?.id]);

  const filteredDirectAndGroup = useMemo(() => {
    if (!user) return [];
    if (!messageSearchLower) return directAndGroupConversations;
    return directAndGroupConversations.filter((c) => {
      const label = formatConversationName(c, user).toLowerCase();
      if (label.includes(messageSearchLower)) return true;
      return c.members.some((m) => m.user.name.toLowerCase().includes(messageSearchLower));
    });
  }, [directAndGroupConversations, messageSearchLower, user]);

  const activeConversation = useMemo(() => {
    if (!activeConversationId) return null;
    return conversations.find((c) => c.id === activeConversationId) ?? null;
  }, [conversations, activeConversationId]);

  const handleLogout = () => {
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("user");
    window.location.href = "/";
  };

  const patchSessionAttendance = async (
    sessionId: string,
    body: { status: "JOINING" | "NOT_JOINING"; joinMode?: "VIRTUAL" | "IN_PERSON" },
  ) => {
    if (!token) return;
    const prevAttendance = myAttendance;
    setMyAttendance((rows) => {
      const rest = rows.filter((r) => r.sessionId !== sessionId);
      if (body.status === "NOT_JOINING") return rest;
      return [
        ...rest,
        {
          sessionId,
          status: "JOINING" as const,
          joinMode: body.joinMode ?? "IN_PERSON",
        },
      ];
    });
    try {
      await apiFetch(`/sessions/${sessionId}/attendance`, {
        method: "PUT",
        body: JSON.stringify(body),
      }, token);
      const meta = await apiFetch<MySessionMeta>("/sessions/me", {}, token);
      setMyAttendance(meta.attendance);
      setSessions(await apiFetch<Session[]>("/sessions", withEventHeaders(), token));
      if (body.status === "JOINING") {
        void refreshUser();
      }
    } catch {
      setMyAttendance(prevAttendance);
    }
  };

  const goToSessionPage = (sessionId: string) => {
    router.push(`/session/${sessionId}`);
  };

  const toggleSessionLike = async (sessionId: string) => {
    if (!token) return;
    const liked = likedSessionIds.includes(sessionId);
    const prevLikes = likedSessionIds;
    if (liked) {
      setLikedSessionIds((prev) => prev.filter((id) => id !== sessionId));
      try {
        await apiFetch(`/sessions/${sessionId}/like`, { method: "DELETE" }, token);
        void refreshUser();
      } catch {
        setLikedSessionIds(prevLikes);
      }
      return;
    }
    setLikedSessionIds((prev) => [...prev, sessionId]);
    try {
      await apiFetch(`/sessions/${sessionId}/like`, { method: "PUT" }, token);
      void refreshUser();
    } catch {
      setLikedSessionIds(prevLikes);
    }
  };

  const startDirectMessage = async (userId: string) => {
    if (!token) return;
    const conversation = await apiFetch<Conversation>(
      "/conversations/direct",
      withEventHeaders({ method: "POST", body: JSON.stringify({ userId }) }),
      token,
    );
    if (!conversations.some((c) => c.id === conversation.id)) {
      setConversations((prev) => [conversation, ...prev]);
    }
    setActive("Messages");
    setActiveConversationId(conversation.id);
  };

  const updateCurrentEvent = async (payload: {
    name: string;
    slug?: string;
    bannerUrl?: string;
    logoUrl?: string;
    timezone: string;
    startDate: string;
    endDate: string;
  }) => {
    if (!token) return;
    setUpdatingEvent(true);
    setEventSettingsError(null);
    try {
      const updated = await apiFetch<Event>(
        "/event",
        withEventHeaders({ method: "PUT", body: JSON.stringify(payload) }),
        token,
      );
      setEvent(updated);
      setEventSettingsOpen(false);
      if (isAdmin) {
        const myEvents = await apiFetch<EventItem[]>("/event/mine", {}, token).catch(() => []);
        setAdminEvents(myEvents);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not save event. If you uploaded large images, try a smaller file.";
      setEventSettingsError(message);
    } finally {
      setUpdatingEvent(false);
    }
  };

  if (!user) return null;

  const appShellBannerStyle: CSSProperties | undefined = event?.bannerUrl
    ? {
        backgroundImage: `linear-gradient(135deg, rgba(0, 30, 92, 0.88) 0%, rgba(0, 51, 160, 0.78) 100%), url(${JSON.stringify(event.bannerUrl)})`,
      }
    : undefined;

  return (
    <div className="container">
      <div className={`header app-shell${event?.bannerUrl ? " app-shell--with-banner" : ""}`} style={appShellBannerStyle}>
        <div className="app-shell-title">
          <div className="app-shell-heading-row">
            {event?.logoUrl ? (
              <img src={event.logoUrl} alt="" className="app-shell-logo" width={48} height={48} />
            ) : null}
            <h1 className="app-shell-heading-title">{event?.name || "Event Dashboard"}</h1>
          </div>
          <p className="app-shell-subtitle" style={{ color: "var(--ink-muted)" }}>
            {user.name} · {user.role}
            {typeof user.engagementPoints === "number" && (
              <>
                {" · "}
                <span
                  className={`points-gem ${engagementGemTier(user.engagementPoints).tierClass}`}
                  title={`${engagementGemTier(user.engagementPoints).label} · ${user.engagementPoints} engagement pts`}
                >
                  <EngagementGemMark />
                  <span>{user.engagementPoints}</span>
                </span>
              </>
            )}
            {event && ` · ${formatEventRange(event.startDate, event.endDate)}`}
          </p>
        </div>
        <div className="app-shell-actions">
          {isAdmin && event && (
            <div className="event-settings-wrap">
              <button
                className="button secondary event-settings-trigger"
                type="button"
                onClick={() => {
                  setEventSettingsError(null);
                  setEventSettingsOpen((open) => !open);
                }}
              >
                {eventSettingsOpen ? "Close Event Settings" : "Edit Event Settings"}
              </button>
              {eventSettingsOpen && (
                <div className="card event-settings-panel">
                  <div className="event-settings-title">Edit This Event</div>
                  <p className="help-text" style={{ marginTop: 0 }}>
                    Update the title, header logo, banner, slug, and dates for the active event.
                  </p>
                  <form
                    className="grid"
                    style={{ marginTop: 10 }}
                    onSubmit={async (eventForm) => {
                      eventForm.preventDefault();
                      const form = new FormData(eventForm.currentTarget);
                      await updateCurrentEvent({
                        name: String(form.get("name") || ""),
                        slug: String(form.get("slug") || "").trim() || undefined,
                        bannerUrl: String(form.get("bannerUrl") || ""),
                        logoUrl: String(form.get("logoUrl") || "").trim() || undefined,
                        timezone: String(form.get("timezone") || "UTC"),
                        startDate: new Date(String(form.get("startDate") || "")).toISOString(),
                        endDate: new Date(String(form.get("endDate") || "")).toISOString(),
                      });
                    }}
                  >
                    <input className="input" name="name" defaultValue={event.name} required />
                    <label className="help-text" style={{ margin: 0 }}>
                      Short link slug (lowercase, hyphens only). Share:{" "}
                      <strong>{typeof window !== "undefined" ? `${window.location.origin}/e/${event.slug}` : `/e/${event.slug}`}</strong>
                    </label>
                    <input
                      className="input"
                      name="slug"
                      defaultValue={event.slug}
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      title="Lowercase letters, numbers, and single hyphens"
                    />
                    <label className="help-text" style={{ margin: 0 }}>
                      Header logo (square PNG/JPG; appears next to the event title)
                    </label>
                    <input className="input" name="logoUrl" defaultValue={event.logoUrl || ""} placeholder="Logo URL or upload below" />
                    <input
                      className="input"
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const data = await fileToDataUrl(file, { maxWidth: 512, maxHeight: 512, quality: 0.88 });
                        const el = e.currentTarget.form?.elements.namedItem("logoUrl");
                        if (el instanceof HTMLInputElement) el.value = data;
                      }}
                    />
                    <input className="input" name="bannerUrl" defaultValue={event.bannerUrl || ""} placeholder="Banner image URL or upload below" />
                    <input
                      className="input"
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const data = await fileToDataUrl(file, { maxWidth: 1920, maxHeight: 720, quality: 0.82 });
                        const el = e.currentTarget.form?.elements.namedItem("bannerUrl");
                        if (el instanceof HTMLInputElement) el.value = data;
                      }}
                    />
                    {eventSettingsError ? (
                      <p className="help-text" style={{ color: "#b42318", margin: 0 }}>
                        {eventSettingsError}
                      </p>
                    ) : null}
                    <input className="input" name="timezone" defaultValue={event.timezone} required />
                    <input className="input" type="datetime-local" name="startDate" defaultValue={toLocalInputValue(event.startDate)} required />
                    <input className="input" type="datetime-local" name="endDate" defaultValue={toLocalInputValue(event.endDate)} required />
                    <button className="button" type="submit" disabled={updatingEvent}>
                      {updatingEvent ? "Saving..." : "Save Event"}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
          <button className="button secondary" onClick={handleLogout}>Logout</button>
        </div>
      </div>

      <div className="nav" style={{ marginBottom: 20 }}>
        {availableTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`${active === tab ? "active" : ""}${tab === "Notifications" && unreadNotifications > 0 ? " nav-tab-unread" : ""}`}
            onClick={() => setActive(tab)}
          >
            <span className="nav-tab-inner">
              <MainNavIcon tab={tab} />
              <span>{tab}</span>
              {tab === "Notifications" && unreadNotifications > 0 ? (
                <span className="nav-unread-badge" aria-label={`${unreadNotifications} unread`}>
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>

      {active === "Agenda" && (
        <div className="schedule-layout">
          <div className="card schedule-list">
            <div className="nav agenda-view-toggle" role="tablist" aria-label="Schedule views">
              <button
                type="button"
                role="tab"
                aria-selected={agendaView === "Event Schedule"}
                className={agendaView === "Event Schedule" ? "active" : ""}
                onClick={() => setAgendaView("Event Schedule")}
              >
                Event Schedule
              </button>
              <span className="agenda-view-toggle-divider" aria-hidden="true" />
              <button
                type="button"
                role="tab"
                aria-selected={agendaView === "My Schedule"}
                className={agendaView === "My Schedule" ? "active" : ""}
                onClick={() => setAgendaView("My Schedule")}
              >
                My Schedule
              </button>
            </div>
            {agendaView === "Event Schedule" && (
              <ScheduleBoard
                grouped={groupedAgenda}
                isAdmin={isAdmin}
                myAttendance={myAttendance}
                likedSessionIds={likedSessionIds}
                onPatchAttendance={patchSessionAttendance}
                onToggleLike={toggleSessionLike}
                onEditSession={(session) => setEditingSession(session)}
                onGoToSession={goToSessionPage}
              />
            )}
            {agendaView === "My Schedule" && (
              <ScheduleBoard
                grouped={groupedMySchedule}
                isAdmin={isAdmin}
                myAttendance={myAttendance}
                likedSessionIds={likedSessionIds}
                onPatchAttendance={patchSessionAttendance}
                onToggleLike={toggleSessionLike}
                onEditSession={(session) => setEditingSession(session)}
                onGoToSession={goToSessionPage}
              />
            )}
          </div>
          {isAdmin && (
            <SessionForm
              key={sessionFormKey}
              token={token!}
              eventHeaders={withEventHeaders}
              attendees={attendees}
              editing={editingSession}
              onSaved={async () => {
                setEditingSession(null);
                setActive("Agenda");
                setSessionFormKey((k) => k + 1);
                setSessions(await apiFetch<Session[]>("/sessions", withEventHeaders(), token!));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onCancel={() => setEditingSession(null)}
            />
          )}
        </div>
      )}

      {active === "Attendees" && (
        <>
          <AttendeeDirectory
            attendees={attendees}
            currentUserId={user.id}
            onMessage={startDirectMessage}
          />
        </>
      )}

      {active === PARTICIPANTS_INVITES_TAB && isAdmin && (
        <div className="grid" style={{ gap: 16 }}>
          <div className="card" style={{ padding: 18 }}>
            <h3 style={{ marginTop: 0 }}>Add participants</h3>
            <p className="help-text" style={{ marginTop: 0 }}>
              Invite people by email so they receive a link to set a password and confirm their profile. Invites are tied to
              whichever event you select below (same as Profile → My Events).
            </p>
            {adminEvents.length > 0 ? (
              <label className="help-text" style={{ margin: "12px 0 6px", display: "grid", gap: 6 }}>
                Event for invites &amp; roster
                <select
                  className="select"
                  value={activeEventId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    setActiveEventId(id);
                    if (id) window.localStorage.setItem("activeEventId", id);
                    else window.localStorage.removeItem("activeEventId");
                  }}
                >
                  <option value="" disabled>
                    Choose an event…
                  </option>
                  {adminEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="help-text" style={{ color: "#b42318", margin: "12px 0 0" }}>
                No events found. Create one under <strong>Profile</strong> → <strong>My Events</strong>.
              </p>
            )}
            <AdminParticipantInviteCard
              token={token!}
              withEventHeaders={withEventHeaders}
              activeEventId={activeEventId}
              eventSlug={event?.slug ?? null}
              onInvited={async () => {
                const list = await apiFetch<User[]>("/attendees", {}, token!);
                setAttendees(list);
              }}
            />
            <BulkInviteCsvCard
              token={token!}
              withEventHeaders={withEventHeaders}
              activeEventId={activeEventId}
              onDone={async () => {
                const list = await apiFetch<User[]>("/attendees", {}, token!);
                setAttendees(list);
              }}
            />
          </div>
          <div className="card" style={{ padding: 18 }}>
            <h3 style={{ marginTop: 0 }}>Roster &amp; invitations</h3>
            <p className="help-text" style={{ marginTop: 0 }}>
              <strong>Joined</strong> means the account is active (invite completed, or they registered another way).{" "}
              <strong>Pending</strong> means they were emailed a setup link and have not finished creating their password.{" "}
              <strong>Expired</strong> means that link is past its date — invite them again with the same email only after resolving the existing record if the app reports a conflict.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="invite-status-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Invite / join status</th>
                    <th>Link expires</th>
                  </tr>
                </thead>
                <tbody>
                  {attendees.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{a.email}</td>
                      <td>{a.role}</td>
                      <td>{inviteStatusLabel(a)}</td>
                      <td>
                        {a.inviteStatus === "PENDING_SETUP" && a.inviteExpiresAt
                          ? new Date(a.inviteExpiresAt).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {active === COMMUNITY_TAB && (
        <CommunityBoard
          threads={networkThreads}
          channelFilter={communityChannel}
          onChannelChange={setCommunityChannel}
          isAdmin={isAdmin}
          currentUserId={user.id}
          attendees={attendees}
          focusThreadId={communityFocusThreadId}
          onFocusThreadConsumed={clearCommunityFocus}
          token={token!}
          withEventHeaders={withEventHeaders}
          onThreadsUpdated={async () => {
            const qs = communityChannel === "ALL" ? "" : `?channel=${communityChannel}`;
            setNetworkThreads(await apiFetch<NetworkThread[]>(`/network/threads${qs}`, withEventHeaders(), token!));
            await refreshUser();
            apiFetch<UserNotificationRow[]>("/notifications", withEventHeaders(), token!)
              .then(setNotifications)
              .catch(() => null);
          }}
        />
      )}

      {active === "Notifications" && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>Notifications</h3>
            {unreadNotifications > 0 ? (
              <button
                type="button"
                className="button secondary"
                onClick={async () => {
                  await apiFetch("/notifications/read-all", withEventHeaders({ method: "POST" }), token!);
                  setNotifications(await apiFetch<UserNotificationRow[]>("/notifications", withEventHeaders(), token!));
                }}
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <p className="help-text" style={{ marginTop: 8 }}>
            You get a confirmation when <strong>you</strong> publish to Community; everyone else is notified too (except on meet-ups limited to specific people). Replies, DMs, groups, and admin event-wide messages also appear here. Open an item to jump to it — opening this tab marks items as read.
          </p>
          {notifications.length === 0 ? (
            <p className="help-text" style={{ marginTop: 16 }}>
              You&apos;re all caught up.
            </p>
          ) : (
            <ul className="notification-list" style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
              {notifications.map((n) => (
                <li key={n.id} style={{ borderBottom: "1px solid var(--border)", padding: "12px 0" }}>
                  <button
                    type="button"
                    className={`notification-row${n.readAt ? "" : " is-unread"}`}
                    onClick={async () => {
                      if (!n.readAt) {
                        await apiFetch(`/notifications/${n.id}/read`, withEventHeaders({ method: "PATCH" }), token!);
                        setNotifications((prev) =>
                          prev.map((row) => (row.id === n.id ? { ...row, readAt: new Date().toISOString() } : row)),
                        );
                      }
                      if (n.threadId) {
                        setCommunityChannel("ALL");
                        setCommunityFocusThreadId(n.threadId);
                        setActive(COMMUNITY_TAB);
                      } else if (n.conversationId) {
                        setActive("Messages");
                        setActiveConversationId(n.conversationId);
                        apiFetch<Conversation[]>("/conversations", withEventHeaders(), token!)
                          .then(setConversations)
                          .catch(() => null);
                      }
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    <strong style={{ display: "block" }}>{n.title}</strong>
                    {n.body ? (
                      <span className="help-text" style={{ display: "block", marginTop: 4 }}>
                        {n.body}
                      </span>
                    ) : null}
                    <span className="help-text" style={{ display: "block", marginTop: 6, fontSize: 12 }}>
                      {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {active === "Messages" && (
        <div className="grid two messages-layout">
          <div className="card message-sidebar-card">
            <h3 style={{ marginTop: 0 }}>Messages</h3>
            <p className="help-text" style={{ marginTop: 0 }}>
              <strong>Direct:</strong> pick someone below and click <strong>Start chat</strong>, then select their name under &quot;Your chats&quot;.{" "}
              <strong>Everyone — event chat</strong> reaches all attendees; admins can broadcast there. Session Q&amp;A stays on each session page.
            </p>
            <DirectChatForm
              attendees={filteredMessageAttendees}
              currentUserId={user.id}
              token={token!}
              withEventHeaders={withEventHeaders}
              onCreated={(c) => {
                setConversations([c, ...conversations]);
                setActiveConversationId(c.id);
              }}
            />
            <GroupChatForm
              attendees={filteredMessageAttendees}
              currentUserId={user.id}
              token={token!}
              withEventHeaders={withEventHeaders}
              onCreated={(c) => {
                setConversations([c, ...conversations]);
                setActiveConversationId(c.id);
              }}
            />
            <hr style={{ margin: "18px 0", border: 0, borderTop: "1px solid var(--border)" }} />
            <label className="help-text" htmlFor="message-directory-search" style={{ display: "block", marginBottom: 6 }}>
              Filter people and chat names
            </label>
            <input
              id="message-directory-search"
              className="input"
              type="search"
              placeholder="Type a name, email, or topic…"
              value={messageDirectoryQuery}
              onChange={(e) => setMessageDirectoryQuery(e.target.value)}
              aria-label="Search people and conversations"
            />
            <h4 style={{ margin: "16px 0 8px" }}>Your chats</h4>
            <div className="grid" style={{ gap: 8 }}>
              {eventWideConversation ? (
                <button
                  type="button"
                  className={activeConversationId === eventWideConversation.id ? "button" : "button secondary"}
                  onClick={() => setActiveConversationId(eventWideConversation.id)}
                >
                  {formatConversationName(eventWideConversation, user)}
                </button>
              ) : null}
              {filteredDirectAndGroup.map((c) => (
                <button
                  key={c.id}
                  className={activeConversationId === c.id ? "button" : "button secondary"}
                  onClick={() => setActiveConversationId(c.id)}
                  type="button"
                >
                  {formatConversationName(c, user)}
                </button>
              ))}
            </div>
          </div>
          <div
            className="card message-thread-card"
            style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 320 }}
          >
            <div>
              <h3 style={{ margin: 0 }}>
                {activeConversation && user
                  ? formatConversationName(activeConversation, user)
                  : "Choose a conversation"}
              </h3>
              <p className="help-text" style={{ margin: "6px 0 0" }}>
                {activeConversation?.type === "EVENT"
                  ? "Everyone at this event can read and post here. When an admin posts, participants get a notification."
                  : activeConversation?.type === "GROUP"
                    ? "Only people in this group see these messages."
                    : activeConversation
                      ? "Only you and this person are in this thread."
                      : "Select a chat on the left, or start one by choosing a participant."}
              </p>
            </div>
            <div
              className="message-thread-scroll"
              style={{
                flex: 1,
                minHeight: 140,
                maxHeight: 440,
                overflowY: "auto",
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
                padding: "10px 0",
              }}
            >
              {!activeConversationId ? (
                <p className="help-text" style={{ margin: 0 }}>
                  Pick a conversation from the list.
                </p>
              ) : messages.length === 0 ? (
                <p className="help-text" style={{ margin: 0 }}>
                  No messages yet — introduce yourself below.
                </p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
                    <strong>{m.user.name}</strong> <span style={{ color: "var(--ink-500)" }}>({m.user.role})</span>
                    <p style={{ margin: "4px 0" }}>{m.body}</p>
                    <small style={{ color: "var(--ink-500)" }}>{new Date(m.createdAt).toLocaleString()}</small>
                  </div>
                ))
              )}
            </div>
            <MessageComposer
              token={token!}
              conversationId={activeConversationId}
              withEventHeaders={withEventHeaders}
              onSent={async (m) => {
                setMessages([...messages, m]);
                await refreshUser();
                apiFetch<UserNotificationRow[]>("/notifications", withEventHeaders(), token!)
                  .then(setNotifications)
                  .catch(() => null);
              }}
            />
          </div>
        </div>
      )}

      {active === "Profile" && (
        <ProfileEditor
          token={token!}
          user={user}
          adminEvents={adminEvents}
          activeEventId={activeEventId}
          withEventHeaders={withEventHeaders}
          onSaved={(updated) => {
            setUser(updated);
            window.localStorage.setItem("user", JSON.stringify(updated));
            setAttendees((prev) => prev.map((attendee) => (attendee.id === updated.id ? updated : attendee)));
          }}
          onEventSelected={(eventId) => {
            setActiveEventId(eventId);
            window.localStorage.setItem("activeEventId", eventId);
            setActive("Agenda");
          }}
          onEventCreated={(created) => {
            setAdminEvents((prev) => [created, ...prev]);
            setActiveEventId(created.id);
            window.localStorage.setItem("activeEventId", created.id);
            setActive("Agenda");
          }}
        />
      )}

    </div>
  );
}

function ScheduleBoard({
  grouped,
  isAdmin,
  myAttendance,
  likedSessionIds,
  onPatchAttendance,
  onToggleLike,
  onEditSession,
  onGoToSession,
}: {
  grouped: Array<{ dayLabel: string; timeSlots: Array<{ timeLabel: string; sessions: Session[] }> }>;
  isAdmin: boolean;
  myAttendance: SessionAttendance[];
  likedSessionIds: string[];
  onPatchAttendance: (
    sessionId: string,
    body: { status: "JOINING" | "NOT_JOINING"; joinMode?: "VIRTUAL" | "IN_PERSON" },
  ) => void | Promise<void>;
  onToggleLike: (sessionId: string) => void;
  onEditSession: (session: Session) => void;
  onGoToSession: (sessionId: string) => void;
}) {
  const [agendaModalSessionId, setAgendaModalSessionId] = useState<string | null>(null);

  if (grouped.length === 0) {
    return <p style={{ color: "var(--ink-500)" }}>No sessions in this view yet.</p>;
  }

  return (
    <>
      {grouped.map((dayGroup) => (
        <section key={dayGroup.dayLabel} className="schedule-day">
          <h3 className="schedule-day-heading">{dayGroup.dayLabel}</h3>
          {dayGroup.timeSlots.map((slot) => (
            <div key={`${dayGroup.dayLabel}-${slot.timeLabel}`} className="schedule-slot">
              <div className="schedule-time">{slot.timeLabel}</div>
              <div className="schedule-events">
                {slot.sessions.map((s) => {
                  const myRow = myAttendance.find((item) => item.sessionId === s.id);
                  const myStatus = myRow?.status;
                  const joiningList = (s.attendances || []).filter((attendance) => attendance.status === "JOINING");
                  const joinedCount = joiningList.length;
                  const virtualJoining = joiningList.filter((a) => a.joinMode === "VIRTUAL").length;
                  const inPersonJoining = joinedCount - virtualJoining;
                  const liked = likedSessionIds.includes(s.id);
                  const likeCount = (s.likes || []).length;
                  const joining = myStatus === "JOINING";
                  const myMode = myRow?.joinMode ?? "IN_PERSON";
                  return (
                    <article
                      className="schedule-event"
                      key={s.id}
                      title={s.description || "No session description yet."}
                      onClick={() => onGoToSession(s.id)}
                    >
                      <div className="schedule-event-head">
                        {s.imageUrl && (
                          <img src={s.imageUrl} alt="" className="schedule-thumb" />
                        )}
                        <h4>{s.title}</h4>
                      </div>
                      {(s.speakers || s.speaker?.name) && <div className="schedule-speaker">{s.speakers || s.speaker?.name}</div>}
                      {s.location && <div className="schedule-speaker">Location: {s.location}</div>}
                      <div className="schedule-links">
                        {s.zoomLink && (
                          <OnlineMeetingLink href={s.zoomLink} onClick={(event) => event.stopPropagation()} />
                        )}
                        {s.recordingUrl && <a href={s.recordingUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Recording</a>}
                        {s.fileLink && <a href={s.fileLink} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Resources</a>}
                        {s.fileUrl && <a href={s.fileUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Uploaded File</a>}
                      </div>
                      <div className="schedule-meta">
                        <span>
                          {formatTimeRange(s.startsAt, s.endsAt)}
                          {" · "}
                          {inPersonJoining} in-person · {virtualJoining} virtual · {likeCount} likes
                        </span>
                        <div className="schedule-actions schedule-actions-with-attendance">
                          <div onClick={(event) => event.stopPropagation()} role="group" aria-label="My agenda">
                            {!joining ? (
                              <button
                                type="button"
                                className="agenda-add-my-btn"
                                onClick={() => setAgendaModalSessionId(s.id)}
                              >
                                <span aria-hidden style={{ fontSize: 18 }}>
                                  &#128197;
                                </span>
                                <span>Add to my agenda</span>
                                <span className="sub">In person or virtual</span>
                              </button>
                            ) : (
                              <div className="session-attendance-block">
                                <span className="attendance-join-text">
                                  On my agenda · {myMode === "VIRTUAL" ? "Virtual" : "In person"}
                                </span>
                                <div className="join-mode-switch" role="group" aria-label="Attendance mode">
                                  <button
                                    type="button"
                                    className={myMode === "VIRTUAL" ? "is-active" : ""}
                                    onClick={() => onPatchAttendance(s.id, { status: "JOINING", joinMode: "VIRTUAL" })}
                                  >
                                    Virtual
                                  </button>
                                  <button
                                    type="button"
                                    className={myMode === "IN_PERSON" ? "is-active" : ""}
                                    onClick={() => onPatchAttendance(s.id, { status: "JOINING", joinMode: "IN_PERSON" })}
                                  >
                                    In person
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  className="button secondary"
                                  onClick={() => onPatchAttendance(s.id, { status: "NOT_JOINING" })}
                                >
                                  Remove
                                </button>
                              </div>
                            )}
                          </div>
                          <button className="button secondary" type="button" onClick={(event) => { event.stopPropagation(); onGoToSession(s.id); }}>Session Q&amp;A</button>
                          <button className={`button ${liked ? "" : "secondary"}`} type="button" onClick={(event) => { event.stopPropagation(); onToggleLike(s.id); }}>
                            Like
                          </button>
                          {isAdmin && (
                            <button className="button secondary" type="button" onClick={(event) => { event.stopPropagation(); onEditSession(s); }}>Edit</button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ))}
      {agendaModalSessionId && (
        <div
          className="agenda-add-modal-overlay"
          role="presentation"
          onClick={() => setAgendaModalSessionId(null)}
        >
          <div
            className="agenda-add-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agenda-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="agenda-modal-title">Add to my agenda</h4>
            <p className="help-text" style={{ marginTop: 0 }}>
              Choose how you plan to join this session. You can change this later from the agenda card.
            </p>
            <div className="agenda-add-modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  const id = agendaModalSessionId;
                  setAgendaModalSessionId(null);
                  if (id) void onPatchAttendance(id, { status: "JOINING", joinMode: "IN_PERSON" });
                }}
              >
                In person
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  const id = agendaModalSessionId;
                  setAgendaModalSessionId(null);
                  if (id) void onPatchAttendance(id, { status: "JOINING", joinMode: "VIRTUAL" });
                }}
              >
                Virtually
              </button>
              <button type="button" className="button secondary" onClick={() => setAgendaModalSessionId(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ParticipantDailySchedules({
  groupedAgenda,
}: {
  groupedAgenda: Array<{ dayLabel: string; timeSlots: Array<{ timeLabel: string; sessions: Session[] }> }>;
}) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Participant Schedules By Day</h3>
      {groupedAgenda.map((day) => (
        <div key={day.dayLabel} style={{ marginBottom: 18 }}>
          <strong>{day.dayLabel}</strong>
          {day.timeSlots.map((slot) => (
            <div key={`${day.dayLabel}-${slot.timeLabel}`} style={{ marginTop: 10 }}>
              <div style={{ color: "var(--ink-500)", fontWeight: 600 }}>{slot.timeLabel}</div>
              {slot.sessions.map((session) => (
                <div key={session.id} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                  <div style={{ fontWeight: 600 }}>{session.title}</div>
                  <div style={{ color: "var(--ink-700)" }}>
                    {(session.attendances || []).filter((attendance) => attendance.status === "JOINING").length > 0
                      ? `Participants: ${(session.attendances || [])
                          .filter((attendance) => attendance.status === "JOINING")
                          .map((attendance) => {
                            const tag = attendance.joinMode === "VIRTUAL" ? " (virtual)" : "";
                            return `${attendance.user.name}${tag}`;
                          })
                          .join(", ")}`
                      : "No participants added yet"}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AdminParticipantInviteCard({
  token,
  withEventHeaders,
  activeEventId,
  eventSlug,
  onInvited,
}: {
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  activeEventId: string | null;
  eventSlug: string | null;
  onInvited?: () => void | Promise<void>;
}) {
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const canInvite = Boolean(activeEventId);

  return (
    <div className="admin-invite-card" style={{ marginBottom: 20 }}>
      <h4 style={{ marginTop: 0 }}>Invite one person</h4>
      {!canInvite ? (
        <p className="help-text" style={{ marginTop: 0, color: "#b42318", fontWeight: 600 }}>
          No active event is selected. Open <strong>Profile</strong>, scroll to <strong>My Events</strong>, and click your event. Then return here to send invites.
        </p>
      ) : null}
      <p className="help-text" style={{ marginTop: 0 }}>
        Add name, email, photo, and description. We create their account and email a setup link (configure{" "}
        <code>RESEND_API_KEY</code> on the API). If email isn&apos;t configured, copy the invite URL from the success message or server logs.
      </p>
      {eventSlug ? (
        <p className="help-text" style={{ margin: "0 0 8px" }}>
          Public join link for this event:{" "}
          <strong>{typeof window !== "undefined" ? `${window.location.origin}/e/${eventSlug}` : `/e/${eventSlug}`}</strong>
        </p>
      ) : null}
      <form
        className="grid"
        style={{ gap: 8 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canInvite) return;
          setInviteBusy(true);
          setInviteError(null);
          setInviteMessage(null);
          const form = new FormData(e.currentTarget);
          try {
            const res = await apiFetch<{ inviteUrl: string }>(
              "/attendees/invite",
              withEventHeaders({
                method: "POST",
                body: JSON.stringify({
                  email: String(form.get("inviteEmail") || "").trim(),
                  name: String(form.get("inviteName") || "").trim(),
                  researchInterests: String(form.get("inviteBio") || "").trim() || undefined,
                  photoUrl: String(form.get("invitePhotoUrl") || "").trim() || undefined,
                }),
              }),
              token,
            );
            setInviteMessage(`Invite sent. Link (also in email): ${res.inviteUrl}`);
            e.currentTarget.reset();
            await onInvited?.();
          } catch (err) {
            setInviteError(err instanceof Error ? err.message : "Invite failed.");
          } finally {
            setInviteBusy(false);
          }
        }}
      >
        <input className="input" name="inviteEmail" type="email" placeholder="Email" required disabled={!canInvite || inviteBusy} />
        <input className="input" name="inviteName" placeholder="Display name" required disabled={!canInvite || inviteBusy} />
        <textarea
          className="textarea"
          name="inviteBio"
          placeholder="Description / research interests (optional)"
          rows={3}
          disabled={!canInvite || inviteBusy}
        />
        <input className="input" name="invitePhotoUrl" placeholder="Photo URL or leave blank" disabled={!canInvite || inviteBusy} />
        <input
          className="input"
          type="file"
          accept="image/*"
          disabled={!canInvite || inviteBusy}
          onChange={async (ev) => {
            const file = ev.currentTarget.files?.[0];
            if (!file) return;
            const data = await fileToDataUrl(file, { maxWidth: 800, maxHeight: 800, quality: 0.82 });
            const target = ev.currentTarget.form?.elements.namedItem("invitePhotoUrl");
            if (target instanceof HTMLInputElement) target.value = data;
          }}
        />
        <button className="button secondary" type="submit" disabled={!canInvite || inviteBusy}>
          {inviteBusy ? "Sending…" : "Create profile & send invite"}
        </button>
        {inviteMessage && <p className="help-text" style={{ color: "#0f7b3d", margin: 0 }}>{inviteMessage}</p>}
        {inviteError && <p className="help-text" style={{ color: "#b42318", margin: 0 }}>{inviteError}</p>}
      </form>
    </div>
  );
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

type ParsedInviteRow = { email: string; name: string; researchInterests?: string; photoUrl?: string };

function parseParticipantInviteCsv(text: string): { ok: true; rows: ParsedInviteRow[] } | { ok: false; error: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { ok: false, error: "Add a header row plus at least one participant row." };
  }
  const header = parseCsvLine(lines[0]).map((h) =>
    h
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_"),
  );
  const emailIdx = header.findIndex((h) => h === "email" || h === "e-mail" || h === "e_mail");
  const nameIdx = header.findIndex((h) =>
    ["name", "full_name", "display_name", "participant", "participant_name"].includes(h),
  );
  if (emailIdx < 0 || nameIdx < 0) {
    return {
      ok: false,
      error:
        'The first row must include columns "email" and "name". Optional columns: description (or bio, research_interests), photo_url.',
    };
  }
  const descIdx = header.findIndex((h) =>
    ["description", "bio", "research_interests", "research", "notes", "details"].includes(h),
  );
  const photoIdx = header.findIndex((h) => ["photo_url", "photo", "image_url", "avatar"].includes(h));

  const rows: ParsedInviteRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const email = (cells[emailIdx] || "").trim();
    const name = (cells[nameIdx] || "").trim();
    if (!email && !name) continue;
    if (!email || !name) {
      return { ok: false, error: `Row ${i + 1}: both email and name are required.` };
    }
    const row: ParsedInviteRow = { email, name };
    if (descIdx >= 0) {
      const d = (cells[descIdx] || "").trim();
      if (d) row.researchInterests = d;
    }
    if (photoIdx >= 0) {
      const p = (cells[photoIdx] || "").trim();
      if (p) row.photoUrl = p;
    }
    rows.push(row);
  }
  if (rows.length === 0) {
    return { ok: false, error: "No data rows found under the header." };
  }
  if (rows.length > 200) {
    return { ok: false, error: "Maximum 200 rows per upload. Split into multiple CSV files." };
  }
  return { ok: true, rows };
}

function BulkInviteCsvCard({
  token,
  withEventHeaders,
  activeEventId,
  onDone,
}: {
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  activeEventId: string | null;
  onDone?: () => void | Promise<void>;
}) {
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkParseError, setBulkParseError] = useState<string | null>(null);
  const [bulkRows, setBulkRows] = useState<ParsedInviteRow[] | null>(null);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const canInvite = Boolean(activeEventId);

  function downloadExampleCsv() {
    const csv = `email,name,description,photo_url
colleague@university.edu,Jane Participant,Optional bio text,
other@university.edu,John Example,,
`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "participant-invites-example.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="admin-bulk-invite-card">
      <hr style={{ margin: "0 0 20px", border: 0, borderTop: "1px solid var(--border)" }} />
      <h4 style={{ marginTop: 0 }}>Bulk invite from spreadsheet</h4>
      <p className="help-text" style={{ marginTop: 0 }}>
        Upload a <strong>CSV</strong> file (export from Excel or Google Sheets). Each row becomes one invite email with the same
        setup flow as above. Duplicate emails in the file are only sent once.
      </p>
      <button type="button" className="button secondary" style={{ marginBottom: 8 }} onClick={downloadExampleCsv}>
        Download example CSV
      </button>
      <input
        className="input"
        type="file"
        accept=".csv,text/csv"
        disabled={!canInvite || bulkBusy}
        onChange={async (ev) => {
          setBulkParseError(null);
          setBulkRows(null);
          setBulkResult(null);
          const file = ev.target.files?.[0];
          if (!file) return;
          const text = await file.text();
          const parsed = parseParticipantInviteCsv(text);
          if (!parsed.ok) {
            setBulkParseError(parsed.error);
            return;
          }
          setBulkRows(parsed.rows);
        }}
      />
      {bulkParseError ? (
        <p className="help-text" style={{ color: "#b42318", margin: "8px 0 0" }}>
          {bulkParseError}
        </p>
      ) : null}
      {bulkRows ? (
        <p className="help-text" style={{ margin: "8px 0 0" }}>
          Ready to invite <strong>{bulkRows.length}</strong> people (after removing duplicate emails).
        </p>
      ) : null}
      <button
        type="button"
        className="button"
        style={{ marginTop: 10 }}
        disabled={!canInvite || bulkBusy || !bulkRows?.length}
        onClick={async () => {
          if (!bulkRows?.length || !canInvite) return;
          setBulkBusy(true);
          setBulkResult(null);
          try {
            const res = await apiFetch<{
              sentCount: number;
              failedCount: number;
              failed: { email: string; error: string }[];
            }>(
              "/attendees/invite-bulk",
              withEventHeaders({
                method: "POST",
                body: JSON.stringify({ invites: bulkRows }),
              }),
              token,
            );
            const failedLines =
              res.failed?.map((f) => `${f.email}: ${f.error}`).join("; ") || "";
            setBulkResult(
              `Sent ${res.sentCount} invite(s). ${res.failedCount ? `Could not send ${res.failedCount}: ${failedLines}` : "All rows processed."}`,
            );
            setBulkRows(null);
            await onDone?.();
          } catch (err) {
            setBulkResult(err instanceof Error ? err.message : "Bulk invite failed.");
          } finally {
            setBulkBusy(false);
          }
        }}
      >
        {bulkBusy ? "Sending invites…" : "Send all invites from CSV"}
      </button>
      {bulkResult ? <p className="help-text" style={{ margin: "10px 0 0" }}>{bulkResult}</p> : null}
    </div>
  );
}

function ProfileEditor({
  token,
  user,
  adminEvents,
  activeEventId,
  withEventHeaders,
  onSaved,
  onEventSelected,
  onEventCreated,
}: {
  token: string;
  user: User;
  adminEvents: EventItem[];
  activeEventId: string | null;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onSaved: (user: User) => void;
  onEventSelected: (eventId: string) => void;
  onEventCreated: (event: EventItem) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(user.photoUrl || null);
  const [name, setName] = useState(user.name);
  const [researchInterests, setResearchInterests] = useState(user.researchInterests || "");
  const [participantType, setParticipantType] = useState<"GRAD_STUDENT" | "PROFESSOR" | "">(
    user.participantType || "",
  );
  const [resettingEngagement, setResettingEngagement] = useState(false);

  useEffect(() => {
    setPhotoPreview(user.photoUrl || null);
    setName(user.name);
    setResearchInterests(user.researchInterests || "");
    setParticipantType(user.participantType || "");
  }, [user]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSaveError(null);
    try {
      const dataUrl = await fileToDataUrl(file, { maxWidth: 800, maxHeight: 800, quality: 0.82 });
      setPhotoPreview(dataUrl);
    } catch {
      setSaveError("That image could not be processed. Please try a smaller JPG or PNG.");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = {
      name: name.trim(),
      researchInterests,
      photoUrl: photoPreview || undefined,
      participantType: participantType || null,
    };
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const updated = await apiFetch<User>("/auth/me/profile", {
        method: "PUT",
        body: JSON.stringify(payload),
      }, token);
      onSaved(updated);
      setSaveSuccess("Profile saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save profile.";
      setSaveError(message.includes("photoUrl") ? "The selected image is too large. Please choose a smaller one." : "Unable to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const createEvent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("eventName") || ""),
      bannerUrl: String(form.get("eventBannerUrl") || ""),
      logoUrl: String(form.get("eventLogoUrl") || "").trim() || undefined,
      timezone: String(form.get("timezone") || "UTC"),
      startDate: new Date(String(form.get("startDate") || "")).toISOString(),
      endDate: new Date(String(form.get("endDate") || "")).toISOString(),
    };
    const created = await apiFetch<EventItem>("/event", {
      method: "POST",
      body: JSON.stringify(payload),
    }, token);
    onEventCreated(created);
    event.currentTarget.reset();
  };

  return (
    <form className="card grid" onSubmit={handleSubmit}>
      <h3 style={{ marginTop: 0 }}>My Profile</h3>
      {photoPreview && <img src={photoPreview} alt={user.name} className="avatar avatar-large" />}
      <input className="input" name="photo" type="file" accept="image/*" onChange={handleFileChange} />
      <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
      <div className="profile-choice-group" role="group" aria-label="Participant type">
        <label className="profile-choice">
          <input
            type="radio"
            name="participantType"
            value="GRAD_STUDENT"
            checked={participantType === "GRAD_STUDENT"}
            onChange={() => setParticipantType("GRAD_STUDENT")}
          />
          Grad Student
        </label>
        <label className="profile-choice">
          <input
            type="radio"
            name="participantType"
            value="PROFESSOR"
            checked={participantType === "PROFESSOR"}
            onChange={() => setParticipantType("PROFESSOR")}
          />
          Professor
        </label>
      </div>
      <textarea
        className="textarea"
        name="researchInterests"
        value={researchInterests}
        onChange={(e) => setResearchInterests(e.target.value)}
        placeholder="Research interests, projects, and topics you care about"
        rows={5}
      />
      {saveError && <p className="help-text" style={{ color: "#b42318", margin: 0 }}>{saveError}</p>}
      {saveSuccess && <p className="help-text" style={{ color: "#0f7b3d", margin: 0 }}>{saveSuccess}</p>}
      <button className="button" type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save Profile"}
      </button>
      {user.role === "ADMIN" && (
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <h4 style={{ marginTop: 0 }}>Engagement points</h4>
          <p className="help-text" style={{ marginTop: 0 }}>
            If your score is inflated from testing the app, you can reset <strong>your own</strong> points to zero. This only affects your account.
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={resettingEngagement}
            onClick={async () => {
              if (!window.confirm("Reset your engagement points to zero?")) return;
              setResettingEngagement(true);
              setSaveError(null);
              setSaveSuccess(null);
              try {
                const updated = await apiFetch<User>("/auth/me/reset-engagement", { method: "POST" }, token);
                onSaved(updated);
                window.localStorage.setItem("user", JSON.stringify(updated));
                setSaveSuccess("Engagement points reset to zero.");
              } catch (e) {
                setSaveError(e instanceof Error ? e.message : "Could not reset points.");
              } finally {
                setResettingEngagement(false);
              }
            }}
          >
            {resettingEngagement ? "Resetting…" : "Reset my points to zero"}
          </button>
        </div>
      )}
      {user.role === "ADMIN" && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ marginTop: 0 }}>My Events</h4>
          <div className="grid" style={{ gap: 8, marginBottom: 12 }}>
            {adminEvents.map((eventItem) => (
              <button
                key={eventItem.id}
                type="button"
                className={activeEventId === eventItem.id ? "button" : "button secondary"}
                onClick={() => onEventSelected(eventItem.id)}
              >
                {eventItem.name}
              </button>
            ))}
          </div>
          <form className="grid" onSubmit={createEvent}>
            <input className="input" name="eventName" placeholder="New event name" required />
            <input className="input" name="eventLogoUrl" placeholder="Header logo URL (optional)" />
            <input
              className="input"
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const data = await fileToDataUrl(file, { maxWidth: 512, maxHeight: 512, quality: 0.88 });
                const el = e.currentTarget.form?.elements.namedItem("eventLogoUrl");
                if (el instanceof HTMLInputElement) el.value = data;
              }}
            />
            <input className="input" name="eventBannerUrl" placeholder="Banner URL (optional)" />
            <input
              className="input"
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const data = await fileToDataUrl(file, { maxWidth: 1920, maxHeight: 720, quality: 0.82 });
                const el = e.currentTarget.form?.elements.namedItem("eventBannerUrl");
                if (el instanceof HTMLInputElement) el.value = data;
              }}
            />
            <input className="input" name="timezone" placeholder="Timezone (e.g. America/New_York)" required />
            <input className="input" type="datetime-local" name="startDate" required />
            <input className="input" type="datetime-local" name="endDate" required />
            <button className="button" type="submit">Create Event</button>
          </form>
        </div>
      )}
    </form>
  );
}

function SessionForm({
  token,
  eventHeaders,
  attendees,
  editing,
  onSaved,
  onCancel,
}: {
  token: string;
  eventHeaders: (extra?: RequestInit) => RequestInit;
  attendees: User[];
  editing: Session | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const form = new FormData(event.currentTarget);
      const payload = {
        title: String(form.get("title") || ""),
        description: String(form.get("description") || ""),
        location: String(form.get("location") || ""),
        speakers: String(form.get("speakers") || ""),
        imageUrl: String(form.get("imageUrl") || ""),
        zoomLink: String(form.get("zoomLink") || ""),
        recordingUrl: String(form.get("recordingUrl") || ""),
        fileLink: String(form.get("fileLink") || ""),
        fileUrl: String(form.get("fileUrl") || ""),
        startsAt: new Date(String(form.get("startsAt") || "")).toISOString(),
        endsAt: new Date(String(form.get("endsAt") || "")).toISOString(),
        speakerId: String(form.get("speakerId") || "") || undefined,
      };

      if (editing) {
        await apiFetch(`/sessions/${editing.id}`, eventHeaders({ method: "PUT", body: JSON.stringify(payload) }), token);
      } else {
        await apiFetch("/sessions", eventHeaders({ method: "POST", body: JSON.stringify(payload) }), token);
      }

      if (!editing) event.currentTarget.reset();
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  const defaultStart = editing?.startsAt ? toLocalInputValue(editing.startsAt) : "";
  const defaultEnd = editing?.endsAt ? toLocalInputValue(editing.endsAt) : "";
  const removeSession = async () => {
    if (!editing) return;
    if (!window.confirm("Delete this session? This cannot be undone.")) return;
    try {
      await apiFetch(`/sessions/${editing.id}`, eventHeaders({ method: "DELETE" }), token);
      onSaved();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not delete session.");
    }
  };

  return (
    <form className="card grid" onSubmit={handleSubmit}>
      <h3>{editing ? "Edit session" : "New session"}</h3>
      <input className="input" name="title" placeholder="Session title" required defaultValue={editing?.title || ""} />
      <textarea className="textarea" name="description" placeholder="Description" defaultValue={editing?.description || ""} />
      <input className="input" name="location" placeholder="Location" defaultValue={editing?.location || ""} />
      <label className="help-text" style={{ margin: 0 }}>
        Session image or icon (URL or upload)
      </label>
      <input className="input" name="imageUrl" placeholder="Image URL" defaultValue={editing?.imageUrl || ""} />
      <input
        className="input"
        type="file"
        accept="image/*"
        onChange={async (ev) => {
          const file = ev.target.files?.[0];
          if (!file) return;
          const data = await fileToDataUrl(file);
          const target = ev.currentTarget.form?.elements.namedItem("imageUrl");
          if (target instanceof HTMLInputElement) target.value = data;
        }}
      />
      <label className="help-text" style={{ margin: 0 }}>
        Speaker names (free text — use for guests who are not in the directory)
      </label>
      <input className="input" name="speakers" placeholder="e.g. Dr. Jane Smith, keynote panel…" defaultValue={editing?.speakers || ""} />
      <label className="help-text" style={{ margin: 0 }}>
        Or link a registered participant as primary speaker
      </label>
      <select className="select" name="speakerId" defaultValue={editing?.speakerId || ""}>
        <option value="">No linked directory speaker</option>
        {attendees.map((a) => (
          <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
        ))}
      </select>
      <input
        className="input"
        name="zoomLink"
        placeholder="Online meeting link (Zoom, Google Meet, Teams, etc.)"
        defaultValue={editing?.zoomLink || ""}
      />
      <label className="help-text" style={{ margin: 0 }}>Recording (URL or upload)</label>
      <input className="input" name="recordingUrl" placeholder="Recording URL" defaultValue={editing?.recordingUrl || ""} />
      <input
        className="input"
        type="file"
        accept="audio/*,video/*"
        onChange={async (ev) => {
          const file = ev.target.files?.[0];
          if (!file) return;
          const data = await fileToDataUrl(file);
          const target = ev.currentTarget.form?.elements.namedItem("recordingUrl");
          if (target instanceof HTMLInputElement) target.value = data;
        }}
      />
      <input className="input" name="fileLink" placeholder="Presentation or resource link" defaultValue={editing?.fileLink || ""} />
      <textarea className="textarea" name="fileUrl" placeholder="Optional materials upload (filled automatically)" defaultValue={editing?.fileUrl || ""} />
      <input
        className="input"
        type="file"
        accept="audio/*,video/*,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,image/*"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const data = await fileToDataUrl(file);
          const target = event.currentTarget.form?.elements.namedItem("fileUrl");
          if (target instanceof HTMLTextAreaElement) {
            target.value = data;
          }
        }}
      />
      <input className="input" type="datetime-local" name="startsAt" required defaultValue={defaultStart} />
      <input className="input" type="datetime-local" name="endsAt" required defaultValue={defaultEnd} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="button" type="submit" disabled={submitting}>
          {submitting ? "Saving…" : editing ? "Save changes" : "Create session"}
        </button>
        {editing && (
          <>
            <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
            <button className="button secondary" type="button" onClick={removeSession}>Delete Session</button>
          </>
        )}
      </div>
    </form>
  );
}

function AttendeeAvatar({ photoUrl, name }: { photoUrl?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const showImg = Boolean(photoUrl) && !failed;
  return showImg ? (
    <img
      src={photoUrl!}
      alt={`${name} profile`}
      className="attendee-avatar"
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="attendee-avatar attendee-avatar-placeholder" aria-hidden>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function AttendeeDirectory({
  attendees,
  currentUserId,
  onMessage,
}: {
  attendees: User[];
  currentUserId: string;
  onMessage: (userId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = [...attendees].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    return list.filter((a) => {
      const hay = `${a.name} ${a.email} ${a.researchInterests || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [attendees, q]);

  let lastLetter = "";
  const rows = filtered.map((a) => {
    const initial = (a.name.trim()[0] || "#").toUpperCase();
    const letter = /[A-Z]/.test(initial) ? initial : "#";
    const isNewLetter = letter !== lastLetter;
    if (isNewLetter) lastLetter = letter;
    return (
      <div
        className="attendee-row"
        key={a.id}
        id={isNewLetter ? `attendee-letter-${letter}` : undefined}
      >
        <div className="attendee-avatar-wrap">
          <AttendeeAvatar photoUrl={a.photoUrl} name={a.name} />
          <span className={`attendee-role-badge role-${a.role.toLowerCase()}`}>{a.role}</span>
        </div>
        <div className="attendee-body">
          <div className="attendee-name">{a.name}</div>
          <div className="attendee-meta">{a.email}</div>
          {a.participantType && (
            <div className="attendee-meta attendee-role-note">
              {a.participantType === "GRAD_STUDENT" ? "Grad Student" : "Professor"}
            </div>
          )}
          {a.researchInterests && (
            <div className="attendee-meta attendee-research">{a.researchInterests}</div>
          )}
        </div>
        {a.id !== currentUserId ? (
          <button className="button attendee-msg-btn" type="button" onClick={() => onMessage(a.id)}>
            Message
          </button>
        ) : (
          <span className="help-text">You</span>
        )}
      </div>
    );
  });

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  return (
    <div className="attendee-directory card">
      <div className="attendee-directory-toolbar">
        <input
          className="input attendee-search"
          type="search"
          placeholder="Search by name, email, or research interests"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search attendees"
        />
        <div className="attendee-index" aria-label="Jump to letter">
          {letters.map((L) => (
            <button
              key={L}
              type="button"
              className="attendee-index-letter"
              onClick={() => document.getElementById(`attendee-letter-${L}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              {L}
            </button>
          ))}
        </div>
      </div>
      <div className="attendee-rows">{rows}</div>
    </div>
  );
}

function networkThreadChannelKey(ch: string | undefined): CommunityPillKey {
  if (ch === "MEETUP" || ch === "MOMENTS" || ch === "LOCAL" || ch === "ICEBREAKER" || ch === "GENERAL") {
    return ch;
  }
  return "GENERAL";
}

function ensureHttpUrl(url: string): string {
  const t = url.trim();
  if (!t) return t;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function threadImageGallery(t: NetworkThread): string[] {
  const fromList = [...(t.imageUrls ?? [])].filter(Boolean);
  if (t.imageUrl && !fromList.includes(t.imageUrl)) {
    return [t.imageUrl, ...fromList];
  }
  return fromList.length ? fromList : t.imageUrl ? [t.imageUrl] : [];
}

function CommunityBoard({
  threads,
  channelFilter,
  onChannelChange,
  isAdmin,
  currentUserId,
  attendees,
  focusThreadId,
  onFocusThreadConsumed,
  token,
  withEventHeaders,
  onThreadsUpdated,
}: {
  threads: NetworkThread[];
  channelFilter: CommunityChannelFilter;
  onChannelChange: (c: CommunityChannelFilter) => void;
  isAdmin: boolean;
  currentUserId: string;
  attendees: User[];
  focusThreadId: string | null;
  onFocusThreadConsumed: () => void;
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onThreadsUpdated: () => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(threads[0]?.id ?? null);
  const [composeChannel, setComposeChannel] = useState<Exclude<CommunityChannelFilter, "ALL">>("GENERAL");
  const [meetupInviteEveryone, setMeetupInviteEveryone] = useState(false);
  const [meetupParticipantIds, setMeetupParticipantIds] = useState<string[]>([]);
  const [meetupComposeMode, setMeetupComposeMode] = useState<"IN_PERSON" | "VIRTUAL">("IN_PERSON");
  const [momentImageUrls, setMomentImageUrls] = useState<string[]>([]);
  const [taggedUserIds, setTaggedUserIds] = useState<string[]>([]);
  const [postingThread, setPostingThread] = useState(false);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);

  const nameById = useMemo(() => Object.fromEntries(attendees.map((a) => [a.id, a.name])), [attendees]);

  useEffect(() => {
    if (channelFilter === "ALL") {
      setComposeChannel("GENERAL");
    } else {
      setComposeChannel(channelFilter);
    }
  }, [channelFilter]);

  useEffect(() => {
    if (!focusThreadId) return;
    setOpenId(focusThreadId);
    requestAnimationFrame(() => {
      document.getElementById(`network-thread-${focusThreadId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    onFocusThreadConsumed();
  }, [focusThreadId, onFocusThreadConsumed]);

  async function createThread(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (postingThread) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const body = String(form.get("body") || "").trim();
    const payload: Record<string, unknown> = {
      title,
      body,
      channel: composeChannel,
    };
    if (composeChannel === "MEETUP") {
      payload.meetupMode = meetupComposeMode;
      const start = String(form.get("meetupStartsAt") || "").trim();
      if (start) {
        payload.meetupStartsAt = new Date(start).toISOString();
      }
      payload.meetupInviteEveryone = meetupInviteEveryone;
      if (!meetupInviteEveryone) {
        payload.meetupParticipantIds = meetupParticipantIds;
      }
      if (meetupComposeMode === "VIRTUAL") {
        const link = String(form.get("meetupMeetingUrl") || "").trim();
        if (!link) {
          window.alert("Add a video link for virtual meet-ups (Zoom, Google Meet, Teams, etc.).");
          return;
        }
        payload.meetupMeetingUrl = link;
      }
    }
    if (composeChannel === "MOMENTS") {
      const img = String(form.get("imageUrl") || "").trim();
      const urls = [...momentImageUrls];
      if (img) urls.push(img);
      if (urls.length) payload.imageUrls = urls.slice(0, 12);
      if (taggedUserIds.length) payload.taggedUserIds = taggedUserIds;
    }
    if (composeChannel === "LOCAL") {
      const maps = String(form.get("mapsUrl") || "").trim();
      if (maps) payload.mapsUrl = maps;
    }
    if (composeChannel === "MEETUP" && !meetupInviteEveryone && meetupParticipantIds.length === 0) {
      window.alert("Add at least one participant, or choose Invite everyone.");
      return;
    }
    setPostingThread(true);
    try {
      await apiFetch("/network/threads", withEventHeaders({ method: "POST", body: JSON.stringify(payload) }), token);
      event.currentTarget.reset();
      setMeetupInviteEveryone(false);
      setMeetupParticipantIds([]);
      setMeetupComposeMode("IN_PERSON");
      setMomentImageUrls([]);
      setTaggedUserIds([]);
      await onThreadsUpdated();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not create post.");
    } finally {
      setPostingThread(false);
    }
  }

  async function sendReply(threadId: string, body: string) {
    if (!body.trim()) return;
    await apiFetch(
      `/network/threads/${threadId}/replies`,
      withEventHeaders({ method: "POST", body: JSON.stringify({ body }) }),
      token,
    );
    await onThreadsUpdated();
  }

  async function deleteThread(threadId: string) {
    await apiFetch(`/network/threads/${threadId}`, withEventHeaders({ method: "DELETE" }), token);
    if (openId === threadId) setOpenId(null);
    await onThreadsUpdated();
  }

  const pills: { key: CommunityChannelFilter; label: string }[] = [
    { key: "ALL", label: "All" },
    { key: "MEETUP", label: "Meet-ups" },
    { key: "MOMENTS", label: "Share your moments" },
    { key: "LOCAL", label: "Local recommendations" },
    { key: "ICEBREAKER", label: "Break the ice" },
    { key: "GENERAL", label: "General" },
  ];

  const composeHint =
    composeChannel === "MEETUP"
      ? "Propose a meet-up and invite specific people, or open it to everyone at this event."
      : composeChannel === "MOMENTS"
        ? "Upload one or more photos, tag people from the directory, and add a caption."
        : composeChannel === "LOCAL"
          ? "Recommend a place and paste a Google Maps link so others can open it in Maps."
          : composeChannel === "ICEBREAKER"
            ? "Welcome others — share a quick intro or icebreaker prompt."
            : "Open discussion for everyone at this event.";

  return (
    <>
      {channelFilter === "ICEBREAKER" && (
        <div className="icebreaker-hero-strip card">
          <div className="icebreaker-hero-copy">
            <strong>Break the ice</strong>
            <p className="help-text" style={{ margin: "6px 0 0" }}>
              Welcome others with a short intro or icebreaker question.
            </p>
          </div>
          <div className="icebreaker-hero-art">
            <img
              src="/community/icebreaker-hero.png"
              alt="Friendly polar bears breaking the ice — share a quick intro and welcome others"
              className="icebreaker-hero-img"
            />
          </div>
        </div>
      )}
      <div className="grid networking-board">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Community</h3>
        <p className="help-text" style={{ marginTop: 0 }}>
          Meet-ups, moments, local tips, and introductions — Whova-style spaces for your event. Session-specific Q&amp;A stays on each session page.
        </p>
        <div className="community-subnav" role="tablist" aria-label="Community areas">
          {pills.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={channelFilter === p.key}
              className={channelFilter === p.key ? "is-active" : ""}
              onClick={() => onChannelChange(p.key)}
            >
              <span className="community-pill-inner">
                <CommunityPillIcon channel={p.key} />
                <span>{p.label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <form className="card grid" onSubmit={createThread}>
        <h4 style={{ margin: 0 }}>New post</h4>
        <p className="help-text" style={{ margin: 0 }}>
          {composeHint}
        </p>
        {channelFilter === "ALL" && (
          <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
            Post in
            <select
              className="select"
              value={composeChannel}
              onChange={(e) => setComposeChannel(e.target.value as typeof composeChannel)}
            >
              <option value="GENERAL">General discussion</option>
              <option value="MEETUP">Meet-up</option>
              <option value="MOMENTS">Share your moments</option>
              <option value="LOCAL">Local recommendations</option>
              <option value="ICEBREAKER">Break the ice</option>
            </select>
          </label>
        )}
        <input className="input" name="title" placeholder="Title" required />
        <textarea className="textarea" name="body" placeholder="Description or message" required rows={4} />
        {composeChannel === "LOCAL" && (
          <>
            <input
              className="input"
              name="mapsUrl"
              placeholder="Google Maps link (Share → Copy link from the Maps app or website)"
            />
            <button
              type="button"
              className="button secondary"
              onClick={(e) => {
                const form = e.currentTarget.closest("form");
                const titleInput = form?.querySelector<HTMLInputElement>('input[name="title"]');
                const q = (titleInput?.value || "").trim() || (form?.querySelector<HTMLTextAreaElement>("textarea[name=\"body\"]")?.value || "").trim();
                if (!q) {
                  window.alert("Add a title or description first to search Maps.");
                  return;
                }
                window.open(
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
            >
              Find on Google Maps
            </button>
            <p className="help-text" style={{ margin: 0 }}>
              Open the place in Google Maps, use <strong>Share</strong>, copy the link, and paste it above.
            </p>
          </>
        )}
        {composeChannel === "MEETUP" && (
          <>
            <div className="join-mode-switch" role="group" aria-label="Meet-up format">
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="meetupMode"
                  value="IN_PERSON"
                  checked={meetupComposeMode === "IN_PERSON"}
                  onChange={() => setMeetupComposeMode("IN_PERSON")}
                />
                In person
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="meetupMode"
                  value="VIRTUAL"
                  checked={meetupComposeMode === "VIRTUAL"}
                  onChange={() => setMeetupComposeMode("VIRTUAL")}
                />
                Virtual
              </label>
            </div>
            {meetupComposeMode === "VIRTUAL" && (
              <>
                <label className="help-text" style={{ margin: 0 }} htmlFor="meetup-meeting-url">
                  Video meeting link
                </label>
                <input
                  id="meetup-meeting-url"
                  className="input"
                  name="meetupMeetingUrl"
                  placeholder="Paste Zoom, Google Meet, Microsoft Teams, or other link"
                  autoComplete="off"
                />
                <p className="help-text" style={{ margin: 0 }}>
                  Participants use this link to join at the scheduled time.
                </p>
              </>
            )}
            <input className="input" type="datetime-local" name="meetupStartsAt" />
            <label className="help-text" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={meetupInviteEveryone}
                onChange={(e) => {
                  setMeetupInviteEveryone(e.target.checked);
                  if (e.target.checked) setMeetupParticipantIds([]);
                }}
              />
              Invite everyone at this event
            </label>
            {!meetupInviteEveryone && (
              <fieldset className="community-attendee-picks">
                <legend className="help-text">Participants (required if not inviting everyone)</legend>
                <div className="community-attendee-pick-grid">
                  {attendees
                    .filter((a) => a.id !== currentUserId)
                    .map((a) => (
                      <label key={a.id} className="community-attendee-pick">
                        <input
                          type="checkbox"
                          checked={meetupParticipantIds.includes(a.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setMeetupParticipantIds((prev) => [...prev, a.id]);
                            } else {
                              setMeetupParticipantIds((prev) => prev.filter((id) => id !== a.id));
                            }
                          }}
                        />
                        {a.name}
                      </label>
                    ))}
                </div>
              </fieldset>
            )}
          </>
        )}
        {composeChannel === "MOMENTS" && (
          <>
            <fieldset className="community-attendee-picks">
              <legend className="help-text">Tag people (optional)</legend>
              <div className="community-attendee-pick-grid">
                {attendees
                  .filter((a) => a.id !== currentUserId)
                  .map((a) => (
                    <label key={a.id} className="community-attendee-pick">
                      <input
                        type="checkbox"
                        checked={taggedUserIds.includes(a.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setTaggedUserIds((prev) => [...prev, a.id]);
                          } else {
                            setTaggedUserIds((prev) => prev.filter((id) => id !== a.id));
                          }
                        }}
                      />
                      {a.name}
                    </label>
                  ))}
              </div>
            </fieldset>
            <input className="input" name="imageUrl" placeholder="Image URL (optional, in addition to uploads)" />
            <input
              className="input"
              type="file"
              accept="image/*"
              multiple
              onChange={async (ev) => {
                const files = [...(ev.target.files || [])].slice(0, 12);
                const next: string[] = [];
                for (const file of files) {
                  next.push(await fileToDataUrl(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.82 }));
                }
                setMomentImageUrls((prev) => [...prev, ...next].slice(0, 12));
                ev.target.value = "";
              }}
            />
            {momentImageUrls.length > 0 && (
              <div className="moment-thumb-strip moment-thumb-strip--composer">
                {momentImageUrls.map((url, idx) => (
                  <div key={`${idx}-${url.slice(0, 24)}`} className="moment-thumb">
                    <img src={url} alt="" />
                    <button
                      type="button"
                      className="moment-thumb-remove"
                      aria-label="Remove photo"
                      onClick={() => setMomentImageUrls((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <button className="button" type="submit" disabled={postingThread}>
          {postingThread ? "Posting…" : "Post"}
        </button>
      </form>

      <div className="card network-thread-list">
        {threads.length === 0 && <p className="help-text">Nothing here yet — start the first post.</p>}
        <div
          className={
            channelFilter === "MOMENTS"
              ? "community-thread-rows community-thread-rows--moments"
              : "community-thread-rows"
          }
        >
          {threads.map((t) => {
            const open = openId === t.id;
            const ch = t.channel || "GENERAL";
            const channelIconKey = networkThreadChannelKey(ch);
            const lastReply = t.replies[t.replies.length - 1];
            const gallery = threadImageGallery(t);
            const taggedNames = (t.taggedUserIds ?? []).map((id) => nameById[id]).filter(Boolean);
            const meetupNames = (t.meetupParticipantIds ?? []).map((id) => nameById[id]).filter(Boolean);
            return (
              <div key={t.id} id={`network-thread-${t.id}`}>
                <div className={`community-thread-row${ch === "MOMENTS" && gallery[0] ? " community-thread-row--with-photo" : ""}`}>
                  <div className="community-thread-lead" aria-hidden>
                    {ch === "MOMENTS" && gallery[0] ? (
                      <img src={gallery[0]} alt="" className="community-thread-thumb" />
                    ) : (
                      <div className={`community-thread-icon ${ch}`}>
                        <CommunityPillIcon channel={channelIconKey} size={22} />
                      </div>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="community-thread-meta">
                      {lastReply
                        ? `Last reply ${new Date(lastReply.createdAt).toLocaleString()}`
                        : `Started ${new Date(t.createdAt).toLocaleString()}`}
                    </div>
                    <h4 className="community-thread-title">{t.title}</h4>
                    <p className="community-thread-desc">{t.body}</p>
                    {ch === "MEETUP" && (
                      <div className="community-thread-foot">
                        {t.meetupInviteEveryone
                          ? "Everyone at this event is invited"
                          : meetupNames.length > 0
                            ? `With ${meetupNames.join(", ")}`
                            : "Meet-up"}
                        {t.meetupMode
                          ? ` · ${t.meetupMode === "VIRTUAL" ? "Virtual" : "In-person"}`
                          : ""}
                        {t.meetupStartsAt ? ` · ${new Date(t.meetupStartsAt).toLocaleString()}` : ""}
                      </div>
                    )}
                    {ch === "MEETUP" && t.meetupMode === "VIRTUAL" && t.meetupMeetingUrl ? (
                      <div className="community-thread-foot">
                        <OnlineMeetingLink href={ensureHttpUrl(t.meetupMeetingUrl)} />
                      </div>
                    ) : null}
                    {ch === "MOMENTS" && taggedNames.length > 0 && (
                      <div className="community-thread-foot">Tagged: {taggedNames.join(", ")}</div>
                    )}
                    {ch === "LOCAL" && t.mapsUrl && (
                      <div className="community-thread-foot">
                        <a className="local-maps-link" href={t.mapsUrl} target="_blank" rel="noreferrer">
                          Open in Google Maps
                        </a>
                      </div>
                    )}
                    {t.meetupMode && ch !== "MEETUP" && (
                      <div className="community-thread-foot">
                        {t.meetupMode === "VIRTUAL" ? "Virtual" : "In-person"} meet-up
                        {t.meetupStartsAt ? ` · ${new Date(t.meetupStartsAt).toLocaleString()}` : ""}
                      </div>
                    )}
                    <div className="community-thread-foot">{t.replies.length} replies</div>
                  </div>
                  <button type="button" className="button secondary community-open-btn" onClick={() => setOpenId(open ? null : t.id)}>
                    {open ? "Close" : "Open"}
                  </button>
                </div>
                {open && (
                  <div className="network-thread-body" style={{ padding: "0 0 16px 64px" }}>
                    {gallery.length > 0 && (
                      <div className="community-thread-gallery">
                        {gallery.map((src) => (
                          <img key={src.slice(0, 48)} src={src} alt="" />
                        ))}
                      </div>
                    )}
                    <p style={{ whiteSpace: "pre-wrap" }}>{t.body}</p>
                    {ch === "MEETUP" && t.meetupMode === "VIRTUAL" && t.meetupMeetingUrl ? (
                      <p style={{ margin: "12px 0" }}>
                        <OnlineMeetingLink href={ensureHttpUrl(t.meetupMeetingUrl)} />
                      </p>
                    ) : null}
                    {isAdmin && (
                      <div style={{ marginBottom: 10 }}>
                        <button className="button secondary" type="button" onClick={() => deleteThread(t.id)}>
                          Delete thread
                        </button>
                      </div>
                    )}
                    <div className="network-replies">
                      {t.replies.map((r) => (
                        <div key={r.id} className="network-reply">
                          <strong>{r.author.name}</strong>
                          <span className="help-text"> · {new Date(r.createdAt).toLocaleString()}</span>
                          <p>{r.body}</p>
                        </div>
                      ))}
                    </div>
                    <form
                      className="grid"
                      style={{ gap: 8, marginTop: 8 }}
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (replyingToId) return;
                        const form = new FormData(e.currentTarget);
                        const body = String(form.get("body") || "");
                        setReplyingToId(t.id);
                        try {
                          await sendReply(t.id, body);
                          e.currentTarget.reset();
                        } finally {
                          setReplyingToId(null);
                        }
                      }}
                    >
                      <textarea className="textarea" name="body" placeholder="Write a reply…" required rows={2} />
                      <button className="button secondary" type="submit" disabled={replyingToId === t.id}>
                        {replyingToId === t.id ? "Sending…" : "Reply"}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </>
  );
}

function MessageComposer({
  token,
  conversationId,
  withEventHeaders,
  onSent,
}: {
  token: string;
  conversationId: string | null;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onSent: (m: Message) => void | Promise<void>;
}) {
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationId || sending) return;
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    setSending(true);
    try {
      const message = await apiFetch<Message>(
        `/conversations/${conversationId}/messages`,
        withEventHeaders({ method: "POST", body: JSON.stringify(payload) }),
        token,
      );
      await onSent(message);
      event.currentTarget.reset();
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="message-composer-form grid" onSubmit={handleSubmit} style={{ gap: 8 }}>
      <label className="help-text" style={{ margin: 0 }} htmlFor="message-composer-body">
        Your message
      </label>
      <textarea
        id="message-composer-body"
        className="textarea"
        name="body"
        placeholder="Write something…"
        required
        disabled={sending}
      />
      <button className="button" disabled={!conversationId || sending}>
        {sending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

function DirectChatForm({
  attendees,
  currentUserId,
  token,
  withEventHeaders,
  onCreated,
}: {
  attendees: User[];
  currentUserId: string;
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onCreated: (c: Conversation) => void;
}) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = String(form.get("userId") || "");
    if (!userId) return;
    const conversation = await apiFetch<Conversation>(
      "/conversations/direct",
      withEventHeaders({ method: "POST", body: JSON.stringify({ userId }) }),
      token,
    );
    onCreated(conversation);
  }

  return (
    <form className="grid" onSubmit={handleSubmit} style={{ gap: 8, marginBottom: 12 }}>
      <h4 style={{ margin: 0 }}>Message someone one-on-one</h4>
      <p className="help-text" style={{ margin: 0 }}>
        Choose a participant, then <strong>Start chat</strong>. The thread appears under &quot;Your chats&quot;.
      </p>
      <label className="help-text" style={{ margin: 0 }} htmlFor="direct-chat-participant">
        Participant
      </label>
      <select id="direct-chat-participant" className="select" name="userId" required defaultValue="">
        <option value="" disabled>
          Choose a participant…
        </option>
        {attendees.filter((a) => a.id !== currentUserId).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.role})
          </option>
        ))}
      </select>
      <button className="button secondary" type="submit">
        Start chat
      </button>
    </form>
  );
}

function GroupChatForm({
  attendees,
  currentUserId,
  token,
  withEventHeaders,
  onCreated,
}: {
  attendees: User[];
  currentUserId: string;
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onCreated: (c: Conversation) => void;
}) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "");
    const memberIds = form.getAll("memberIds").map((id) => String(id)).filter((id) => id && id !== currentUserId);
    if (!name || memberIds.length === 0) return;
    const conversation = await apiFetch<Conversation>(
      "/conversations/group",
      withEventHeaders({ method: "POST", body: JSON.stringify({ name, memberIds }) }),
      token,
    );
    onCreated(conversation);
    event.currentTarget.reset();
  }

  return (
    <form className="grid" onSubmit={handleSubmit} style={{ gap: 8 }}>
      <h4 style={{ margin: 0 }}>Create a group chat</h4>
      <p className="help-text" style={{ margin: 0 }}>
        Name the group and select at least one other person (hold Ctrl/Cmd to pick multiple).
      </p>
      <input className="input" name="name" placeholder="Group name" required />
      <select className="select" name="memberIds" multiple size={4} required>
        {attendees.filter((a) => a.id !== currentUserId).map((a) => (
          <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
        ))}
      </select>
      <button className="button secondary" type="submit">Create</button>
    </form>
  );
}

function inviteStatusLabel(attendee: User) {
  if (attendee.inviteStatus === "PENDING_SETUP") return "Pending — has not finished signup";
  if (attendee.inviteStatus === "INVITE_EXPIRED") return "Invite expired";
  if (attendee.inviteStatus === "ACTIVE") return "Joined";
  return "—";
}

function formatConversationName(conversation: Conversation, currentUser: User) {
  if (conversation.type === "EVENT") return conversation.name || "Everyone — event chat";
  if (conversation.type === "GROUP") return conversation.name || "Group Chat";
  if (conversation.type === "SESSION") return conversation.name || "Session chat";
  const other = conversation.members.find((m) => m.user.id !== currentUser.id);
  return other ? other.user.name : "Direct Chat";
}

function toLocalInputValue(dateString: string) {
  const date = new Date(dateString);
  const offset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - offset);
  return local.toISOString().slice(0, 16);
}

function formatEventRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${endDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function formatTimeRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function groupSessionsByDayAndTime(sessions: Session[]) {
  const groupedByDay = new Map<string, Session[]>();
  for (const session of sessions) {
    const dayKey = new Date(session.startsAt).toDateString();
    const existing = groupedByDay.get(dayKey) || [];
    existing.push(session);
    groupedByDay.set(dayKey, existing);
  }

  return Array.from(groupedByDay.values()).map((daySessions) => {
    const firstSession = daySessions[0];
    const dayLabel = new Date(firstSession.startsAt).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    const timeMap = new Map<string, Session[]>();
    for (const session of daySessions) {
      const timeKey = new Date(session.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const list = timeMap.get(timeKey) || [];
      list.push(session);
      timeMap.set(timeKey, list);
    }

    return {
      dayLabel,
      timeSlots: Array.from(timeMap.entries()).map(([timeLabel, slotSessions]) => ({
        timeLabel,
        sessions: slotSessions,
      })),
    };
  });
}

function fileToDataUrl(
  file: File,
  options?: { maxWidth?: number; maxHeight?: number; quality?: number },
) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      if (!options || !file.type.startsWith("image/")) {
        resolve(raw);
        return;
      }

      const image = new Image();
      image.onload = () => {
        const maxWidth = options.maxWidth ?? image.width;
        const maxHeight = options.maxHeight ?? image.height;
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(raw);
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        const output = canvas.toDataURL("image/jpeg", options.quality ?? 0.85);
        resolve(output);
      };
      image.onerror = () => resolve(raw);
      image.src = raw;
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}
