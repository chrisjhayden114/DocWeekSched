import { brand, icsProductId } from "@event-app/config";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  DELETED_PARTICIPANT_LABEL,
  resolveFeatureEnabled,
  type FeatureKey,
  type FeatureOverrideValue,
} from "@event-app/shared";
import { CommunityPillIcon, MainNavIcon, type CommunityPillKey } from "../components/dashboardNavIcons";
import { AppShell, type ShellNavGroup, type ShellNavItem } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DateTimePicker } from "../components/DateTimePicker";
import { EventSettingsModal } from "../components/EventSettingsModal";
import { ConciergeChat } from "../components/ConciergeChat";
import { MatchmakerPanel } from "../components/MatchmakerPanel";
import { KebabMenu } from "../components/KebabMenu";
import { OnlineMeetingLink } from "../components/OnlineMeetingLink";
import { UploadDropzone } from "../components/UploadDropzone";
import { VenueMapsAttendee, roomPinIndex } from "../components/VenueMapsAttendee";
import { MeetingRequestModal, MeetingRequestsPanel } from "../components/MeetingRequestsPanel";
import { ModerationReportsPanel } from "../components/ModerationReportsPanel";
import { apiFetch, apiFetchAll, clearAuthClientState } from "../lib/api";
import { readClientStorage, writeClientStorage } from "../lib/clientStorage";
import { filterSessions, nowAndNext, overlappingSessionIds } from "../lib/agendaFilters";
import { trackColor } from "../lib/trackColors";
import { AgendaFiltersSheet, DayChips, FilterGroup, dayChipLabel } from "../components/AgendaFilterPanel";
import { ListEmpty, ListError, ListSkeleton } from "../components/ListState";
import { formatEventTimeRange, formatEventDateTime, formatDayHeading, formatRelativeTime } from "../lib/dateFormat";
import { offerPushAfterFirstAgendaSave } from "../lib/push";
import { AutolinkText } from "../components/AutolinkText";
import { SearchableMultiSelect } from "../components/SearchableMultiSelect";
import { SponsorsStrip } from "../components/SponsorsStrip";
import { OnboardingPanel } from "../components/OnboardingPanel";

type FeatureOverridesMap = Partial<Record<FeatureKey, FeatureOverrideValue>>;

type User = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ATTENDEE" | "SPEAKER";
  photoUrl?: string | null;
  researchInterests?: string | null;
  title?: string | null;
  affiliation?: string | null;
  bio?: string | null;
  participantType?: "GRAD_STUDENT" | "EDD_STUDENT" | "PHD_STUDENT" | "EDL_ALUMNI" | "PROFESSOR" | null;
  engagementPoints?: number;
  inviteStatus?: "ACTIVE" | "PENDING_SETUP" | "INVITE_EXPIRED";
  inviteExpiresAt?: string | null;
  isEventAdmin?: boolean;
  orgRole?: "OWNER" | "ADMIN" | "STAFF" | null;
  eventRole?: string | null;
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
  showPoweredByBadge?: boolean;
};

type AgendaJoinMode = "VIRTUAL" | "IN_PERSON" | "ASYNC";

type Session = {
  id: string;
  title: string;
  description?: string;
  location?: string | null;
  roomId?: string | null;
  trackId?: string | null;
  room?: { id: string; name: string } | null;
  track?: { id: string; name: string; color?: string } | null;
  items?: { id: string; title: string; sortOrder?: number; authors?: { name: string; sortOrder?: number }[] }[];
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
  bookmarks?: { userId: string; user: Pick<User, "id" | "name" | "email" | "photoUrl"> }[];
  attendances?: {
    userId: string;
    status: "JOINING" | "NOT_JOINING";
    joinMode?: AgendaJoinMode | null;
    user: Pick<User, "id" | "name" | "email" | "photoUrl">;
  }[];
  waitlistEntries?: {
    id: string;
    userId: string;
    mode: AgendaJoinMode;
    position: number;
    promotedAt?: string | null;
    holdExpiresAt?: string | null;
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
type Message = {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string | null; name: string; role: string | null; deleted?: boolean };
};
type SessionAttendance = {
  sessionId: string;
  status: "JOINING" | "NOT_JOINING";
  joinMode?: AgendaJoinMode | null;
};
type MySessionMeta = { attendance: SessionAttendance[]; likedSessionIds: string[]; bookmarkedSessionIds?: string[] };
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

function asEventItem(event: Event): EventItem {
  return {
    id: event.id,
    name: event.name,
    slug: event.slug,
    bannerUrl: event.bannerUrl,
    logoUrl: event.logoUrl,
    timezone: event.timezone,
    startDate: event.startDate,
    endDate: event.endDate,
  };
}

function mergeAdminEvents(list: EventItem[], current: Event | null): EventItem[] {
  if (!current) return list;
  if (list.some((row) => row.id === current.id)) return list;
  return [asEventItem(current), ...list];
}

function agendaJoinModeLabel(mode: AgendaJoinMode | null | undefined): string {
  if (mode === "VIRTUAL") return "Virtual";
  if (mode === "ASYNC") return "Asynchronous (time zone)";
  return "In person";
}

const EVENT_TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

function timezoneOptionLabel(timezone: string) {
  const map: Record<string, string> = {
    "America/New_York": "Eastern (ET: EST/EDT) — America/New_York",
    "America/Chicago": "Central (CT: CST/CDT) — America/Chicago",
    "America/Denver": "Mountain (MT: MST/MDT) — America/Denver",
    "America/Los_Angeles": "Pacific (PT: PST/PDT) — America/Los_Angeles",
    "Europe/London": "United Kingdom (GMT/BST) — Europe/London",
    "Europe/Paris": "Central Europe (CET/CEST) — Europe/Paris",
    "Asia/Singapore": "Singapore (SGT) — Asia/Singapore",
    "Asia/Hong_Kong": "Hong Kong (HKT) — Asia/Hong_Kong",
    "Asia/Tokyo": "Japan (JST) — Asia/Tokyo",
    "Australia/Sydney": "Australia East (AEST/AEDT) — Australia/Sydney",
    UTC: "UTC",
  };
  return map[timezone] || timezone;
}

type NetworkAuthor = {
  id: string | null;
  name: string;
  role: string | null;
  photoUrl?: string | null;
  deleted?: boolean;
};
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
  kind:
    | "COMMUNITY_THREAD"
    | "COMMUNITY_REPLY"
    | "MESSAGE"
    | "ADMIN_REQUEST"
    | "WAITLIST_PROMOTED"
    | "ANNOUNCEMENT"
    | "MEETING_REQUEST"
    | "MEETING_ACCEPTED"
    | "SESSION_CHANGED"
    | "SESSION_STARTING_SOON"
    | "DIGEST_ROLLUP"
    | "USER_REPORT"
    | "AGENT_ATTENDEE_TOUCH";
  title: string;
  body: string | null;
  threadId: string | null;
  conversationId: string | null;
  sessionId?: string | null;
  meetingRequestId?: string | null;
  announcementId?: string | null;
  readAt: string | null;
  createdAt: string;
};

const COMMUNITY_TAB = "Community" as const;
const PARTICIPANTS_INVITES_TAB = "Participants and Invites" as const;
const MAPS_TAB = "Maps" as const;
const MATCHMAKER_TAB = "Meet" as const;
const adminTabs = [
  "Agenda",
  "Attendees",
  MATCHMAKER_TAB,
  PARTICIPANTS_INVITES_TAB,
  COMMUNITY_TAB,
  MAPS_TAB,
  "Messages",
  "Notifications",
  "Profile",
] as const;
const participantTabs = [
  "Agenda",
  "Attendees",
  MATCHMAKER_TAB,
  COMMUNITY_TAB,
  MAPS_TAB,
  "Messages",
  "Notifications",
  "Profile",
] as const;
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
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [attendees, setAttendees] = useState<User[]>([]);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [networkThreads, setNetworkThreads] = useState<NetworkThread[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messagePrefill, setMessagePrefill] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newChatMode, setNewChatMode] = useState<null | "direct" | "group">(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [agendaView, setAgendaView] = useState<"Event Schedule" | "My Schedule">("Event Schedule");
  const [agendaTimeMode, setAgendaTimeMode] = useState<"MY" | "EVENT">("MY");
  const [myAttendance, setMyAttendance] = useState<SessionAttendance[]>([]);
  const [likedSessionIds, setLikedSessionIds] = useState<string[]>([]);
  const [bookmarkedSessionIds, setBookmarkedSessionIds] = useState<string[]>([]);
  const [agendaFilterTrack, setAgendaFilterTrack] = useState<string>("");
  const [agendaFilterRoom, setAgendaFilterRoom] = useState<string>("");
  const [agendaFilterDay, setAgendaFilterDay] = useState<string>("");
  const [agendaSearch, setAgendaSearch] = useState("");
  const [agendaFiltersOpen, setAgendaFiltersOpen] = useState(false);
  const [adminEvents, setAdminEvents] = useState<EventItem[]>([]);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [eventLoadError, setEventLoadError] = useState<string | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);
  const [tabReloadToken, setTabReloadToken] = useState(0);
  /** Event ids that returned 403/404 — skip them when auto-falling back. */
  const failedEventIds = useRef<Set<string>>(new Set());
  const [communityChannel, setCommunityChannel] = useState<CommunityChannelFilter>("ALL");
  const [updatingEvent, setUpdatingEvent] = useState(false);
  const [sessionFormKey, setSessionFormKey] = useState(0);
  const [messageDirectoryQuery, setMessageDirectoryQuery] = useState("");
  const [eventSettingsOpen, setEventSettingsOpen] = useState(false);
  const [eventSettingsError, setEventSettingsError] = useState<string | null>(null);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [rosterConfirm, setRosterConfirm] = useState<null | {
    kind: "make-admin" | "remove-admin" | "delete";
    user: User;
  }>(null);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [messageConfirmId, setMessageConfirmId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageBody, setEditingMessageBody] = useState("");
  const [notifications, setNotifications] = useState<UserNotificationRow[]>([]);
  const [communityFocusThreadId, setCommunityFocusThreadId] = useState<string | null>(null);
  const clearCommunityFocus = useCallback(() => setCommunityFocusThreadId(null), []);
  const [featureOverrides, setFeatureOverrides] = useState<FeatureOverridesMap>({});
  const [roomPins, setRoomPins] = useState<Record<string, { mapId: string; pinId: string }>>({});
  const [mapsFocus, setMapsFocus] = useState<{ mapId: string | null; pinId: string | null }>({
    mapId: null,
    pinId: null,
  });
  const [meetingTarget, setMeetingTarget] = useState<{ id: string; name: string } | null>(null);
  const [meetingsRefreshKey, setMeetingsRefreshKey] = useState(0);
  const myTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  const featureOn = useCallback(
    (key: FeatureKey) => resolveFeatureEnabled(key, featureOverrides),
    [featureOverrides],
  );

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
    let cancelled = false;
    (async () => {
      try {
        const fresh = await apiFetch<User>("/auth/me", withEventHeaders());
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
    const storedEventId = window.localStorage.getItem("activeEventId");
    if (storedEventId) {
      setActiveEventId(storedEventId);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      /* Switcher list from existing /event/mine (org + admin memberships). */
      try {
        const mine = await apiFetch<EventItem[]>("/event/mine", {}, token);
        if (!cancelled) setAdminEvents(mergeAdminEvents(mine, null));
      } catch {
        /* ignore — switcher stays empty */
      }

      if (!activeEventId) {
        try {
          const mine = await apiFetch<EventItem[]>("/event/mine", {}, token);
          if (cancelled) return;
          setAdminEvents(mergeAdminEvents(mine, null));
          const next = mine.find((e) => !failedEventIds.current.has(e.id));
          if (next) {
            setActiveEventId(next.id);
            window.localStorage.setItem("activeEventId", next.id);
            return;
          }
          setEvent(null);
          setEventLoadError("No event is linked to your account yet.");
        } catch {
          if (!cancelled) setEventLoadError("Could not load your events.");
        }
        return;
      }

      try {
        const ev = await apiFetch<Event>("/event", withEventHeaders(), token);
        if (cancelled) return;
        failedEventIds.current.delete(activeEventId);
        setEvent(ev);
        setEventLoadError(null);
        setAdminEvents((prev) => mergeAdminEvents(prev, ev));
      } catch (err) {
        const status = (err as Error & { status?: number }).status;
        if (status === 403 || status === 404) {
          failedEventIds.current.add(activeEventId);
          try {
            const mine = await apiFetch<EventItem[]>("/event/mine", {}, token);
            if (cancelled) return;
            setAdminEvents(mergeAdminEvents(mine, null));
            const next = mine.find((e) => !failedEventIds.current.has(e.id)) ?? null;
            if (next) {
              setActiveEventId(next.id);
              window.localStorage.setItem("activeEventId", next.id);
              return;
            }
            window.localStorage.removeItem("activeEventId");
            setActiveEventId(null);
            setEvent(null);
            setEventLoadError("You don’t have access to that event. Pick another from the switcher, or join an event.");
          } catch {
            if (!cancelled) {
              setEvent(null);
              setEventLoadError("Could not restore your event context.");
            }
          }
        } else if (!cancelled) {
          setEvent(null);
          setEventLoadError(err instanceof Error ? err.message : "Could not load event");
        }
      }

      apiFetch<User>("/auth/me", withEventHeaders(), token)
        .then((freshUser) => {
          if (cancelled) return;
          setUser(freshUser);
          window.localStorage.setItem("user", JSON.stringify(freshUser));
        })
        .catch(() => null);

      if (activeEventId) {
        apiFetch<MySessionMeta>("/sessions/me", withEventHeaders(), token)
          .then((meta) => {
            if (cancelled) return;
            setMyAttendance(meta.attendance);
            setLikedSessionIds(meta.likedSessionIds);
            setBookmarkedSessionIds(meta.bookmarkedSessionIds || []);
          })
          .catch(() => null);
        apiFetch<{ overrides: FeatureOverridesMap }>("/event/features", withEventHeaders(), token)
          .then((res) => {
            if (!cancelled) setFeatureOverrides(res.overrides || {});
          })
          .catch(() => {
            if (!cancelled) setFeatureOverrides({});
          });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, activeEventId]);

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      setTabError(null);
      try {
        if (active === "Agenda") {
          try {
            setSessions(await apiFetch<Session[]>("/sessions", withEventHeaders(), token));
          } finally {
            setSessionsLoading(false);
          }
          if (isAdmin && attendees.length === 0) {
            setAttendees(await apiFetchAll<User>("/attendees", withEventHeaders(), token).catch(() => []));
          }
        }
        if (active === "Attendees" || active === PARTICIPANTS_INVITES_TAB) {
          setAttendeesLoading(true);
          try {
            setAttendees(await apiFetchAll<User>("/attendees", withEventHeaders(), token));
          } finally {
            setAttendeesLoading(false);
          }
        }
        if (active === COMMUNITY_TAB) {
          const qs = communityChannel === "ALL" ? "" : `?channel=${communityChannel}`;
          setNetworkThreads(await apiFetch<NetworkThread[]>(`/network/threads${qs}`, withEventHeaders(), token));
          if (attendees.length === 0) {
            setAttendees(await apiFetchAll<User>("/attendees", withEventHeaders(), token).catch(() => []));
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
            setAttendees(await apiFetchAll<User>("/attendees", {}, token).catch(() => []));
          }
        }
        const myEvents = await apiFetch<EventItem[]>("/event/mine", {}, token).catch(() => []);
        setAdminEvents(mergeAdminEvents(myEvents, event));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong loading this panel";
        setTabError(message);
        setSessionsLoading(false);
        setAttendeesLoading(false);
      }
    };
    void load();
  }, [active, token, user?.role, activeConversationId, activeEventId, communityChannel, event, tabReloadToken]);

  useEffect(() => {
    if (user?.role !== "ADMIN" || !event) return;
    setAdminEvents((prev) => mergeAdminEvents(prev, event));
  }, [user?.role, event]);

  useEffect(() => {
    if (!token || active !== "Messages" || !activeConversationId) return;
    setMessages([]);
    let cancelled = false;
    apiFetchAll<Message>(`/conversations/${activeConversationId}/messages`, withEventHeaders(), token)
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

  const isAdmin = useMemo(() => Boolean(user?.isEventAdmin || user?.role === "ADMIN"), [user]);
  const messagingEnabled =
    featureOn("messaging_dms") || featureOn("messaging_groups") || featureOn("messaging_event_chat");
  const availableTabs = useMemo(() => {
    const base = isAdmin ? adminTabs : participantTabs;
    return base.filter((tab) => {
      if (tab === "Attendees") return featureOn("attendee_directory");
      if (tab === MATCHMAKER_TAB) return featureOn("matchmaker");
      if (tab === COMMUNITY_TAB) return featureOn("community");
      if (tab === "Messages") return messagingEnabled;
      if (tab === MAPS_TAB) return featureOn("venue_maps");
      return true;
    });
  }, [isAdmin, featureOn, messagingEnabled]);
  const unreadNotifications = useMemo(
    () => notifications.filter((row) => !row.readAt).length,
    [notifications],
  );
  const unreadConversationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of notifications) {
      if (n.kind === "MESSAGE" && !n.readAt && n.conversationId) ids.add(n.conversationId);
    }
    return ids;
  }, [notifications]);
  const notificationsByDay = useMemo(() => {
    const groups: { heading: string; items: UserNotificationRow[] }[] = [];
    let current = "";
    for (const n of notifications) {
      const heading = formatDayHeading(n.createdAt);
      if (heading !== current) {
        current = heading;
        groups.push({ heading, items: [] });
      }
      groups[groups.length - 1]!.items.push(n);
    }
    return groups;
  }, [notifications]);
  const rosterAdminCount = useMemo(() => attendees.filter((a) => a.role === "ADMIN").length, [attendees]);
  const timezoneToggleOn = featureOn("timezone_toggle");
  const sessionLikesOn = featureOn("session_likes");
  const engagementPointsOn = featureOn("engagement_points");
  const venueMapsOn = featureOn("venue_maps");

  useEffect(() => {
    if (!token || !activeEventId || !venueMapsOn) {
      setRoomPins({});
      return;
    }
    apiFetch<Array<{ id: string; pins: Array<{ id: string; linkedRoomId?: string | null }> }>>(
      "/event/maps/",
      withEventHeaders(),
      token,
    )
      .then((list) => setRoomPins(roomPinIndex(list as never)))
      .catch(() => setRoomPins({}));
  }, [token, activeEventId, venueMapsOn]);

  useEffect(() => {
    if (!router.isReady) return;
    const mapId = typeof router.query.mapId === "string" ? router.query.mapId : null;
    const pinId = typeof router.query.pinId === "string" ? router.query.pinId : null;
    const tabQ = typeof router.query.tab === "string" ? router.query.tab : null;
    // Case-insensitive so links like ?tab=maps work too.
    const tabMatch = tabQ ? adminTabs.find((t) => t.toLowerCase() === tabQ.toLowerCase()) ?? null : null;
    if (tabMatch === MAPS_TAB || mapId || pinId) {
      setActive(MAPS_TAB);
      setMapsFocus({ mapId, pinId });
    } else if (tabMatch) {
      setActive(tabMatch);
    }
  }, [router.isReady, router.query.mapId, router.query.pinId, router.query.tab]);

  useEffect(() => {
    if (!availableTabs.some((tab) => tab === active)) {
      setActive("Agenda");
    }
  }, [availableTabs, active]);

  useEffect(() => {
    if (!timezoneToggleOn && agendaTimeMode !== "EVENT") {
      setAgendaTimeMode("EVENT");
    }
  }, [timezoneToggleOn, agendaTimeMode]);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [sessions]
  );
  const agendaDisplayTimezone = useMemo(
    () =>
      !timezoneToggleOn || agendaTimeMode === "EVENT"
        ? event?.timezone || myTimezone
        : myTimezone,
    [timezoneToggleOn, agendaTimeMode, event?.timezone, myTimezone],
  );
  const filteredSessions = useMemo(
    () =>
      filterSessions(
        sortedSessions,
        {
          trackId: agendaFilterTrack || null,
          roomId: agendaFilterRoom || null,
          dayKey: agendaFilterDay || null,
          query: agendaSearch,
        },
        (iso) => zonedDayKey(new Date(iso), agendaDisplayTimezone),
      ),
    [sortedSessions, agendaFilterTrack, agendaFilterRoom, agendaFilterDay, agendaSearch, agendaDisplayTimezone],
  );
  const agendaNowNext = useMemo(() => nowAndNext(filteredSessions), [filteredSessions]);
  /* First-appearance order across the event schedule — drives collision-free track colors. */
  const trackOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color?: string }>();
    for (const s of sessions) {
      if (s.trackId && s.track) map.set(s.trackId, { id: s.track.id, name: s.track.name, color: s.track.color });
    }
    return [...map.values()];
  }, [sessions]);
  const orderedTrackIds = useMemo(() => trackOptions.map((t) => t.id), [trackOptions]);
  const roomOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const s of sessions) {
      if (s.roomId && s.room) map.set(s.roomId, s.room);
    }
    return [...map.values()];
  }, [sessions]);
  const dayOptions = useMemo(() => {
    const keys = new Set(sortedSessions.map((s) => zonedDayKey(new Date(s.startsAt), agendaDisplayTimezone)));
    return [...keys];
  }, [sortedSessions, agendaDisplayTimezone]);
  const groupedAgenda = useMemo(
    () => groupSessionsByDayAndTime(filteredSessions, agendaDisplayTimezone),
    [filteredSessions, agendaDisplayTimezone],
  );
  const joiningSessionIds = useMemo(
    () => myAttendance.filter((item) => item.status === "JOINING").map((item) => item.sessionId),
    [myAttendance]
  );
  const myScheduledSessions = useMemo(
    () => filteredSessions.filter((session) => joiningSessionIds.includes(session.id)),
    [filteredSessions, joiningSessionIds]
  );
  const myOverlapIds = useMemo(() => overlappingSessionIds(myScheduledSessions), [myScheduledSessions]);
  const groupedMySchedule = useMemo(
    () => groupSessionsByDayAndTime(myScheduledSessions, agendaDisplayTimezone),
    [myScheduledSessions, agendaDisplayTimezone],
  );
  /* Count pill on the My Schedule segment — unaffected by active filters. */
  const myAgendaCount = useMemo(
    () => sortedSessions.filter((s) => joiningSessionIds.includes(s.id)).length,
    [sortedSessions, joiningSessionIds],
  );
  const agendaActiveFilterCount =
    (agendaFilterTrack ? 1 : 0) + (agendaFilterRoom ? 1 : 0) + (agendaSearch.trim() ? 1 : 0);

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

  const handleLogout = async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" }, token || undefined);
    } catch {
      /* ignore */
    }
    clearAuthClientState();
    window.location.href = "/login";
  };

  const isOrganizer = Boolean(user?.isEventAdmin || user?.role === "ADMIN");

  const patchSessionAttendance = async (
    sessionId: string,
    body: { status: "JOINING" | "NOT_JOINING"; joinMode?: AgendaJoinMode },
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
        void offerPushAfterFirstAgendaSave(token);
      }
    } catch (err) {
      setMyAttendance(prevAttendance);
      const msg = err instanceof Error ? err.message : "Could not update attendance";
      if (/waitlist|full/i.test(msg)) {
        window.alert(msg);
        setSessions(await apiFetch<Session[]>("/sessions", withEventHeaders(), token).catch(() => sessions));
        const meta = await apiFetch<MySessionMeta>("/sessions/me", {}, token).catch(() => null);
        if (meta) setMyAttendance(meta.attendance);
      }
    }
  };

  const goToSessionPage = (sessionId: string) => {
    router.push(`/session/${sessionId}`);
  };

  const goToRoomOnMap = (roomId: string) => {
    const pin = roomPins[roomId];
    if (!pin) return;
    setMapsFocus({ mapId: pin.mapId, pinId: pin.pinId });
    setActive(MAPS_TAB);
    void router.replace(
      { pathname: "/dashboard", query: { tab: "Maps", mapId: pin.mapId, pinId: pin.pinId } },
      undefined,
      { shallow: true },
    );
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

  const toggleSessionBookmark = async (sessionId: string) => {
    if (!token) return;
    const starred = bookmarkedSessionIds.includes(sessionId);
    const prev = bookmarkedSessionIds;
    if (starred) {
      setBookmarkedSessionIds((ids) => ids.filter((id) => id !== sessionId));
      try {
        await apiFetch(`/sessions/${sessionId}/bookmark`, { method: "DELETE" }, token);
      } catch {
        setBookmarkedSessionIds(prev);
      }
      return;
    }
    setBookmarkedSessionIds((ids) => [...ids, sessionId]);
    try {
      await apiFetch(`/sessions/${sessionId}/bookmark`, { method: "PUT" }, token);
    } catch {
      setBookmarkedSessionIds(prev);
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
        setAdminEvents(mergeAdminEvents(myEvents, updated));
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

  const eventGroupTabs: Tab[] = ["Agenda", "Attendees", MATCHMAKER_TAB, COMMUNITY_TAB, MAPS_TAB, "Messages"];
  const toNavItem = (tab: Tab): ShellNavItem => ({
    id: tab,
    label: tab,
    icon: <MainNavIcon tab={tab} />,
    active: active === tab,
    onSelect: () => setActive(tab),
    badge: tab === "Notifications" && unreadNotifications > 0 ? unreadNotifications : undefined,
  });
  const shellNav: ShellNavGroup[] = [
    {
      id: "event",
      label: "Event",
      items: eventGroupTabs.filter((tab) => availableTabs.includes(tab)).map(toNavItem),
    },
    ...(isAdmin
      ? [
          {
            id: "organize",
            label: "Organize",
            items: [
              ...(availableTabs.includes(PARTICIPANTS_INVITES_TAB) ? [toNavItem(PARTICIPANTS_INVITES_TAB)] : []),
              ...(user.orgRole
                ? [
                    {
                      id: "organizer-console",
                      label: "Organizer console",
                      href: "/organizer",
                      icon: <MainNavIcon tab="Participants and Invites" />,
                    } satisfies ShellNavItem,
                  ]
                : []),
            ],
          },
        ]
      : []),
    {
      id: "account",
      label: "Account",
      items: [
        ...(["Profile", "Notifications"] as Tab[]).filter((tab) => availableTabs.includes(tab)).map(toNavItem),
        { id: "account-settings", label: "Settings", href: "/account", icon: <MainNavIcon tab="Profile" /> },
      ],
    },
  ];
  const mobilePrimaryIds = (["Agenda", "Attendees", COMMUNITY_TAB] as Tab[]).filter((tab) =>
    availableTabs.includes(tab),
  );

  /* Filter controls — rendered in the right rail (≥1280px) and the Filters sheet below. */
  const agendaFilterControls = (
    <>
      <input
        className="input"
        type="search"
        placeholder="Search sessions, speakers, papers…"
        aria-label="Search sessions"
        value={agendaSearch}
        onChange={(e) => setAgendaSearch(e.target.value)}
      />
      <FilterGroup
        label="Day"
        options={dayOptions.map((d) => ({ id: d, label: dayChipLabel(d) }))}
        value={agendaFilterDay}
        onChange={setAgendaFilterDay}
        allLabel="All days"
      />
      <FilterGroup
        label="Track"
        options={trackOptions.map((t) => ({ id: t.id, label: t.name, dot: trackColor(t.id, t.color, orderedTrackIds) }))}
        value={agendaFilterTrack}
        onChange={setAgendaFilterTrack}
        allLabel="All tracks"
      />
      <FilterGroup
        label="Room"
        options={roomOptions.map((r) => ({ id: r.id, label: r.name }))}
        value={agendaFilterRoom}
        onChange={setAgendaFilterRoom}
        allLabel="All rooms"
      />
    </>
  );

  return (
    <AppShell
      title={event?.name || "Event dashboard"}
      logoUrl={event?.logoUrl}
      nav={shellNav}
      mobilePrimaryIds={mobilePrimaryIds}
      userName={user.name}
      userPhotoUrl={user.photoUrl}
      userMeta={`${user.role}${event ? ` · ${formatEventRange(event.startDate, event.endDate)}` : ""}`}
      events={adminEvents.map((ev) => ({
        id: ev.id,
        name: ev.name,
        meta: formatEventRange(ev.startDate, ev.endDate),
      }))}
      activeEventId={activeEventId}
      onSelectEvent={(id) => {
        failedEventIds.current.delete(id);
        setActiveEventId(id);
        window.localStorage.setItem("activeEventId", id);
        setEventLoadError(null);
        setTabError(null);
        setSessionsLoading(true);
        setEvent(null);
      }}
      topBarExtra={
        engagementPointsOn && typeof user.engagementPoints === "number" ? (
          <span
            className={`points-gem ${engagementGemTier(user.engagementPoints).tierClass}`}
            title={`${engagementGemTier(user.engagementPoints).label} · ${user.engagementPoints} engagement pts`}
          >
            <EngagementGemMark />
            <span>{user.engagementPoints}</span>
          </span>
        ) : null
      }
      accountMenu={[
        { id: "profile", label: "Profile", onSelect: () => setActive("Profile") },
        ...(isAdmin && event
          ? [
              {
                id: "event-settings",
                label: "Event settings",
                onSelect: () => {
                  setEventSettingsError(null);
                  setEventSettingsOpen(true);
                },
              },
            ]
          : []),
        { id: "account", label: "Account settings", href: "/account" },
        { id: "logout", label: "Log out", tone: "danger" as const, onSelect: () => void handleLogout() },
      ]}
    >
      {eventLoadError ? (
        <ListEmpty
          title="No event to show"
          body={eventLoadError}
          actionLabel="Browse demo"
          onAction={() => {
            window.location.href = `/e/${brand.demoEventSlug || "demo"}`;
          }}
        />
      ) : null}
      {tabError && !eventLoadError ? (
        <ListError
          message={tabError}
          onRetry={() => {
            setTabError(null);
            setTabReloadToken((n) => n + 1);
          }}
        />
      ) : null}

      <OnboardingPanel
        onSampleCreated={(eventId) => {
          failedEventIds.current.delete(eventId);
          writeClientStorage(window.localStorage, "linkedEventContext", eventId);
          window.localStorage.setItem("activeEventId", eventId);
          window.location.reload();
        }}
      />

      {active === "Agenda" && (
        <>
          {token && activeEventId ? (
            <SponsorsStrip token={token} eventId={activeEventId} enabled={featureOn("sponsors")} />
          ) : null}
        <div className="schedule-layout">
          <div className="schedule-list">
            <div className="agenda-context-bar">
              <div className="agenda-context-row">
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
                  <button
                    type="button"
                    role="tab"
                    aria-selected={agendaView === "My Schedule"}
                    className={agendaView === "My Schedule" ? "active" : ""}
                    onClick={() => setAgendaView("My Schedule")}
                  >
                    My Schedule
                    <span className="agenda-seg-count">{myAgendaCount}</span>
                  </button>
                </div>
                <span className="agenda-context-spacer" aria-hidden />
                {timezoneToggleOn ? (
                  <div
                    className="agenda-timezone-toggle"
                    role="tablist"
                    aria-label="Time display mode"
                    title={`Times shown in ${agendaDisplayTimezone}`}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={agendaTimeMode === "MY"}
                      className={agendaTimeMode === "MY" ? "active" : ""}
                      onClick={() => setAgendaTimeMode("MY")}
                    >
                      My timezone
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={agendaTimeMode === "EVENT"}
                      className={agendaTimeMode === "EVENT" ? "active" : ""}
                      onClick={() => setAgendaTimeMode("EVENT")}
                    >
                      Event timezone
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="button secondary agenda-filters-btn"
                  aria-haspopup="dialog"
                  aria-expanded={agendaFiltersOpen}
                  onClick={() => setAgendaFiltersOpen(true)}
                >
                  Filters{agendaActiveFilterCount ? ` · ${agendaActiveFilterCount}` : ""}
                </button>
                {isAdmin ? (
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setEditingSession(null);
                      setSessionFormKey((k) => k + 1);
                      setSessionDrawerOpen(true);
                    }}
                  >
                    + New session
                  </button>
                ) : null}
              </div>
              <DayChips days={dayOptions} value={agendaFilterDay} onChange={setAgendaFilterDay} />
            </div>
            <p className="text-meta" style={{ margin: "0 0 10px" }}>
              Times shown in <strong>{agendaDisplayTimezone}</strong>
              {timezoneToggleOn
                ? ` (${agendaTimeMode === "MY" ? "your device setting" : "event setting"})`
                : " (event timezone)"}
            </p>
            {(agendaNowNext.now.length > 0 || agendaNowNext.next) && (
              <p className="help-text" style={{ marginTop: 0 }}>
                {agendaNowNext.now.length > 0 ? (
                  <>
                    <strong>Now:</strong> {agendaNowNext.now.map((s) => s.title).join(" · ")}
                    {agendaNowNext.next ? " · " : ""}
                  </>
                ) : null}
                {agendaNowNext.next ? (
                  <>
                    <strong>Next:</strong> {agendaNowNext.next.title}
                  </>
                ) : null}
              </p>
            )}
            {agendaView === "My Schedule" && myOverlapIds.size > 0 ? (
              <p className="help-text" style={{ color: "var(--danger)", marginTop: 0 }}>
                {myOverlapIds.size} sessions on your agenda overlap — check times before you go.
              </p>
            ) : null}
            {agendaView === "My Schedule" ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    const lines = [
                      "BEGIN:VCALENDAR",
                      "VERSION:2.0",
                      `PRODID:${icsProductId('Agenda')}`,
                      "CALSCALE:GREGORIAN",
                    ];
                    for (const s of myScheduledSessions) {
                      lines.push(
                        "BEGIN:VEVENT",
                        `UID:${s.id}@${brand.domain}`,
                        `DTSTART:${new Date(s.startsAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
                        `DTEND:${new Date(s.endsAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
                        `SUMMARY:${(s.title || "").replace(/\n/g, " ")}`,
                        "END:VEVENT",
                      );
                    }
                    lines.push("END:VCALENDAR");
                    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "my-agenda.ics";
                    a.click();
                  }}
                >
                  Download agenda ICS
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={async () => {
                    if (!token) return;
                    const res = await apiFetch<{ url: string }>("/ics/feed", withEventHeaders({ method: "POST" }), token);
                    window.prompt("Subscribe to this read-only ICS URL in your calendar app:", res.url);
                  }}
                >
                  ICS subscription URL
                </button>
              </div>
            ) : null}
            {sessionsLoading && sortedSessions.length === 0 ? <ListSkeleton rows={8} /> : null}
            {(!sessionsLoading || sortedSessions.length > 0) && agendaView === "Event Schedule" && (
              <ScheduleBoard
                grouped={groupedAgenda}
                eventName={event?.name || "Event"}
                eventTimezone={event?.timezone || "UTC"}
                displayTimezone={agendaDisplayTimezone}
                orderedTrackIds={orderedTrackIds}
                isAdmin={isAdmin}
                myAttendance={myAttendance}
                likedSessionIds={sessionLikesOn ? likedSessionIds : []}
                bookmarkedSessionIds={bookmarkedSessionIds}
                onPatchAttendance={patchSessionAttendance}
                onToggleLike={sessionLikesOn ? toggleSessionLike : undefined}
                onToggleBookmark={toggleSessionBookmark}
                likesEnabled={sessionLikesOn}
                qaEnabled={featureOn("session_qa")}
                roomPins={venueMapsOn ? roomPins : {}}
                onViewOnMap={venueMapsOn ? goToRoomOnMap : undefined}
                onEditSession={(session) => {
                  setEditingSession(session);
                  setSessionFormKey((k) => k + 1);
                  setSessionDrawerOpen(true);
                }}
                onGoToSession={goToSessionPage}
              />
            )}
            {(!sessionsLoading || sortedSessions.length > 0) && agendaView === "My Schedule" && (
              <ScheduleBoard
                grouped={groupedMySchedule}
                eventName={event?.name || "Event"}
                eventTimezone={event?.timezone || "UTC"}
                displayTimezone={agendaDisplayTimezone}
                orderedTrackIds={orderedTrackIds}
                isAdmin={isAdmin}
                myAttendance={myAttendance}
                likedSessionIds={sessionLikesOn ? likedSessionIds : []}
                bookmarkedSessionIds={bookmarkedSessionIds}
                onPatchAttendance={patchSessionAttendance}
                onToggleLike={sessionLikesOn ? toggleSessionLike : undefined}
                onToggleBookmark={toggleSessionBookmark}
                likesEnabled={sessionLikesOn}
                qaEnabled={featureOn("session_qa")}
                roomPins={venueMapsOn ? roomPins : {}}
                onViewOnMap={venueMapsOn ? goToRoomOnMap : undefined}
                onEditSession={(session) => {
                  setEditingSession(session);
                  setSessionFormKey((k) => k + 1);
                  setSessionDrawerOpen(true);
                }}
                onGoToSession={goToSessionPage}
              />
            )}
          </div>
          <aside className="agenda-rail" aria-label="Agenda filters">
            <div className="agenda-rail-panel">{agendaFilterControls}</div>
          </aside>
          {isAdmin && (sessionDrawerOpen || editingSession) ? (
            <>
              <div
                className="drawer-backdrop"
                role="presentation"
                onClick={() => {
                  setSessionDrawerOpen(false);
                  setEditingSession(null);
                }}
              />
              <div className="drawer-panel" role="dialog" aria-modal="true" aria-label="Session editor">
                <SessionForm
                  key={sessionFormKey}
                  token={token!}
                  eventTimezone={event?.timezone || "UTC"}
                  eventHeaders={withEventHeaders}
                  attendees={attendees}
                  editing={editingSession}
                  onSaved={async () => {
                    setEditingSession(null);
                    setSessionDrawerOpen(false);
                    setActive("Agenda");
                    setSessionFormKey((k) => k + 1);
                    setSessions(await apiFetch<Session[]>("/sessions", withEventHeaders(), token!));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  onCancel={() => {
                    setEditingSession(null);
                    setSessionDrawerOpen(false);
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
        <AgendaFiltersSheet open={agendaFiltersOpen} onClose={() => setAgendaFiltersOpen(false)}>
          {agendaFilterControls}
        </AgendaFiltersSheet>
        </>
      )}

      {active === MAPS_TAB && venueMapsOn && (
        <div className="card">
          <VenueMapsAttendee
            eventId={activeEventId}
            token={token}
            withEventHeaders={withEventHeaders}
            focusMapId={mapsFocus.mapId}
            focusPinId={mapsFocus.pinId}
            displayTimezone={agendaDisplayTimezone}
          />
        </div>
      )}

      {active === "Attendees" && (
        <>
          <AttendeeDirectory
            attendees={attendees}
            currentUserId={user.id}
            loading={attendeesLoading}
            onMessage={startDirectMessage}
            onRequestMeeting={(a) => setMeetingTarget({ id: a.id, name: a.name })}
          />
          {token ? (
            <MeetingRequestsPanel
              key={meetingsRefreshKey}
              token={token}
              withEventHeaders={withEventHeaders}
              currentUserId={user.id}
            />
          ) : null}
          <MeetingRequestModal
            open={Boolean(meetingTarget)}
            toUser={meetingTarget}
            token={token!}
            withEventHeaders={withEventHeaders}
            onClose={() => setMeetingTarget(null)}
            onSent={() => setMeetingsRefreshKey((k) => k + 1)}
          />
        </>
      )}

      {active === MATCHMAKER_TAB && token && activeEventId && featureOn("matchmaker") ? (
        <MatchmakerPanel
          eventId={activeEventId}
          token={token}
          withEventHeaders={withEventHeaders}
          onViewProfile={(userId) => {
            setActive("Attendees");
            // Directory shows all opted-in; focus via hash for accessibility
            if (typeof window !== "undefined") {
              window.location.hash = `attendee-${userId}`;
            }
          }}
          onDraftIntro={({ conversationId, prefillBody }) => {
            if (!conversations.some((c) => c.id === conversationId)) {
              apiFetch<Conversation[]>("/conversations", withEventHeaders(), token)
                .then(setConversations)
                .catch(() => null);
            }
            setActiveConversationId(conversationId);
            setMessagePrefill(prefillBody);
            setActive("Messages");
          }}
        />
      ) : null}

      {active === PARTICIPANTS_INVITES_TAB && isAdmin && (
        <div className="grid" style={{ gap: 16 }}>
          <ModerationReportsPanel token={token!} withEventHeaders={withEventHeaders} />
          <div className="console-panel">
            <p className="console-panel-label">Event for invites</p>
            <p className="help-text" style={{ marginTop: 0 }}>
              Invites and the roster below are tied to this event (same as Profile → My Events).
            </p>
            {adminEvents.length > 0 ? (
              <div className="console-form">
                <label>
                  Event
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
              </div>
            ) : (
              <p className="help-text" style={{ color: "var(--danger)", margin: "12px 0 0" }}>
                No events found. Create one under <strong>Profile</strong> → <strong>My Events</strong>.
              </p>
            )}
          </div>
          <AdminParticipantInviteCard
            token={token!}
            withEventHeaders={withEventHeaders}
            activeEventId={activeEventId}
            eventSlug={event?.slug ?? null}
            onInvited={async () => {
              const list = await apiFetchAll<User>("/attendees", withEventHeaders(), token!);
              setAttendees(list);
            }}
          />
          <BulkInviteCsvCard
            token={token!}
            withEventHeaders={withEventHeaders}
            activeEventId={activeEventId}
            onDone={async () => {
              const list = await apiFetchAll<User>("/attendees", withEventHeaders(), token!);
              setAttendees(list);
            }}
          />
          <div className="card" style={{ padding: 18 }}>
            <h3 style={{ marginTop: 0 }}>Roster &amp; invitations</h3>
            <p className="help-text" style={{ marginTop: 0 }}>
              <strong>Joined</strong> means the account is active (invite completed, or they registered another way).{" "}
              <strong>Pending</strong> means they were emailed a setup link and have not finished creating their password.{" "}
              New invites <strong>do not expire</strong>. Older rows may still show <strong>Expired</strong> if they used a dated link from before that change — invite them again if needed.
            </p>
            <div className="invite-status-table-wrap">
              <table className="invite-status-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Invite / join status</th>
                    <th>Link expires</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {attendees.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Name">{a.name}</td>
                      <td data-label="Email">{a.email}</td>
                      <td data-label="Role">
                        {a.role === "ADMIN" ? (
                          <span className="roster-role-badge roster-role-badge--admin">Administrator</span>
                        ) : (
                          rosterRoleLabel(a.role)
                        )}
                      </td>
                      <td data-label="Status">{inviteStatusLabel(a)}</td>
                      <td data-label="Link expires">
                        {a.inviteStatus === "PENDING_SETUP" && !a.inviteExpiresAt
                          ? "Does not expire"
                          : a.inviteStatus === "PENDING_SETUP" && a.inviteExpiresAt
                            ? new Date(a.inviteExpiresAt).toLocaleString()
                            : "—"}
                      </td>
                      <td data-label="Actions" className="invite-actions-cell">
                        {a.id === user.id ? (
                          <p className="roster-admin-note text-meta" style={{ margin: 0 }}>
                            You
                          </p>
                        ) : (
                          <KebabMenu
                            label={`Actions for ${a.name}`}
                            items={[
                              ...(a.role === "ADMIN"
                                ? [
                                    {
                                      id: "remove-admin",
                                      label: "Remove admin access",
                                      disabled: rosterAdminCount <= 1,
                                      title:
                                        rosterAdminCount <= 1
                                          ? "There must be at least one administrator"
                                          : undefined,
                                      onSelect: () => setRosterConfirm({ kind: "remove-admin", user: a }),
                                    },
                                  ]
                                : [
                                    {
                                      id: "make-admin",
                                      label: "Make admin",
                                      onSelect: () => setRosterConfirm({ kind: "make-admin", user: a }),
                                    },
                                  ]),
                              {
                                id: "delete",
                                label: "Remove from event",
                                tone: "danger" as const,
                                onSelect: () => setRosterConfirm({ kind: "delete", user: a }),
                              },
                            ]}
                          />
                        )}
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
          enabledChannels={{
            MEETUP: featureOn("community_meetups"),
            MOMENTS: featureOn("community_moments"),
            LOCAL: featureOn("community_local"),
            ICEBREAKER: featureOn("community_icebreakers"),
            GENERAL: featureOn("community_general"),
          }}
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
            <h3 style={{ margin: 0 }}>
              Notifications
              {unreadNotifications > 0 ? (
                <span className="help-text" style={{ marginLeft: 10, fontWeight: 600 }}>
                  {unreadNotifications} unread
                </span>
              ) : (
                <span className="help-text" style={{ marginLeft: 10, fontWeight: 500 }}>
                  All caught up
                </span>
              )}
            </h3>
            <button
              type="button"
              className="button secondary"
              disabled={unreadNotifications === 0}
              onClick={async () => {
                await apiFetch("/notifications/read-all", withEventHeaders({ method: "POST" }), token!);
                setNotifications(await apiFetch<UserNotificationRow[]>("/notifications", withEventHeaders(), token!));
              }}
            >
              Mark all read
            </button>
          </div>
          <p className="help-text" style={{ marginTop: 8 }}>
            One inbox for this event — session changes and messages may notify you; quieter community activity rolls into your
            daily digest. Open an item to jump to it.
          </p>
          {notifications.length === 0 ? (
            <p className="help-text" style={{ marginTop: 16 }}>
              You&apos;re all caught up.
            </p>
          ) : (
            <div style={{ marginTop: 16 }}>
              {notificationsByDay.map((group) => (
                <div key={group.heading} style={{ marginBottom: 18 }}>
                  <h4 className="help-text" style={{ margin: "0 0 8px", fontWeight: 700, letterSpacing: "0.02em" }}>
                    {group.heading}
                  </h4>
                  <ul className="notification-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {group.items.map((n) => (
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
                            if (n.kind === "ADMIN_REQUEST" || n.kind === "USER_REPORT") {
                              setActive(PARTICIPANTS_INVITES_TAB);
                            } else if (n.kind === "AGENT_ATTENDEE_TOUCH") {
                              setActive(MATCHMAKER_TAB);
                            } else if (n.kind === "MEETING_REQUEST" || n.kind === "MEETING_ACCEPTED" || n.meetingRequestId) {
                              setActive("Attendees");
                            } else if (n.sessionId) {
                              router.push(`/session/${n.sessionId}`);
                            } else if (n.threadId) {
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
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                          }}
                        >
                          <span className="notification-kind-icon" aria-hidden>
                            {notificationKindIcon(n.kind)}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <strong style={{ display: "block" }}>{n.title}</strong>
                            {n.body ? (
                              <span className="help-text" style={{ display: "block", marginTop: 4 }}>
                                {n.body}
                              </span>
                            ) : null}
                            <span className="help-text" style={{ display: "block", marginTop: 6, fontSize: 12 }}>
                              {formatEventDateTime(n.createdAt)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {active === "Messages" && (
        <div className="grid two messages-layout">
          <div className="card message-sidebar-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>Messages</h3>
              <button
                type="button"
                className="button secondary"
                onClick={() => setNewChatMode((prev) => (prev ? null : "direct"))}
              >
                {newChatMode ? "Close" : "+ New"}
              </button>
            </div>
            <p className="help-text" style={{ marginTop: 8 }}>
              Your chats are listed below. Use <strong>+ New</strong> for a direct or group conversation.{" "}
              <strong>Everyone — event chat</strong> reaches all attendees; session Q&amp;A stays on each session page.
            </p>
            {newChatMode ? (
              <div className="new-chat-panel" style={{ marginBottom: 14, padding: 12, border: "1px solid var(--border)", borderRadius: 10 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <button
                    type="button"
                    className={newChatMode === "direct" ? "button" : "button secondary"}
                    onClick={() => setNewChatMode("direct")}
                  >
                    Direct
                  </button>
                  <button
                    type="button"
                    className={newChatMode === "group" ? "button" : "button secondary"}
                    onClick={() => setNewChatMode("group")}
                  >
                    Group
                  </button>
                </div>
                {newChatMode === "direct" ? (
                  <DirectChatForm
                    attendees={attendees}
                    currentUserId={user.id}
                    token={token!}
                    withEventHeaders={withEventHeaders}
                    onCreated={(c) => {
                      setConversations([c, ...conversations]);
                      setActiveConversationId(c.id);
                      setNewChatMode(null);
                    }}
                  />
                ) : (
                  <GroupChatForm
                    attendees={attendees}
                    currentUserId={user.id}
                    token={token!}
                    withEventHeaders={withEventHeaders}
                    onCreated={(c) => {
                      setConversations([c, ...conversations]);
                      setActiveConversationId(c.id);
                      setNewChatMode(null);
                    }}
                  />
                )}
              </div>
            ) : null}
            <label className="help-text" htmlFor="message-directory-search" style={{ display: "block", marginBottom: 6 }}>
              Filter chats
            </label>
            <input
              id="message-directory-search"
              className="input"
              type="search"
              placeholder="Type a name or chat topic…"
              value={messageDirectoryQuery}
              onChange={(e) => setMessageDirectoryQuery(e.target.value)}
              aria-label="Search conversations"
            />
            <h4 style={{ margin: "16px 0 8px" }}>Your chats</h4>
            <div className="grid" style={{ gap: 8 }}>
              {eventWideConversation ? (
                <button
                  type="button"
                  className={activeConversationId === eventWideConversation.id ? "button" : "button secondary"}
                  onClick={() => setActiveConversationId(eventWideConversation.id)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
                >
                  <span>{formatConversationName(eventWideConversation, user)}</span>
                  {unreadConversationIds.has(eventWideConversation.id) ? (
                    <span className="help-text" style={{ fontWeight: 700, fontSize: 12 }}>
                      New
                    </span>
                  ) : null}
                </button>
              ) : null}
              {filteredDirectAndGroup.map((c) => (
                <button
                  key={c.id}
                  className={activeConversationId === c.id ? "button" : "button secondary"}
                  onClick={() => setActiveConversationId(c.id)}
                  type="button"
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
                >
                  <span>{formatConversationName(c, user)}</span>
                  {unreadConversationIds.has(c.id) ? (
                    <span className="help-text" style={{ fontWeight: 700, fontSize: 12 }}>
                      New
                    </span>
                  ) : null}
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
                      : "Select a chat from the list, or start one with + New."}
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
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <div>
                        <strong>{m.user?.name ?? DELETED_PARTICIPANT_LABEL}</strong>{" "}
                        <span style={{ color: "var(--ink-500)" }}>
                          ({m.user?.role ?? "—"})
                        </span>
                      </div>
                      {(isAdmin || (m.user?.id != null && m.user.id === user.id)) && (
                        <KebabMenu
                          label={`Message actions`}
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
                              onSelect: () => setMessageConfirmId(m.id),
                            },
                          ]}
                        />
                      )}
                    </div>
                    {editingMessageId === m.id ? (
                      <form
                        className="grid"
                        style={{ gap: 8, marginTop: 8 }}
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!activeConversationId || !token) return;
                          try {
                            const updated = await apiFetch<Message>(
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
                            window.alert(err instanceof Error ? err.message : "Could not save message");
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
                          <button
                            className="button secondary"
                            type="button"
                            onClick={() => setEditingMessageId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <p style={{ margin: "4px 0" }}>
                        <AutolinkText text={m.body} />
                      </p>
                    )}
                    <small style={{ color: "var(--ink-500)" }}>{formatEventDateTime(m.createdAt)}</small>
                  </div>
                ))
              )}
            </div>
            <MessageComposer
              token={token!}
              conversationId={activeConversationId}
              withEventHeaders={withEventHeaders}
              initialBody={messagePrefill}
              onInitialBodyConsumed={() => setMessagePrefill(null)}
              onSent={async (m) => {
                setMessages([...messages, m]);
                setMessagePrefill(null);
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
          onAdminRequestSent={async () => {
            try {
              setNotifications(await apiFetch<UserNotificationRow[]>("/notifications", withEventHeaders(), token!));
            } catch {
              /* ignore */
            }
          }}
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
            setAdminEvents((prev) => mergeAdminEvents([created, ...prev], event));
            setActiveEventId(created.id);
            window.localStorage.setItem("activeEventId", created.id);
            setActive("Agenda");
          }}
        />
      )}

      {event ? (
        <EventSettingsModal
          open={eventSettingsOpen}
          eventId={event.id}
          slugUrlPreview={
            typeof window !== "undefined" ? `${window.location.origin}/e/${event.slug}` : `/e/${event.slug}`
          }
          timezoneOptions={EVENT_TIMEZONE_OPTIONS}
          timezoneLabel={timezoneOptionLabel}
          initial={{
            name: event.name,
            slug: event.slug,
            logoUrl: event.logoUrl || "",
            bannerUrl: event.bannerUrl || "",
            timezone: event.timezone,
            startDate: toLocalInputValueInTimeZone(event.startDate, event.timezone),
            endDate: toLocalInputValueInTimeZone(event.endDate, event.timezone),
          }}
          saving={updatingEvent}
          error={eventSettingsError}
          onClose={() => setEventSettingsOpen(false)}
          fileToDataUrl={fileToDataUrl}
          onSave={async (values) => {
            await updateCurrentEvent({
              name: values.name,
              slug: values.slug.trim() || undefined,
              logoUrl: values.logoUrl.trim() || undefined,
              bannerUrl: values.bannerUrl,
              timezone: values.timezone,
              startDate: zonedDateTimeLocalToIso(values.startDate, values.timezone),
              endDate: zonedDateTimeLocalToIso(values.endDate, values.timezone),
            });
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(rosterConfirm)}
        title={
          rosterConfirm?.kind === "delete"
            ? `Remove ${rosterConfirm.user.name}?`
            : rosterConfirm?.kind === "make-admin"
              ? `Make ${rosterConfirm.user.name} an admin?`
              : `Remove admin access?`
        }
        body={
          rosterConfirm?.kind === "delete"
            ? `${rosterConfirm.user.name} (${rosterConfirm.user.email}) will be removed from this event roster. Their account and posts are kept for 30 days in case you need to restore access.`
            : rosterConfirm?.kind === "make-admin"
              ? `${rosterConfirm.user.name} (${rosterConfirm.user.email}) will be able to manage events, invites, and sessions.`
              : `${rosterConfirm?.user.name} will become a regular attendee.`
        }
        confirmLabel={
          rosterConfirm?.kind === "delete"
            ? "Remove from event"
            : rosterConfirm?.kind === "make-admin"
              ? "Make admin"
              : "Remove admin"
        }
        busy={rosterBusy}
        onCancel={() => setRosterConfirm(null)}
        onConfirm={async () => {
          if (!rosterConfirm || !token) return;
          setRosterBusy(true);
          try {
            if (rosterConfirm.kind === "delete") {
              await apiFetch(`/attendees/${rosterConfirm.user.id}`, { method: "DELETE" }, token);
              setAttendees((prev) => prev.filter((row) => row.id !== rosterConfirm.user.id));
            } else if (rosterConfirm.kind === "make-admin") {
              await apiFetch(`/attendees/${rosterConfirm.user.id}/make-admin`, { method: "POST" }, token);
              setAttendees(await apiFetchAll<User>("/attendees", withEventHeaders(), token));
            } else {
              await apiFetch(`/attendees/${rosterConfirm.user.id}/remove-admin`, { method: "POST" }, token);
              setAttendees(await apiFetchAll<User>("/attendees", withEventHeaders(), token));
            }
            setRosterConfirm(null);
          } catch (err) {
            window.alert(err instanceof Error ? err.message : "Action failed");
          } finally {
            setRosterBusy(false);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(messageConfirmId && activeConversationId)}
        title="Delete message?"
        body="This removes the message from the conversation for everyone. This cannot be undone."
        confirmLabel="Delete message"
        onCancel={() => setMessageConfirmId(null)}
        onConfirm={async () => {
          if (!messageConfirmId || !activeConversationId || !token) return;
          try {
            await apiFetch(
              `/conversations/${activeConversationId}/messages/${messageConfirmId}`,
              withEventHeaders({ method: "DELETE" }),
              token,
            );
            setMessages((prev) => prev.filter((m) => m.id !== messageConfirmId));
            setMessageConfirmId(null);
          } catch (err) {
            window.alert(err instanceof Error ? err.message : "Could not delete message");
          }
        }}
      />

      {event?.showPoweredByBadge ? (
        <p className="text-meta" style={{ textAlign: "center", marginTop: 28, opacity: 0.75 }}>
          Powered by {brand.productName}
        </p>
      ) : null}

      {activeEventId && featureOn("concierge") ? (
        <ConciergeChat
          eventId={activeEventId}
          enabled
          onMapHint={(hint) => {
            if (hint.mapId && featureOn("venue_maps")) {
              setActive(MAPS_TAB);
            }
          }}
        />
      ) : null}

    </AppShell>
  );
}

function ScheduleBoard({
  grouped,
  eventName,
  eventTimezone,
  displayTimezone,
  orderedTrackIds = [],
  isAdmin,
  myAttendance,
  likedSessionIds,
  bookmarkedSessionIds = [],
  onPatchAttendance,
  onToggleLike,
  onToggleBookmark,
  likesEnabled = true,
  qaEnabled = true,
  roomPins = {},
  onViewOnMap,
  onEditSession,
  onGoToSession,
}: {
  grouped: Array<{ dayLabel: string; timeSlots: Array<{ timeLabel: string; sessions: Session[] }> }>;
  eventName: string;
  eventTimezone: string;
  displayTimezone: string;
  orderedTrackIds?: string[];
  isAdmin: boolean;
  myAttendance: SessionAttendance[];
  likedSessionIds: string[];
  bookmarkedSessionIds?: string[];
  onPatchAttendance: (
    sessionId: string,
    body: { status: "JOINING" | "NOT_JOINING"; joinMode?: AgendaJoinMode },
  ) => void | Promise<void>;
  onToggleLike?: (sessionId: string) => void;
  onToggleBookmark?: (sessionId: string) => void;
  likesEnabled?: boolean;
  qaEnabled?: boolean;
  roomPins?: Record<string, { mapId: string; pinId: string }>;
  onViewOnMap?: (roomId: string) => void;
  onEditSession: (session: Session) => void;
  onGoToSession: (sessionId: string) => void;
}) {
  const [agendaModalSessionId, setAgendaModalSessionId] = useState<string | null>(null);
  const [calendarModalSessionId, setCalendarModalSessionId] = useState<string | null>(null);

  const agendaModalSession = useMemo(() => {
    if (!agendaModalSessionId) return null;
    for (const dayGroup of grouped) {
      for (const slot of dayGroup.timeSlots) {
        for (const s of slot.sessions) {
          if (s.id === agendaModalSessionId) return s;
        }
      }
    }
    return null;
  }, [grouped, agendaModalSessionId]);

  const calendarModalSession = useMemo(() => {
    if (!calendarModalSessionId) return null;
    for (const dayGroup of grouped) {
      for (const slot of dayGroup.timeSlots) {
        for (const s of slot.sessions) {
          if (s.id === calendarModalSessionId) return s;
        }
      }
    }
    return null;
  }, [grouped, calendarModalSessionId]);

  if (grouped.length === 0) {
    return (
      <ListEmpty
        title="No sessions in this view"
        body="Adjust the day or filters, or check back once the program is published."
      />
    );
  }

  const agendaModalAllowsVirtual = agendaModalSession?.allowVirtualJoin !== false;

  async function joinSessionAndOpenCalendar(sessionId: string, joinMode: AgendaJoinMode) {
    setAgendaModalSessionId(null);
    await onPatchAttendance(sessionId, { status: "JOINING", joinMode });
    setCalendarModalSessionId(sessionId);
  }

  return (
    <>
      {grouped.map((dayGroup) => {
        const [weekday, ...restLabel] = dayGroup.dayLabel.split(", ");
        return (
        <section key={dayGroup.dayLabel} className="schedule-day">
          <h3 className="schedule-day-heading">
            <strong>{weekday}</strong>
            {restLabel.length ? `, ${restLabel.join(", ")}` : null}
          </h3>
          {dayGroup.timeSlots.map((slot) => (
            <div key={`${dayGroup.dayLabel}-${slot.timeLabel}`} className="schedule-slot">
              <div className="schedule-time">
                <span>{slot.timeLabel}</span>
                <span className="schedule-time-tz">
                  {timeZoneAbbrev(new Date(slot.sessions[0]!.startsAt), displayTimezone)}
                </span>
              </div>
              <div className="schedule-events-wrap">
                {slot.sessions.length > 1 && (
                  <div className="schedule-concurrent-note">{slot.sessions.length} concurrent sessions</div>
                )}
                <div className="schedule-events">
                {slot.sessions.map((s) => {
                  const myRow = myAttendance.find((item) => item.sessionId === s.id);
                  const myStatus = myRow?.status;
                  const joiningList = (s.attendances || []).filter((attendance) => attendance.status === "JOINING");
                  const joinedCount = joiningList.length;
                  const virtualJoining = joiningList.filter((a) => a.joinMode === "VIRTUAL").length;
                  const asyncJoining = joiningList.filter((a) => a.joinMode === "ASYNC").length;
                  const inPersonJoining = joinedCount - virtualJoining - asyncJoining;
                  const liked = likedSessionIds.includes(s.id);
                  const starred = bookmarkedSessionIds.includes(s.id);
                  const likeCount = (s.likes || []).length;
                  const joining = myStatus === "JOINING";
                  const myMode = myRow?.joinMode ?? "IN_PERSON";
                  const sessionAllowsVirtual = s.allowVirtualJoin !== false;
                  const inPersonFull =
                    s.inPersonCapacity != null && inPersonJoining >= s.inPersonCapacity;
                  const virtualFull =
                    s.virtualCapacity != null && virtualJoining >= s.virtualCapacity;
                  const paperCount = s.items?.length || 0;
                  const roomLabel = s.room?.name || s.location || null;
                  const countBits = [
                    `${inPersonJoining}${s.inPersonCapacity != null ? `/${s.inPersonCapacity}` : ""} in-person`,
                    `${virtualJoining}${s.virtualCapacity != null ? `/${s.virtualCapacity}` : ""} virtual`,
                    `${asyncJoining} async`,
                  ];
                  if (likeCount > 0) countBits.push(`${likeCount} like${likeCount === 1 ? "" : "s"}`);
                  if ((s.waitlistEntries?.length || 0) > 0) countBits.push(`${s.waitlistEntries!.length} waitlisted`);
                  const extraLinks: Array<{ key: string; node: ReactNode }> = [];
                  if (s.recordingUrl) {
                    extraLinks.push({
                      key: "rec",
                      node: (
                        <a href={s.recordingUrl} target="_blank" rel="noreferrer" className="schedule-meta-chip" onClick={(event) => event.stopPropagation()}>
                          Recording
                        </a>
                      ),
                    });
                  }
                  if (s.fileLink) {
                    extraLinks.push({
                      key: "file",
                      node: (
                        <a href={s.fileLink} target="_blank" rel="noreferrer" className="schedule-meta-chip" onClick={(event) => event.stopPropagation()}>
                          Resources
                        </a>
                      ),
                    });
                  }
                  if (s.fileUrl) {
                    extraLinks.push({
                      key: "upload",
                      node: (
                        <a href={s.fileUrl} target="_blank" rel="noreferrer" className="schedule-meta-chip" onClick={(event) => event.stopPropagation()}>
                          File
                        </a>
                      ),
                    });
                  }
                  if (s.roomId && onViewOnMap && roomPins[s.roomId]) {
                    extraLinks.push({
                      key: "map",
                      node: (
                        <button
                          type="button"
                          className="schedule-meta-chip"
                          onClick={(event) => {
                            event.stopPropagation();
                            onViewOnMap(s.roomId!);
                          }}
                        >
                          Map
                        </button>
                      ),
                    });
                  }
                  return (
                    <article
                      className="schedule-event"
                      key={s.id}
                      style={{ ["--track-color" as string]: trackColor(s.trackId, s.track?.color, orderedTrackIds) }}
                      title={s.description || undefined}
                      onClick={() => onGoToSession(s.id)}
                    >
                      <div className="schedule-event-main">
                        <h4 className="schedule-event-title">
                          <span className="schedule-event-title-text">{s.title}</span>
                          {paperCount > 0 ? (
                            <span className="schedule-option-chip">
                              {paperCount} paper{paperCount === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          {inPersonFull || virtualFull ? (
                            <span className="schedule-option-chip">Full — waitlist</span>
                          ) : null}
                        </h4>
                        <div className="schedule-event-meta-row">
                          <p className="schedule-event-meta">
                            {formatRowTimeRange(s.startsAt, s.endsAt, displayTimezone)}
                            {roomLabel ? ` · ${roomLabel}` : ""}
                            {s.track?.name ? ` · ${s.track.name}` : ""}
                            {s.zoomLink ? (
                              <>
                                {" · "}
                                <OnlineMeetingLink
                                  href={s.zoomLink}
                                  variant="chip"
                                  onClick={(event) => event.stopPropagation()}
                                />
                              </>
                            ) : null}
                            {extraLinks.map((link) => (
                              <span key={link.key}>
                                {" · "}
                                {link.node}
                              </span>
                            ))}
                            {isAdmin || joinedCount > 0 ? ` · ${countBits.join(" · ")}` : null}
                          </p>
                          {joining ? (
                            <div
                              className="join-mode-switch join-mode-switch--compact"
                              onClick={(event) => event.stopPropagation()}
                              role="group"
                              aria-label="Attendance mode"
                            >
                              {sessionAllowsVirtual && (
                                <button
                                  type="button"
                                  className={myMode === "VIRTUAL" ? "is-active" : ""}
                                  onClick={() => onPatchAttendance(s.id, { status: "JOINING", joinMode: "VIRTUAL" })}
                                >
                                  Virtual
                                </button>
                              )}
                              <button
                                type="button"
                                className={myMode === "IN_PERSON" ? "is-active" : ""}
                                onClick={() => onPatchAttendance(s.id, { status: "JOINING", joinMode: "IN_PERSON" })}
                              >
                                In person
                              </button>
                              <button
                                type="button"
                                className={myMode === "ASYNC" ? "is-active" : ""}
                                onClick={() => onPatchAttendance(s.id, { status: "JOINING", joinMode: "ASYNC" })}
                                title="Asynchronous — join across time zones"
                              >
                                Async
                              </button>
                            </div>
                          ) : null}
                        </div>
                        {(s.speakers || s.speaker?.name) && (
                          <p className="schedule-event-speakers">{s.speakers || s.speaker?.name}</p>
                        )}
                      </div>
                      <div className="schedule-event-side" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className={`attendance-join-dot schedule-event-save ${joining ? "is-on" : ""}`}
                          aria-pressed={joining}
                          aria-label={joining ? "Remove from my schedule" : "Add to my schedule"}
                          title={
                            joining
                              ? `On my schedule (${agendaJoinModeLabel(myMode)}) — click to remove`
                              : sessionAllowsVirtual
                                ? "Add to my schedule — in person, virtual, or async"
                                : "Add to my schedule — in person or async"
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            if (joining) {
                              void onPatchAttendance(s.id, { status: "NOT_JOINING" });
                            } else {
                              setAgendaModalSessionId(s.id);
                            }
                          }}
                        />
                        <div className="schedule-row-actions">
                          {qaEnabled ? (
                            <button
                              className="row-action-btn"
                              type="button"
                              title="Session Q&A"
                              aria-label="Session Q&A"
                              onClick={() => onGoToSession(s.id)}
                            >
                              Q&amp;A
                            </button>
                          ) : null}
                          {likesEnabled && onToggleLike ? (
                            <button
                              className={`row-action-btn${liked ? " is-active" : ""}`}
                              type="button"
                              aria-pressed={liked}
                              aria-label={liked ? "Unlike session" : "Like session"}
                              onClick={() => onToggleLike(s.id)}
                            >
                              Like{likeCount > 0 ? ` · ${likeCount}` : ""}
                            </button>
                          ) : null}
                          {onToggleBookmark ? (
                            <button
                              className={`row-action-btn${starred ? " is-active" : ""}`}
                              type="button"
                              title={starred ? "Remove star (session starting soon alerts)" : "Star for reminders"}
                              aria-label={starred ? "Unstar session" : "Star session"}
                              aria-pressed={starred}
                              onClick={() => onToggleBookmark(s.id)}
                            >
                              {starred ? "Starred" : "Star"}
                            </button>
                          ) : null}
                          {isAdmin && (
                            <button
                              className="row-action-btn"
                              type="button"
                              onClick={() => onEditSession(s)}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
                </div>
              </div>
            </div>
          ))}
        </section>
        );
      })}
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
                onClick={async () => {
                  const id = agendaModalSessionId;
                  if (id) await joinSessionAndOpenCalendar(id, "IN_PERSON");
                }}
              >
                In person
              </button>
              {agendaModalAllowsVirtual && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={async () => {
                    const id = agendaModalSessionId;
                    if (id) await joinSessionAndOpenCalendar(id, "VIRTUAL");
                  }}
                >
                  Virtually
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                onClick={async () => {
                  const id = agendaModalSessionId;
                  if (id) await joinSessionAndOpenCalendar(id, "ASYNC");
                }}
              >
                Asynchronous- Time Zone Issues!
              </button>
              <button type="button" className="button secondary" onClick={() => setAgendaModalSessionId(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {calendarModalSession && (
        <div
          className="agenda-add-modal-overlay"
          role="presentation"
          onClick={() => setCalendarModalSessionId(null)}
        >
          <div
            className="agenda-add-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="calendar-modal-title">Add to your personal calendar</h4>
            <p className="help-text" style={{ marginTop: 0 }}>
              Your session is on your {brand.productName} agenda. Choose your personal calendar:
            </p>
            <div className="agenda-add-modal-actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  openGoogleCalendar(calendarModalSession, eventName);
                  setCalendarModalSessionId(null);
                }}
              >
                Google Calendar
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  openOutlookCalendar(calendarModalSession, eventName);
                  setCalendarModalSessionId(null);
                }}
              >
                Outlook / Teams
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  downloadSessionIcs(calendarModalSession, eventName, eventTimezone);
                  setCalendarModalSessionId(null);
                }}
              >
                Apple / Other (.ics)
              </button>
              <button type="button" className="button secondary" onClick={() => setCalendarModalSessionId(null)}>
                Done
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
                            const tag =
                              attendance.joinMode === "VIRTUAL"
                                ? " (virtual)"
                                : attendance.joinMode === "ASYNC"
                                  ? " (async)"
                                  : "";
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
    <div className="console-panel admin-invite-card">
      <p className="console-panel-label">Invite one person</p>
      {!canInvite ? (
        <p className="help-text" style={{ marginTop: 0, color: "var(--danger)", fontWeight: 600 }}>
          No active event is selected. Choose an event above, then return here to send invites.
        </p>
      ) : null}
      <p className="help-text" style={{ marginTop: 0 }}>
        Add name, email, photo, and description. We create their account and email a setup link. If email delivery
        isn&apos;t set up, copy the invite link from the success message instead.
      </p>
      {activeEventId ? (
        <div className="help-text" style={{ margin: "0 0 12px", display: "grid", gap: 6, maxWidth: 560 }}>
          <span>
            <strong>Permanent join link</strong> (share in programs; does not change):{" "}
            <strong>
              {typeof window !== "undefined" ? `${window.location.origin}/e/${activeEventId}` : `/e/${activeEventId}`}
            </strong>
          </span>
          {eventSlug ? (
            <span>
              Optional readable link (may change if you edit the event slug):{" "}
              <strong>
                {typeof window !== "undefined" ? `${window.location.origin}/e/${eventSlug}` : `/e/${eventSlug}`}
              </strong>
            </span>
          ) : null}
        </div>
      ) : null}
      <form
        className="console-form"
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
        <label>
          Email
          <input className="input" name="inviteEmail" type="email" required disabled={!canInvite || inviteBusy} />
        </label>
        <label>
          Display name
          <input className="input" name="inviteName" required disabled={!canInvite || inviteBusy} />
        </label>
        <label>
          Description / research interests
          <textarea
            className="textarea"
            name="inviteBio"
            placeholder="Optional"
            rows={3}
            disabled={!canInvite || inviteBusy}
          />
        </label>
        <label>
          Photo URL
          <input className="input" name="invitePhotoUrl" placeholder="Optional — or upload below" disabled={!canInvite || inviteBusy} />
        </label>
        <label>
          Upload photo
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
        </label>
        <button className="button" type="submit" disabled={!canInvite || inviteBusy} style={{ justifySelf: "start" }}>
          {inviteBusy ? "Sending…" : "Create profile & send invite"}
        </button>
        {inviteMessage && <p className="help-text" style={{ color: "var(--success)", margin: 0 }}>{inviteMessage}</p>}
        {inviteError && <p className="help-text" style={{ color: "var(--danger)", margin: 0 }}>{inviteError}</p>}
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
    <div className="console-panel admin-bulk-invite-card">
      <p className="console-panel-label">Bulk invite from spreadsheet</p>
      <p className="help-text" style={{ marginTop: 0 }}>
        Upload a <strong>CSV</strong> file (export from Excel or Google Sheets). Each row becomes one invite email with the same
        setup flow as above. Duplicate emails in the file are only sent once.
      </p>
      <div className="console-form">
        <div>
          <button type="button" className="button secondary" onClick={downloadExampleCsv}>
            Download example CSV
          </button>
        </div>
        <label>
          CSV file
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
        </label>
        {bulkParseError ? (
          <p className="help-text" style={{ color: "var(--danger)", margin: 0 }}>
            {bulkParseError}
          </p>
        ) : null}
        {bulkRows ? (
          <p className="help-text" style={{ margin: 0 }}>
            Ready to invite <strong>{bulkRows.length}</strong> people (after removing duplicate emails).
          </p>
        ) : null}
        <button
          type="button"
          className="button"
          style={{ justifySelf: "start" }}
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
        {bulkResult ? <p className="help-text" style={{ margin: 0 }}>{bulkResult}</p> : null}
      </div>
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
  onAdminRequestSent,
}: {
  token: string;
  user: User;
  adminEvents: EventItem[];
  activeEventId: string | null;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onSaved: (user: User) => void;
  onEventSelected: (eventId: string) => void;
  onEventCreated: (event: EventItem) => void;
  onAdminRequestSent?: () => void | Promise<void>;
}) {
  const isOrganizer = Boolean(user.isEventAdmin || user.role === "ADMIN");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [adminRequestBusy, setAdminRequestBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(user.photoUrl || null);
  const [name, setName] = useState(user.name);
  const [researchInterests, setResearchInterests] = useState(user.researchInterests || "");
  const [title, setTitle] = useState(user.title || "");
  const [affiliation, setAffiliation] = useState(user.affiliation || "");
  const [bio, setBio] = useState(user.bio || "");
  const [directoryOptIn, setDirectoryOptIn] = useState(false);
  const [matchMeEnabled, setMatchMeEnabled] = useState(true);
  const [participantType, setParticipantType] = useState<
    "GRAD_STUDENT" | "EDD_STUDENT" | "PHD_STUDENT" | "EDL_ALUMNI" | "PROFESSOR" | ""
  >(
    user.participantType || "",
  );
  const [resettingEngagement, setResettingEngagement] = useState(false);
  const [appearanceTheme, setAppearanceTheme] = useState<"blue" | "slate">("blue");
  const [checkInCode, setCheckInCode] = useState<{
    qrPayload: string;
    checkedIn: boolean;
    checkedInAt: string | null;
  } | null>(null);

  useEffect(() => {
    setPhotoPreview(user.photoUrl || null);
    setName(user.name);
    setResearchInterests(user.researchInterests || "");
    setTitle(user.title || "");
    setAffiliation(user.affiliation || "");
    setBio(user.bio || "");
    setParticipantType(user.participantType || "");
  }, [user]);

  useEffect(() => {
    if (!token || !activeEventId) return;
    apiFetch<{ directoryOptIn: boolean; matchMeEnabled?: boolean }>("/attendees/me", withEventHeaders(), token)
      .then((r) => {
        setDirectoryOptIn(r.directoryOptIn);
        setMatchMeEnabled(r.matchMeEnabled !== false);
      })
      .catch(() => {
        setDirectoryOptIn(false);
        setMatchMeEnabled(true);
      });
    apiFetch<{ qrPayload: string; checkedIn: boolean; checkedInAt: string | null }>(
      "/checkins/me/code",
      withEventHeaders(),
      token,
    )
      .then((r) => setCheckInCode({ qrPayload: r.qrPayload, checkedIn: r.checkedIn, checkedInAt: r.checkedInAt }))
      .catch(() => setCheckInCode(null));
  }, [token, activeEventId, withEventHeaders]);

  useEffect(() => {
    try {
      const t = readClientStorage(window.localStorage, "theme");
      if (t === "slate" || t === "blue") setAppearanceTheme(t);
    } catch {
      /* ignore */
    }
  }, []);

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
      title: title.trim() || null,
      affiliation: affiliation.trim() || null,
      bio: bio.trim() || null,
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
      if (activeEventId) {
        await apiFetch("/attendees/me/directory", withEventHeaders({
          method: "PUT",
          body: JSON.stringify({ directoryOptIn }),
        }), token);
        try {
          await apiFetch("/attendees/me/match-me", withEventHeaders({
            method: "PUT",
            body: JSON.stringify({ matchMeEnabled }),
          }), token);
        } catch {
          /* ignore */
        }
      }
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
      startDate: zonedDateTimeLocalToIso(
        String(form.get("startDate") || ""),
        String(form.get("timezone") || "UTC"),
      ),
      endDate: zonedDateTimeLocalToIso(
        String(form.get("endDate") || ""),
        String(form.get("timezone") || "UTC"),
      ),
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
      <p className="help-text" style={{ marginTop: 0 }}>
        <a href="/account">Account &amp; data export</a>
      </p>
      {checkInCode ? (
        <div
          style={{
            display: "grid",
            gap: 8,
            justifyItems: "start",
            paddingBottom: 12,
            borderBottom: "1px solid var(--border)",
            marginBottom: 4,
          }}
        >
          <strong>Event check-in QR</strong>
          <p className="help-text" style={{ margin: 0 }}>
            Show this at registration. Staff scanners read your membership check-in code
            {checkInCode.checkedIn
              ? ` · already checked in${checkInCode.checkedInAt ? ` ${new Date(checkInCode.checkedInAt).toLocaleString()}` : ""}`
              : ""}
            .
          </p>
          {/* Same pattern as event slug QR — payload is membership.checkInCode */}
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(checkInCode.qrPayload)}`}
            alt="Your check-in QR code"
            width={180}
            height={180}
          />
          <code className="help-text" style={{ wordBreak: "break-all" }}>
            {checkInCode.qrPayload}
          </code>
        </div>
      ) : null}
      {photoPreview && <img src={photoPreview} alt={user.name} className="avatar avatar-large" />}
      <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
        Profile photo
        <span style={{ color: "var(--ink-muted)", fontWeight: 400 }}>
          Choose an image file: JPG, PNG, WebP, or GIF (your browser&apos;s file picker may show &quot;Choose file&quot;
          or &quot;Browse&quot;).
        </span>
        <input
          className="input"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
          aria-label="Profile photo: JPG, PNG, WebP, or GIF"
          onChange={handleFileChange}
        />
      </label>
      <input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
      <input
        className="input"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (e.g. PhD Candidate)"
      />
      <input
        className="input"
        name="affiliation"
        value={affiliation}
        onChange={(e) => setAffiliation(e.target.value)}
        placeholder="Affiliation / organization"
      />
      <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
        Participant type
        <select
          className="select"
          name="participantType"
          value={participantType}
          onChange={(e) => setParticipantType(e.target.value as typeof participantType)}
        >
          <option value="">Choose one (optional)</option>
          <option value="GRAD_STUDENT">Grad Student</option>
          <option value="EDD_STUDENT">EdD Student</option>
          <option value="PHD_STUDENT">PhD Student</option>
          <option value="EDL_ALUMNI">EDL Alumni</option>
          <option value="PROFESSOR">Professor</option>
        </select>
      </label>
      <textarea
        className="textarea"
        name="bio"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        placeholder="Short bio"
        rows={3}
      />
      <textarea
        className="textarea"
        name="researchInterests"
        value={researchInterests}
        onChange={(e) => setResearchInterests(e.target.value)}
        placeholder="Research interests, projects, and topics you care about"
        rows={4}
      />
      {activeEventId ? (
        <>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={directoryOptIn}
              onChange={(e) => setDirectoryOptIn(e.target.checked)}
            />
            Show me in this event&apos;s attendee directory (opt-in; required for DMs)
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={matchMeEnabled}
              disabled={!directoryOptIn}
              onChange={(e) => setMatchMeEnabled(e.target.checked)}
            />
            Match me — suggest people with shared interests (one-tap mute when off)
          </label>
        </>
      ) : null}
      {saveError && <p className="help-text" style={{ color: "#b42318", margin: 0 }}>{saveError}</p>}
      {saveSuccess && <p className="help-text" style={{ color: "#0f7b3d", margin: 0 }}>{saveSuccess}</p>}
      <button className="button" type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save Profile"}
      </button>
      {user.role !== "ADMIN" && (
        <div className="card profile-admin-request-card" style={{ marginTop: 12, padding: 16 }}>
          <h4 style={{ marginTop: 0 }}>Administrator access</h4>
          <p className="help-text" style={{ marginTop: 0 }}>
            If you need to help manage this event (invites, agenda, settings), you can notify all current administrators.
            They will see a message under <strong>Notifications</strong> and can promote you from{" "}
            <strong>Participants and Invites</strong> if they agree.
          </p>
          {!activeEventId ? (
            <p className="help-text" style={{ marginTop: 8, color: "#b42318" }}>
              The app needs to know which event you&apos;re part of. Open your event join link once (from your invite
              email), or ask an organizer — then return here and try again.
            </p>
          ) : (
            <button
              type="button"
              className="button secondary"
              style={{ marginTop: 10 }}
              disabled={adminRequestBusy}
              onClick={async () => {
                setAdminRequestBusy(true);
                setSaveError(null);
                setSaveSuccess(null);
                try {
                  await apiFetch("/attendees/admin-access-request", withEventHeaders({ method: "POST" }), token);
                  setSaveSuccess("Request sent. Organizers have been notified.");
                  await onAdminRequestSent?.();
                } catch (e) {
                  setSaveError(e instanceof Error ? e.message : "Could not send request.");
                } finally {
                  setAdminRequestBusy(false);
                }
              }}
            >
              {adminRequestBusy ? "Sending…" : "Request administrator access"}
            </button>
          )}
        </div>
      )}
      {isOrganizer && (
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
      {isOrganizer && (
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <h4 style={{ marginTop: 0 }}>Appearance</h4>
          <p className="help-text" style={{ marginTop: 0 }}>
            Color theme for this browser (stored only on your device). Everyone chooses their own look.
          </p>
          <div className="profile-choice-group" style={{ marginTop: 10 }}>
            <button
              type="button"
              className={appearanceTheme === "blue" ? "button" : "button secondary"}
              onClick={() => {
                setAppearanceTheme("blue");
                try {
                  writeClientStorage(window.localStorage, "theme", "blue");
                  document.documentElement.setAttribute("data-theme", "blue");
                } catch {
                  /* ignore */
                }
              }}
            >
              Blue (default)
            </button>
            <button
              type="button"
              className={appearanceTheme === "slate" ? "button" : "button secondary"}
              onClick={() => {
                setAppearanceTheme("slate");
                try {
                  writeClientStorage(window.localStorage, "theme", "slate");
                  document.documentElement.setAttribute("data-theme", "slate");
                } catch {
                  /* ignore */
                }
              }}
            >
              Slate
            </button>
          </div>
        </div>
      )}
      {isOrganizer && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ marginTop: 0 }}>My Events</h4>
          <p className="help-text" style={{ marginTop: 0 }}>
            Prefer the new{" "}
            <a href="/organizer">
              organizer workspace
            </a>{" "}
            for drafts, publishing, tracks/rooms/speakers, papers, and CSV dry-run invites.
          </p>
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
          <form className="console-form" onSubmit={createEvent}>
            <label>
              Event name
              <input className="input" name="eventName" required />
            </label>
            <label>
              Header logo URL
              <input className="input" name="eventLogoUrl" placeholder="Optional" />
            </label>
            <label>
              Upload logo
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
            </label>
            <label>
              Banner URL
              <input className="input" name="eventBannerUrl" placeholder="Optional" />
            </label>
            <label>
              Upload banner
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
            </label>
            <label>
              Event timezone
              <select className="select" name="timezone" defaultValue="America/New_York" required>
                {EVENT_TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>{timezoneOptionLabel(tz)}</option>
                ))}
              </select>
            </label>
            <label>
              Start
              <input className="input" type="datetime-local" name="startDate" required />
            </label>
            <label>
              End
              <input className="input" type="datetime-local" name="endDate" required />
            </label>
            <button className="button" type="submit" style={{ justifySelf: "start" }}>Create event</button>
          </form>
        </div>
      )}
    </form>
  );
}

function SessionForm({
  token,
  eventTimezone,
  eventHeaders,
  attendees,
  editing,
  onSaved,
  onCancel,
}: {
  token: string;
  eventTimezone: string;
  eventHeaders: (extra?: RequestInit) => RequestInit;
  attendees: User[];
  editing: Session | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageUrl, setImageUrl] = useState(editing?.imageUrl || "");
  const [recordingUrl, setRecordingUrl] = useState(editing?.recordingUrl || "");
  const [fileUrl, setFileUrl] = useState(editing?.fileUrl || "");
  const [waitlist, setWaitlist] = useState(editing?.waitlistEntries || []);

  useEffect(() => {
    setWaitlist(editing?.waitlistEntries || []);
  }, [editing?.id, editing?.waitlistEntries]);

  async function refreshWaitlist() {
    if (!editing) return;
    try {
      const res = await apiFetch<{ entries: NonNullable<Session["waitlistEntries"]> }>(
        `/sessions/${editing.id}/waitlist`,
        eventHeaders(),
        token,
      );
      setWaitlist(res.entries as NonNullable<Session["waitlistEntries"]>);
    } catch {
      /* ignore */
    }
  }

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
        imageUrl: imageUrl || String(form.get("imageUrl") || ""),
        zoomLink: String(form.get("zoomLink") || ""),
        recordingUrl: recordingUrl || String(form.get("recordingUrl") || ""),
        fileLink: String(form.get("fileLink") || ""),
        fileUrl: fileUrl || String(form.get("fileUrl") || ""),
        allowVirtualJoin: form.get("allowVirtualJoin") === "on",
        inPersonCapacity: (() => {
          const raw = String(form.get("inPersonCapacity") || "").trim();
          if (!raw) return null;
          const n = Number(raw);
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        virtualCapacity: (() => {
          const raw = String(form.get("virtualCapacity") || "").trim();
          if (!raw) return null;
          const n = Number(raw);
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        startsAt: zonedDateTimeLocalToIso(String(form.get("startsAt") || ""), eventTimezone),
        endsAt: zonedDateTimeLocalToIso(String(form.get("endsAt") || ""), eventTimezone),
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

  const defaultStart = editing?.startsAt ? toLocalInputValueInTimeZone(editing.startsAt, eventTimezone) : "";
  const defaultEnd = editing?.endsAt ? toLocalInputValueInTimeZone(editing.endsAt, eventTimezone) : "";

  return (
    <>
      <form className="grid" onSubmit={handleSubmit}>
        <h3 className="panel-heading">{editing ? "Edit session" : "New session"}</h3>

        <section className="session-form-section">
          <h4>Basics</h4>
          <input className="input" name="title" placeholder="Session title" required defaultValue={editing?.title || ""} />
          <textarea className="textarea" name="description" placeholder="Description" defaultValue={editing?.description || ""} />
          <input className="input" name="location" placeholder="Location / room" defaultValue={editing?.location || ""} />
        </section>

        <section className="session-form-section">
          <h4>Schedule</h4>
          <DateTimePicker name="startsAt" label="Starts" required defaultValue={defaultStart} />
          <DateTimePicker name="endsAt" label="Ends" required defaultValue={defaultEnd} />
          <label className="help-text" style={{ margin: 0, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              name="allowVirtualJoin"
              value="on"
              defaultChecked={editing?.allowVirtualJoin !== false}
              style={{ marginTop: 3 }}
            />
            <span>Allow participants to join virtually</span>
          </label>
          <label>
            In-person capacity
            <input
              className="input"
              name="inPersonCapacity"
              type="number"
              min={1}
              placeholder="Unlimited"
              defaultValue={editing?.inPersonCapacity ?? ""}
            />
          </label>
          <label>
            Virtual capacity
            <input
              className="input"
              name="virtualCapacity"
              type="number"
              min={1}
              placeholder="Unlimited"
              defaultValue={editing?.virtualCapacity ?? ""}
            />
          </label>
          <p className="text-meta" style={{ margin: 0 }}>
            Leave blank for unlimited. When full, attendees can join a waitlist for that mode.
          </p>
        </section>

        <section className="session-form-section">
          <h4>Speakers</h4>
          <input
            className="input"
            name="speakers"
            placeholder="Free-text speaker names"
            defaultValue={editing?.speakers || ""}
          />
          <select className="select" name="speakerId" defaultValue={editing?.speakerId || ""}>
            <option value="">No linked directory speaker</option>
            {attendees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.role})
              </option>
            ))}
          </select>
        </section>

        <section className="session-form-section">
          <h4>Media</h4>
          <input
            className="input"
            name="imageUrl"
            placeholder="Image URL"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
          />
          <UploadDropzone
            label="Session image"
            accept="image/*"
            onFile={async (file) => setImageUrl(await fileToDataUrl(file))}
          />
        </section>

        <section className="session-form-section">
          <h4>Links</h4>
          <input
            className="input"
            name="zoomLink"
            placeholder="Online meeting link"
            defaultValue={editing?.zoomLink || ""}
          />
          <input
            className="input"
            name="recordingUrl"
            placeholder="Recording URL"
            value={recordingUrl}
            onChange={(e) => setRecordingUrl(e.target.value)}
          />
          <UploadDropzone
            label="Recording file"
            accept="audio/*,video/*"
            onFile={async (file) => setRecordingUrl(await fileToDataUrl(file))}
          />
          <input className="input" name="fileLink" placeholder="Presentation or resource link" defaultValue={editing?.fileLink || ""} />
          <textarea
            className="textarea"
            name="fileUrl"
            placeholder="Materials (filled by upload)"
            value={fileUrl}
            onChange={(e) => setFileUrl(e.target.value)}
            rows={2}
          />
          <UploadDropzone
            label="Materials upload"
            accept="audio/*,video/*,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,image/*"
            onFile={async (file) => setFileUrl(await fileToDataUrl(file))}
          />
        </section>

        {editing ? (
          <section className="session-form-section">
            <h4>Roster & waitlist</h4>
            <p className="help-text" style={{ marginTop: 0 }}>
              In-person:{" "}
              {(editing.attendances || []).filter((a) => a.status === "JOINING" && a.joinMode === "IN_PERSON").length}
              {editing.inPersonCapacity != null ? ` / ${editing.inPersonCapacity}` : " (unlimited)"}
              {" · "}
              Virtual:{" "}
              {(editing.attendances || []).filter((a) => a.status === "JOINING" && a.joinMode === "VIRTUAL").length}
              {editing.virtualCapacity != null ? ` / ${editing.virtualCapacity}` : " (unlimited)"}
            </p>
            {waitlist.length === 0 ? (
              <p className="text-meta">No one on the waitlist.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                {waitlist.map((w) => (
                  <li
                    key={w.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      justifyContent: "space-between",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      padding: "8px 10px",
                    }}
                  >
                    <span>
                      #{w.position} {w.user.name} · {w.mode === "VIRTUAL" ? "virtual" : "in person"}
                      {w.promotedAt ? " · seat offered" : ""}
                    </span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => {
                          void (async () => {
                            await apiFetch(
                              `/sessions/${editing.id}/waitlist/${w.id}/promote`,
                              eventHeaders({ method: "POST", body: "{}" }),
                              token,
                            );
                            await refreshWaitlist();
                          })().catch((err) =>
                            window.alert(err instanceof Error ? err.message : "Promote failed"),
                          );
                        }}
                      >
                        Promote
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => {
                          void (async () => {
                            await apiFetch(
                              `/sessions/${editing.id}/waitlist/${w.id}`,
                              eventHeaders({ method: "DELETE" }),
                              token,
                            );
                            await refreshWaitlist();
                          })().catch((err) =>
                            window.alert(err instanceof Error ? err.message : "Remove failed"),
                          );
                        }}
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="button" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : editing ? "Save changes" : "Create session"}
          </button>
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          {editing ? (
            <button className="button button-danger" type="button" onClick={() => setConfirmDelete(true)}>
              Delete session
            </button>
          ) : null}
        </div>
      </form>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this session?"
        body="This removes the session from the agenda. Attendance and discussion for it will be cleared. This cannot be undone."
        confirmLabel="Delete session"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (!editing) return;
          try {
            await apiFetch(`/sessions/${editing.id}`, eventHeaders({ method: "DELETE" }), token);
            setConfirmDelete(false);
            onSaved();
          } catch (err) {
            window.alert(err instanceof Error ? err.message : "Could not delete session.");
          }
        }}
      />
    </>
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

function lastNameOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : name;
}

function splitInterestTokens(raw: string) {
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function notificationKindIcon(kind: UserNotificationRow["kind"] | string) {
  switch (kind) {
    case "MESSAGE":
      return "✉";
    case "COMMUNITY_THREAD":
    case "COMMUNITY_REPLY":
      return "💬";
    case "ANNOUNCEMENT":
      return "📣";
    case "MEETING_REQUEST":
    case "MEETING_ACCEPTED":
      return "🤝";
    case "SESSION_CHANGED":
    case "SESSION_STARTING_SOON":
      return "📅";
    case "ADMIN_REQUEST":
      return "🔑";
    case "WAITLIST_PROMOTED":
      return "🎫";
    case "USER_REPORT":
      return "🚩";
    case "AGENT_ATTENDEE_TOUCH":
    case "DIGEST_ROLLUP":
      return "✦";
    default:
      return "•";
  }
}

function AttendeeDirectory({
  attendees,
  currentUserId,
  onMessage,
  onRequestMeeting,
  loading = false,
}: {
  attendees: User[];
  currentUserId: string;
  onMessage: (userId: string) => void;
  onRequestMeeting?: (user: User) => void;
  loading?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [interestFilter, setInterestFilter] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const interestLower = interestFilter?.trim().toLowerCase() || "";

  const filtered = useMemo(() => {
    const list = [...attendees].sort((a, b) => {
      const lastCmp = lastNameOf(a.name).localeCompare(lastNameOf(b.name), undefined, { sensitivity: "base" });
      if (lastCmp !== 0) return lastCmp;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return list.filter((a) => {
      if (interestLower) {
        const interests = splitInterestTokens(a.researchInterests || "").map((t) => t.toLowerCase());
        if (!interests.some((t) => t === interestLower)) return false;
      }
      if (!q) return true;
      const hay = `${a.name} ${a.email} ${a.researchInterests || ""} ${a.title || ""} ${a.affiliation || ""} ${a.bio || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [attendees, q, interestLower]);

  let lastLetter = "";
  const rows = filtered.map((a) => {
    const lastInitial = (lastNameOf(a.name).trim()[0] || "#").toUpperCase();
    const letter = /[A-Z]/.test(lastInitial) ? lastInitial : "#";
    const isNewLetter = letter !== lastLetter;
    if (isNewLetter) lastLetter = letter;
    const expanded = Boolean(expandedIds[a.id]);
    const interests = splitInterestTokens(a.researchInterests || "");
    const clampStyle = expanded
      ? undefined
      : ({
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        } as CSSProperties);
    const hasClampable = Boolean(a.bio?.trim()) || interests.length > 0;
    const actionButtons =
      a.id !== currentUserId ? (
        <>
          <button className="button attendee-msg-btn" type="button" onClick={() => onMessage(a.id)}>
            Message
          </button>
          {onRequestMeeting ? (
            <button className="button secondary attendee-msg-btn" type="button" onClick={() => onRequestMeeting(a)}>
              Meet
            </button>
          ) : null}
        </>
      ) : (
        <span className="help-text attendee-you">You</span>
      );

    return (
      <div
        className={`attendee-row${expanded ? " is-expanded" : ""}`}
        key={a.id}
        id={`attendee-${a.id}`}
      >
        {isNewLetter ? <span id={`attendee-letter-${letter}`} className="attendee-letter-anchor" /> : null}
        <div className="attendee-avatar-wrap">
          <AttendeeAvatar photoUrl={a.photoUrl} name={a.name} />
          <span className={`attendee-role-badge role-${a.role.toLowerCase()}`}>{a.role}</span>
        </div>
        <div className="attendee-body">
          <div className="attendee-identity">
            <div className="attendee-name">{a.name}</div>
            {(a.title || a.affiliation) && (
              <div className="attendee-meta attendee-affiliation">
                {[a.title, a.affiliation].filter(Boolean).join(" · ")}
              </div>
            )}
            <div className="attendee-meta attendee-email-meta">{a.email}</div>
            {a.participantType && (
              <div className="attendee-meta attendee-role-note">
                {participantTypeLabel(a.participantType)}
              </div>
            )}
            {/* Mobile: Message / Meet under the identity block. */}
            <div className="attendee-actions attendee-actions--under">{actionButtons}</div>
          </div>
          {a.bio?.trim() ? (
            <div className={`attendee-meta bio-clamp${expanded ? " is-expanded" : ""}`} style={clampStyle}>
              {a.bio}
            </div>
          ) : null}
          {interests.length > 0 ? (
            <div
              className={`attendee-meta attendee-research bio-clamp${expanded ? " is-expanded" : ""}`}
              style={{
                ...clampStyle,
                display: expanded ? "flex" : clampStyle ? "-webkit-box" : "flex",
                flexWrap: expanded ? "wrap" : undefined,
                gap: 6,
              }}
            >
              {interests.map((interest) => {
                const active = interestLower === interest.toLowerCase();
                return (
                  <button
                    key={`${a.id}-${interest}`}
                    type="button"
                    className={`chip interest-chip${active ? " is-active" : ""}`}
                    onClick={() =>
                      setInterestFilter((prev) => (prev?.toLowerCase() === interest.toLowerCase() ? null : interest))
                    }
                  >
                    {interest}
                  </button>
                );
              })}
            </div>
          ) : null}
          {hasClampable ? (
            <button
              type="button"
              className="button secondary attendee-more-btn"
              onClick={() => setExpandedIds((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
            >
              {expanded ? "Less" : "More"}
            </button>
          ) : null}
        </div>
        {/* ≥768px: actions right-aligned beside the row. */}
        <div className="attendee-actions attendee-actions--side">{actionButtons}</div>
      </div>
    );
  });

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const showSkeleton = loading && attendees.length === 0;
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
        <div className="attendee-browse-chips" role="toolbar" aria-label="Browse by letter">
          <button
            type="button"
            className={`attendee-browse-chip${!interestFilter ? " is-active" : ""}`}
            onClick={() => setInterestFilter(null)}
          >
            All
          </button>
          {letters.map((L) => (
            <button
              key={L}
              type="button"
              className="attendee-browse-chip attendee-index-letter"
              onClick={() =>
                document.getElementById(`attendee-letter-${L}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              {L}
            </button>
          ))}
        </div>
      </div>
      {interestFilter ? (
        <div className="attendee-browse-chips attendee-interest-filter-bar">
          <span className="help-text">Interest</span>
          <button type="button" className="attendee-browse-chip is-active" onClick={() => setInterestFilter(null)}>
            {interestFilter} · Clear
          </button>
        </div>
      ) : null}
      <div className="attendee-rows">
        {showSkeleton ? (
          Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton-row list-skeleton-row" style={{ margin: "12px 16px" }} />)
        ) : rows.length > 0 ? (
          rows
        ) : (
          <p className="list-empty text-body-md" style={{ margin: "var(--space-4) 0" }}>
            {q || interestFilter ? (
              <>
                No attendees match{q ? ` '${query.trim()}'` : ""}
                {interestFilter ? ` with interest “${interestFilter}”` : ""}.
              </>
            ) : (
              <>No attendees yet.</>
            )}
          </p>
        )}
      </div>
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
  enabledChannels,
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
  enabledChannels: Record<Exclude<CommunityChannelFilter, "ALL">, boolean>;
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
  const [confirmDeleteThreadId, setConfirmDeleteThreadId] = useState<string | null>(null);
  const [confirmDeleteReply, setConfirmDeleteReply] = useState<null | { threadId: string; replyId: string }>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const nameById = useMemo(() => Object.fromEntries(attendees.map((a) => [a.id, a.name])), [attendees]);

  const composeChannels = useMemo(
    () =>
      (["GENERAL", "MEETUP", "MOMENTS", "LOCAL", "ICEBREAKER"] as const).filter((k) => enabledChannels[k]),
    [enabledChannels],
  );

  useEffect(() => {
    if (channelFilter !== "ALL" && !enabledChannels[channelFilter]) {
      onChannelChange("ALL");
      return;
    }
    if (channelFilter !== "ALL") {
      setComposeChannel(channelFilter);
      return;
    }
    const preferred = composeChannels.includes("GENERAL") ? "GENERAL" : composeChannels[0];
    if (preferred) setComposeChannel(preferred);
  }, [channelFilter, enabledChannels, composeChannels, onChannelChange]);

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

  async function deleteThreadReply(threadId: string, replyId: string) {
    await apiFetch(`/network/threads/${threadId}/replies/${replyId}`, withEventHeaders({ method: "DELETE" }), token);
    await onThreadsUpdated();
  }

  const pills: { key: CommunityChannelFilter; label: string }[] = (
    [
      { key: "ALL", label: "All" },
      { key: "MEETUP", label: "Meet-ups" },
      { key: "MOMENTS", label: "Share your moments" },
      { key: "LOCAL", label: "Local recommendations" },
      { key: "ICEBREAKER", label: "Break the ice" },
      { key: "GENERAL", label: "General" },
    ] as { key: CommunityChannelFilter; label: string }[]
  ).filter((p) => p.key === "ALL" || enabledChannels[p.key]);

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

      <form className="card grid community-compose-card" onSubmit={createThread}>
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
              {composeChannels.includes("GENERAL") ? (
                <option value="GENERAL">General discussion</option>
              ) : null}
              {composeChannels.includes("MEETUP") ? <option value="MEETUP">Meet-up</option> : null}
              {composeChannels.includes("MOMENTS") ? (
                <option value="MOMENTS">Share your moments</option>
              ) : null}
              {composeChannels.includes("LOCAL") ? (
                <option value="LOCAL">Local recommendations</option>
              ) : null}
              {composeChannels.includes("ICEBREAKER") ? (
                <option value="ICEBREAKER">Break the ice</option>
              ) : null}
            </select>
          </label>
        )}
        <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
          Title
          <input className="input" name="title" placeholder="Title" required />
        </label>
        <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
          Message
          <textarea className="textarea" name="body" placeholder="Description or message" required rows={4} />
        </label>
        {composeChannel === "LOCAL" && (
          <>
            <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
              Maps link
              <input
                className="input"
                name="mapsUrl"
                placeholder="Google Maps link (Share → Copy link from the Maps app or website)"
              />
            </label>
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
            <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
              Starts at
              <input className="input" type="datetime-local" name="meetupStartsAt" />
            </label>
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
              <SearchableMultiSelect
                label="Participants (required if not inviting everyone)"
                people={attendees}
                selectedIds={meetupParticipantIds}
                excludeIds={[currentUserId]}
                placeholder="Search participants…"
                onChange={setMeetupParticipantIds}
              />
            )}
          </>
        )}
        {composeChannel === "MOMENTS" && (
          <>
            <SearchableMultiSelect
              label="Tag people (optional)"
              people={attendees}
              selectedIds={taggedUserIds}
              excludeIds={[currentUserId]}
              placeholder="Search people to tag…"
              onChange={setTaggedUserIds}
            />
            <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
              Image URL
              <input className="input" name="imageUrl" placeholder="Image URL (optional, in addition to uploads)" />
            </label>
            <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
              Upload photos
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
            </label>
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
            const lastReply = t.replies?.[t.replies.length - 1];
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
                        ? `Last reply ${formatRelativeTime(lastReply.createdAt)}`
                        : `Started ${formatRelativeTime(t.createdAt)}`}
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
                        {t.meetupStartsAt ? ` · ${formatEventDateTime(t.meetupStartsAt)}` : ""}
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
                        {t.meetupStartsAt ? ` · ${formatEventDateTime(t.meetupStartsAt)}` : ""}
                      </div>
                    )}
                    <div className="community-thread-foot">{t.replies?.length ?? 0} replies</div>
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
                    {editingThreadId === t.id ? (
                      <form
                        className="grid"
                        style={{ gap: 8, marginBottom: 12 }}
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await apiFetch(
                            `/network/threads/${t.id}`,
                            withEventHeaders({
                              method: "PATCH",
                              body: JSON.stringify({ title: editTitle, body: editBody }),
                            }),
                            token,
                          );
                          setEditingThreadId(null);
                          await onThreadsUpdated();
                        }}
                      >
                        <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
                        <textarea className="textarea" rows={4} value={editBody} onChange={(e) => setEditBody(e.target.value)} required />
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="button" type="submit">
                            Save post
                          </button>
                          <button className="button secondary" type="button" onClick={() => setEditingThreadId(null)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <p style={{ whiteSpace: "pre-wrap" }}>{t.body}</p>
                    )}
                    {ch === "MEETUP" && t.meetupMode === "VIRTUAL" && t.meetupMeetingUrl ? (
                      <p style={{ margin: "12px 0" }}>
                        <OnlineMeetingLink href={ensureHttpUrl(t.meetupMeetingUrl)} />
                      </p>
                    ) : null}
                    {isAdmin && (
                      <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => {
                            setEditingThreadId(t.id);
                            setEditTitle(t.title);
                            setEditBody(t.body);
                          }}
                        >
                          Edit post
                        </button>
                        <button
                          className="button button-danger"
                          type="button"
                          onClick={() => setConfirmDeleteThreadId(t.id)}
                        >
                          Delete thread
                        </button>
                      </div>
                    )}
                    <div className="network-replies">
                      {t.replies?.map((r) => (
                        <div key={r.id} className="network-reply">
                          <strong>{r.author?.name ?? DELETED_PARTICIPANT_LABEL}</strong>
                          <span className="help-text"> · {formatEventDateTime(r.createdAt)}</span>
                          <p>{r.body}</p>
                          {isAdmin && (
                            <button
                              type="button"
                              className="button secondary"
                              onClick={() => setConfirmDeleteReply({ threadId: t.id, replyId: r.id })}
                              style={{ marginTop: 6 }}
                            >
                              Delete reply
                            </button>
                          )}
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
      <ConfirmDialog
        open={Boolean(confirmDeleteThreadId)}
        title="Delete this community post?"
        body="The post and its replies will be removed for everyone. This cannot be undone."
        confirmLabel="Delete post"
        onCancel={() => setConfirmDeleteThreadId(null)}
        onConfirm={async () => {
          if (!confirmDeleteThreadId) return;
          await deleteThread(confirmDeleteThreadId);
          setConfirmDeleteThreadId(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(confirmDeleteReply)}
        title="Delete this reply?"
        body="The reply will be removed for everyone. This cannot be undone."
        confirmLabel="Delete reply"
        onCancel={() => setConfirmDeleteReply(null)}
        onConfirm={async () => {
          if (!confirmDeleteReply) return;
          await deleteThreadReply(confirmDeleteReply.threadId, confirmDeleteReply.replyId);
          setConfirmDeleteReply(null);
        }}
      />
    </div>
    </>
  );
}

function MessageComposer({
  token,
  conversationId,
  withEventHeaders,
  onSent,
  initialBody,
  onInitialBodyConsumed,
}: {
  token: string;
  conversationId: string | null;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onSent: (m: Message) => void | Promise<void>;
  initialBody?: string | null;
  onInitialBodyConsumed?: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (initialBody == null) return;
    setBody(initialBody);
    onInitialBodyConsumed?.();
  }, [initialBody, conversationId, onInitialBodyConsumed]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationId || sending) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      const message = await apiFetch<Message>(
        `/conversations/${conversationId}/messages`,
        withEventHeaders({ method: "POST", body: JSON.stringify({ body: trimmed }) }),
        token,
      );
      await onSent(message);
      setBody("");
      event.currentTarget.reset();
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="message-composer-form grid" onSubmit={handleSubmit} style={{ gap: 8 }}>
      <label className="help-text" style={{ margin: 0 }} htmlFor="message-composer-body">
        Your message
        {body.trim() ? (
          <span className="help-text"> · Edit before sending</span>
        ) : null}
      </label>
      <textarea
        id="message-composer-body"
        className="textarea"
        name="body"
        placeholder="Write something…"
        required
        disabled={sending}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button className="button" disabled={!conversationId || sending || !body.trim()}>
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userId = selectedIds[0];
    if (!userId) return;
    const conversation = await apiFetch<Conversation>(
      "/conversations/direct",
      withEventHeaders({ method: "POST", body: JSON.stringify({ userId }) }),
      token,
    );
    onCreated(conversation);
    setSelectedIds([]);
  }

  return (
    <form className="grid" onSubmit={handleSubmit} style={{ gap: 8 }}>
      <h4 style={{ margin: 0 }}>Message someone one-on-one</h4>
      <p className="help-text" style={{ margin: 0 }}>
        Search and pick one participant, then <strong>Start chat</strong>.
      </p>
      <SearchableMultiSelect
        label="Participant"
        people={attendees}
        selectedIds={selectedIds}
        excludeIds={[currentUserId]}
        placeholder="Search people…"
        onChange={(ids) => setSelectedIds(ids.length <= 1 ? ids : [ids[ids.length - 1]!])}
      />
      <button className="button secondary" type="submit" disabled={selectedIds.length !== 1}>
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
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = memberIds.filter((id) => id && id !== currentUserId);
    if (!name.trim() || cleaned.length === 0) return;
    const conversation = await apiFetch<Conversation>(
      "/conversations/group",
      withEventHeaders({ method: "POST", body: JSON.stringify({ name: name.trim(), memberIds: cleaned }) }),
      token,
    );
    onCreated(conversation);
    setName("");
    setMemberIds([]);
  }

  return (
    <form className="grid" onSubmit={handleSubmit} style={{ gap: 8 }}>
      <h4 style={{ margin: 0 }}>Create a group chat</h4>
      <p className="help-text" style={{ margin: 0 }}>
        Name the group and select at least one other person.
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
      <button className="button secondary" type="submit" disabled={!name.trim() || memberIds.length === 0}>
        Create
      </button>
    </form>
  );
}

function inviteStatusLabel(attendee: User) {
  if (attendee.inviteStatus === "PENDING_SETUP") return "Pending — has not finished signup";
  if (attendee.inviteStatus === "INVITE_EXPIRED") return "Invite expired";
  if (attendee.inviteStatus === "ACTIVE") return "Joined";
  return "—";
}

function rosterRoleLabel(role: User["role"]) {
  if (role === "SPEAKER") return "Speaker";
  return "Attendee";
}

function participantTypeLabel(type?: User["participantType"] | "") {
  if (type === "GRAD_STUDENT") return "Grad Student";
  if (type === "EDD_STUDENT") return "EdD Student";
  if (type === "PHD_STUDENT") return "PhD Student";
  if (type === "EDL_ALUMNI") return "EDL Alumni";
  if (type === "PROFESSOR") return "Professor";
  return "";
}

function formatConversationName(conversation: Conversation, currentUser: User) {
  if (conversation.type === "EVENT") return conversation.name || "Everyone — event chat";
  if (conversation.type === "GROUP") return conversation.name || "Group Chat";
  if (conversation.type === "SESSION") return conversation.name || "Session chat";
  const other = conversation.members.find((m) => m.user.id !== currentUser.id);
  return other ? other.user.name : "Direct Chat";
}

function zonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value || "00";
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

function wallMinutes(parts: { year: number; month: number; day: number; hour: number; minute: number }) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) / 60000);
}

function zonedDateTimeLocalToIso(localValue: string, timeZone: string) {
  const [datePart, timePart] = localValue.split("T");
  if (!datePart || !timePart) return new Date(localValue).toISOString();
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const desired = { year, month, day, hour, minute };

  // Start with the wall time as-if it were UTC, then correct to match the requested timezone wall clock.
  let guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const actual = zonedDateParts(new Date(guessUtcMs), timeZone);
    const deltaMinutes = wallMinutes(desired) - wallMinutes(actual);
    if (deltaMinutes === 0) break;
    guessUtcMs += deltaMinutes * 60_000;
  }
  return new Date(guessUtcMs).toISOString();
}

function toLocalInputValueInTimeZone(dateString: string, timeZone: string) {
  const parts = zonedDateParts(new Date(dateString), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function formatEventRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${endDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function timeZoneAbbrev(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(date);
  return parts.find((part) => part.type === "timeZoneName")?.value || timeZone;
}

function zonedDayKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value || "0000";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function formatTimeRange(start: string, end: string, timeZone = "UTC") {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })} - ${endDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })} ${timeZoneAbbrev(startDate, timeZone)}`;
}

/** Row meta time: short range without TZ (the rail shows the TZ). */
function formatRowTimeRange(start: string, end: string, timeZone = "UTC") {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  return `${fmt(start)}–${fmt(end)}`;
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

function openOutlookCalendar(session: Session, eventName: string) {
  const title = `${session.title} (${eventName})`;
  const details = [session.description, session.zoomLink ? `Meeting: ${session.zoomLink}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const url = new URL("https://outlook.office.com/calendar/0/deeplink/compose");
  url.searchParams.set("path", "/calendar/action/compose");
  url.searchParams.set("rru", "addevent");
  url.searchParams.set("subject", title);
  url.searchParams.set("startdt", new Date(session.startsAt).toISOString());
  url.searchParams.set("enddt", new Date(session.endsAt).toISOString());
  if (session.location) url.searchParams.set("location", session.location);
  if (details) url.searchParams.set("body", details);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

function escapeIcsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function downloadSessionIcs(session: Session, eventName: string, eventTimezone: string) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${icsProductId('Conference Session')}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${session.id}@${brand.domain}`,
    `DTSTAMP:${toGoogleCalendarUtc(new Date().toISOString())}`,
    `DTSTART:${toGoogleCalendarUtc(session.startsAt)}`,
    `DTEND:${toGoogleCalendarUtc(session.endsAt)}`,
    `SUMMARY:${escapeIcsText(`${session.title} (${eventName})`)}`,
    `DESCRIPTION:${escapeIcsText([session.description, session.zoomLink ? `Meeting: ${session.zoomLink}` : "", `Event timezone: ${eventTimezone}`].filter(Boolean).join("\n\n"))}`,
    session.location ? `LOCATION:${escapeIcsText(session.location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${session.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "session"}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function groupSessionsByDayAndTime(sessions: Session[], timeZone = "UTC") {
  const groupedByDay = new Map<string, Session[]>();
  for (const session of sessions) {
    const dayKey = zonedDayKey(new Date(session.startsAt), timeZone);
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
      timeZone,
    });

    const timeMap = new Map<string, Session[]>();
    for (const session of daySessions) {
      const timeKey = new Date(session.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone });
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
