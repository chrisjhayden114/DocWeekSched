import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveFeatureEnabled, type FeatureKey, type FeatureOverrideValue } from "@event-app/shared";
import { OnlineMeetingLink } from "../../components/OnlineMeetingLink";
import { ConciergeChat } from "../../components/ConciergeChat";
import { apiFetch, clearAuthClientState } from "../../lib/api";
import { formatEventTimeRange } from "../../lib/dateFormat";
import { offerPushAfterFirstAgendaSave } from "../../lib/push";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const RESOURCE_DATA_URL_MAX_CHARS = 4_500_000;

type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ATTENDEE" | "SPEAKER";
  photoUrl?: string | null;
  researchInterests?: string | null;
  participantType?: "GRAD_STUDENT" | "EDD_STUDENT" | "PHD_STUDENT" | "EDL_ALUMNI" | "PROFESSOR" | null;
  engagementPoints?: number;
  isEventAdmin?: boolean;
};

type Event = {
  id: string;
  name: string;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
};

type AgendaJoinMode = "VIRTUAL" | "IN_PERSON" | "ASYNC";

function agendaJoinModeLabel(mode: AgendaJoinMode | null | undefined): string {
  if (mode === "VIRTUAL") return "Virtual";
  if (mode === "ASYNC") return "Asynchronous (time zone)";
  return "In person";
}

type Session = {
  id: string;
  title: string;
  description?: string;
  location?: string | null;
  roomId?: string | null;
  room?: { id: string; name: string } | null;
  speakers?: string | null;
  zoomLink?: string | null;
  recordingUrl?: string | null;
  fileUrl?: string | null;
  fileLink?: string | null;
  imageUrl?: string | null;
  startsAt: string;
  endsAt: string;
  allowVirtualJoin?: boolean | null;
  inPersonCapacity?: number | null;
  virtualCapacity?: number | null;
  speaker?: { name: string };
  speakerId?: string | null;
  sessionSpeakers?: {
    sortOrder: number;
    speaker: { id: string; name: string; title?: string | null; affiliation?: string | null; photoUrl?: string | null };
  }[];
  items?: {
    id: string;
    title: string;
    sortOrder: number;
    authors: { name: string; sortOrder: number }[];
    discussantSpeaker?: { id: string; name: string } | null;
  }[];
  attendances?: {
    userId: string;
    status: "JOINING" | "NOT_JOINING";
    joinMode?: AgendaJoinMode | null;
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
  upvoteCount?: number;
  upvotedByMe?: boolean;
  isAnswered?: boolean;
  isHidden?: boolean;
};

type SessionPoll = {
  id: string;
  question: string;
  status: "DRAFT" | "OPEN" | "CLOSED";
  showResultsToAttendees: boolean;
  myOptionId: string | null;
  options: { id: string; label: string; sortOrder: number; voteCount?: number }[];
};

type FeedbackState = {
  sessionEnded: boolean;
  mine: { rating: number; comment?: string | null } | null;
  summary: { count: number; average: number | null } | null;
};

type SessionResource = {
  id: string;
  title: string;
  kind: "LINK" | "FILE";
  url: string;
  createdAt: string;
  user: Pick<User, "id" | "name" | "role">;
};

type SessionAttendance = {
  sessionId: string;
  status: "JOINING" | "NOT_JOINING";
  joinMode?: AgendaJoinMode | null;
};

type MySessionMeta = { attendance: SessionAttendance[]; likedSessionIds: string[] };

function withEventHeaders(activeEventId: string | null, extra: RequestInit = {}): RequestInit {
  if (!activeEventId) return extra;
  const h = (extra.headers as Record<string, string> | undefined) || {};
  return { ...extra, headers: { ...h, "x-event-id": activeEventId } };
}

function formatEventRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${endDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function toGoogleCalendarUtc(dateString: string) {
  return new Date(dateString).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function openGoogleCalendar(session: Session, eventName: string) {
  const title = `${session.title} (${eventName})`;
  const details = [session.description, session.zoomLink ? `Meeting: ${session.zoomLink}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", title);
  url.searchParams.set("dates", `${toGoogleCalendarUtc(session.startsAt)}/${toGoogleCalendarUtc(session.endsAt)}`);
  if (session.location) url.searchParams.set("location", session.location);
  if (details) url.searchParams.set("details", details);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function downloadSessionIcs(session: Session, eventName: string) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EventPilot//EN",
    "BEGIN:VEVENT",
    `UID:${session.id}@eventpilot`,
    `DTSTAMP:${toGoogleCalendarUtc(new Date().toISOString())}`,
    `DTSTART:${toGoogleCalendarUtc(session.startsAt)}`,
    `DTEND:${toGoogleCalendarUtc(session.endsAt)}`,
    `SUMMARY:${session.title.replace(/[,;\\]/g, " ")} (${eventName.replace(/[,;\\]/g, " ")})`,
    session.location ? `LOCATION:${session.location.replace(/[,;\\]/g, " ")}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${session.title.slice(0, 40).replace(/[^\w\- ]+/g, "") || "session"}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") resolve(r);
      else reject(new Error("Could not read file"));
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function fetchSessionResources(token: string, sessionId: string): Promise<SessionResource[]> {
  const evId = window.localStorage.getItem("activeEventId");
  const res = await fetch(`${API_URL}/sessions/${sessionId}/resources`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(evId ? { "x-event-id": evId } : {}),
    },
  });
  if (res.status === 403) {
    return [];
  }
  if (!res.ok) {
    return [];
  }
  return (await res.json()) as SessionResource[];
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
  const [qaSort, setQaSort] = useState<"recent" | "votes">("votes");
  const [polls, setPolls] = useState<SessionPoll[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [pollsOn, setPollsOn] = useState(false);
  const [feedbackOn, setFeedbackOn] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [myAttendance, setMyAttendance] = useState<SessionAttendance[]>([]);
  const [likedSessionIds, setLikedSessionIds] = useState<string[]>([]);
  const [resources, setResources] = useState<SessionResource[]>([]);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<"MY" | "EVENT">("MY");
  const myTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const [resourceKind, setResourceKind] = useState<"LINK" | "FILE">("LINK");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [venueMapsOn, setVenueMapsOn] = useState(false);
  const [conciergeOn, setConciergeOn] = useState(false);
  const [roomMapPin, setRoomMapPin] = useState<{ mapId: string; pinId: string } | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);

  const refreshUser = useCallback(async (t: string) => {
    const fresh = await apiFetch<User>("/auth/me", {}, t);
    setUser(fresh);
    window.localStorage.setItem("user", JSON.stringify(fresh));
  }, []);

  const reloadSessionAndMessages = useCallback(async () => {
    if (!token || !sessionId) return;
    const evId = window.localStorage.getItem("activeEventId");
    const ev = withEventHeaders(evId);
    const [sess, threadList, meta, resourceList] = await Promise.all([
      apiFetch<Session>(`/sessions/${sessionId}`, ev, token),
      apiFetch<SessionThread[]>(`/sessions/${sessionId}/conversations?sort=${qaSort}`, ev, token),
      apiFetch<MySessionMeta>("/sessions/me", ev, token),
      fetchSessionResources(token, sessionId),
    ]);
    setSession(sess);
    setThreads(threadList);
    setOpenThreadId((current) => current ?? threadList[0]?.id ?? null);
    setMyAttendance(meta.attendance);
    setLikedSessionIds(meta.likedSessionIds);
    setResources(resourceList);
  }, [token, sessionId, qaSort]);

  const reloadPollsAndFeedback = useCallback(async () => {
    if (!token || !sessionId) return;
    const evId = window.localStorage.getItem("activeEventId");
    const ev = withEventHeaders(evId);
    if (pollsOn) {
      try {
        const list = await apiFetch<SessionPoll[]>(`/polls/session/${sessionId}`, ev, token);
        setPolls(list);
      } catch {
        setPolls([]);
      }
    }
    if (feedbackOn) {
      try {
        const fb = await apiFetch<FeedbackState>(`/feedback/session/${sessionId}`, ev, token);
        setFeedback(fb);
      } catch {
        setFeedback(null);
      }
    }
  }, [token, sessionId, pollsOn, feedbackOn]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fresh = await apiFetch<User>("/auth/me");
        if (cancelled) return;
        setUser(fresh);
        window.localStorage.setItem("user", JSON.stringify(fresh));
        window.localStorage.removeItem("token");
        setToken("session");
      } catch {
        if (!cancelled) {
          clearAuthClientState();
          window.location.href = "/";
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
          apiFetch<SessionThread[]>(`/sessions/${sessionId}/conversations?sort=${qaSort}`, ev, token),
          apiFetch<MySessionMeta>("/sessions/me", ev, token),
        ]);
        setEvent(evData);
        setSession(sess);
        setThreads(threadList);
        setOpenThreadId((current) => current ?? threadList[0]?.id ?? null);
        setMyAttendance(meta.attendance);
        setLikedSessionIds(meta.likedSessionIds);
        setResources(await fetchSessionResources(token, sessionId));
      } catch {
        setLoadError("This session could not be loaded. It may have been removed or you may need to select the right event in your profile.");
        setSession(null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token, sessionId, router.isReady, qaSort]);

  useEffect(() => {
    const evId = window.localStorage.getItem("activeEventId");
    if (!token || !evId) return;
    const ev = withEventHeaders(evId);
    let cancelled = false;
    (async () => {
      try {
        const feats = await apiFetch<{
          overrides: Partial<Record<FeatureKey, FeatureOverrideValue>>;
          features: { key: FeatureKey; enabled: boolean }[];
        }>("/event/features", ev, token);
        const enabled = (key: FeatureKey) =>
          feats.features?.find((f) => f.key === key)?.enabled ??
          resolveFeatureEnabled(key, feats.overrides || {});
        const on = enabled("venue_maps");
        const concierge = enabled("concierge");
        const pollsEnabled = enabled("session_polls");
        const feedbackEnabled = enabled("session_feedback");
        if (cancelled) return;
        setVenueMapsOn(on);
        setConciergeOn(concierge);
        setPollsOn(pollsEnabled);
        setFeedbackOn(feedbackEnabled);
        setActiveEventId(evId);
        setCanManage(Boolean(user?.isEventAdmin) || user?.role === "ADMIN");
        if (!session?.roomId || !on) {
          setRoomMapPin(null);
          return;
        }
        const pin = await apiFetch<{ id: string; mapId: string; map: { id: string } }>(
          `/event/maps/by-room/${session.roomId}`,
          ev,
          token,
        ).catch(() => null);
        if (cancelled) return;
        setRoomMapPin(pin ? { mapId: pin.mapId || pin.map.id, pinId: pin.id } : null);
      } catch {
        if (!cancelled) {
          setVenueMapsOn(false);
          setRoomMapPin(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, session?.roomId, session?.id, user?.role, user?.isEventAdmin]);

  useEffect(() => {
    void reloadPollsAndFeedback();
  }, [reloadPollsAndFeedback]);

  // Live polling for Q&A + polls (no websockets)
  useEffect(() => {
    if (!token || !sessionId) return;
    const id = window.setInterval(() => {
      void reloadSessionAndMessages();
      void reloadPollsAndFeedback();
    }, 8000);
    return () => window.clearInterval(id);
  }, [token, sessionId, reloadSessionAndMessages, reloadPollsAndFeedback]);

  const patchAttendance = async (body: { status: "JOINING" | "NOT_JOINING"; joinMode?: AgendaJoinMode }) => {
    if (!token || !sessionId) return;
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
      const meta = await apiFetch<MySessionMeta>("/sessions/me", withEventHeaders(window.localStorage.getItem("activeEventId")), token);
      setMyAttendance(meta.attendance);
      if (body.status === "JOINING") {
        void refreshUser(token);
        void offerPushAfterFirstAgendaSave(token);
      }
      void reloadSessionAndMessages();
    } catch {
      setMyAttendance(prevAttendance);
    }
  };

  const toggleLike = async () => {
    if (!token || !sessionId) return;
    const liked = likedSessionIds.includes(sessionId);
    const prevLikes = likedSessionIds;
    if (liked) {
      setLikedSessionIds((prev) => prev.filter((id) => id !== sessionId));
      try {
        await apiFetch(`/sessions/${sessionId}/like`, { method: "DELETE" }, token);
        void refreshUser(token);
        void reloadSessionAndMessages();
      } catch {
        setLikedSessionIds(prevLikes);
      }
    } else {
      setLikedSessionIds((prev) => [...prev, sessionId]);
      try {
        await apiFetch(`/sessions/${sessionId}/like`, { method: "PUT" }, token);
        void refreshUser(token);
        void reloadSessionAndMessages();
      } catch {
        setLikedSessionIds(prevLikes);
      }
    }
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

  const deleteReply = async (threadId: string, replyId: string) => {
    if (!token || !sessionId) return;
    await apiFetch(`/sessions/${sessionId}/conversations/${threadId}/replies/${replyId}`, { method: "DELETE" }, token);
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === threadId ? { ...thread, replies: thread.replies.filter((row) => row.id !== replyId) } : thread,
      ),
    );
  };

  const toggleUpvote = async (threadId: string, currentlyUpvoted: boolean) => {
    if (!token || !sessionId) return;
    const path = `/sessions/${sessionId}/conversations/${threadId}/upvote`;
    const res = await apiFetch<{ upvoteCount: number; upvotedByMe: boolean }>(
      path,
      { method: currentlyUpvoted ? "DELETE" : "POST" },
      token,
    );
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId ? { ...t, upvoteCount: res.upvoteCount, upvotedByMe: res.upvotedByMe } : t,
      ),
    );
  };

  const setAnswered = async (threadId: string, answered: boolean) => {
    if (!token || !sessionId) return;
    await apiFetch(`/sessions/${sessionId}/conversations/${threadId}/answered`, {
      method: "POST",
      body: JSON.stringify({ answered }),
    }, token);
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, isAnswered: answered } : t)));
  };

  const hideThread = async (threadId: string) => {
    if (!token || !sessionId) return;
    await apiFetch(`/sessions/${sessionId}/conversations/${threadId}/hide`, {
      method: "POST",
      body: JSON.stringify({ hidden: true }),
    }, token);
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    setOpenThreadId((current) => (current === threadId ? null : current));
  };

  const votePoll = async (pollId: string, optionId: string) => {
    if (!token) return;
    await apiFetch(`/polls/${pollId}/vote`, {
      method: "POST",
      body: JSON.stringify({ optionId }),
    }, token);
    await reloadPollsAndFeedback();
  };

  const submitFeedback = async (rating: number, comment: string) => {
    if (!token || !sessionId) return;
    await apiFetch(`/feedback/session/${sessionId}`, {
      method: "PUT",
      body: JSON.stringify({ rating, comment: comment || null }),
    }, token);
    await reloadPollsAndFeedback();
  };

  const deleteResource = async (resourceId: string) => {
    if (!token || !sessionId) return;
    await apiFetch(`/sessions/${sessionId}/resources/${resourceId}`, { method: "DELETE" }, token);
    setResources((prev) => prev.filter((r) => r.id !== resourceId));
    await refreshUser(token);
  };

  if (!user || !sessionId) {
    return null;
  }

  const myRow = myAttendance.find((a) => a.sessionId === sessionId);
  const joining = myRow?.status === "JOINING";
  const canShareResources = user.role === "ADMIN" || joining;
  const myMode = myRow?.joinMode ?? "IN_PERSON";
  const liked = sessionId ? likedSessionIds.includes(sessionId) : false;
  const attendanceLabel = joining && session
    ? (new Date() > new Date(session.endsAt) ? "Joined" : "Joining")
    : "Join";
  const openThread = threads.find((thread) => thread.id === openThreadId) ?? null;
  const displayTimezone = timeMode === "EVENT" ? event?.timezone || myTimezone : myTimezone;

  return (
    <div className="container">
      {event?.bannerUrl ? (
        <div className="hero-banner" style={{ backgroundImage: `url(${event.bannerUrl})` }} />
      ) : null}
      <div className="header app-shell">
        <div className="app-shell-title">
          <nav className="session-breadcrumb text-meta" aria-label="Breadcrumb">
            <Link href="/dashboard">{event?.name || "Event"}</Link>
            <span aria-hidden="true"> › </span>
            <Link href="/dashboard?tab=Agenda">Agenda</Link>
            <span aria-hidden="true"> › </span>
            <span aria-current="page">{session?.title || "Session"}</span>
          </nav>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            {event?.logoUrl ? (
              <img
                src={event.logoUrl}
                alt=""
                width={44}
                height={44}
                style={{
                  objectFit: "contain",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  padding: 4,
                }}
              />
            ) : null}
            <h1 style={{ margin: 0 }}>{event?.name || "Event"}</h1>
          </div>
          <p className="app-shell-subtitle" style={{ color: "var(--ink-muted)", margin: "8px 0 0" }}>
            {user.name}
            {event ? ` · ${formatEventRange(event.startDate, event.endDate)}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            clearAuthClientState();
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
            {session.imageUrl ? (
              <img src={session.imageUrl} alt="" className="session-page-image" />
            ) : (
              <div className="session-title-banner" aria-hidden="true">
                <span className="session-title-banner-label">{session.title}</span>
              </div>
            )}
            <h2 style={{ margin: "0 0 8px", fontFamily: "Merriweather, Georgia, serif" }}>{session.title}</h2>
            <p style={{ color: "var(--ink-muted)", margin: "0 0 8px" }}>
              {formatEventTimeRange(session.startsAt, session.endsAt, displayTimezone)}
              {session.room?.name ? ` · ${session.room.name}` : session.location ? ` · ${session.location}` : ""}
            </p>
            {(() => {
              const inPerson = (session.attendances || []).filter(
                (a) => a.status === "JOINING" && (a.joinMode === "IN_PERSON" || !a.joinMode),
              ).length;
              const virtual = (session.attendances || []).filter(
                (a) => a.status === "JOINING" && a.joinMode === "VIRTUAL",
              ).length;
              const hasCap = session.inPersonCapacity != null || session.virtualCapacity != null;
              if (!hasCap) return null;
              return (
                <p className="help-text" style={{ margin: "0 0 10px" }}>
                  Capacity: {inPerson}
                  {session.inPersonCapacity != null ? `/${session.inPersonCapacity}` : ""} in-person · {virtual}
                  {session.virtualCapacity != null ? `/${session.virtualCapacity}` : ""} virtual
                  {(session.inPersonCapacity != null && inPerson >= session.inPersonCapacity) ||
                  (session.virtualCapacity != null && virtual >= session.virtualCapacity)
                    ? " · Full — waitlist available from the agenda"
                    : ""}
                </p>
              );
            })()}
            <div className="nav agenda-timezone-toggle" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={timeMode === "MY" ? "active" : ""}
                onClick={() => setTimeMode("MY")}
              >
                My timezone
              </button>
              <button
                type="button"
                className={timeMode === "EVENT" ? "active" : ""}
                onClick={() => setTimeMode("EVENT")}
              >
                Event timezone
              </button>
            </div>
            {(session.sessionSpeakers && session.sessionSpeakers.length > 0) ||
            session.speakers ||
            session.speaker?.name ||
            session.location ||
            session.room?.name ? (
              <div style={{ margin: "0 0 8px" }}>
                {session.sessionSpeakers && session.sessionSpeakers.length > 0 ? (
                  <p style={{ margin: "0 0 6px" }}>
                    <strong style={{ color: "var(--ink-900)" }}>Speakers:</strong>{" "}
                    {session.sessionSpeakers.map((row, i) => (
                      <span key={row.speaker.id}>
                        {i > 0 ? " · " : ""}
                        <Link href={`/dashboard?tab=Attendees`}>{row.speaker.name}</Link>
                        {row.speaker.title || row.speaker.affiliation
                          ? ` (${[row.speaker.title, row.speaker.affiliation].filter(Boolean).join(", ")})`
                          : ""}
                      </span>
                    ))}
                  </p>
                ) : (session.speakers || session.speaker?.name) ? (
                  <p className="schedule-speaker" style={{ margin: "0 0 6px" }}>
                    <strong style={{ color: "var(--ink-900)" }}>Speakers:</strong>{" "}
                    {session.speakers || session.speaker?.name}
                  </p>
                ) : null}
                {(session.room?.name || session.location) && (
                  <p style={{ margin: 0, color: "var(--ink-muted)" }}>
                    <strong style={{ color: "var(--ink-900)" }}>Room:</strong>{" "}
                    {session.room?.name || session.location}
                  </p>
                )}
              </div>
            ) : null}
            {session.description && <p style={{ margin: "12px 0", lineHeight: 1.5 }}>{session.description}</p>}
            {session.items && session.items.length > 0 ? (
              <div style={{ margin: "16px 0" }}>
                <h3 style={{ margin: "0 0 8px", fontFamily: "Merriweather, Georgia, serif", fontSize: "1.05rem" }}>
                  Program
                </h3>
                <ol className="session-items-list" style={{ margin: 0, paddingLeft: "1.2rem" }}>
                  {session.items.map((item) => (
                    <li key={item.id} style={{ marginBottom: 8 }}>
                      <strong>{item.title}</strong>
                      {item.authors?.length ? (
                        <span className="help-text">
                          {" "}
                          — {item.authors.map((a) => a.name).join(", ")}
                        </span>
                      ) : null}
                      {item.discussantSpeaker ? (
                        <span className="help-text"> · Discussant: {item.discussantSpeaker.name}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            <div className="schedule-links" style={{ marginBottom: 12 }}>
              {session.zoomLink && <OnlineMeetingLink href={session.zoomLink} />}
              {session.recordingUrl && (
                <a href={session.recordingUrl} target="_blank" rel="noreferrer">Recording</a>
              )}
              {session.fileLink && (
                <a href={session.fileLink} target="_blank" rel="noreferrer">Resources</a>
              )}
              {session.fileUrl && (
                <a href={session.fileUrl} target="_blank" rel="noreferrer">Materials</a>
              )}
              {venueMapsOn && roomMapPin ? (
                <Link
                  href={`/dashboard?tab=Maps&mapId=${encodeURIComponent(roomMapPin.mapId)}&pinId=${encodeURIComponent(roomMapPin.pinId)}`}
                >
                  View on map
                </Link>
              ) : null}
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
                <span className="attendance-join-text">
                  {joining ? `${attendanceLabel} · ${agendaJoinModeLabel(myMode)}` : attendanceLabel}
                </span>
                {joining && session && (
                  <div className="join-mode-switch" role="group" aria-label="Attendance mode">
                    {session.allowVirtualJoin !== false && (
                      <button
                        type="button"
                        className={myMode === "VIRTUAL" ? "is-active" : ""}
                        onClick={() => patchAttendance({ status: "JOINING", joinMode: "VIRTUAL" })}
                      >
                        Virtual
                      </button>
                    )}
                    <button
                      type="button"
                      className={myMode === "IN_PERSON" ? "is-active" : ""}
                      onClick={() => patchAttendance({ status: "JOINING", joinMode: "IN_PERSON" })}
                    >
                      In person
                    </button>
                    <button
                      type="button"
                      className={myMode === "ASYNC" ? "is-active" : ""}
                      onClick={() => patchAttendance({ status: "JOINING", joinMode: "ASYNC" })}
                      title="Asynchronous – Time Zone Issues!"
                    >
                      Async
                    </button>
                  </div>
                )}
              </div>
              {session && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => openGoogleCalendar(session, event?.name || "Event")}
                >
                  Add to Google Calendar
                </button>
              )}
              {session && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => downloadSessionIcs(session, event?.name || "Event")}
                >
                  Download ICS
                </button>
              )}
              <button type="button" className={liked ? "button" : "button secondary"} onClick={() => toggleLike()}>
                Like
              </button>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Session resources</h3>
            <p className="help-text" style={{ marginTop: 0 }}>
              Links (for example Google Drive folders) or files you upload are visible to others who have joined this session. Uploads are sent as data URLs and must stay under about 4.5 MB so the server can accept them.
            </p>
            {!canShareResources && (
              <p className="help-text">Join this session to see shared resources and add your own.</p>
            )}
            {resourceError && (
              <p className="help-text" style={{ color: "var(--danger, #b91c1c)" }}>
                {resourceError}
              </p>
            )}
            {canShareResources && (
              <form
                className="grid"
                style={{ gap: 10, marginTop: 12 }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  setResourceError(null);
                  if (!token || !sessionId) return;
                  const form = e.currentTarget;
                  const title = String(new FormData(form).get("resTitle") || "").trim();
                  const kind = resourceKind;
                  if (!title) {
                    setResourceError("Add a title for this resource.");
                    return;
                  }
                  try {
                    let url = "";
                    if (kind === "LINK") {
                      url = String(new FormData(form).get("resUrl") || "").trim();
                      if (!url) {
                        setResourceError("Paste a link URL.");
                        return;
                      }
                    } else {
                      const input = form.querySelector<HTMLInputElement>('input[name="resFile"]');
                      const file = input?.files?.[0];
                      if (!file) {
                        setResourceError("Choose a file to upload.");
                        return;
                      }
                      url = await fileToDataUrl(file);
                      if (url.length > RESOURCE_DATA_URL_MAX_CHARS) {
                        setResourceError("That file is too large after encoding. Try a smaller file or share a link instead.");
                        return;
                      }
                    }
                    const evId = window.localStorage.getItem("activeEventId");
                    await apiFetch<SessionResource>(
                      `/sessions/${sessionId}/resources`,
                      {
                        method: "POST",
                        body: JSON.stringify({ title, kind, url }),
                        headers: { ...(evId ? { "x-event-id": evId } : {}) },
                      },
                      token,
                    );
                    form.reset();
                    setResourceKind("LINK");
                    await refreshUser(token);
                    setResources(await fetchSessionResources(token, sessionId));
                  } catch (err) {
                    setResourceError(err instanceof Error ? err.message : "Could not add resource.");
                  }
                }}
              >
                <input className="input" name="resTitle" placeholder="Title (e.g. Lab data folder)" required />
                <div className="join-mode-switch" role="group" aria-label="Resource type">
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="resKind"
                      value="LINK"
                      checked={resourceKind === "LINK"}
                      onChange={() => setResourceKind("LINK")}
                    />
                    Link
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="resKind"
                      value="FILE"
                      checked={resourceKind === "FILE"}
                      onChange={() => setResourceKind("FILE")}
                    />
                    File
                  </label>
                </div>
                {resourceKind === "LINK" ? (
                  <input className="input" name="resUrl" type="url" placeholder="https://…" />
                ) : (
                  <input className="input" name="resFile" type="file" />
                )}
                <button type="submit" className="button secondary">
                  Add resource
                </button>
              </form>
            )}
            <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
              {resources.length === 0 && <li className="help-text">No resources yet.</li>}
              {resources.map((r) => {
                const canDelete = user.role === "ADMIN" || r.user.id === user.id;
                return (
                  <li
                    key={r.id}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                      <strong style={{ display: "block" }}>{r.title}</strong>
                      <span className="help-text">
                        {r.user.name} · {r.kind === "LINK" ? "Link" : "File"} · {new Date(r.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <a
                      className="button secondary"
                      href={r.url}
                      {...(r.kind === "LINK" ? { target: "_blank", rel: "noreferrer" } : { download: r.title })}
                      style={{ display: "inline-block", textAlign: "center", textDecoration: "none" }}
                    >
                      Open
                    </a>
                    {canDelete && (
                      <button type="button" className="button secondary" onClick={() => deleteResource(r.id)}>
                        Remove
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card session-conversation-card">
            <h3 style={{ marginTop: 0 }}>Session Q&amp;A</h3>
            <p className="help-text" style={{ marginTop: 0 }}>
              Ask questions, upvote what matters, and (for organizers) mark answered or hide. Updates every few seconds.
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                className={qaSort === "votes" ? "button" : "button secondary"}
                onClick={() => setQaSort("votes")}
              >
                Top votes
              </button>
              <button
                type="button"
                className={qaSort === "recent" ? "button" : "button secondary"}
                onClick={() => setQaSort("recent")}
              >
                Recent
              </button>
            </div>
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
                    <strong>
                      {thread.isAnswered ? "✓ " : ""}
                      {thread.title}
                    </strong>
                    <span className="help-text">
                      {thread.upvoteCount ?? 0} votes · {thread.author.name} · {thread.replies.length} replies
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
                            {openThread.isAnswered ? " · Answered" : ""}
                          </div>
                        </div>
                      </div>
                      <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{openThread.body}</p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                        <button
                          type="button"
                          className={openThread.upvotedByMe ? "button" : "button secondary"}
                          onClick={() => void toggleUpvote(openThread.id, Boolean(openThread.upvotedByMe))}
                        >
                          ▲ {openThread.upvoteCount ?? 0}
                        </button>
                        {canManage ? (
                          <>
                            <button
                              type="button"
                              className="button secondary"
                              onClick={() => void setAnswered(openThread.id, !openThread.isAnswered)}
                            >
                              {openThread.isAnswered ? "Unmark answered" : "Mark answered"}
                            </button>
                            <button type="button" className="button secondary" onClick={() => void hideThread(openThread.id)}>
                              Hide
                            </button>
                            <button type="button" className="button secondary" onClick={() => deleteThread(openThread.id)}>
                              Delete
                            </button>
                          </>
                        ) : null}
                      </div>
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
                        {canManage && (
                          <button
                            type="button"
                            className="button secondary"
                            style={{ marginTop: 8 }}
                            onClick={() => deleteReply(openThread.id, reply.id)}
                          >
                            Delete reply
                          </button>
                        )}
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

          {pollsOn ? (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Live polls</h3>
              {polls.length === 0 ? <p className="help-text">No polls for this session yet.</p> : null}
              {polls.map((poll) => {
                const totalVotes = poll.options.reduce((s, o) => s + (o.voteCount ?? 0), 0);
                return (
                  <div key={poll.id} style={{ marginBottom: 16 }}>
                    <strong>{poll.question}</strong>
                    <span className="help-text"> · {poll.status}</span>
                    <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
                      {poll.options.map((o) => {
                        const count = o.voteCount;
                        const pct = count != null && totalVotes > 0 ? Math.round((count / totalVotes) * 100) : null;
                        return (
                          <li key={o.id} style={{ marginBottom: 6 }}>
                            {poll.status === "OPEN" ? (
                              <button
                                type="button"
                                className={poll.myOptionId === o.id ? "button" : "button secondary"}
                                style={{ width: "100%", textAlign: "left" }}
                                onClick={() => void votePoll(poll.id, o.id)}
                              >
                                {o.label}
                                {pct != null ? ` — ${pct}% (${count})` : ""}
                              </button>
                            ) : (
                              <div>
                                {o.label}
                                {pct != null ? (
                                  <span className="help-text">
                                    {" "}
                                    — {pct}% ({count})
                                  </span>
                                ) : null}
                                {pct != null ? (
                                  <div
                                    style={{
                                      height: 6,
                                      marginTop: 4,
                                      background: "var(--border, #D9E1EE)",
                                      borderRadius: 3,
                                    }}
                                  >
                                    <div
                                      style={{
                                        height: 6,
                                        width: `${pct}%`,
                                        background: "var(--accent, #2F6FED)",
                                        borderRadius: 3,
                                      }}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {canManage && poll.status === "DRAFT" ? (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() =>
                          void apiFetch(`/polls/${poll.id}/open`, { method: "POST" }, token!).then(() =>
                            reloadPollsAndFeedback(),
                          )
                        }
                      >
                        Open poll
                      </button>
                    ) : null}
                    {canManage && poll.status === "OPEN" ? (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() =>
                          void apiFetch(`/polls/${poll.id}/close`, { method: "POST" }, token!).then(() =>
                            reloadPollsAndFeedback(),
                          )
                        }
                      >
                        Close poll
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {canManage ? (
                <form
                  className="grid"
                  style={{ gap: 8 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!token || !sessionId) return;
                    const fd = new FormData(e.currentTarget);
                    const question = String(fd.get("question") || "").trim();
                    const options = String(fd.get("options") || "")
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (!question || options.length < 2) return;
                    await apiFetch(`/polls/session/${sessionId}`, {
                      method: "POST",
                      body: JSON.stringify({ question, options }),
                    }, token);
                    e.currentTarget.reset();
                    await reloadPollsAndFeedback();
                  }}
                >
                  <input className="input" name="question" placeholder="Poll question" required />
                  <textarea
                    className="textarea"
                    name="options"
                    placeholder={"Option A\nOption B\nOption C"}
                    rows={3}
                    required
                  />
                  <button type="submit" className="button secondary">
                    Create draft poll
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}

          {feedbackOn && feedback?.sessionEnded ? (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Session feedback</h3>
              {feedback.mine ? (
                <p className="help-text">
                  You rated this {feedback.mine.rating}/5
                  {feedback.mine.comment ? ` — “${feedback.mine.comment}”` : ""}
                </p>
              ) : (
                <form
                  className="grid"
                  style={{ gap: 8 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    await submitFeedback(Number(fd.get("rating")), String(fd.get("comment") || "").trim());
                  }}
                >
                  <label className="help-text">
                    Rating
                    <select className="select" name="rating" defaultValue={5} required>
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <textarea className="textarea" name="comment" placeholder="Optional comment" rows={2} />
                  <button type="submit" className="button">
                    Submit feedback
                  </button>
                </form>
              )}
              {canManage && feedback.summary ? (
                <p className="help-text">
                  Summary: {feedback.summary.count} responses
                  {feedback.summary.average != null ? ` · avg ${feedback.summary.average.toFixed(1)}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {activeEventId && conciergeOn ? <ConciergeChat eventId={activeEventId} enabled /> : null}
    </div>
  );
}
