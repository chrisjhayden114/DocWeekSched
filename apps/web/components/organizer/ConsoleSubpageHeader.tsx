import Link from "next/link";
import { useOrganizerEvent } from "../OrganizerShell";

export type ConsoleSubpageBackTo = {
  href: string;
  label: string;
};

export type ConsoleSubpageHeaderProps = {
  title: string;
  /** Override the event back-link from OrganizerShell (billing uses this). */
  backTo?: ConsoleSubpageBackTo;
};

/**
 * K-1 — shared header for organizer console subpages: a quiet back crumb
 * ("← Back to {eventName}") and the page h1. Event name comes from
 * OrganizerShell so pages do not refetch just to label the crumb.
 */
export function ConsoleSubpageHeader({ title, backTo }: ConsoleSubpageHeaderProps) {
  const { eventId, eventName } = useOrganizerEvent();
  const crumb = backTo
    ? backTo
    : eventId
      ? {
          href: `/organizer/events/${eventId}`,
          label: eventName ? `Back to ${eventName}` : "Back to event",
        }
      : null;

  return (
    <header className="console-subpage-header">
      {crumb ? (
        <p className="console-subpage-back">
          <Link href={crumb.href}>← {crumb.label}</Link>
        </p>
      ) : null}
      <h1>{title}</h1>
    </header>
  );
}
