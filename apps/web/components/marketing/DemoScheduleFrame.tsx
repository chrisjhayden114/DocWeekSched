/**
 * Browser-framed schedule preview for the marketing hero.
 * Static demo-like rows — no API calls; mirrors agenda anatomy for credibility.
 */

import { brand } from "@event-app/config";

const ROWS = [
  {
    time: "9:00 AM",
    title: "Opening keynote: Designing calm learning days",
    meta: "9:00–10:00 AM · Hall A · Keynote",
    track: "var(--track-1)",
    papers: 0,
  },
  {
    time: "10:30 AM",
    title: "Workshop block A: Reading conferences",
    meta: "10:30–12:00 · Room 12 · Workshops",
    track: "var(--track-2)",
    papers: 0,
  },
  {
    time: "10:30 AM",
    title: "Workshop block A: Small-group math routines",
    meta: "10:30–12:00 · Room 14 · Workshops",
    track: "var(--track-3)",
    papers: 0,
  },
  {
    time: "1:00 PM",
    title: "Practice showcase: What worked this year",
    meta: "1:00–2:30 PM · Library · Practice",
    track: "var(--track-4)",
    papers: 2,
  },
] as const;

export function DemoScheduleFrame() {
  return (
    <div className="mkt-browser" aria-hidden>
      <div className="mkt-browser-chrome">
        <span className="mkt-browser-dot" />
        <span className="mkt-browser-dot" />
        <span className="mkt-browser-dot" />
        <span className="mkt-browser-url">/e/{brand.demoEventSlug}</span>
      </div>
      <div className="mkt-browser-body">
        <div className="mkt-browser-agenda-bar">
          <span className="mkt-browser-seg is-active">Event Schedule</span>
          <span className="mkt-browser-seg">My Schedule</span>
        </div>
        <p className="mkt-browser-day">
          <strong>Monday</strong>, July 20
        </p>
        <div className="mkt-browser-rows">
          {ROWS.map((row) => (
            <article
              key={row.title}
              className="schedule-event schedule-event--tinted mkt-browser-row"
              style={{ ["--track-color" as string]: row.track }}
            >
              <div className="schedule-event-main">
                <h4 className="schedule-event-title">
                  <span className="schedule-event-title-text">{row.title}</span>
                  {row.papers > 0 ? (
                    <span className="schedule-option-chip">{row.papers} papers</span>
                  ) : null}
                </h4>
                <p className="schedule-event-meta">{row.meta}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
