import { sessionFormatLabel, type PresenterRelatedSession } from "@event-app/shared";
import { formatEventTimeRange } from "../lib/dateFormat";
import { SAME_TIME_AS_YOURS } from "../lib/presenterRoster";

function formatChipLabel(session: Pick<PresenterRelatedSession, "format" | "trackName">): string | null {
  const label = sessionFormatLabel(session.format);
  if (!label) return null;
  const track = session.trackName?.trim() ?? "";
  if (track && label.toLowerCase() === track.toLowerCase()) return null;
  return label;
}

export function RelatedSessionCard({
  session,
  eventSlug,
  timezone,
}: {
  session: PresenterRelatedSession;
  eventSlug: string;
  timezone: string;
}) {
  const formatLabel = formatChipLabel(session);
  const trackName = session.trackName?.trim() ?? "";
  const speakers = session.speakers.join(", ");
  const time = formatEventTimeRange(session.startsAt, session.endsAt, timezone);
  const room = session.roomName?.trim() ?? "";
  const meta = [time, room].filter((part) => part.length > 0).join(" · ");

  return (
    <div className="card presenter-related-card">
      <div className="presenter-related-title-row">
        <a
          className="presenter-related-title"
          href={`/e/${encodeURIComponent(eventSlug)}?session=${encodeURIComponent(session.id)}`}
        >
          {session.title}
        </a>
        {session.overlapsYours ? (
          <span className="session-peek-format presenter-related-same-time">{SAME_TIME_AS_YOURS}</span>
        ) : null}
      </div>
      {session.speakers.length > 0 ? <p className="text-meta presenter-related-presenters">{speakers}</p> : null}
      {meta ? <p className="text-meta presenter-related-meta">{meta}</p> : null}
      {trackName || formatLabel ? (
        <p className="session-peek-track-row presenter-chip-row presenter-related-chips">
          {trackName ? (
            <span
              className="session-peek-track"
              style={session.trackColor ? { ["--track-color" as string]: session.trackColor } : undefined}
            >
              <span className="session-peek-track-dot" aria-hidden />
              {trackName}
            </span>
          ) : null}
          {formatLabel ? <span className="session-peek-format">{formatLabel}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
