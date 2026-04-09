import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";

type User = { id: string; name: string; email: string; role: "ADMIN" | "ATTENDEE" | "SPEAKER" };

type Event = { id: string; name: string; timezone: string; startDate: string; endDate: string };

type Session = { id: string; title: string; description?: string; startsAt: string; endsAt: string; speaker?: { name: string }; speakerId?: string | null };

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

type CheckIn = { id: string; user: { id: string; name: string; email: string; role: string }; createdAt: string };

const tabs = ["Agenda", "Attendees", "Announcements", "Surveys", "Messages", "Check-In"] as const;

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

  const handleLogout = () => {
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("user");
    window.location.href = "/";
  };

  if (!user) return null;

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>{event?.name || "Event Dashboard"}</h1>
          <p style={{ color: "var(--ink-700)" }}>{user.name} · {user.role}</p>
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
        <div className="grid">
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
          {sessions.map((s) => (
            <div className="card" key={s.id}>
              <h3>{s.title}</h3>
              <p style={{ color: "var(--ink-700)" }}>{s.description}</p>
              <p style={{ color: "var(--ink-500)" }}>
                {new Date(s.startsAt).toLocaleString()} - {new Date(s.endsAt).toLocaleString()}
              </p>
              {s.speaker?.name && <span className="badge">Speaker: {s.speaker.name}</span>}
              {isAdmin && (
                <div style={{ marginTop: 10 }}>
                  <button className="button secondary" onClick={() => setEditingSession(s)}>Edit</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {active === "Attendees" && (
        <div className="grid two">
          {attendees.map((a) => (
            <div className="card" key={a.id}>
              <h3>{a.name}</h3>
              <p style={{ color: "var(--ink-700)" }}>{a.email}</p>
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

  return (
    <form className="card grid" onSubmit={handleSubmit}>
      <h3>{editing ? "Edit session" : "New session"}</h3>
      <input className="input" name="title" placeholder="Session title" required defaultValue={editing?.title || ""} />
      <textarea className="textarea" name="description" placeholder="Description" defaultValue={editing?.description || ""} />
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
          <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
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
