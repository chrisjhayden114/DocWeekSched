/**
 * H5 (DESIGN_PHASE_H D5 + D7) — pick-one timeslot accordion for
 * breakout-style events, behind the breakout_style flag.
 *
 * The Event Schedule List view becomes a slot-by-slot chooser: the current
 * slot is open, choosing collapses it to your choice, and everything stays
 * calm — no recommendations, no seat-count pressure ("Full — waitlist"
 * stays factual). Single-session slots (welcome / lunch / breaks) render
 * as plain minimal rows with no accordion chrome.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultOpenSlotKey,
  type BreakoutSlot,
  type BreakoutSlotSession,
} from "../lib/breakoutSlots";
import {
  pickOneRowIsAmber,
  sessionDecisionAmberClass,
  sessionTrackTintClass,
  type AgendaScheduleView,
} from "../lib/trackColors";

export type BreakoutBoardSession = BreakoutSlotSession & {
  location?: string | null;
  room?: { id: string; name: string } | null;
  speakers?: string | null;
  speaker?: { name: string } | null;
  trackId?: string | null;
  track?: { color?: string } | null;
  inPersonCapacity?: number | null;
  attendances?: { status: "JOINING" | "NOT_JOINING"; joinMode?: string | null }[];
};

export type BreakoutSlotBoardProps<T extends BreakoutBoardSession> = {
  slots: BreakoutSlot<T>[];
  joinBusy: boolean;
  /**
   * Resolve true = joined (the board collapses the slot and moves on),
   * false = failure (inline error), void/undefined = nothing happened
   * (e.g. replace-confirm canceled).
   */
  onJoin: (sessionId: string, slot: BreakoutSlot<T>) => Promise<boolean | void> | void;
  /** Fired when [Change] re-expands an already-chosen slot. */
  onChange?: (slot: BreakoutSlot<T>) => void;
  onOpenSession: (sessionId: string) => void;
  trackColor: (session: T) => string;
  timeZone: string;
  /**
   * UI-2 — Event Schedule keeps amber on the slot row in both Choose and
   * Change states. My Schedule collapses a chosen slot to the session's
   * track tint (the "Your 10:00 AM" card).
   */
  agendaView?: AgendaScheduleView;
  /** Event-level untracked wash — lunch / no-track rows share card anatomy. */
  untrackedTint?: string | null;
};

const FILTER_THRESHOLD = 8;

function slotTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone });
}

function firstSpeaker(session: BreakoutBoardSession): string | null {
  const raw = session.speakers || session.speaker?.name || "";
  const first = raw.split(/[,;]/)[0]?.trim();
  return first || null;
}

function roomLabel(session: BreakoutBoardSession): string | null {
  return session.room?.name || session.location || null;
}

/** Factual only — same rule the List rows use, no urgency styling. */
function isInPersonFull(session: BreakoutBoardSession): boolean {
  if (session.inPersonCapacity == null) return false;
  const joining = (session.attendances || []).filter((a) => a.status === "JOINING");
  const inPerson = joining.filter((a) => !a.joinMode || a.joinMode === "IN_PERSON").length;
  return inPerson >= session.inPersonCapacity;
}

function matchesFilter(session: BreakoutBoardSession, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [session.title, session.speakers, session.speaker?.name, roomLabel(session)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);
}

export function BreakoutSlotBoard<T extends BreakoutBoardSession>({
  slots,
  joinBusy,
  onJoin,
  onChange,
  onOpenSession,
  trackColor,
  timeZone,
  agendaView = "eventSchedule",
  untrackedTint = null,
}: BreakoutSlotBoardProps<T>) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const seededRef = useRef(false);

  // Seed the accordion once sessions arrive; after that the user (and
  // successful joins) drive it.
  useEffect(() => {
    if (seededRef.current || slots.length === 0) return;
    seededRef.current = true;
    setOpenKey(defaultOpenSlotKey(slots, new Date()));
  }, [slots]);

  useEffect(() => {
    setFilterText("");
    setError(null);
  }, [openKey]);

  const days = useMemo(() => {
    const out: { dayKey: string; dayLabel: string; slots: BreakoutSlot<T>[] }[] = [];
    for (const slot of slots) {
      const last = out[out.length - 1];
      if (last && last.dayKey === slot.dayKey) last.slots.push(slot);
      else out.push({ dayKey: slot.dayKey, dayLabel: slot.dayLabel, slots: [slot] });
    }
    return out;
  }, [slots]);

  if (slots.length === 0) return null;

  const handleJoin = async (sessionId: string, slot: BreakoutSlot<T>) => {
    setError(null);
    const ok = await onJoin(sessionId, slot);
    if (ok === false) {
      setError("Couldn't save — try again");
      return;
    }
    if (ok === true) {
      setOpenKey(
        defaultOpenSlotKey(
          slots.filter((s) => s.key !== slot.key),
          new Date(),
        ),
      );
    }
  };

  const renderOptionRow = (session: T, slot: BreakoutSlot<T>) => {
    const chosen = slot.chosenSessionId === session.id;
    const speaker = firstSpeaker(session);
    const room = roomLabel(session);
    return (
      <div
        key={session.id}
        className="breakout-option"
        style={{ ["--track-color" as string]: trackColor(session) }}
        role="button"
        tabIndex={0}
        onClick={() => onOpenSession(session.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenSession(session.id);
          }
        }}
      >
        <div className="breakout-option-main">
          <p className="breakout-option-title">
            <span>{session.title}</span>
            {isInPersonFull(session) ? <span className="schedule-option-chip">Full — waitlist</span> : null}
          </p>
          {room || speaker ? (
            <p className="breakout-option-meta">{[room, speaker].filter(Boolean).join(" · ")}</p>
          ) : null}
        </div>
        {chosen ? (
          <span className="breakout-option-chosen">Your choice ✓</span>
        ) : (
          <button
            type="button"
            className="button breakout-join"
            disabled={joinBusy}
            onClick={(e) => {
              e.stopPropagation();
              void handleJoin(session.id, slot);
            }}
          >
            Join
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="breakout-board">
      {days.map((day) => {
        const [weekday, ...restLabel] = day.dayLabel.split(", ");
        return (
          <section key={day.dayKey} className="schedule-day motion-stagger">
            <h3 className="schedule-day-heading">
              <strong>{weekday}</strong>
              {restLabel.length ? `, ${restLabel.join(", ")}` : null}
            </h3>
            {day.slots.map((slot) => {
              const start = slotTime(slot.startsAt, timeZone);
              const end = slot.endsAt ? slotTime(slot.endsAt, timeZone) : null;
              const open = openKey === slot.key;

              if (!slot.isChoice) {
                const only = slot.sessions[0]!;
                const joined = slot.chosenSessionId === only.id;
                const room = roomLabel(only);
                return (
                  <article
                    key={slot.key}
                    className={["schedule-event", "schedule-event--minimal", "breakout-minimal", sessionTrackTintClass(only.trackId, only.track?.color ?? untrackedTint)].filter(Boolean).join(" ")}
                    style={{ ["--track-color" as string]: trackColor(only) }}
                    onClick={() => onOpenSession(only.id)}
                  >
                    <div className="schedule-event-main">
                      <h4 className="schedule-event-title">
                        <span className="schedule-event-title-text">{only.title}</span>
                        {isInPersonFull(only) ? (
                          <span className="schedule-option-chip">Full — waitlist</span>
                        ) : null}
                      </h4>
                      <p className="schedule-event-meta">
                        {start}
                        {end ? `–${end}` : ""}
                        {room ? ` · ${room}` : ""}
                      </p>
                    </div>
                    <div className="schedule-event-side" onClick={(e) => e.stopPropagation()}>
                      {joined ? (
                        <span className="breakout-option-chosen">Joined ✓</span>
                      ) : (
                        <button
                          type="button"
                          className="button breakout-join"
                          disabled={joinBusy}
                          onClick={() => void handleJoin(only.id, slot)}
                        >
                          Join
                        </button>
                      )}
                    </div>
                  </article>
                );
              }

              const chosenSession = slot.chosenSessionId
                ? slot.sessions.find((s) => s.id === slot.chosenSessionId) ?? null
                : null;

              // My Schedule: collapse a chosen slot to the picked session's
              // track tint. Event Schedule never does this — the row stays
              // the decision control ("Change your session") with amber.
              if (agendaView === "mySchedule" && chosenSession && !open) {
                const room = roomLabel(chosenSession);
                return (
                  <article
                    key={slot.key}
                    className={["breakout-choice", sessionTrackTintClass(chosenSession.trackId, chosenSession.track?.color ?? untrackedTint)].filter(Boolean).join(" ")}
                    style={{ ["--track-color" as string]: trackColor(chosenSession) }}
                  >
                    <button
                      type="button"
                      className="breakout-choice-body"
                      onClick={() => onOpenSession(chosenSession.id)}
                    >
                      <span className="breakout-choice-label">Your {start}</span>
                      <span className="breakout-choice-title">
                        {chosenSession.title}
                        {room ? ` · ${room}` : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="breakout-change"
                      onClick={() => {
                        setOpenKey(slot.key);
                        onChange?.(slot);
                      }}
                    >
                      Change
                    </button>
                  </article>
                );
              }

              const visibleSessions = slot.sessions.filter((s) => matchesFilter(s, open ? filterText : ""));
              return (
                <section
                  key={slot.key}
                  className={["breakout-slot", open ? "is-open" : "", sessionDecisionAmberClass(pickOneRowIsAmber(Boolean(chosenSession), agendaView))].filter(Boolean).join(" ")}
                >
                  <button
                    type="button"
                    className="breakout-slot-header"
                    aria-expanded={open}
                    onClick={() => setOpenKey(open ? null : slot.key)}
                  >
                    <span className="breakout-slot-time">
                      {start}
                      {end ? `–${end}` : ""}
                    </span>
                    <span className="breakout-slot-label">
                      {chosenSession ? "Change your session" : "Choose your session"} ({slot.sessions.length}{" "}
                      options)
                    </span>
                    <span className="breakout-slot-caret" aria-hidden>
                      {open ? "▾" : "▸"}
                    </span>
                  </button>
                  {open ? (
                    <div className="breakout-slot-options">
                      {slot.sessions.length > FILTER_THRESHOLD ? (
                        <input
                          type="search"
                          className="breakout-filter"
                          placeholder="Filter by title, speaker, or room"
                          aria-label="Filter sessions in this timeslot"
                          value={filterText}
                          onChange={(e) => setFilterText(e.target.value)}
                        />
                      ) : null}
                      {error ? (
                        <p className="breakout-error" role="alert">
                          {error}
                        </p>
                      ) : null}
                      {visibleSessions.map((session) => renderOptionRow(session, slot))}
                      {visibleSessions.length === 0 ? (
                        <p className="breakout-empty">No sessions match — clear the filter to see all {slot.sessions.length}.</p>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
