import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ATTENDEE" | "SPEAKER";
  photoUrl?: string | null;
  researchInterests?: string | null;
  participantType?: "GRAD_STUDENT" | "PROFESSOR" | null;
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
  attendances?: {
    userId: string;
    status: "JOINING" | "NOT_JOINING";
    joinMode?: "VIRTUAL" | "IN_PERSON" | null;
    user: Pick<User, "id" | "name" | "email" | "photoUrl">;
  }[];
  likes?: { userId: string; user: Pick<User, "id" | "name" | "email" | "photoUrl"> }[];
};

type ThreadAuthor = { id: string; name: string; role: string; photoUrl?: string | null };
type SessionReply = { id: string; body: string; createdAt: string; author: ThreadAuthor };
type SessionThread = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  author: ThreadAuthor;
  replies: SessionReply[];
};

type SessionAttendance = {
  sessionId: string;
  status: "JOINING" | "NOT_JOINING";
  joinMode?: "VIRTUAL" | "IN_PERSON" | null;
};

type MySessionMeta = { attendance: SessionAttendance[]; likedSessionIds: string[] };

function withEventHeaders(activeEventId: string | null, extra: RequestInit = {}): RequestInit {
  if (!activeEventId) return extra;
  const h = (extra.headers as Record<string, string> | undefined) || {};
  return { ...extra, headers: { ...h, "x-event-id": activeEventId } };
}

function formatTimeRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function formatEventRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${endDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

export default function SessionPage() {
  const router = useRouter();
  const sessionId = typeof router.query.sessionId === "string" ? router.query.sessionId : null;

  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [threads, setThreads] = useState<SessionThread[]>([]);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [myAttendance, setMyAttendance] = useState<SessionAttendance[]>([]);
  const [likedSessionIds, setLikedSessionIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async (t: string) => {
    const fresh = await apiFetch<User>("/auth/me", {}, t);
    setUser(fresh);
    window.localStorage.setItem("user", JSON.stringify(fresh));
  }, []);

  const reloadSessionAndMessages = useCallback(async () => {
    if (!token || !sessionId) return;
    const evId = window.localStorage.getItem("activeEventId");
    const ev = withEventHeaders(evId);
    const [sess, threadList, meta] = await Promise.all([
      apiFetch<Session>(`/sessions/${sessionId}`, ev, token),
      apiFetch<SessionThread[]>(`/sessions/${sessionId}/conversations`, {}, token),
      apiFetch<MySessionMeta>("/sessions/me", {}, token),
    ]);
    setSession(sess);
    setThreads(threadList);
    setOpenThreadId((current) => current ?? threadList[0]?.id ?? null);
    setMyAttendance(meta.attendance);
    setLikedSessionIds(meta.likedSessionIds);
  }, [token, sessionId]);

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
    if (!token || !sessionId || router.isReady === false) return;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const evId = window.localStorage.getItem("activeEventId");
        const ev = withEventHeaders(evId);
        const [evData, sess, threadList, meta] = await Promise.all([
          apiFetch<Event>("/event", ev, token),
          apiFetch<Session>(`/sessions/${sessionId}`, ev, token),
          apiFetch<SessionThread[]>(`/sessions/${sessionId}/conversations`, {}, token),
          apiFetch<MySessionMeta>("/sessions/me", {}, token),
        ]);
        setEvent(evData);
        setSession(sess);
        setThreads(threadList);
        setOpenThreadId((current) => current ?? threadList[0]?.id ?? null);
        setMyAttendance(meta.attendance);
        setLikedSessionIds(meta.likedSessionIds);
      } catch {
        setLoadError("This session could not be loaded. It may have been removed or you may need to select the right event in your profile.");
        setSession(null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token, sessionId, router.isReady]);

  const patchAttendance = async (body: { status: "JOINING" | "NOT_JOINING"; joinMode?: "VIRTUAL" | "IN_PERSON" }) => {
    if (!token || !sessionId) return;
    await apiFetch(`/sessions/${sessionId}/attendance`, {
      method: "PUT",
      body: JSON.stringify(body),
    }, token);
    const meta = await apiFetch<MySessionMeta>("/sessions/me", {}, token);
    setMyAttendance(meta.attendance);
    if (body.status === "JOINING") await refreshUser(token);
    await reloadSessionAndMessages();
  };

  const toggleLike = async () => {
    if (!token || !sessionId) return;
    const liked = likedSessionIds.includes(sessionId);
    if (liked) {
      await apiFetch(`/sessions/${sessionId}/like`, { method: "DELETE" }, token);
      setLikedSessionIds((prev) => prev.filter((id) => id !== sessionId));
    } else {
      await apiFetch(`/sessions/${sessionId}/like`, { method: "PUT" }, token);
      setLikedSessionIds((prev) => [...prev, sessionId]);
    }
    await refreshUser(token);
    await reloadSessionAndMessages();
  };

  const createThread = async (title: string, body: string) => {
    if (!token || !sessionId) return;
    const thread = await apiFetch<SessionThread>(`/sessions/${sessionId}/conversations`, {
      method: "POST",
      body: JSON.stringify({ title, body }),
    }, token);
    setThreads((prev) => [thread, ...prev]);
    setOpenThreadId(thread.id);
    await refreshUser(token);
  };

  const sendReply = async (threadId: string, body: string) => {
    if (!token || !sessionId) return;
    const reply = await apiFetch<SessionReply>(`/sessions/${sessionId}/conversations/${threadId}/replies`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }, token);
    setThreads((prev) =>
      prev.map((thread) => (
        thread.id === threadId ? { ...thread, replies: [...thread.replies, reply] } : thread
      )),
    );
    await refreshUser(token);
  };

  const deleteThread = async (threadId: string) => {
    if (!token || !sessionId) return;
    await apiFetch(`/sessions/${sessionId}/conversations/${threadId}`, { method: "DELETE" }, token);
    setThreads((prev) => prev.filter((thread) => thread.id !== threadId));
    setOpenThreadId((current) => (current === threadId ? null : current));
  };

  if (!user || !sessionId) {
    return null;
  }

  const myRow = myAttendance.find((a) => a.sessionId === sessionId);
  const joining = myRow?.status === "JOINING";
  const myMode = myRow?.joinMode ?? "IN_PERSON";
  const liked = sessionId ? likedSessionIds.includes(sessionId) : false;
  const attendanceLabel = joining && session
    ? (new Date() > new Date(session.endsAt) ? "Joined" : "Joining")
    : "Join";
  const openThread = threads.find((thread) => thread.id === openThreadId) ?? null;

  return (
    <div className="container">
      {event && (
        <div
          className="hero-banner"
          style={event.bannerUrl ? { backgroundImage: `url(${event.bannerUrl})` } : undefined}
        />
      )}
      <div className="header app-shell">
        <div>
          <p style={{ margin: "0 0 6px" }}>
            <Link href="/dashboard" className="session-back-link">
              ← Back to schedule
            </Link>
          </p>
          <h1 style={{ margin: 0 }}>{event?.name || "Event"}</h1>
          <p style={{ color: "var(--ink-muted)", margin: "8px 0 0" }}>
            {user.name} · Session discussion {event && ` · ${formatEventRange(event.startDate, event.endDate)}`}
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            window.localStorage.removeItem("token");
            window.localStorage.removeItem("user");
            window.location.href = "/";
          }}
        >
          Logout
        </button>
      </div>

      {loading && <p className="help-text">Loading session…</p>}
      {loadError && (
        <div className="card">
          <p>{loadError}</p>
          <Link href="/dashboard" className="button" style={{ display: "inline-block", marginTop: 12 }}>
            Return to dashboard
          </Link>
        </div>
      )}

      {!loading && session && (
        <>
          <div className="card session-page-header">
            {session.imageUrl && (
              <img src={session.imageUrl} alt="" className="session-page-image" />
            )}
            <h2 style={{ margin: "0 0 8px", fontFamily: "Merriweather, Georgia, serif" }}>{session.title}</h2>
            <p style={{ color: "var(--ink-muted)", margin: "0 0 12px" }}>{formatTimeRange(session.startsAt, session.endsAt)}</p>
            {(session.speakers || session.speaker?.name) && (
              <p style={{ margin: "0 0 8px" }}>
                <strong>Speakers:</strong> {session.speakers || session.speaker?.name}
              </p>
            )}
            {session.location && (
              <p style={{ margin: "0 0 8px" }}>
                <strong>Location:</strong> {session.location}
              </p>
            )}
            {session.description && <p style={{ margin: "12px 0", lineHeight: 1.5 }}>{session.description}</p>}
            <div className="schedule-links" style={{ marginBottom: 12 }}>
              {session.zoomLink && (
                <a href={session.zoomLink} target="_blank" rel="noreferrer">Zoom</a>
              )}
              {session.recordingUrl && (
                <a href={session.recordingUrl} target="_blank" rel="noreferrer">Recording</a>
              )}
              {session.fileLink && (
                <a href={session.fileLink} target="_blank" rel="noreferrer">Resources</a>
              )}
              {session.fileUrl && (
                <a href={session.fileUrl} target="_blank" rel="noreferrer">Materials</a>
              )}
            </div>

            <div className="session-page-toolbar">
              <div
                className="session-attendance-block"
                role="group"
                aria-label="Session attendance"
              >
                <button
                  type="button"
                  className={`attendance-join-dot ${joining ? "is-on" : ""}`}
                  aria-pressed={joining}
                  aria-label={joining ? "Leave session" : "Join session"}
                  onClick={() =>
                    patchAttendance(joining ? { status: "NOT_JOINING" } : { status: "JOINING", joinMode: "IN_PERSON" })
                  }
                />
                <span className="attendance-join-text">{attendanceLabel}</span>
                {joining && (
                  <div className="join-mode-switch" role="group" aria-label="Attendance mode">
                    <button
                      type="button"
                      className={myMode === "VIRTUAL" ? "is-active" : ""}
                      onClick={() => patchAttendance({ status: "JOINING", joinMode: "VIRTUAL" })}
                    >
                      Virtual
                    </button>
                    <button
                      type="button"
                      className={myMode === "IN_PERSON" ? "is-active" : ""}
                      onClick={() => patchAttendance({ status: "JOINING", joinMode: "IN_PERSON" })}
                    >
                      In person
                    </button>
                  </div>
                )}
              </div>
              <button type="button" className={liked ? "button" : "button secondary"} onClick={() => toggleLike()}>
                Like
              </button>
            </div>
          </div>

          <div className="card session-conversation-card">
            <h3 style={{ marginTop: 0 }}>Session conversations</h3>
            <p className="help-text" style={{ marginTop: 0 }}>
              Start a titled conversation for this session, or open an existing one to read and reply. Direct and group chats stay under Messages on the dashboard.
            </p>
            <form
              className="grid"
              style={{ gap: 10 }}
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const title = String(form.get("title") || "").trim();
                const body = String(form.get("body") || "").trim();
                if (!title || !body) return;
                await createThread(title, body);
                e.currentTarget.reset();
              }}
            >
              <input className="input" name="title" placeholder="Conversation title" required />
              <textarea className="textarea" name="body" placeholder="Start a new session conversation…" required rows={3} />
              <button type="submit" className="button">Start conversation</button>
            </form>
            <div className="session-thread-layout">
              <div className="session-thread-list">
                {threads.length === 0 && <p className="help-text">No conversations yet — start the first one.</p>}
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className={`session-thread-link ${thread.id === openThreadId ? "is-active" : ""}`}
                    onClick={() => setOpenThreadId(thread.id)}
                  >
                    <strong>{thread.title}</strong>
                    <span className="help-text">
                      {thread.author.name} · {thread.replies.length} replies
                    </span>
                  </button>
                ))}
              </div>
              <div className="session-message-list">
                {!openThread && threads.length > 0 && <p className="help-text">Select a conversation title to read the thread.</p>}
                {openThread && (
                  <div className="session-thread-detail">
                    <div className="session-message-row">
                      <div className="session-message-author">
                        {openThread.author.photoUrl ? (
                          <img src={openThread.author.photoUrl} alt="" className="session-message-avatar" />
                        ) : (
                          <div className="session-message-avatar session-message-avatar-ph">{openThread.author.name.charAt(0)}</div>
                        )}
                        <div>
                          <strong>{openThread.title}</strong>
                          <div className="help-text">
                            {openThread.author.name} · {openThread.author.role} · {new Date(openThread.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{openThread.body}</p>
                      {user.role === "ADMIN" && (
                        <div style={{ marginTop: 10 }}>
                          <button type="button" className="button secondary" onClick={() => deleteThread(openThread.id)}>
                            Delete conversation
                          </button>
                        </div>
                      )}
                    </div>
                    {openThread.replies.map((reply) => (
                      <div key={reply.id} className="session-message-row">
                        <div className="session-message-author">
                          {reply.author.photoUrl ? (
                            <img src={reply.author.photoUrl} alt="" className="session-message-avatar" />
                          ) : (
                            <div className="session-message-avatar session-message-avatar-ph">{reply.author.name.charAt(0)}</div>
                          )}
                          <div>
                            <strong>{reply.author.name}</strong>
                            <span className="help-text"> · {reply.author.role} · {new Date(reply.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                        <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{reply.body}</p>
                      </div>
                    ))}
                    <form
                      className="grid"
                      style={{ gap: 8, marginTop: 8 }}
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        const body = String(form.get("body") || "").trim();
                        if (!body) return;
                        await sendReply(openThread.id, body);
                        e.currentTarget.reset();
                      }}
                    >
                      <textarea className="textarea" name="body" placeholder="Reply to this conversation…" required rows={2} />
                      <button type="submit" className="button secondary">Reply</button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
