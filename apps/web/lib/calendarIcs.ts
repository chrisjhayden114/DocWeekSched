/**
 * Client-side ICS download helpers — same pattern as the dashboard My Schedule
 * "Download agenda ICS" / session calendar modal (no API changes).
 */

import { brand, icsProductId } from "@event-app/config";

export type IcsSession = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  description?: string | null;
  location?: string | null;
  zoomLink?: string | null;
};

function toGoogleCalendarUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function triggerIcsDownload(filename: string, body: string) {
  const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/** Per-session .ics — same shape as dashboard `downloadSessionIcs`. */
export function downloadSessionIcs(session: IcsSession, eventName: string, eventTimezone?: string) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${icsProductId("Conference Session")}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${session.id}@${brand.domain}`,
    `DTSTAMP:${toGoogleCalendarUtc(new Date().toISOString())}`,
    `DTSTART:${toGoogleCalendarUtc(session.startsAt)}`,
    `DTEND:${toGoogleCalendarUtc(session.endsAt)}`,
    `SUMMARY:${escapeIcsText(`${session.title} (${eventName})`)}`,
    `DESCRIPTION:${escapeIcsText(
      [
        session.description,
        session.zoomLink ? `Meeting: ${session.zoomLink}` : "",
        eventTimezone ? `Event timezone: ${eventTimezone}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    )}`,
    session.location ? `LOCATION:${escapeIcsText(session.location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  const slug =
    session.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "session";
  triggerIcsDownload(`${slug}.ics`, lines.join("\r\n"));
}

/** Full program .ics from already-fetched sessions (public page / My Schedule blob). */
export function downloadProgramIcs(sessions: IcsSession[], eventName: string, eventTimezone?: string) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${icsProductId("Agenda")}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const s of sessions) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@${brand.domain}`,
      `DTSTAMP:${toGoogleCalendarUtc(new Date().toISOString())}`,
      `DTSTART:${toGoogleCalendarUtc(s.startsAt)}`,
      `DTEND:${toGoogleCalendarUtc(s.endsAt)}`,
      `SUMMARY:${escapeIcsText(`${s.title} (${eventName})`)}`,
      `DESCRIPTION:${escapeIcsText(
        [s.description, eventTimezone ? `Event timezone: ${eventTimezone}` : ""].filter(Boolean).join("\n\n"),
      )}`,
      s.location ? `LOCATION:${escapeIcsText(s.location)}` : "",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  const slug = eventName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "program";
  triggerIcsDownload(`${slug}.ics`, lines.filter(Boolean).join("\r\n"));
}
