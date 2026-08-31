import { cfpDisplayLabel } from "@event-app/shared";
import { useRouter } from "next/router";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode, type SVGProps } from "react";
import { apiFetch, type AuthResponse } from "../lib/api";
import { eventAccentStyle } from "../lib/eventAccent";
import { AppShell, type ShellEventOption, type ShellNavGroup } from "./AppShell";
import { OrganizerAssistantDock } from "./OrganizerAssistantDock";

type OrganizerEventContextValue = {
  eventId: string | null;
  eventName: string | null;
  cfpLabel: string | null;
};

const OrganizerEventContext = createContext<OrganizerEventContextValue>({
  eventId: null,
  eventName: null,
  cfpLabel: null,
});

/** Event id/name already loaded by the shell — subpage headers must not refetch. */
export function useOrganizerEvent(): OrganizerEventContextValue {
  return useContext(OrganizerEventContext);
}

/**
 * Shell wrapper for organizer console pages (pages/organizer/**).
 * Link-based nav; anyone reaching these pages is an organizer (API-gated),
 * so the Organize group always shows here.
 */

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Icon(props: SVGProps<SVGSVGElement>) {
  return <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden {...stroke} {...props} />;
}

const icons = {
  overview: (
    <Icon>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Icon>
  ),
  events: (
    <Icon>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Icon>
  ),
  ingest: (
    <Icon>
      <path d="M12 3v12M8 11l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  ),
  cfp: (
    <Icon>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </Icon>
  ),
  sponsors: (
    <Icon>
      <path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </Icon>
  ),
  analytics: (
    <Icon>
      <path d="M3 21h18M7 16v-4M12 16V8M17 16v-7" />
    </Icon>
  ),
  scanner: (
    <Icon>
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
    </Icon>
  ),
  billing: (
    <Icon>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </Icon>
  ),
  ai: (
    <Icon>
      <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z" />
      <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
    </Icon>
  ),
  app: (
    <Icon>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </Icon>
  ),
  org: (
    <Icon>
      <path d="M3 21h18M5 21V7l7-4 7 4v14" />
      <path d="M10 21v-6h4v6" />
    </Icon>
  ),
};

type MineEvent = {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  uiStatus?: string;
  brandColor?: string | null;
  cfpLabel?: string | null;
  organizationId?: string;
};

const NAV_BLURB = {
  overview:
    "Home for this event — publish state, setup checklist, and counts of sessions, speakers, and people. Settings and publish live here.",
  ingest:
    "Turn a program document or spreadsheet into a draft schedule you review before it goes live.",
  cfp: "Open a public call, collect submissions, assign reviewers, and convert accepted work into draft sessions.",
  sponsors: "Manage sponsor logos by tier and optional exhibitor lead capture. Logos show on attendee pages.",
  analytics: "Attendance and engagement numbers for this event.",
  scanner:
    "Scan attendee QR codes at the door. Works offline and syncs when you’re back online. Each person’s code is on their profile in the attendee app.",
  events: "Every event you organize — switch, open, or start another.",
  newEvent: "Start a draft event with the setup wizard.",
  allEvents: "Leave this event and see every event you organize.",
  orgSettings:
    "Your organization's name, website, support email, and the logo events borrow when they have none of their own.",
  billing: "Plan, invoices, and upgrades for this organization.",
  aiUsage: "How many AI ingest and assistant runs this organization has used.",
  attendeeApp: "See the event the way a participant does — agenda, messages, and community.",
  settings: "Your account, email, and notification defaults.",
} as const;

type OrganizerShellProps = {
  /** Active nav item id (see item ids below). */
  active?: string;
  /** When present, the shell shows the event-level Organize group. */
  eventId?: string | null;
  eventName?: string | null;
  userName?: string | null;
  userPhotoUrl?: string | null;
  children: ReactNode;
};

export function OrganizerShell({ active, eventId, eventName, userName, userPhotoUrl, children }: OrganizerShellProps) {
  const router = useRouter();
  const isActive = (id: string) => active === id;
  const [events, setEvents] = useState<ShellEventOption[]>([]);
  const [brandColors, setBrandColors] = useState<Record<string, string | null>>({});
  const [cfpLabels, setCfpLabels] = useState<Record<string, string | null>>({});
  const [orgIds, setOrgIds] = useState<Record<string, string>>({});
  const [me, setMe] = useState<Pick<AuthResponse["user"], "name" | "photoUrl"> | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      const mine = await apiFetch<MineEvent[]>("/event/mine");
      setEvents(
        mine.map((ev) => ({
          id: ev.id,
          name: ev.name,
          meta: ev.uiStatus || null,
        })),
      );
      setBrandColors(Object.fromEntries(mine.map((ev) => [ev.id, ev.brandColor ?? null])));
      setCfpLabels(Object.fromEntries(mine.map((ev) => [ev.id, ev.cfpLabel ?? null])));
      setOrgIds(
        Object.fromEntries(
          mine.filter((ev) => ev.organizationId).map((ev) => [ev.id, ev.organizationId as string]),
        ),
      );
    } catch {
      setEvents([]);
      setBrandColors({});
      setCfpLabels({});
      setOrgIds({});
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void apiFetch<AuthResponse["user"]>("/auth/me")
      .then((user) => setMe({ name: user.name, photoUrl: user.photoUrl }))
      .catch(() => {
        /* avatar falls back to initials / "?" */
      });
  }, []);

  /* F1.5.3 — inside an event's console, the accent variables come from that
     event's brandColor (contrast-safe; neutral blue-gray when unset). Outside
     an event context the token defaults apply untouched. */
  const accentStyle = useMemo(
    () => (eventId ? eventAccentStyle(brandColors[eventId]) : undefined),
    [eventId, brandColors],
  );

  const resolvedCfpLabel = eventId ? cfpDisplayLabel({ cfpLabel: cfpLabels[eventId] }) : cfpDisplayLabel({});

  const organizeItems = eventId
    ? [
        {
          id: "overview",
          label: "Overview",
          description: NAV_BLURB.overview,
          href: `/organizer/events/${eventId}`,
          icon: icons.overview,
          active: isActive("overview"),
        },
        {
          id: "ingest",
          label: "Agenda ingest",
          description: NAV_BLURB.ingest,
          href: `/organizer/events/${eventId}/ingest`,
          icon: icons.ingest,
          active: isActive("ingest"),
        },
        {
          id: "cfp",
          label: resolvedCfpLabel,
          description: NAV_BLURB.cfp,
          featureKey: "cfp" as const,
          href: `/organizer/events/${eventId}/cfp`,
          icon: icons.cfp,
          active: isActive("cfp"),
        },
        {
          id: "sponsors",
          label: "Sponsors",
          description: NAV_BLURB.sponsors,
          featureKey: "sponsors" as const,
          href: `/organizer/events/${eventId}/sponsors`,
          icon: icons.sponsors,
          active: isActive("sponsors"),
        },
        {
          id: "analytics",
          label: "Analytics",
          description: NAV_BLURB.analytics,
          href: `/organizer/events/${eventId}/analytics`,
          icon: icons.analytics,
          active: isActive("analytics"),
        },
        {
          id: "scanner",
          label: "Check-in",
          description: NAV_BLURB.scanner,
          featureKey: "checkin" as const,
          href: `/organizer/events/${eventId}/scanner`,
          icon: icons.scanner,
          active: isActive("scanner"),
        },
      ]
    : [
        {
          id: "events",
          label: "Events",
          description: NAV_BLURB.events,
          href: "/organizer",
          icon: icons.events,
          active: isActive("events"),
        },
        {
          id: "new-event",
          label: "New event",
          description: NAV_BLURB.newEvent,
          href: "/organizer/events/new",
          icon: icons.ai,
          active: isActive("new-event"),
        },
      ];

  const nav: ShellNavGroup[] = [
    { id: "organize", label: "Organize", items: organizeItems },
    {
      id: "workspace",
      label: "Workspace",
      items: [
        ...(eventId
          ? [
              {
                id: "events",
                label: "All events",
                description: NAV_BLURB.allEvents,
                href: "/organizer",
                icon: icons.events,
                active: isActive("events"),
              },
            ]
          : []),
        {
          id: "org-settings",
          label: "Organization",
          description: NAV_BLURB.orgSettings,
          href: "/organizer/org/settings",
          icon: icons.org,
          active: isActive("org-settings"),
        },
        {
          id: "billing",
          label: "Billing",
          description: NAV_BLURB.billing,
          href: "/organizer/billing",
          icon: icons.billing,
          active: isActive("billing"),
        },
        {
          id: "ai-usage",
          label: "AI usage",
          description: NAV_BLURB.aiUsage,
          href: "/organizer/ai-usage",
          icon: icons.ai,
          active: isActive("ai-usage"),
        },
      ],
    },
    {
      id: "account",
      label: "Account",
      items: [
        {
          id: "attendee-app",
          label: "Attendee app",
          description: NAV_BLURB.attendeeApp,
          href: "/dashboard",
          icon: icons.app,
        },
        {
          id: "account-settings",
          label: "Settings",
          description: NAV_BLURB.settings,
          href: "/account",
          icon: icons.app,
        },
      ],
    },
  ];

  function switchEvent(id: string) {
    try {
      window.localStorage.setItem("activeEventId", id);
    } catch {
      /* ignore */
    }
    void router.push(`/organizer/events/${id}`);
  }

  const resolvedEventName = eventName || (eventId ? events.find((ev) => ev.id === eventId)?.name : null) || null;

  return (
    <OrganizerEventContext.Provider
      value={{
        eventId: eventId || null,
        eventName: resolvedEventName,
        cfpLabel: eventId ? cfpLabels[eventId] ?? null : null,
      }}
    >
      <AppShell
        title={resolvedEventName || "Organizer"}
        nav={nav}
        mobilePrimaryIds={organizeItems.slice(0, 3).map((i) => i.id)}
        userName={userName || me?.name}
        userPhotoUrl={userPhotoUrl ?? me?.photoUrl}
        events={events}
        activeEventId={eventId || null}
        onSelectEvent={switchEvent}
        accentStyle={accentStyle}
        modeBadge="Organizer mode"
        accountMenu={[
          { id: "attendee-app", label: "Open attendee app", href: "/dashboard" },
          { id: "account", label: "Account settings", href: "/account" },
        ]}
      >
        {children}
      </AppShell>
      {eventId ? (
        <OrganizerAssistantDock eventId={eventId} organizationId={orgIds[eventId]} />
      ) : null}
    </OrganizerEventContext.Provider>
  );
}
