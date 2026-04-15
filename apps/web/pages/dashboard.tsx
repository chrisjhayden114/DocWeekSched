import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";

type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ATTENDEE" | "SPEAKER";
  photoUrl?: string | null;
  researchInterests?: string | null;
};

type Event = { id: string; name: string; timezone: string; startDate: string; endDate: string };

type Session = {
  id: string;
  title: string;
  description?: string;
  speakers?: string | null;
  zoomLink?: string | null;
  recordingUrl?: string | null;
  fileUrl?: string | null;
  fileLink?: string | null;
  startsAt: string;
  endsAt: string;
  speaker?: { name: string };
  speakerId?: string | null;
  bookmarks?: { userId: string; user: Pick<User, "id" | "name" | "email" | "photoUrl"> }[];
  attendances?: { userId: string; status: "JOINING" | "NOT_JOINING"; user: Pick<User, "id" | "name" | "email" | "photoUrl"> }[];
};

type Announcement = { id: string; title: string; body: string; createdAt: string };

type Survey = { id: string; title: string; questions: { id: string; prompt: string; type: string; options: string[] }[] };

type ConversationMember = { user: { id: string; name: string; role: string } };
type Conversation = {
  id: string;
  name?: string | null;
  type: "EVENT" | "DIRECT" | "GROUP";
  members: ConversationMember[];
  messages: { id: string; body: string; createdAt: string; user: { id: string; name: string } }[];
};
type Message = { id: string; body: string; createdAt: string; user: { id: string; name: string; role: string } };
type SessionAttendance = { sessionId: string; status: "JOINING" | "NOT_JOINING" };

type CheckIn = { id: string; user: { id: string; name: string; email: string; role: string }; createdAt: string };

const tabs = ["Agenda", "Attendees", "Announcements", "Surveys", "Messages", "Check-In", "Profile"] as const;

export default function Dashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [active, setActive] = useState<(typeof tabs)[number]>("Agenda");

  const [event, setEvent] = useState<Event | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [attendees, setAttendees] = useState<User[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [agendaView, setAgendaView] = useState<"Event Schedule" | "My Schedule">("Event Schedule");
  const [myAttendance, setMyAttendance] = useState<SessionAttendance[]>([]);
  const [activeSessionConversationId, setActiveSessionConversationId] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<Message[]>([]);

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
    apiFetch<Event>("/event", {}, token).then(setEvent).catch(() => null);
    apiFetch<User>("/auth/me", {}, token).then((freshUser) => {
      setUser(freshUser);
      window.localStorage.setItem("user", JSON.stringify(freshUser));
    }).catch(() => null);
    apiFetch<SessionAttendance[]>("/sessions/me", {}, token).then(setMyAttendance).catch(() => null);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      if (active === "Agenda") {
        setSessions(await apiFetch<Session[]>("/sessions", {}, token));
        if (user?.role === "ADMIN" && attendees.length === 0) {
          setAttendees(await apiFetch<User[]>("/attendees", {}, token));
        }
      }
      if (active === "Attendees") {
        setAttendees(await apiFetch<User[]>("/attendees", {}, token));
      }
      if (active === "Announcements") {
        setAnnouncements(await apiFetch<Announcement[]>("/announcements", {}, token));
      }
      if (active === "Surveys") {
        setSurveys(await apiFetch<Survey[]>("/surveys", {}, token));
      }
      if (active === "Messages") {
        const convoList = await apiFetch<Conversation[]>("/conversations", {}, token);
        setConversations(convoList);
        if (!activeConversationId && convoList.length > 0) {
          setActiveConversationId(convoList[0].id);
        }
        if (attendees.length === 0) {
          setAttendees(await apiFetch<User[]>("/attendees", {}, token));
        }
      }
      if (active === "Check-In" && user?.role === "ADMIN") {
        setCheckIns(await apiFetch<CheckIn[]>("/checkins", {}, token));
      }
    };
    load();
  }, [active, token, user?.role, activeConversationId]);

  useEffect(() => {
    if (!token || active !== "Messages" || !activeConversationId) return;
    apiFetch<Message[]>(`/conversations/${activeConversationId}/messages`, {}, token)
      .then(setMessages)
      .catch(() => null);
  }, [active, activeConversationId, token]);

  const isAdmin = useMemo(() => user?.role === "ADMIN", [user]);
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

  const handleLogout = () => {
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("user");
    window.location.href = "/";
  };

  const setSessionAttendance = async (sessionId: string, status: "JOINING" | "NOT_JOINING") => {
    if (!token) return;
    await apiFetch(`/sessions/${sessionId}/attendance`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }, token);
    setMyAttendance((prev) => {
      const rest = prev.filter((item) => item.sessionId !== sessionId);
      return [...rest, { sessionId, status }];
    });
  };

  const openSessionConversation = async (sessionId: string) => {
    if (!token) return;
    setActiveSessionConversationId(sessionId);
    const messagesForSession = await apiFetch<Message[]>(`/sessions/${sessionId}/conversation/messages`, {}, token);
    setSessionMessages(messagesForSession);
  };

  const sendSessionMessage = async (body: string) => {
    if (!token || !activeSessionConversationId) return;
    const message = await apiFetch<Message>(`/sessions/${activeSessionConversationId}/conversation/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }, token);
    setSessionMessages((prev) => [...prev, message]);
  };

  if (!user) return null;

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>{event?.name || "Event Dashboard"}</h1>
          <p style={{ color: "var(--ink-700)" }}>
            {user.name} · {user.role}
            {event && ` · ${formatEventRange(event.startDate, event.endDate)}`}
          </p>
        </div>
        <button className="button secondary" onClick={handleLogout}>Logout</button>
      </div>

      <div className="nav" style={{ marginBottom: 20 }}>
        {tabs.map((tab) => (
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
                onSetAttendance={setSessionAttendance}
                onEditSession={(session) => setEditingSession(session)}
                onOpenConversation={openSessionConversation}
              />
            )}
            {agendaView === "My Schedule" && (
              <>
                <ScheduleBoard
                  grouped={groupedMySchedule}
                  isAdmin={isAdmin}
                  myAttendance={myAttendance}
                  onSetAttendance={setSessionAttendance}
                  onEditSession={(session) => setEditingSession(session)}
                  onOpenConversation={openSessionConversation}
                />
                {isAdmin && (
                  <ParticipantDailySchedules groupedAgenda={groupedAgenda} />
                )}
              </>
            )}
            {activeSessionConversationId && (
              <SessionConversationPanel
                messages={sessionMessages}
                onSend={sendSessionMessage}
              />
            )}
          </div>
          {isAdmin && (
            <SessionForm
              token={token!}
              attendees={attendees.filter((a) => a.role === "SPEAKER")}
              editing={editingSession}
              onSaved={async () => {
                setEditingSession(null);
                setSessions(await apiFetch<Session[]>("/sessions", {}, token!));
              }}
              onCancel={() => setEditingSession(null)}
            />
          )}
        </div>
      )}

      {active === "Attendees" && (
        <div className="grid two">
          {attendees.map((a) => (
            <div className="card" key={a.id}>
              {a.photoUrl && <img src={a.photoUrl} alt={a.name} className="avatar" />}
              <h3>{a.name}</h3>
              <p style={{ color: "var(--ink-700)" }}>{a.email}</p>
              {a.researchInterests && <p style={{ color: "var(--ink-700)" }}>{a.researchInterests}</p>}
              <span className="badge">{a.role}</span>
            </div>
          ))}
        </div>
      )}

      {active === "Announcements" && (
        <div className="grid">
          {isAdmin && (
            <AnnouncementForm token={token!} onCreated={(a) => setAnnouncements([a, ...announcements])} />
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

      {active === "Surveys" && (
        <div className="grid">
          {isAdmin && (
            <SurveyForm token={token!} onCreated={(s) => setSurveys([...surveys, s])} />
          )}
          {surveys.map((s) => (
            <SurveyCard key={s.id} survey={s} token={token!} />
          ))}
        </div>
      )}

      {active === "Messages" && (
        <div className="grid two">
          <div className="card">
            <h3>Conversations</h3>
            <div className="grid" style={{ gap: 8 }}>
              {conversations.map((c) => (
                <button
                  key={c.id}
                  className={activeConversationId === c.id ? "button" : "button secondary"}
                  onClick={() => setActiveConversationId(c.id)}
                >
                  {formatConversationName(c, user)}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <DirectChatForm
                attendees={attendees}
                currentUserId={user.id}
                token={token!}
                onCreated={(c) => {
                  setConversations([c, ...conversations]);
                  setActiveConversationId(c.id);
                }}
              />
            </div>
            <div style={{ marginTop: 16 }}>
              <GroupChatForm
                attendees={attendees}
                currentUserId={user.id}
                token={token!}
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
              onSent={(m) => setMessages([...messages, m])}
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
          onSaved={(updated) => {
            setUser(updated);
            window.localStorage.setItem("user", JSON.stringify(updated));
            setAttendees((prev) => prev.map((attendee) => (attendee.id === updated.id ? updated : attendee)));
          }}
        />
      )}

      {active === "Check-In" && (
        <div className="grid">
          <CheckInSelf token={token!} />
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
  onSetAttendance,
  onEditSession,
  onOpenConversation,
}: {
  grouped: Array<{ dayLabel: string; timeSlots: Array<{ timeLabel: string; sessions: Session[] }> }>;
  isAdmin: boolean;
  myAttendance: SessionAttendance[];
  onSetAttendance: (sessionId: string, status: "JOINING" | "NOT_JOINING") => void;
  onEditSession: (session: Session) => void;
  onOpenConversation: (sessionId: string) => void;
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
                  const myStatus = myAttendance.find((item) => item.sessionId === s.id)?.status;
                  return (
                    <article className="schedule-event" key={s.id} title={s.description || "No session description yet."}>
                      <h4>{s.title}</h4>
                      {(s.speakers || s.speaker?.name) && <div className="schedule-speaker">{s.speakers || s.speaker?.name}</div>}
                      <div className="schedule-links">
                        {s.zoomLink && <a href={s.zoomLink} target="_blank" rel="noreferrer">Zoom</a>}
                        {s.recordingUrl && <a href={s.recordingUrl} target="_blank" rel="noreferrer">Recording</a>}
                        {s.fileLink && <a href={s.fileLink} target="_blank" rel="noreferrer">Resources</a>}
                        {s.fileUrl && <a href={s.fileUrl} target="_blank" rel="noreferrer">Uploaded File</a>}
                      </div>
                      <div className="schedule-meta">
                        <span>{formatTimeRange(s.startsAt, s.endsAt)}</span>
                        <div className="schedule-actions">
                          <button className={`button ${myStatus === "JOINING" ? "" : "secondary"}`} type="button" onClick={() => onSetAttendance(s.id, "JOINING")}>
                            Joining
                          </button>
                          <button className={`button ${myStatus === "NOT_JOINING" ? "" : "secondary"}`} type="button" onClick={() => onSetAttendance(s.id, "NOT_JOINING")}>
                            Not Joining
                          </button>
                          <button className="button secondary" type="button" onClick={() => onOpenConversation(s.id)}>Conversation</button>
                          {isAdmin && (
                            <button className="button secondary" type="button" onClick={() => onEditSession(s)}>Edit</button>
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
                          .map((attendance) => attendance.user.name)
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

function SessionConversationPanel({
  messages,
  onSend,
}: {
  messages: Message[];
  onSend: (body: string) => Promise<void>;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Session Conversation</h3>
      <form
        className="grid"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const body = String(form.get("body") || "");
          if (!body.trim()) return;
          await onSend(body);
          event.currentTarget.reset();
        }}
      >
        <textarea className="textarea" name="body" placeholder="Add to this session conversation..." required />
        <button className="button" type="submit">Send</button>
      </form>
      <div className="grid" style={{ marginTop: 12 }}>
        {messages.map((message) => (
          <div key={message.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            <strong>{message.user.name}</strong>
            <div>{message.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileEditor({
  token,
  user,
  onSaved,
}: {
  token: string;
  user: User;
  onSaved: (user: User) => void;
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
    </form>
  );
}

function AnnouncementForm({ token, onCreated }: { token: string; onCreated: (a: Announcement) => void }) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const announcement = await apiFetch<Announcement>("/announcements", {
      method: "POST",
      body: JSON.stringify(payload),
    }, token);
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
  attendees,
  editing,
  onSaved,
  onCancel,
}: {
  token: string;
  attendees: User[];
  editing: Session | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      title: String(form.get("title") || ""),
      description: String(form.get("description") || ""),
      speakers: String(form.get("speakers") || ""),
      zoomLink: String(form.get("zoomLink") || ""),
      recordingUrl: String(form.get("recordingUrl") || ""),
      fileLink: String(form.get("fileLink") || ""),
      fileUrl: String(form.get("fileUrl") || ""),
      startsAt: new Date(String(form.get("startsAt") || "")).toISOString(),
      endsAt: new Date(String(form.get("endsAt") || "")).toISOString(),
      speakerId: String(form.get("speakerId") || "") || undefined,
    };

    if (editing) {
      await apiFetch(`/sessions/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }, token);
    } else {
      await apiFetch("/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      }, token);
    }

    event.currentTarget.reset();
    onSaved();
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
      <input className="input" name="speakers" placeholder="Speaker(s)" defaultValue={editing?.speakers || ""} />
      <input className="input" name="zoomLink" placeholder="Zoom link" defaultValue={editing?.zoomLink || ""} />
      <input className="input" name="recordingUrl" placeholder="Recording URL" defaultValue={editing?.recordingUrl || ""} />
      <input className="input" name="fileLink" placeholder="Presentation or resource link" defaultValue={editing?.fileLink || ""} />
      <textarea className="textarea" name="fileUrl" placeholder="Optional file upload (base64 data URL auto-added from upload)" defaultValue={editing?.fileUrl || ""} />
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
      <select className="select" name="speakerId" defaultValue={editing?.speakerId || ""}>
        <option value="">Assign speaker (optional)</option>
        {attendees.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="button" type="submit">{editing ? "Save changes" : "Create session"}</button>
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

function SurveyForm({ token, onCreated }: { token: string; onCreated: (s: Survey) => void }) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "");
    const question = String(form.get("question") || "");
    const survey = await apiFetch<Survey>("/surveys", {
      method: "POST",
      body: JSON.stringify({
        title,
        questions: [{ prompt: question, type: "TEXT" }],
      }),
    }, token);
    onCreated(survey);
    event.currentTarget.reset();
  }

  return (
    <form className="card grid" onSubmit={handleSubmit}>
      <h3>New survey</h3>
      <input className="input" name="title" placeholder="Survey title" required />
      <input className="input" name="question" placeholder="Single question" required />
      <button className="button">Create survey</button>
    </form>
  );
}

function SurveyCard({ survey, token }: { survey: Survey; token: string }) {
  async function submitAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const answers = survey.questions.map((q) => ({
      questionId: q.id,
      answer: String(form.get(q.id) || ""),
    }));
    await apiFetch(`/surveys/${survey.id}/answers`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }, token);
    event.currentTarget.reset();
    alert("Thanks for your response!");
  }

  return (
    <form className="card grid" onSubmit={submitAnswer}>
      <h3>{survey.title}</h3>
      {survey.questions.map((q) => (
        <input key={q.id} className="input" name={q.id} placeholder={q.prompt} required />
      ))}
      <button className="button secondary" type="submit">Submit</button>
    </form>
  );
}

function MessageComposer({
  token,
  conversationId,
  onSent,
}: { token: string; conversationId: string | null; onSent: (m: Message) => void }) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationId) return;
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const message = await apiFetch<Message>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    }, token);
    onSent(message);
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
  onCreated,
}: {
  attendees: User[];
  currentUserId: string;
  token: string;
  onCreated: (c: Conversation) => void;
}) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = String(form.get("userId") || "");
    if (!userId) return;
    const conversation = await apiFetch<Conversation>("/conversations/direct", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }, token);
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
      <button className="button secondary">Start</button>
    </form>
  );
}

function GroupChatForm({
  attendees,
  currentUserId,
  token,
  onCreated,
}: {
  attendees: User[];
  currentUserId: string;
  token: string;
  onCreated: (c: Conversation) => void;
}) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "");
    const memberIds = form.getAll("memberIds").map((id) => String(id)).filter((id) => id && id !== currentUserId);
    if (!name || memberIds.length === 0) return;
    const conversation = await apiFetch<Conversation>("/conversations/group", {
      method: "POST",
      body: JSON.stringify({ name, memberIds }),
    }, token);
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
      <button className="button secondary">Create</button>
    </form>
  );
}

function formatConversationName(conversation: Conversation, currentUser: User) {
  if (conversation.type === "EVENT") return conversation.name || "Event Chat";
  if (conversation.type === "GROUP") return conversation.name || "Group Chat";
  const other = conversation.members.find((m) => m.user.id !== currentUser.id);
  return other ? other.user.name : "Direct Chat";
}

function CheckInSelf({ token }: { token: string }) {
  const [status, setStatus] = useState<string | null>(null);

  async function handleCheckIn() {
    await apiFetch("/checkins", { method: "POST" }, token);
    setStatus("Checked in!");
  }

  return (
    <div className="card">
      <h3>Check in</h3>
      <p style={{ color: "var(--ink-700)" }}>Tap below to check yourself in.</p>
      <button className="button" onClick={handleCheckIn}>Check in</button>
      {status && <p style={{ color: "var(--blue-700)" }}>{status}</p>}
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
