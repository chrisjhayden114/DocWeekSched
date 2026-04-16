import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";

type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ATTENDEE" | "SPEAKER";
  photoUrl?: string | null;
  researchInterests?: string | null;
  engagementPoints?: number;
};

type Event = { id: string; name: string; bannerUrl?: string | null; timezone: string; startDate: string; endDate: string };

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

type Announcement = { id: string; title: string; body: string; createdAt: string };

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
type EventItem = { id: string; name: string; bannerUrl?: string | null; timezone: string; startDate: string; endDate: string };

type CheckIn = { id: string; user: { id: string; name: string; email: string; role: string }; createdAt: string };

type NetworkAuthor = { id: string; name: string; role: string; photoUrl?: string | null };
type NetworkReply = { id: string; body: string; createdAt: string; author: NetworkAuthor };
type NetworkThread = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  author: NetworkAuthor;
  replies: NetworkReply[];
};

const NETWORKING_TAB = "Networking & Conversations" as const;
const adminTabs = ["Agenda", "Attendees", "Announcements", NETWORKING_TAB, "Messages", "Check-In", "Profile"] as const;
const participantTabs = ["Agenda", "Attendees", NETWORKING_TAB, "Messages", "Profile"] as const;
type Tab = (typeof adminTabs)[number];

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [active, setActive] = useState<Tab>("Agenda");

  const [event, setEvent] = useState<Event | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [attendees, setAttendees] = useState<User[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [networkThreads, setNetworkThreads] = useState<NetworkThread[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [agendaView, setAgendaView] = useState<"Event Schedule" | "My Schedule">("Event Schedule");
  const [myAttendance, setMyAttendance] = useState<SessionAttendance[]>([]);
  const [likedSessionIds, setLikedSessionIds] = useState<string[]>([]);
  const [adminEvents, setAdminEvents] = useState<EventItem[]>([]);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [updatingEvent, setUpdatingEvent] = useState(false);
  const [sessionFormKey, setSessionFormKey] = useState(0);
  const [messageDirectoryQuery, setMessageDirectoryQuery] = useState("");

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

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      if (active === "Agenda") {
        setSessions(await apiFetch<Session[]>("/sessions", withEventHeaders(), token));
        if (user?.role === "ADMIN" && attendees.length === 0) {
          setAttendees(await apiFetch<User[]>("/attendees", {}, token));
        }
      }
      if (active === "Attendees") {
        setAttendees(await apiFetch<User[]>("/attendees", {}, token));
      }
      if (active === "Announcements") {
        setAnnouncements(await apiFetch<Announcement[]>("/announcements", withEventHeaders(), token));
      }
      if (active === NETWORKING_TAB) {
        setNetworkThreads(await apiFetch<NetworkThread[]>("/network/threads", withEventHeaders(), token));
      }
      if (active === "Messages") {
        const convoList = await apiFetch<Conversation[]>("/conversations", withEventHeaders(), token);
        setConversations(convoList);
        const firstDm = convoList.find((c) => c.type !== "SESSION");
        if (!activeConversationId && firstDm) {
          setActiveConversationId(firstDm.id);
        }
        if (attendees.length === 0) {
          setAttendees(await apiFetch<User[]>("/attendees", {}, token));
        }
      }
      if (active === "Check-In" && user?.role === "ADMIN") {
        setCheckIns(await apiFetch<CheckIn[]>("/checkins", withEventHeaders(), token));
      }
      if (user?.role === "ADMIN") {
        const myEvents = await apiFetch<EventItem[]>("/event/mine", {}, token).catch(() => []);
        setAdminEvents(myEvents);
      }
    };
    load();
  }, [active, token, user?.role, activeConversationId, activeEventId]);

  useEffect(() => {
    if (!token || active !== "Messages" || !activeConversationId) return;
    apiFetch<Message[]>(`/conversations/${activeConversationId}/messages`, withEventHeaders(), token)
      .then(setMessages)
      .catch(() => null);
  }, [active, activeConversationId, token, activeEventId]);

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

  const filteredConversations = useMemo(() => {
    if (!user) return [];
    if (!messageSearchLower) return messagingConversations;
    return messagingConversations.filter((c) => {
      const label = formatConversationName(c, user).toLowerCase();
      if (label.includes(messageSearchLower)) return true;
      return c.members.some((m) => m.user.name.toLowerCase().includes(messageSearchLower));
    });
  }, [messagingConversations, messageSearchLower, user]);

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
    await apiFetch(`/sessions/${sessionId}/attendance`, {
      method: "PUT",
      body: JSON.stringify(body),
    }, token);
    const meta = await apiFetch<MySessionMeta>("/sessions/me", {}, token);
    setMyAttendance(meta.attendance);
    if (body.status === "JOINING") {
      await refreshUser();
    }
  };

  const goToSessionPage = (sessionId: string) => {
    router.push(`/session/${sessionId}`);
  };

  const toggleSessionLike = async (sessionId: string) => {
    if (!token) return;
    const liked = likedSessionIds.includes(sessionId);
    if (liked) {
      await apiFetch(`/sessions/${sessionId}/like`, { method: "DELETE" }, token);
      setLikedSessionIds((prev) => prev.filter((id) => id !== sessionId));
      return;
    }
    await apiFetch(`/sessions/${sessionId}/like`, { method: "PUT" }, token);
    setLikedSessionIds((prev) => [...prev, sessionId]);
    await refreshUser();
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

  const updateCurrentEvent = async (payload: { name: string; bannerUrl?: string; timezone: string; startDate: string; endDate: string }) => {
    if (!token) return;
    setUpdatingEvent(true);
    try {
      const updated = await apiFetch<Event>(
        "/event",
        withEventHeaders({ method: "PUT", body: JSON.stringify(payload) }),
        token,
      );
      setEvent(updated);
      if (isAdmin) {
        const myEvents = await apiFetch<EventItem[]>("/event/mine", {}, token).catch(() => []);
        setAdminEvents(myEvents);
      }
    } finally {
      setUpdatingEvent(false);
    }
  };

  if (!user) return null;

  return (
    <div className="container">
      {event?.bannerUrl && (
        <div className="hero-banner" style={{ backgroundImage: `url(${event.bannerUrl})` }} />
      )}
      <div className="header app-shell">
        <div>
          <h1>{event?.name || "Event Dashboard"}</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            {user.name} · {user.role}
            {typeof user.engagementPoints === "number" && (
              <> · <span className="points-pill">{user.engagementPoints} pts</span></>
            )}
            {event && ` · ${formatEventRange(event.startDate, event.endDate)}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {isAdmin && event && (
            <details className="card" style={{ padding: 12, minWidth: 320 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>Event Settings</summary>
              <form
                className="grid"
                style={{ marginTop: 10 }}
                onSubmit={async (eventForm) => {
                  eventForm.preventDefault();
                  const form = new FormData(eventForm.currentTarget);
                  await updateCurrentEvent({
                    name: String(form.get("name") || ""),
                    bannerUrl: String(form.get("bannerUrl") || ""),
                    timezone: String(form.get("timezone") || "UTC"),
                    startDate: new Date(String(form.get("startDate") || "")).toISOString(),
                    endDate: new Date(String(form.get("endDate") || "")).toISOString(),
                  });
                }}
              >
                <input className="input" name="name" defaultValue={event.name} required />
                <input className="input" name="bannerUrl" defaultValue={event.bannerUrl || ""} placeholder="Banner image URL or upload below" />
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const data = await fileToDataUrl(file);
                    const el = e.currentTarget.form?.elements.namedItem("bannerUrl");
                    if (el instanceof HTMLInputElement) el.value = data;
                  }}
                />
                <input className="input" name="timezone" defaultValue={event.timezone} required />
                <input className="input" type="datetime-local" name="startDate" defaultValue={toLocalInputValue(event.startDate)} required />
                <input className="input" type="datetime-local" name="endDate" defaultValue={toLocalInputValue(event.endDate)} required />
                <button className="button" type="submit" disabled={updatingEvent}>
                  {updatingEvent ? "Saving..." : "Save Event"}
                </button>
              </form>
            </details>
          )}
          <button className="button secondary" onClick={handleLogout}>Logout</button>
        </div>
      </div>

      <div className="nav" style={{ marginBottom: 20 }}>
        {availableTabs.map((tab) => (
          <button key={tab} className={active === tab ? "active" : ""} onClick={() => setActive(tab)}>
            {tab}
          </button>
        ))}
      </div>

      {active === "Agenda" && (
        <div className="schedule-layout">
          <div className="card schedule-list">
            <div className="nav" style={{ marginBottom: 16 }}>
              <button
                className={agendaView === "Event Schedule" ? "active" : ""}
                onClick={() => setAgendaView("Event Schedule")}
              >
                Event Schedule
              </button>
              <button
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
              <>
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
                {isAdmin && (
                  <ParticipantDailySchedules groupedAgenda={groupedAgenda} />
                )}
              </>
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
        <AttendeeDirectory
          attendees={attendees}
          currentUserId={user.id}
          onMessage={startDirectMessage}
        />
      )}

      {active === "Announcements" && (
        <div className="grid">
          {isAdmin && (
            <AnnouncementForm
              token={token!}
              withEventHeaders={withEventHeaders}
              onCreated={(a) => setAnnouncements([a, ...announcements])}
            />
          )}
          {announcements.map((a) => (
            <div className="card" key={a.id}>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
              <p style={{ color: "var(--ink-500)" }}>{new Date(a.createdAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {active === NETWORKING_TAB && (
        <NetworkingBoard
          threads={networkThreads}
          token={token!}
          withEventHeaders={withEventHeaders}
          onThreadsUpdated={async () => {
            setNetworkThreads(await apiFetch<NetworkThread[]>("/network/threads", withEventHeaders(), token!));
            await refreshUser();
          }}
        />
      )}

      {active === "Messages" && (
        <div className="grid two messages-layout">
          <div className="card">
            <h3>Messages</h3>
            <p className="help-text" style={{ marginTop: 0 }}>
              Direct and group chats only. Open any session from the Agenda to see its session-specific discussion.
            </p>
            <p className="help-text" style={{ marginTop: 0 }}>
              Search by name or research interests to find people and filter your chats.
            </p>
            <input
              className="input"
              type="search"
              placeholder="Search people and conversations…"
              value={messageDirectoryQuery}
              onChange={(e) => setMessageDirectoryQuery(e.target.value)}
              aria-label="Search people and conversations"
            />
            <h4 style={{ marginBottom: 8 }}>Conversations</h4>
            <div className="grid" style={{ gap: 8 }}>
              {filteredConversations.map((c) => (
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
            <div style={{ marginTop: 16 }}>
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
            </div>
            <div style={{ marginTop: 16 }}>
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
            </div>
          </div>
          <div className="card">
            <MessageComposer
              token={token!}
              conversationId={activeConversationId}
              withEventHeaders={withEventHeaders}
              onSent={async (m) => {
                setMessages([...messages, m]);
                await refreshUser();
              }}
            />
            {messages.map((m) => (
              <div key={m.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
                <strong>{m.user.name}</strong> <span style={{ color: "var(--ink-500)" }}>({m.user.role})</span>
                <p style={{ margin: "4px 0" }}>{m.body}</p>
                <small style={{ color: "var(--ink-500)" }}>{new Date(m.createdAt).toLocaleString()}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      {active === "Profile" && (
        <ProfileEditor
          token={token!}
          user={user}
          adminEvents={adminEvents}
          activeEventId={activeEventId}
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

      {active === "Check-In" && (
        <div className="grid">
          <CheckInSelf token={token!} withEventHeaders={withEventHeaders} />
          {isAdmin && (
            <div className="card">
              <h3>Checked In</h3>
              {checkIns.map((c) => (
                <div key={c.id} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                  <strong>{c.user.name}</strong> · {c.user.email}
                </div>
              ))}
            </div>
          )}
        </div>
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
                        {s.zoomLink && <a href={s.zoomLink} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Zoom</a>}
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
                          <div
                            className="session-attendance-block"
                            onClick={(event) => event.stopPropagation()}
                            role="group"
                            aria-label="Session attendance"
                          >
                            <button
                              type="button"
                              className={`attendance-join-dot ${joining ? "is-on" : ""}`}
                              aria-pressed={joining}
                              aria-label={joining ? "Leave session" : "Join session"}
                              onClick={() =>
                                onPatchAttendance(s.id, joining ? { status: "NOT_JOINING" } : { status: "JOINING", joinMode: "IN_PERSON" })
                              }
                            />
                            <span className="attendance-join-text">{joining ? "Joined" : "Join"}</span>
                            {joining && (
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
                            )}
                          </div>
                          <button className="button secondary" type="button" onClick={(event) => { event.stopPropagation(); onGoToSession(s.id); }}>Conversation</button>
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

function ProfileEditor({
  token,
  user,
  adminEvents,
  activeEventId,
  onSaved,
  onEventSelected,
  onEventCreated,
}: {
  token: string;
  user: User;
  adminEvents: EventItem[];
  activeEventId: string | null;
  onSaved: (user: User) => void;
  onEventSelected: (eventId: string) => void;
  onEventCreated: (event: EventItem) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(user.photoUrl || null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setPhotoPreview(dataUrl);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") || ""),
      researchInterests: String(form.get("researchInterests") || ""),
      photoUrl: photoPreview || undefined,
    };
    setSaving(true);
    try {
      const updated = await apiFetch<User>("/auth/me/profile", {
        method: "PUT",
        body: JSON.stringify(payload),
      }, token);
      onSaved(updated);
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
      <input className="input" name="name" defaultValue={user.name} required />
      <textarea
        className="textarea"
        name="researchInterests"
        defaultValue={user.researchInterests || ""}
        placeholder="Research interests, projects, and topics you care about"
        rows={5}
      />
      <button className="button" type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save Profile"}
      </button>
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
            <input className="input" name="eventBannerUrl" placeholder="Banner URL (optional)" />
            <input
              className="input"
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const data = await fileToDataUrl(file);
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

function AnnouncementForm({
  token,
  withEventHeaders,
  onCreated,
}: {
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onCreated: (a: Announcement) => void;
}) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const announcement = await apiFetch<Announcement>(
      "/announcements",
      withEventHeaders({ method: "POST", body: JSON.stringify(payload) }),
      token,
    );
    onCreated(announcement);
    event.currentTarget.reset();
  }

  return (
    <form className="card grid" onSubmit={handleSubmit}>
      <h3>New announcement</h3>
      <input className="input" name="title" placeholder="Title" required />
      <textarea className="textarea" name="body" placeholder="What’s new?" required />
      <button className="button">Publish</button>
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
    if (!confirm("Delete this session?")) return;
    await apiFetch(`/sessions/${editing.id}`, { method: "DELETE" }, token);
    onSaved();
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
      <input className="input" name="zoomLink" placeholder="Zoom link" defaultValue={editing?.zoomLink || ""} />
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

function NetworkingBoard({
  threads,
  token,
  withEventHeaders,
  onThreadsUpdated,
}: {
  threads: NetworkThread[];
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onThreadsUpdated: () => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(threads[0]?.id ?? null);

  async function createThread(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await apiFetch(
      "/network/threads",
      withEventHeaders({
        method: "POST",
        body: JSON.stringify({
          title: String(form.get("title") || ""),
          body: String(form.get("body") || ""),
        }),
      }),
      token,
    );
    event.currentTarget.reset();
    await onThreadsUpdated();
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

  return (
    <div className="grid networking-board">
      <form className="card grid" onSubmit={createThread}>
        <h3 style={{ marginTop: 0 }}>Start a discussion</h3>
        <p className="help-text" style={{ margin: 0 }}>
          Introduce yourself or start a thread everyone registered can see and reply to.
        </p>
        <input className="input" name="title" placeholder="Title" required />
        <textarea className="textarea" name="body" placeholder="Your message…" required rows={4} />
        <button className="button" type="submit">Post</button>
      </form>
      <div className="network-thread-list">
        {threads.length === 0 && <p className="help-text">No discussions yet — be the first to post.</p>}
        {threads.map((t) => {
          const open = openId === t.id;
          return (
            <div className="card network-thread" key={t.id}>
              <button type="button" className="network-thread-toggle" onClick={() => setOpenId(open ? null : t.id)}>
                <strong>{t.title}</strong>
                <span className="help-text">
                  {t.author.name} · {new Date(t.createdAt).toLocaleString()}
                </span>
              </button>
              {open && (
                <div className="network-thread-body">
                  <p>{t.body}</p>
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
                      const form = new FormData(e.currentTarget);
                      const body = String(form.get("body") || "");
                      await sendReply(t.id, body);
                      e.currentTarget.reset();
                    }}
                  >
                    <textarea className="textarea" name="body" placeholder="Write a public reply…" required rows={2} />
                    <button className="button secondary" type="submit">Reply</button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationId) return;
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const message = await apiFetch<Message>(
      `/conversations/${conversationId}/messages`,
      withEventHeaders({ method: "POST", body: JSON.stringify(payload) }),
      token,
    );
    await onSent(message);
    event.currentTarget.reset();
  }

  return (
    <form className="card grid" onSubmit={handleSubmit}>
      <h3>Chat</h3>
      <textarea className="textarea" name="body" placeholder="Write a message" required />
      <button className="button" disabled={!conversationId}>Send</button>
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
    <form className="grid" onSubmit={handleSubmit}>
      <h4>Start direct chat</h4>
      <select className="select" name="userId" required defaultValue="">
        <option value="" disabled>Select attendee</option>
        {attendees.filter((a) => a.id !== currentUserId).map((a) => (
          <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
        ))}
      </select>
      <button className="button secondary" type="submit">Start</button>
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
    <form className="grid" onSubmit={handleSubmit}>
      <h4>Create group chat</h4>
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

function formatConversationName(conversation: Conversation, currentUser: User) {
  if (conversation.type === "EVENT") return conversation.name || "Event Chat";
  if (conversation.type === "GROUP") return conversation.name || "Group Chat";
  if (conversation.type === "SESSION") return conversation.name || "Session chat";
  const other = conversation.members.find((m) => m.user.id !== currentUser.id);
  return other ? other.user.name : "Direct Chat";
}

function CheckInSelf({ token, withEventHeaders }: { token: string; withEventHeaders: (extra?: RequestInit) => RequestInit }) {
  const [status, setStatus] = useState<string | null>(null);

  async function handleCheckIn() {
    await apiFetch("/checkins", withEventHeaders({ method: "POST" }), token);
    setStatus("Checked in!");
  }

  return (
    <div className="card">
      <h3>Check in</h3>
      <p style={{ color: "var(--ink-muted)" }}>Tap below to check yourself in.</p>
      <button className="button" type="button" onClick={handleCheckIn}>Check in</button>
      {status && <p style={{ color: "var(--gold)" }}>{status}</p>}
    </div>
  );
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

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}
