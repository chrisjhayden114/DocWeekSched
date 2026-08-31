import { brand, emptyStateCopy, programCopy, sessionQaCopy } from "@event-app/config";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DELETED_PARTICIPANT_LABEL, resolveFeatureEnabled, type FeatureKey, type FeatureOverrideValue } from "@event-app/shared";
import { AppShell, type ShellNavGroup } from "../../components/AppShell";
import { MainNavIcon } from "../../components/dashboardNavIcons";
import { ListSkeleton } from "../../components/ListState";
import { AutoGrowTextarea, Composer, EmptyState, FilterPills } from "../../components/kit";
import { OnlineMeetingLink } from "../../components/OnlineMeetingLink";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import { ConciergeChat } from "../../components/ConciergeChat";
import { apiFetch, clearAuthClientState } from "../../lib/api";
import { downloadSessionIcs } from "../../lib/calendarIcs";
import { formatEventTimeRange } from "../../lib/dateFormat";
import { eventAccentStyle } from "../../lib/eventAccent";
import { offerPushAfterFirstAgendaSave } from "../../lib/push";

const RESOURCE_DATA_URL_MAX_CHARS = 4_500_000;

type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ATTENDEE" | "SPEAKER";
  photoUrl?: string | null;
  researchInterests?: string | null;
  engagementPoints?: number;
  isEventAdmin?: boolean;
};

type Event = {
  id: string;
  name: string;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  /** ORG-1 — the logo to render: this event's own, or the organization's. */
  displayLogoUrl?: string | null;
  /** Organizer's chosen event color; drives --event-accent (F1.5.3). */
  brandColor?: string | null;
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
  audience?: "EVERYONE" | "PRESENTERS";
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
  try {
    // E9.3: must go through apiFetch — it sends the httpOnly auth cookie
    // (credentials: "include"); a raw fetch with only a Bearer header never
    // authenticates cross-origin, so this 401'd for everyone.
    return await apiFetch<SessionResource[]>(
      `/sessions/${sessionId}/resources`,
      withEventHeaders(evId),
      token,
    );
  } catch {
    // 403 = not joined this session; the panel shows its join hint instead.
    return [];
  }
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
  const [qaAudience, setQaAudience] = useState<"EVERYONE" | "PRESENTERS">("EVERYONE");
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
  // E12.3: the add form is secondary — collapsed until asked for.
  const [addResourceOpen, setAddResourceOpen] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [venueMapsOn, setVenueMapsOn] = useState(false);
  const [conciergeOn, setConciergeOn] = useState(false);
  const [communityOn, setCommunityOn] = useState(true);
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
          window.location.href = "/login";
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
        setCommunityOn(enabled("community"));
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
      body: JSON.stringify({ title, body, audience: qaAudience }),
    }, token);
    setThreads((prev) => [thread, ...prev]);
    setOpenThreadId(thread.id);
    setQaAudience("EVERYONE");
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

  const shellNav: ShellNavGroup[] = [
    {
      id: "event",
      label: "Event",
      items: [
        {
          id: "Agenda",
          label: "Agenda",
          href: "/dashboard?tab=Agenda",
          icon: <MainNavIcon tab="Agenda" />,
          active: true,
        },
        { id: "Attendees", label: "Attendees", href: "/dashboard?tab=Attendees", icon: <MainNavIcon tab="Attendees" /> },
        ...(communityOn
          ? [{ id: "Community", label: "Community", href: "/dashboard?tab=Community", icon: <MainNavIcon tab="Community" /> }]
          : []),
        { id: "Messages", label: "Messages", href: "/dashboard?tab=Messages", icon: <MainNavIcon tab="Messages" /> },
      ],
    },
    {
      id: "account",
      label: "Account",
      items: [
        { id: "Profile", label: "Profile", href: "/dashboard?tab=Profile", icon: <MainNavIcon tab="Profile" /> },
      ],
    },
  ];

  return (
    <AppShell
      title={event?.name || "Event"}
      logoUrl={event?.displayLogoUrl}
      /* BRAND-1 — session pages are the event's surface too: without this,
         they rendered in default blue beside an accented dashboard. */
      accentStyle={event ? eventAccentStyle(event.brandColor) : undefined}
      nav={shellNav}
      mobilePrimaryIds={["Agenda", "Attendees", communityOn ? "Community" : "Messages"]}
      userName={user.name}
      userPhotoUrl={user.photoUrl}
      userMeta={event ? formatEventRange(event.startDate, event.endDate) : null}
      accountMenu={[
        { id: "profile", label: "Profile", href: "/dashboard?tab=Profile" },
        { id: "account", label: "Account settings", href: "/account" },
        {
          id: "logout",
          label: "Log out",
          tone: "danger",
          onSelect: () => {
            clearAuthClientState();
            window.location.href = "/login";
          },
        },
      ]}
    >
      <p style={{ margin: "0 0 12px" }}>
        <button
          type="button"
          className="linkish session-back-link"
          onClick={() => {
            /* history.back preserves the agenda scroll position */
            if (window.history.length > 1) router.back();
            else void router.push("/dashboard?tab=Agenda");
          }}
        >
          ← Back to agenda
        </button>
      </p>

      {loading && <ListSkeleton rows={5} />}
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
            {session.imageUrl ? <img src={session.imageUrl} alt="" className="session-page-image" /> : null}
            <h1 style={{ margin: "0 0 6px", font: "var(--text-h2)" }}>{session.title}</h1>
            <div className="session-meta-block">
              <p className="session-meta-line">
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
                  <p className="session-meta-line">
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
            </div>
            <SegmentedToggle
              className="agenda-timezone-toggle"
              ariaLabel="Time display mode"
              style={{ margin: "10px 0 12px" }}
              options={[
                { id: "MY", label: "My timezone" },
                { id: "EVENT", label: "Event timezone" },
              ]}
              value={timeMode}
              onChange={setTimeMode}
            />
            {session.description && (
              <p style={{ margin: "0 0 12px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{session.description}</p>
            )}
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
                      title="Asynchronous — join across time zones"
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
                  onClick={() =>
                    downloadSessionIcs(
                      {
                        id: session.id,
                        title: session.title,
                        startsAt: session.startsAt,
                        endsAt: session.endsAt,
                        description: session.description,
                        location: session.location || session.room?.name,
                        zoomLink: session.zoomLink,
                      },
                      event?.name || "Event",
                      event?.timezone,
                    )
                  }
                >
                  Add to calendar
                </button>
              )}
              <button type="button" className={liked ? "button" : "button secondary"} onClick={() => toggleLike()}>
                Like
              </button>
            </div>
          </div>

          <div className="card session-conversation-card">
            <h3 style={{ marginTop: 0 }}>{sessionQaCopy.title}</h3>
            <p className="help-text" style={{ marginTop: 0 }}>
              {sessionQaCopy.purpose}
            </p>
            {/* F3.2 — content-first: the thread list leads; asking is a
                collapsed Composer, matching the resources section above. */}
            <div style={{ marginBottom: 10 }}>
              <FilterPills
                label={sessionQaCopy.sortLabel}
                options={[
                  { id: "votes", label: sessionQaCopy.sortVotes },
                  { id: "recent", label: sessionQaCopy.sortRecent },
                ]}
                value={qaSort}
                onChange={(id) => setQaSort(id as "votes" | "recent")}
              />
            </div>
            <Composer
              collapsedLabel={sessionQaCopy.composer.collapsed}
              submitLabel={sessionQaCopy.composer.submit}
              titlePlaceholder={sessionQaCopy.composer.titlePlaceholder}
              placeholder={sessionQaCopy.composer.bodyPlaceholder}
              onSubmit={async (body, title) => {
                await createThread(title, body);
              }}
            >
              <div style={{ margin: "0 0 4px" }}>
                <FilterPills
                  label="Ask"
                  options={[
                    { id: "EVERYONE", label: "Everyone" },
                    { id: "PRESENTERS", label: "For the presenter" },
                  ]}
                  value={qaAudience}
                  onChange={(id) => setQaAudience(id as "EVERYONE" | "PRESENTERS")}
                />
              </div>
            </Composer>
            <div className="session-thread-layout">
              <div className="session-thread-list">
                {threads.length === 0 && (
                  <EmptyState
                    title={emptyStateCopy.sessionDiscussion.title}
                    body={emptyStateCopy.sessionDiscussion.body}
                  />
                )}
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className={`session-thread-link ${thread.id === openThreadId ? "is-active" : ""}`}
                    onClick={() => setOpenThreadId(thread.id)}
                  >
                    <span className="session-thread-link-top">
                      <strong>{thread.title}</strong>
                      {thread.audience === "PRESENTERS" && (
                        <span className="kit-status-pill">For the presenter</span>
                      )}
                      {thread.isAnswered ? (
                        <span className="kit-status-pill kit-status-pill--success">{sessionQaCopy.answeredPill}</span>
                      ) : null}
                    </span>
                    <span className="help-text">
                      {sessionQaCopy.votes(thread.upvoteCount ?? 0)} · {thread.author?.name ?? DELETED_PARTICIPANT_LABEL} ·{" "}
                      {sessionQaCopy.replies(thread.replies.length)}
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
                        {openThread.author?.photoUrl ? (
                          <img src={openThread.author.photoUrl} alt="" className="session-message-avatar" />
                        ) : (
                          <div className="session-message-avatar session-message-avatar-ph">
                            {(openThread.author?.name ?? DELETED_PARTICIPANT_LABEL).charAt(0)}
                          </div>
                        )}
                        <div>
                          <strong>{openThread.title}</strong>
                          <div className="help-text">
                            {openThread.author?.name ?? DELETED_PARTICIPANT_LABEL}
                            {openThread.author?.role ? ` · ${openThread.author.role}` : ""} ·{" "}
                            {new Date(openThread.createdAt).toLocaleString()}
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
                          {reply.author?.photoUrl ? (
                            <img src={reply.author.photoUrl} alt="" className="session-message-avatar" />
                          ) : (
                            <div className="session-message-avatar session-message-avatar-ph">
                              {(reply.author?.name ?? DELETED_PARTICIPANT_LABEL).charAt(0)}
                            </div>
                          )}
                          <div>
                            <strong>{reply.author?.name ?? DELETED_PARTICIPANT_LABEL}</strong>
                            <span className="help-text">
                              {" "}
                              · {reply.author?.role ?? "—"} · {new Date(reply.createdAt).toLocaleString()}
                            </span>
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
                        // React nulls currentTarget once dispatch returns, so hold the
                        // node itself — reading e.currentTarget after the await threw
                        // "Cannot read properties of null" (UKEDL-WEB-9).
                        const form = e.currentTarget;
                        const body = String(new FormData(form).get("body") || "").trim();
                        if (!body) return;
                        await sendReply(openThread.id, body);
                        // The thread can close while the reply is in flight.
                        form?.reset();
                      }}
                    >
                      <AutoGrowTextarea className="textarea" name="body" placeholder="Reply to this conversation…" required minRows={2} />
                      <button type="submit" className="button secondary">Reply</button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>

          {session.items && session.items.length > 0 ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 className="text-h3" style={{ margin: "0 0 12px" }}>
                Papers &amp; presentations ({session.items.length})
              </h2>
              <ol className="session-papers">
                {session.items.map((item) => (
                  <li key={item.id} className="session-paper">
                    <p className="session-paper-title">{item.title}</p>
                    {item.authors?.length ? (
                      <p className="session-paper-authors">{item.authors.map((a) => a.name).join(", ")}</p>
                    ) : null}
                    {item.discussantSpeaker ? (
                      <p className="session-paper-authors">Discussant: {item.discussantSpeaker.name}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {(session.sessionSpeakers && session.sessionSpeakers.length > 0) ||
          session.speakers ||
          session.speaker?.name ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 className="text-h3" style={{ margin: "0 0 12px" }}>
                Speakers
              </h2>
              {session.sessionSpeakers && session.sessionSpeakers.length > 0 ? (
                <ul className="session-speakers-list">
                  {session.sessionSpeakers.map((row) => (
                    <li key={row.speaker.id} className="session-speaker-row">
                      {row.speaker.photoUrl ? (
                        <img src={row.speaker.photoUrl} alt="" className="session-speaker-avatar" />
                      ) : (
                        <span className="session-speaker-avatar" aria-hidden>
                          {row.speaker.name.trim().charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span>
                        <span className="session-speaker-name">
                          <Link href="/dashboard?tab=Attendees">{row.speaker.name}</Link>
                        </span>
                        {row.speaker.title || row.speaker.affiliation ? (
                          <span className="session-speaker-affil">
                            {[row.speaker.title, row.speaker.affiliation].filter(Boolean).join(", ")}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body" style={{ margin: 0 }}>
                  {session.speakers || session.speaker?.name}
                </p>
              )}
            </div>
          ) : null}

          {/* M8: quiet entry into Messages with this session as compose context. */}
          {token && user ? (
            <p style={{ margin: "0 0 16px" }}>
              <Link
                href={`/dashboard?tab=Messages&contextSessionId=${encodeURIComponent(session.id)}&contextTitle=${encodeURIComponent(session.title)}`}
                className="button secondary"
              >
                Message about this session
              </Link>
            </p>
          ) : null}

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Session resources</h3>
            <p className="help-text" style={{ marginTop: 0 }}>
              {programCopy.resource.shareHint}
            </p>
            {!canShareResources && (
              <p className="help-text">Join this session to see shared resources and add your own.</p>
            )}
            {resourceError && (
              <p className="help-text" style={{ color: "var(--danger)" }}>
                {resourceError}
              </p>
            )}
            {/* E12.3: existing resources come first — the attendee's goal is opening
                the slides, not filling in a form. The add form follows, collapsed. */}
            <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
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
            {canShareResources && !addResourceOpen && (
              <button
                type="button"
                className="button secondary"
                style={{ marginTop: 12 }}
                onClick={() => setAddResourceOpen(true)}
              >
                + Add a resource
              </button>
            )}
            {canShareResources && addResourceOpen && (
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
                    setAddResourceOpen(false);
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
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" className="button secondary">
                    Add resource
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setResourceError(null);
                      setAddResourceOpen(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
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
                                      background: "var(--border)",
                                      borderRadius: 3,
                                    }}
                                  >
                                    <div
                                      style={{
                                        height: 6,
                                        width: `${pct}%`,
                                        background: "var(--event-accent)",
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
                    // Same lifecycle trap as the reply form (UKEDL-WEB-9): capture the
                    // form node before awaiting, because currentTarget is gone after.
                    const form = e.currentTarget;
                    const fd = new FormData(form);
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
                    form?.reset();
                    await reloadPollsAndFeedback();
                  }}
                >
                  <input className="input" name="question" placeholder="Poll question" required />
                  <AutoGrowTextarea
                    className="textarea"
                    name="options"
                    placeholder={"Option A\nOption B\nOption C"}
                    minRows={3}
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
                    await submitFeedback(feedbackRating, String(fd.get("comment") || "").trim());
                  }}
                >
                  <span className="text-label">Rating</span>
                  <div className="join-mode-switch" role="radiogroup" aria-label="Rating out of 5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={feedbackRating === n}
                        className={feedbackRating === n ? "is-active" : ""}
                        onClick={() => setFeedbackRating(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <AutoGrowTextarea className="textarea" name="comment" placeholder="Optional comment" minRows={2} />
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
    </AppShell>
  );
}
