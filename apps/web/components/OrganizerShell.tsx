import type { ReactNode, SVGProps } from "react";
import { AppShell, type ShellNavGroup } from "./AppShell";

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
};

type OrganizerShellProps = {
  /** Active nav item id (see item ids below). */
  active?: string;
  /** When present, the shell shows the event-level Organize group. */
  eventId?: string | null;
  eventName?: string | null;
  userName?: string | null;
  children: ReactNode;
};

export function OrganizerShell({ active, eventId, eventName, userName, children }: OrganizerShellProps) {
  const isActive = (id: string) => active === id;

  const organizeItems = eventId
    ? [
        { id: "overview", label: "Overview", href: `/organizer/events/${eventId}`, icon: icons.overview, active: isActive("overview") },
        { id: "ingest", label: "Agenda ingest", href: `/organizer/events/${eventId}/ingest`, icon: icons.ingest, active: isActive("ingest") },
        { id: "cfp", label: "CFP", href: `/organizer/events/${eventId}/cfp`, icon: icons.cfp, active: isActive("cfp") },
        { id: "sponsors", label: "Sponsors", href: `/organizer/events/${eventId}/sponsors`, icon: icons.sponsors, active: isActive("sponsors") },
        { id: "analytics", label: "Analytics", href: `/organizer/events/${eventId}/analytics`, icon: icons.analytics, active: isActive("analytics") },
        { id: "scanner", label: "Check-in", href: `/organizer/events/${eventId}/scanner`, icon: icons.scanner, active: isActive("scanner") },
      ]
    : [
        { id: "events", label: "Events", href: "/organizer", icon: icons.events, active: isActive("events") },
        { id: "new-event", label: "New event", href: "/organizer/events/new", icon: icons.ai, active: isActive("new-event") },
      ];

  const nav: ShellNavGroup[] = [
    { id: "organize", label: "Organize", items: organizeItems },
    {
      id: "workspace",
      label: "Workspace",
      items: [
        ...(eventId
          ? [{ id: "events", label: "All events", href: "/organizer", icon: icons.events, active: isActive("events") }]
          : []),
        { id: "billing", label: "Billing", href: "/organizer/billing", icon: icons.billing, active: isActive("billing") },
        { id: "ai-usage", label: "AI usage", href: "/organizer/ai-usage", icon: icons.ai, active: isActive("ai-usage") },
      ],
    },
    {
      id: "account",
      label: "Account",
      items: [
        { id: "attendee-app", label: "Attendee app", href: "/dashboard", icon: icons.app },
        { id: "account-settings", label: "Settings", href: "/account", icon: icons.app },
      ],
    },
  ];

  return (
    <AppShell
      title={eventName || "Organizer"}
      nav={nav}
      mobilePrimaryIds={organizeItems.slice(0, 3).map((i) => i.id)}
      userName={userName}
      accountMenu={[
        { id: "attendee-app", label: "Open attendee app", href: "/dashboard" },
        { id: "account", label: "Account settings", href: "/account" },
      ]}
    >
      {children}
    </AppShell>
  );
}
