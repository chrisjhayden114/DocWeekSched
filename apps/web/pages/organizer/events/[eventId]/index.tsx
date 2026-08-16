import { brand, overviewCopy } from "@event-app/config";
import { ASSISTANT_COPY } from "@event-app/shared";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useCallback, useEffect, useMemo, useState, type SVGProps } from "react";
import { OrganizerShell } from "../../../../components/OrganizerShell";
import { ReviewChangeset, parseCsvToTable } from "../../../../components/ReviewChangeset";
import { FeatureConfigPanel, type FeatureOverridesMap } from "../../../../components/FeatureConfigPanel";
import { SetupAssistantPanel } from "../../../../components/SetupAssistantPanel";
import { SetupCopilotChat } from "../../../../components/SetupCopilotChat";
import { VenueMapEditor } from "../../../../components/VenueMapEditor";
import { AnnouncementComposer } from "../../../../components/AnnouncementComposer";
import { AssistantStartersEditor, EventFaqEditor } from "../../../../components/EventFaqEditor";
import { OpsInboxPanel } from "../../../../components/OpsInboxPanel";
import { RecapPanel } from "../../../../components/RecapPanel";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { KebabMenu } from "../../../../components/KebabMenu";
import { ListEmpty, ListError, ListSkeleton } from "../../../../components/ListState";
import { StatusChip } from "../../../../components/StatusChip";
import { PageHeader, StatCard } from "../../../../components/kit";
import { EventSettingsSlideOver } from "../../../../components/organizer/EventSettingsSlideOver";
import {
  ProgramTab,
  type ProgramSession,
  type Room,
  type Track,
} from "../../../../components/organizer/ProgramTab";
import { apiFetch, apiFetchAll } from "../../../../lib/api";
import { formatEventDateRange } from "../../../../lib/dateFormat";
import { openAttendeeApp, publicEventUrl } from "../../../../lib/organizerLinks";
import { eventHeaders, organizerFetch } from "../../../../lib/organizerApi";
import {
  filterParticipants,
  inviteStatusChipStatus,
  inviteStatusLabel,
  type InviteStatus,
} from "../../../../lib/participants";
import { buildSetupChecklist } from "../../../../lib/setupChecklist";

type EventDetail = {
  id: string;
  name: string;
  slug: string;
  status: string;
  uiStatus: string;
  description?: string | null;
  timezone: string;
  startDate: string;
  endDate: string;
  venueName?: string | null;
  venueAddress?: string | null;
  onlineUrl?: string | null;
  brandColor?: string | null;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  organizationId: string;
  seriesId?: string | null;
};

type Speaker = { id: string; name: string; title?: string | null; affiliation?: string | null };

/** INV-1 — roster row from GET /attendees (managers get inviteStatus). */
type ParticipantRow = {
  id: string;
  name: string;
  email: string;
  eventRole?: "ADMIN" | "ATTENDEE" | string;
  inviteStatus?: InviteStatus;
};

type RosterAction = { kind: "make-admin" | "remove-admin" | "remove"; row: ParticipantRow };

type DryRun = {
  headers: string[];
  mapping: Record<string, string>;
  rows: { kind: string; rowIndex: number; email?: string; name?: string; message?: string; researchInterests?: string; photoUrl?: string }[];
  summary: { creates: number; errors: number; skipped: number };
};

type EventTab =
  | "overview"
  | "program"
  | "people"
  | "invites"
  | "maps"
  | "announcements"
  | "features"
  | "ops"
  | "recap";

const EVENT_TABS: readonly EventTab[] = [
  "overview",
  "program",
  "people",
  "invites",
  "maps",
  "announcements",
  "features",
  "ops",
  "recap",
];

/** Stroke icons for the overview (same 18px stroke style as OrganizerShell). */
function OverviewIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

const overviewIcons = {
  calendar: (
    <OverviewIcon>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </OverviewIcon>
  ),
  people: (
    <OverviewIcon>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </OverviewIcon>
  ),
  ticket: (
    <OverviewIcon>
      <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6z" />
      <path d="M13 5v2M13 17v2M13 11v2" />
    </OverviewIcon>
  ),
  room: (
    <OverviewIcon>
      <path d="M3 21h18M9 8h1M9 12h1M14 8h1M14 12h1" />
      <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
      <path d="M10 21v-4a2 2 0 0 1 4 0v4" />
    </OverviewIcon>
  ),
  ingest: (
    <OverviewIcon>
      <path d="M12 3v12M8 11l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </OverviewIcon>
  ),
  edit: (
    <OverviewIcon>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </OverviewIcon>
  ),
  eye: (
    <OverviewIcon>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </OverviewIcon>
  ),
  app: (
    <OverviewIcon>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M12 18h.01" />
    </OverviewIcon>
  ),
};

/** INV-1 — copy-to-clipboard with a brief inline "Copied" state (no toast). */
function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button secondary"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => {
            /* clipboard may be denied — leave label unchanged */
          });
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

const MAPPING_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "name", label: "Name" },
  { value: "description", label: "Description / interests" },
  { value: "bio", label: "Bio" },
  { value: "photoUrl", label: "Photo URL" },
  { value: "skip", label: "Skip" },
];

export default function OrganizerEventPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === "string" ? router.query.eventId : "";
  const [tab, setTab] = useState<EventTab>("overview");

  // E12.1: honor deep links like ?tab=program (used by "View program" after
  // an ingest confirm). Unknown values fall back to the default tab.
  // F0.2: the URL is the source of truth — this also runs on Back/Forward
  // (popstate), so history navigation moves between tabs instead of exiting
  // the console, and a refresh keeps the current tab.
  useEffect(() => {
    if (!router.isReady) return;
    const raw = router.query.tab;
    // INV-1: the tab is named Participants now, but the id stays "invites"
    // for deep-link compat — accept both spellings in the URL.
    const q = raw === "participants" ? "invites" : raw;
    setTab(
      typeof q === "string" && (EVENT_TABS as readonly string[]).includes(q)
        ? (q as EventTab)
        : "overview",
    );
  }, [router.isReady, router.query.tab]);

  // F0.2: tab clicks write the tab to the query string (shallow — no data
  // refetch); the effect above reads it back into state.
  const selectTab = useCallback(
    (next: EventTab) => {
      const query: Record<string, string> = { eventId };
      if (next !== "overview") query.tab = next;
      void router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
    },
    [router, eventId],
  );

  // F2: the settings SlideOver is URL-addressable (?settings=1) so the
  // checklist's "Open Settings" deep link and the old dashboard entry point
  // both land here, and Back closes the panel.
  const settingsOpen = router.isReady && router.query.settings === "1";
  const setSettingsOpen = useCallback(
    (next: boolean) => {
      const query: Record<string, string> = { eventId };
      if (tab !== "overview") query.tab = tab;
      if (next) query.settings = "1";
      void router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
    },
    [router, eventId, tab],
  );
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [featureOverrides, setFeatureOverrides] = useState<FeatureOverridesMap>({});
  const [featuresDirty, setFeaturesDirty] = useState(false);
  const [featuresSaving, setFeaturesSaving] = useState(false);
  const [askAssistant, setAskAssistant] = useState(false);
  /** H1 — brief inline "Copied" after Copy link on the publish success block. */
  const [linkCopied, setLinkCopied] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [sessions, setSessions] = useState<ProgramSession[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);
  /** F2 stat row — registered count; null while unknown (card hidden). */
  const [registeredCount, setRegisteredCount] = useState<number | null>(null);

  // People form
  const [speakerName, setSpeakerName] = useState("");

  // Series
  const [nextStart, setNextStart] = useState("");

  // CSV
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [inviteLinks, setInviteLinks] = useState<{ slugUrl?: string; joinUrl?: string | null } | null>(null);

  // INV-1 — Participants tab: single invite form + roster
  const [invName, setInvName] = useState("");
  const [invEmail, setInvEmail] = useState("");
  const [invBusy, setInvBusy] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);
  const [invResult, setInvResult] = useState<{ text: string; fallbackUrl?: string } | null>(null);
  const [roster, setRoster] = useState<ParticipantRow[] | null>(null);
  const [rosterFilter, setRosterFilter] = useState("");
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterConfirm, setRosterConfirm] = useState<RosterAction | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!eventId) return;
    const ev = await organizerFetch<EventDetail>("/event/", eventId);
    setEvent(ev);
    const [t, r, s, sess, links, feats, attendeeRows] = await Promise.all([
      organizerFetch<Track[]>("/tracks/", eventId),
      organizerFetch<Room[]>("/rooms/", eventId),
      organizerFetch<Speaker[]>("/speakers/", eventId),
      organizerFetch<ProgramSession[]>("/sessions/", eventId),
      organizerFetch<{ slugUrl?: string; joinUrl?: string | null }>("/event/invite-links", eventId).catch(() => null),
      organizerFetch<{ overrides: FeatureOverridesMap }>("/event/features", eventId).catch(() => ({ overrides: {} })),
      // F2 stat row + INV-1 roster: one fetch feeds both.
      apiFetchAll<ParticipantRow>("/attendees/", eventHeaders(eventId)).catch(() => null),
    ]);
    setTracks(t);
    setRooms(r);
    setSpeakers(s);
    setSessions(sess);
    setInviteLinks(links);
    setFeatureOverrides(feats.overrides || {});
    setFeaturesDirty(false);
    setRegisteredCount(attendeeRows ? attendeeRows.length : null);
    setRoster(attendeeRows);
  }, [eventId]);

  /** INV-1 — refetch just the roster (after invites / kebab actions). */
  const refreshRoster = useCallback(async () => {
    if (!eventId) return;
    const rows = await apiFetchAll<ParticipantRow>("/attendees/", eventHeaders(eventId));
    setRoster(rows);
    setRegisteredCount(rows.length);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    void refresh().catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load event");
    });
  }, [eventId, refresh]);

  async function runStatus(path: string) {
    if (!eventId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await organizerFetch<{ publishedSessionCount?: number }>(path, eventId, {
        method: "POST",
        body: "{}",
      });
      await refresh();
      // E13.1: publishing reports what it did — the event AND its draft
      // sessions go live together.
      if (path === "/event/publish") {
        const n = res?.publishedSessionCount ?? 0;
        setMessage(n > 0 ? `Published event and ${n} session${n === 1 ? "" : "s"}.` : "Published event.");
      } else {
        setMessage("Status updated");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status change failed");
    } finally {
      setBusy(false);
    }
  }

  async function addSpeaker(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !speakerName.trim()) return;
    await organizerFetch("/speakers/", eventId, {
      method: "POST",
      body: JSON.stringify({ name: speakerName.trim() }),
    });
    setSpeakerName("");
    await refresh();
  }

  async function createNextEdition(e: FormEvent) {
    e.preventDefault();
    if (!event || !nextStart) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ eventId: string }>("/series/next-edition", {
        method: "POST",
        body: JSON.stringify({
          sourceEventId: event.id,
          organizationId: event.organizationId,
          startDate: new Date(nextStart).toISOString(),
        }),
      });
      void router.push(`/organizer/events/${result.eventId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clone edition");
    } finally {
      setBusy(false);
    }
  }

  /** INV-1 a) — invite one person; falls back to a copyable link when email isn't set up. */
  async function sendSingleInvite(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !invName.trim() || !invEmail.trim()) return;
    setInvBusy(true);
    setInvError(null);
    setInvResult(null);
    try {
      const res = await organizerFetch<{
        inviteUrl: string;
        emailDelivered: boolean;
        emailFallbackMessage?: string;
      }>("/attendees/invite", eventId, {
        method: "POST",
        body: JSON.stringify({ email: invEmail.trim(), name: invName.trim() }),
      });
      setInvResult(
        res.emailDelivered
          ? { text: "Invited — setup email sent." }
          : {
              text: `Invited. ${res.emailFallbackMessage || "Email isn't set up — share this invite link instead."}`,
              fallbackUrl: res.inviteUrl,
            },
      );
      setInvName("");
      setInvEmail("");
      await refreshRoster().catch(() => undefined);
    } catch (err) {
      setInvError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setInvBusy(false);
    }
  }

  async function onCsvFile(file: File) {
    const text = await file.text();
    const parsed = parseCsvToTable(text);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setCsvHeaders(parsed.headers);
    setCsvRows(parsed.rows);
    setDryRun(null);
    const dry = await organizerFetch<DryRun>("/attendees/invite-dry-run", eventId, {
      method: "POST",
      body: JSON.stringify({ headers: parsed.headers, rows: parsed.rows }),
    });
    setCsvMapping(dry.mapping);
    setDryRun(dry);
  }

  async function reDryRun(mapping: Record<string, string>) {
    setCsvMapping(mapping);
    if (!eventId || !csvHeaders.length) return;
    const dry = await organizerFetch<DryRun>("/attendees/invite-dry-run", eventId, {
      method: "POST",
      body: JSON.stringify({ headers: csvHeaders, rows: csvRows, mapping }),
    });
    setDryRun(dry);
  }

  async function confirmInvites() {
    if (!dryRun || !eventId) return;
    setBusy(true);
    try {
      const invites = dryRun.rows
        .filter((r) => r.kind === "create" && r.email && r.name)
        .map((r) => ({
          email: r.email!,
          name: r.name!,
          researchInterests: r.researchInterests,
          photoUrl: r.photoUrl,
        }));
      const result = await organizerFetch<{
        sentCount: number;
        emailFallbackMessage?: string;
        sent: { inviteUrl: string; emailDelivered: boolean }[];
      }>("/attendees/invite-bulk", eventId, {
        method: "POST",
        body: JSON.stringify({ invites }),
      });
      setMessage(
        result.emailFallbackMessage
          ? `${result.sentCount} invited. ${result.emailFallbackMessage}`
          : `Invited ${result.sentCount} people.`,
      );
      setDryRun(null);
      setCsvRows([]);
      // INV-1 — the roster now lives on the same tab; keep it current.
      await refreshRoster().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  // F2 — the checklist input doubles as the header's "N steps from
  // publishing" source, so the state line and the checklist always agree.
  const checklistInput = useMemo(
    () =>
      event
        ? {
            eventId,
            status: event.status,
            venueName: event.venueName,
            onlineUrl: event.onlineUrl,
            sessionCount: sessions.length,
            draftSessionCount: sessions.filter(
              (s) => (s.publishStatus || "").toUpperCase() === "DRAFT",
            ).length,
            roomCount: rooms.length,
            speakerCount: speakers.length,
          }
        : null,
    [event, eventId, sessions, rooms, speakers],
  );
  const remainingSteps = useMemo(
    () => (checklistInput ? buildSetupChecklist(checklistInput).filter((i) => !i.done).length : 0),
    [checklistInput],
  );
  const stateLine = event
    ? [
        event.uiStatus,
        formatEventDateRange(event.startDate, event.endDate, event.timezone),
        event.status === "ACTIVE"
          ? remainingSteps > 0
            ? overviewCopy.stateLine.stepsRemaining(remainingSteps)
            : overviewCopy.stateLine.setupComplete
          : overviewCopy.stateLine.stepsFromPublishing(remainingSteps),
      ].join(" · ")
    : "";

  if (!eventId) return null;

  return (
    <>
      <Head>
        <title>{`${event?.name || "Event"} — Organizer — ${brand.productName}`}</title>
      </Head>
      {/* F0.2: only claim "Overview" in the sidebar when the Overview tab is
          actually selected — other tabs have no sidebar item, so nothing
          highlights (rather than lying). Nav unification is later F work. */}
      <OrganizerShell active={tab === "overview" ? "overview" : undefined} eventId={eventId} eventName={event?.name}>
        {error && !event ? (
          <ListError message={error} onRetry={() => void refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed to load event"))} />
        ) : null}
        {!event && !error ? <ListSkeleton rows={5} /> : null}

        {/* F2 — the Overview gets the kit wayfinding header: name, one-line
            state ("Draft · Jun 8–10 · 3 steps from publishing"), and the
            primary action (Publish, or Preview once live) plus Settings,
            which opens the relocated settings SlideOver. */}
        {event && tab === "overview" ? (
          <PageHeader
            title={event.name}
            state={stateLine}
            icon={overviewIcons.calendar}
            action={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button type="button" className="button secondary" onClick={() => setSettingsOpen(true)}>
                  {overviewCopy.actions.settings}
                </button>
                {event.status !== "ACTIVE" ? (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      if (sessions.length === 0) setPublishConfirm(true);
                      else void runStatus("/event/publish");
                    }}
                  >
                    {overviewCopy.actions.publish}
                  </button>
                ) : (
                  <>
                    <a className="button" href={publicEventUrl(event.slug)}>
                      {overviewCopy.actions.preview}
                    </a>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => openAttendeeApp(event.id)}
                    >
                      {overviewCopy.actions.openAttendeeApp}
                    </button>
                  </>
                )}
              </div>
            }
          />
        ) : null}
        {event && tab !== "overview" ? (
          <header className="console-page-header">
            <div>
              <h1>{event.name}</h1>
              <p className="text-meta" style={{ margin: "6px 0 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <StatusChip status={event.uiStatus} />
                <span>/e/{event.slug}</span>
                {inviteLinks?.slugUrl ? (
                  <a href={inviteLinks.slugUrl}>{inviteLinks.slugUrl}</a>
                ) : null}
              </p>
            </div>
          </header>
        ) : null}

        {message &&
        event?.status === "ACTIVE" &&
        message.startsWith("Published event") ? (
          // H1 / D4 — publish moment: live URL + Copy / View as attendees /
          // Open attendee app (same calm banner language as ingest success).
          <div
            role="status"
            style={{
              padding: 12,
              borderRadius: "var(--radius-sm)",
              background: "var(--success-50, #f0fdf4)",
              border: "1px solid var(--gray-200)",
            }}
          >
            <p style={{ margin: 0, color: "var(--success)" }}>
              {overviewCopy.publishSuccess.liveAt(event.slug)}
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(`${window.location.origin}${publicEventUrl(event.slug)}`)
                    .then(() => {
                      setLinkCopied(true);
                      window.setTimeout(() => setLinkCopied(false), 2000);
                    })
                    .catch(() => {
                      /* clipboard may be denied — leave label unchanged */
                    });
                }}
              >
                {linkCopied
                  ? overviewCopy.publishSuccess.copied
                  : overviewCopy.publishSuccess.copyLink}
              </button>
              <a
                className="button secondary"
                href={publicEventUrl(event.slug)}
                target="_blank"
                rel="noopener"
              >
                {overviewCopy.publishSuccess.viewAsAttendees}
              </a>
              <button
                type="button"
                className="button secondary"
                onClick={() => openAttendeeApp(event.id)}
              >
                {overviewCopy.actions.openAttendeeApp}
              </button>
            </div>
          </div>
        ) : message ? (
          <p style={{ color: "var(--success)" }}>{message}</p>
        ) : null}
        {error && event ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}

        {event ? (
        <nav className="nav console-event-tabs" aria-label="Event sections" style={{ margin: "0 0 16px" }}>
          {(
            [
              ["overview", "Overview"],
              ["program", "Program"],
              ["people", "Speakers"],
              ["invites", "Participants"],
              ["maps", "Maps"],
              ["announcements", "Announcements"],
              ["ops", "Ops Inbox"],
              ["recap", "Recap"],
              ["features", "Features"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "active" : ""}
              onClick={() => selectTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        ) : null}

        {/* E28.3 — keyed by tab, so switching tabs remounts the wrapper and
            cross-fades the incoming panel (.motion-fade, --motion-fast). */}
        <div className="motion-fade" key={tab}>
        {tab === "overview" && event ? (
          <section style={{ display: "grid", gap: 16 }}>
            {/* F2 #2 — the earned count-up home: real counts, reduced-motion
                safe (CountUp collapses to static under the E28 token). */}
            <div className="overview-stat-row">
              <StatCard
                label={overviewCopy.stats.sessions}
                value={sessions.length}
                countUp
                icon={overviewIcons.calendar}
                hint={
                  checklistInput && checklistInput.draftSessionCount > 0
                    ? `${checklistInput.draftSessionCount} draft`
                    : undefined
                }
              />
              <StatCard
                label={overviewCopy.stats.speakers}
                value={speakers.length}
                countUp
                icon={overviewIcons.people}
                iconTone="success"
              />
              {registeredCount != null ? (
                // INV-1 — the count answers "who?"; clicking goes to the roster.
                <StatCard
                  label={overviewCopy.stats.registered}
                  value={registeredCount}
                  countUp
                  icon={overviewIcons.ticket}
                  iconTone="live"
                  href={`/organizer/events/${eventId}?tab=participants`}
                />
              ) : null}
              <StatCard
                label={overviewCopy.stats.rooms}
                value={rooms.length}
                countUp
                icon={overviewIcons.room}
                iconTone="neutral"
              />
            </div>

            {/* E19.3 / F2 #3 — the "Before you publish" checklist: live event
                state, done/attention/todo, deep links to the fixing tab. */}
            {checklistInput ? (
              <SetupAssistantPanel
                input={checklistInput}
                organizationId={event.organizationId}
                onFeaturesApplied={(overrides) => {
                  setFeatureOverrides(overrides);
                  setFeaturesDirty(false);
                  setMessage("Feature settings updated");
                }}
              />
            ) : null}

            {/* F2 #4 — quick actions, deep-linking to the existing screens. */}
            <div className="overview-quick-actions" aria-label={overviewCopy.quickActions.label}>
              <Link className="kit-action-card" href={`/organizer/events/${eventId}/ingest`}>
                <span className="kit-icon-tile kit-icon-tile--primary" aria-hidden>
                  {overviewIcons.ingest}
                </span>
                <span className="kit-action-card-title">{overviewCopy.quickActions.importProgram.title}</span>
                <span className="kit-action-card-body">{overviewCopy.quickActions.importProgram.body}</span>
              </Link>
              <Link className="kit-action-card" href={`/organizer/events/${eventId}?tab=program`}>
                <span className="kit-icon-tile kit-icon-tile--success" aria-hidden>
                  {overviewIcons.edit}
                </span>
                <span className="kit-action-card-title">{overviewCopy.quickActions.editProgram.title}</span>
                <span className="kit-action-card-body">{overviewCopy.quickActions.editProgram.body}</span>
              </Link>
              {/* INV-1 — deep link to the Participants tab. */}
              <Link className="kit-action-card" href={`/organizer/events/${eventId}?tab=participants`}>
                <span className="kit-icon-tile kit-icon-tile--primary" aria-hidden>
                  {overviewIcons.people}
                </span>
                <span className="kit-action-card-title">{overviewCopy.quickActions.manageParticipants.title}</span>
                <span className="kit-action-card-body">{overviewCopy.quickActions.manageParticipants.body}</span>
              </Link>
              {event.status === "ACTIVE" ? (
                <a className="kit-action-card" href={publicEventUrl(event.slug)}>
                  <span className="kit-icon-tile kit-icon-tile--live" aria-hidden>
                    {overviewIcons.eye}
                  </span>
                  <span className="kit-action-card-title">{overviewCopy.quickActions.preview.title}</span>
                  <span className="kit-action-card-body">{overviewCopy.quickActions.preview.body}</span>
                </a>
              ) : (
                <div className="kit-action-card is-disabled" aria-disabled="true">
                  <span className="kit-icon-tile kit-icon-tile--neutral" aria-hidden>
                    {overviewIcons.eye}
                  </span>
                  <span className="kit-action-card-title">{overviewCopy.quickActions.preview.title}</span>
                  <span className="kit-action-card-body">{overviewCopy.quickActions.preview.draftHint}</span>
                </div>
              )}
              {event.status === "ACTIVE" ? (
                <button
                  type="button"
                  className="kit-action-card"
                  onClick={() => openAttendeeApp(event.id)}
                >
                  <span className="kit-icon-tile kit-icon-tile--live" aria-hidden>
                    {overviewIcons.app}
                  </span>
                  <span className="kit-action-card-title">
                    {overviewCopy.quickActions.openAttendeeApp.title}
                  </span>
                  <span className="kit-action-card-body">
                    {overviewCopy.quickActions.openAttendeeApp.body}
                  </span>
                </button>
              ) : (
                <div className="kit-action-card is-disabled" aria-disabled="true">
                  <span className="kit-icon-tile kit-icon-tile--neutral" aria-hidden>
                    {overviewIcons.app}
                  </span>
                  <span className="kit-action-card-title">
                    {overviewCopy.quickActions.openAttendeeApp.title}
                  </span>
                  <span className="kit-action-card-body">
                    {overviewCopy.quickActions.preview.draftHint}
                  </span>
                </div>
              )}
            </div>

            {/* Rare/advanced actions tucked behind disclosure (audit: "Create
                next edition" had permanent prime real estate). Same handlers,
                same copy — just no longer the hero. */}
            <details className="console-panel overview-advanced">
              <summary className="overview-advanced-summary">{overviewCopy.advanced.label}</summary>
              <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
                <div>
                  <p className="help-text" style={{ marginTop: 0 }}>
                    {overviewCopy.advanced.statusHelp}
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {event.status === "ACTIVE" ? (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void runStatus("/event/unpublish")}
                      >
                        {overviewCopy.advanced.unpublish}
                      </button>
                    ) : null}
                    {event.status !== "ARCHIVED" ? (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void runStatus("/event/archive")}
                      >
                        {overviewCopy.advanced.archive}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void runStatus("/event/unarchive")}
                      >
                        {overviewCopy.advanced.unarchive}
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <p className="console-panel-label">Create next edition</p>
                  <p className="help-text" style={{ marginTop: 0 }}>
                    Clones tracks, rooms, speakers, sessions, papers, and presentations into a new Draft — no attendees.
                    Dates shift from the new start.
                  </p>
                  <form onSubmit={createNextEdition} className="console-form">
                    <label>
                      New start
                      <input
                        className="input"
                        type="datetime-local"
                        required
                        value={nextStart}
                        onChange={(e) => setNextStart(e.target.value)}
                      />
                    </label>
                    <button className="button" type="submit" disabled={busy} style={{ justifySelf: "start" }}>
                      Create next edition
                    </button>
                  </form>
                </div>
              </div>
            </details>
          </section>
        ) : null}

        {tab === "program" && event ? (
          <ProgramTab
            eventId={eventId}
            event={event}
            tracks={tracks}
            rooms={rooms}
            sessions={sessions}
            onChanged={refresh}
          />
        ) : null}

        {tab === "people" ? (
          <section className="console-panel">
            <p className="console-panel-label">Speakers</p>
            <p className="help-text" style={{ marginTop: 0 }}>
              Speakers present sessions and appear on the public schedule. Authors and presenters are listed under each
              paper or presentation inside a session (Program tab) — a person can be both.
            </p>
            {speakers.length === 0 ? (
              <ListEmpty title="No speakers yet" body="Add speakers to assign them to sessions, papers, and presentations." />
            ) : (
              <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                {speakers.map((s) => (
                  <li key={s.id}>
                    {s.name}
                    {s.title || s.affiliation ? (
                      <span className="help-text">
                        {" "}
                        — {[s.title, s.affiliation].filter(Boolean).join(", ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addSpeaker} className="console-form" style={{ gridTemplateColumns: "1fr auto", alignItems: "end" }}>
              <label style={{ margin: 0 }}>
                Speaker name
                <input className="input" placeholder="Speaker name" value={speakerName} onChange={(e) => setSpeakerName(e.target.value)} />
              </label>
              <button className="button" type="submit">
                Add speaker
              </button>
            </form>
          </section>
        ) : null}

        {tab === "invites" ? (
          <section style={{ display: "grid", gap: 16 }}>
            {/* INV-1 a) — invite one person */}
            <div className="console-panel">
              <p className="console-panel-label">Invite one person</p>
              <p className="help-text" style={{ marginTop: 0 }}>
                They get a setup email with a personal link. If email isn&apos;t set up, you&apos;ll get a copyable link
                instead.
              </p>
              <form
                onSubmit={sendSingleInvite}
                className="console-form"
                style={{ gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}
              >
                <label style={{ margin: 0 }}>
                  Name
                  <input
                    className="input"
                    required
                    placeholder="Full name"
                    value={invName}
                    onChange={(e) => setInvName(e.target.value)}
                  />
                </label>
                <label style={{ margin: 0 }}>
                  Email
                  <input
                    className="input"
                    type="email"
                    required
                    placeholder="name@example.edu"
                    value={invEmail}
                    onChange={(e) => setInvEmail(e.target.value)}
                  />
                </label>
                <button className="button" type="submit" disabled={invBusy}>
                  {invBusy ? "Sending…" : "Send invite"}
                </button>
              </form>
              {invError ? (
                <p style={{ color: "var(--danger)", margin: "10px 0 0" }}>{invError}</p>
              ) : null}
              {invResult ? (
                <div role="status" style={{ marginTop: 10 }}>
                  <p style={{ color: "var(--success)", margin: 0 }}>{invResult.text}</p>
                  {invResult.fallbackUrl ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                      <code style={{ overflowWrap: "anywhere" }}>{invResult.fallbackUrl}</code>
                      <CopyButton value={invResult.fallbackUrl} label="Copy invite link" />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* INV-1 b) — invite links (display + copy only; managing them is later work) */}
            <div className="console-panel">
              <p className="console-panel-label">Invite links</p>
              <p className="help-text" style={{ marginTop: 0 }}>
                Anyone with these links can join. The join link is permanent; the public page link follows the event
                address.
              </p>
              {inviteLinks?.joinUrl || inviteLinks?.slugUrl ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {inviteLinks.joinUrl ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="text-meta" style={{ minWidth: 110 }}>
                        Permanent join link
                      </span>
                      <code style={{ overflowWrap: "anywhere" }}>{inviteLinks.joinUrl}</code>
                      <CopyButton value={inviteLinks.joinUrl} />
                    </div>
                  ) : null}
                  {inviteLinks.slugUrl ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="text-meta" style={{ minWidth: 110 }}>
                        Public page link
                      </span>
                      <code style={{ overflowWrap: "anywhere" }}>{inviteLinks.slugUrl}</code>
                      <CopyButton value={inviteLinks.slugUrl} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="help-text" style={{ margin: 0 }}>
                  Invite links aren&apos;t available yet — reload to try again.
                </p>
              )}
            </div>

            {/* INV-1 c) — the existing CSV bulk invite card, unchanged */}
            <div className="console-panel">
              <p className="console-panel-label">CSV bulk invite</p>
              <p className="help-text" style={{ marginTop: 0 }}>
                Upload a CSV, review the dry-run (errors per row), then confirm. If email isn&apos;t set up, you&apos;ll get
                copyable invite links instead.
              </p>
              <input
                className="input"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onCsvFile(f).catch((err) => setError(err instanceof Error ? err.message : "CSV failed"));
                }}
              />
              {dryRun ? (
                <ReviewChangeset
                  title="Review invite changeset"
                  headers={csvHeaders}
                  mapping={csvMapping}
                  onMappingChange={(m) => void reDryRun(m)}
                  mappingOptions={MAPPING_OPTIONS}
                  rows={dryRun.rows as never}
                  summary={dryRun.summary}
                  confirmLabel={`Invite ${dryRun.summary.creates} people`}
                  busy={busy}
                  onConfirm={confirmInvites}
                  onCancel={() => {
                    setDryRun(null);
                    setCsvRows([]);
                  }}
                  renderCreateSummary={(row) =>
                    row.kind === "create" ? `${row.name || ""} <${row.email || ""}>` : ""
                  }
                />
              ) : null}
            </div>

            {/* INV-1 d) — roster */}
            <div className="console-panel">
              <p className="console-panel-label">Roster</p>
              {rosterError ? (
                <p role="alert" style={{ color: "var(--danger)", marginTop: 0 }}>
                  {rosterError}
                </p>
              ) : null}
              {roster === null ? (
                <ListSkeleton rows={4} />
              ) : roster.length === 0 ? (
                <ListEmpty
                  title="No participants yet"
                  body="Invite people above — they'll appear here with their invite status."
                />
              ) : (
                <>
                  {roster.length > 10 ? (
                    <input
                      className="input"
                      type="search"
                      placeholder="Filter by name or email"
                      aria-label="Filter participants by name or email"
                      value={rosterFilter}
                      onChange={(e) => setRosterFilter(e.target.value)}
                      style={{ marginBottom: 12, maxWidth: 360 }}
                    />
                  ) : null}
                  {(() => {
                    const visible = filterParticipants(roster, rosterFilter);
                    if (visible.length === 0) {
                      return (
                        <p className="help-text" style={{ marginTop: 0 }}>
                          No participants match &ldquo;{rosterFilter.trim()}&rdquo;.
                        </p>
                      );
                    }
                    return (
                      <div className="console-table-wrap">
                        <table className="console-table">
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Email</th>
                              <th>Status</th>
                              <th aria-label="Actions" />
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map((p) => (
                              <tr key={p.id}>
                                <td>
                                  {p.name}
                                  {p.eventRole === "ADMIN" ? (
                                    <span className="text-meta"> — admin</span>
                                  ) : null}
                                </td>
                                <td>{p.email}</td>
                                <td>
                                  <StatusChip
                                    status={inviteStatusChipStatus(p.inviteStatus)}
                                    label={inviteStatusLabel(p.inviteStatus)}
                                  />
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <KebabMenu
                                    label={`Actions for ${p.name}`}
                                    items={[
                                      p.eventRole === "ADMIN"
                                        ? {
                                            id: "remove-admin",
                                            label: "Remove admin",
                                            onSelect: () => setRosterConfirm({ kind: "remove-admin", row: p }),
                                          }
                                        : {
                                            id: "make-admin",
                                            label: "Make admin",
                                            onSelect: () => setRosterConfirm({ kind: "make-admin", row: p }),
                                          },
                                      {
                                        id: "remove",
                                        label: "Remove participant",
                                        tone: "danger",
                                        onSelect: () => setRosterConfirm({ kind: "remove", row: p }),
                                      },
                                    ]}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </section>
        ) : null}

        {tab === "maps" && eventId ? <VenueMapEditor eventId={eventId} rooms={rooms} /> : null}

        {tab === "announcements" && eventId ? (
          <AnnouncementComposer eventId={eventId} sessions={sessions.map((s) => ({ id: s.id, title: s.title }))} />
        ) : null}

        {tab === "ops" && eventId ? <OpsInboxPanel eventId={eventId} /> : null}
        {tab === "recap" && eventId ? <RecapPanel eventId={eventId} /> : null}

        {tab === "features" ? (
          <section>
            <h2 style={{ marginTop: 0 }}>Features</h2>
            <p className="help-text">
              Turn capabilities on or off for attendees. Existing data is preserved when a feature is disabled.
            </p>
            <div style={{ marginBottom: 16 }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => setAskAssistant((v) => !v)}
              >
                {askAssistant ? "Hide assistant" : `Ask the ${ASSISTANT_COPY.organizer.name.toLowerCase()}`}
              </button>
            </div>
            {askAssistant && eventId ? (
              <div style={{ marginBottom: 20 }}>
                <SetupCopilotChat
                  mode="settings"
                  eventId={eventId}
                  organizationId={event?.organizationId}
                  compact
                  onFormChange={(form) => {
                    setFeatureOverrides(form.featureOverrides);
                    setFeaturesDirty(true);
                  }}
                  onFeaturesApplied={(overrides) => {
                    setFeatureOverrides(overrides);
                    setFeaturesDirty(false);
                    setMessage("Feature settings updated");
                  }}
                />
              </div>
            ) : null}
            <FeatureConfigPanel
              overrides={featureOverrides}
              onChange={(next) => {
                setFeatureOverrides(next);
                setFeaturesDirty(true);
              }}
              confirmOff
              showPresets
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
              <button
                type="button"
                className="button"
                disabled={!featuresDirty || featuresSaving}
                onClick={() => {
                  void (async () => {
                    setFeaturesSaving(true);
                    setError(null);
                    try {
                      await organizerFetch("/event/features", eventId, {
                        method: "PUT",
                        body: JSON.stringify({ overrides: featureOverrides }),
                      });
                      setFeaturesDirty(false);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not save features");
                    } finally {
                      setFeaturesSaving(false);
                    }
                  })();
                }}
              >
                {featuresSaving ? "Saving…" : "Save features"}
              </button>
              {featuresDirty ? <span className="help-text">Unsaved changes</span> : null}
            </div>
            {eventId ? <EventFaqEditor eventId={eventId} /> : null}
            {eventId ? <AssistantStartersEditor eventId={eventId} /> : null}
          </section>
        ) : null}
        </div>

        {/* F2 — event settings, relocated into a SlideOver (progressive
            disclosure): the one settings surface, shared with the attendee
            dashboard's "Event settings" entry point via ?settings=1. */}
        {event ? (
          <EventSettingsSlideOver
            key={event.id}
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            eventId={eventId}
            event={event}
            onSaved={refresh}
          />
        ) : null}

        {/* INV-1 — roster actions all confirm first; server rejections
            (owner-only rules, self-removal) surface as the inline roster
            error line, never alert(). */}
        <ConfirmDialog
          open={rosterConfirm != null}
          title={
            rosterConfirm?.kind === "remove"
              ? `Remove ${rosterConfirm.row.name}?`
              : rosterConfirm?.kind === "make-admin"
                ? `Make ${rosterConfirm.row.name} an admin?`
                : "Remove admin access?"
          }
          body={
            rosterConfirm?.kind === "remove"
              ? `${rosterConfirm.row.name} (${rosterConfirm.row.email}) will be taken off the roster and lose access to this event. Removing keeps their data for 30 days.`
              : rosterConfirm?.kind === "make-admin"
                ? `${rosterConfirm.row.name} (${rosterConfirm.row.email}) will be able to manage this event — program, invites, and roster.`
                : `${rosterConfirm?.row.name ?? ""} will become a regular participant.`
          }
          confirmLabel={
            rosterConfirm?.kind === "remove"
              ? "Remove participant"
              : rosterConfirm?.kind === "make-admin"
                ? "Make admin"
                : "Remove admin"
          }
          tone={rosterConfirm?.kind === "remove" ? "danger" : "default"}
          busy={rosterBusy}
          onCancel={() => setRosterConfirm(null)}
          onConfirm={async () => {
            if (!rosterConfirm) return;
            setRosterBusy(true);
            setRosterError(null);
            try {
              const { kind, row } = rosterConfirm;
              if (kind === "remove") {
                await organizerFetch(`/attendees/${row.id}`, eventId, { method: "DELETE" });
              } else {
                await organizerFetch(`/attendees/${row.id}/${kind}`, eventId, {
                  method: "POST",
                  body: "{}",
                });
              }
              setRosterConfirm(null);
              await refreshRoster();
            } catch (err) {
              setRosterConfirm(null);
              setRosterError(err instanceof Error ? err.message : "Roster update failed");
            } finally {
              setRosterBusy(false);
            }
          }}
        />

        <ConfirmDialog
          open={publishConfirm}
          title="Publish with no sessions?"
          body="This event has no sessions yet. Attendees will see an empty schedule. Publish anyway?"
          confirmLabel="Publish anyway"
          tone="default"
          busy={busy}
          onCancel={() => setPublishConfirm(false)}
          onConfirm={async () => {
            await runStatus("/event/publish");
            setPublishConfirm(false);
          }}
        />
      </OrganizerShell>
    </>
  );
}
