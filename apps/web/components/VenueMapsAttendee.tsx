import { useCallback, useEffect, useMemo, useState } from "react";
import { FloorPlanCanvas, type FloorPlanPin } from "./FloorPlanCanvas";
import { apiFetch } from "../lib/api";

type VenueMapRow = {
  id: string;
  name: string;
  imageUrl: string;
  sortOrder: number;
  pins: FloorPlanPin[];
};

type MapDetail = VenueMapRow & {
  sessionsToday?: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    roomId: string | null;
  }[];
};

type Props = {
  eventId: string | null;
  token: string | null;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  focusMapId?: string | null;
  focusPinId?: string | null;
  displayTimezone?: string;
};

function formatTime(iso: string, timeZone: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

/**
 * Attendee Maps section — tappable pins with room + today's sessions; pinch/scroll zoom.
 */
export function VenueMapsAttendee({
  eventId,
  token,
  withEventHeaders,
  focusMapId,
  focusPinId,
  displayTimezone = "UTC",
}: Props) {
  const [maps, setMaps] = useState<VenueMapRow[]>([]);
  const [activeMapId, setActiveMapId] = useState<string | null>(focusMapId || null);
  const [detail, setDetail] = useState<MapDetail | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(focusPinId || null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMaps = useCallback(async () => {
    if (!token || !eventId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await apiFetch<VenueMapRow[]>("/event/maps/", withEventHeaders(), token);
      setMaps(list);
      setActiveMapId((cur) => focusMapId || cur || list[0]?.id || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Maps unavailable");
      setMaps([]);
    } finally {
      setLoading(false);
    }
  }, [token, eventId, withEventHeaders, focusMapId]);

  useEffect(() => {
    void loadMaps();
  }, [loadMaps]);

  useEffect(() => {
    if (focusMapId) setActiveMapId(focusMapId);
    if (focusPinId) setSelectedPinId(focusPinId);
  }, [focusMapId, focusPinId]);

  useEffect(() => {
    if (!token || !eventId || !activeMapId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const d = await apiFetch<MapDetail>(`/event/maps/${activeMapId}`, withEventHeaders(), token);
        if (!cancelled) setDetail(d);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load map");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, eventId, activeMapId, withEventHeaders]);

  const selectedPin = detail?.pins.find((p) => p.id === selectedPinId) || null;
  const sessionsForPin = useMemo(() => {
    if (!selectedPin?.linkedRoomId || !detail?.sessionsToday) return [];
    return detail.sessionsToday.filter((s) => s.roomId === selectedPin.linkedRoomId);
  }, [selectedPin, detail]);

  if (loading) return <p className="help-text">Loading maps…</p>;
  if (error) return <p style={{ color: "#b42318" }}>{error}</p>;
  if (maps.length === 0) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Maps</h2>
        <p className="help-text">No venue maps have been published for this event yet.</p>
      </div>
    );
  }

  return (
    <div className="venue-maps-attendee">
      <h2 style={{ marginTop: 0 }}>Maps</h2>
      <p className="help-text">Pinch or scroll to zoom, drag to pan. Tap a pin for room details.</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {maps.map((m) => (
          <button
            key={m.id}
            type="button"
            className={m.id === activeMapId ? "button" : "button secondary"}
            onClick={() => {
              setActiveMapId(m.id);
              setSelectedPinId(null);
            }}
          >
            {m.name}
          </button>
        ))}
      </div>

      {detail ? (
        <FloorPlanCanvas
          imageUrl={detail.imageUrl}
          pins={detail.pins}
          focusPinId={focusPinId && focusPinId === selectedPinId ? focusPinId : null}
          selectedPinId={selectedPinId}
          onSelectPin={(pin) => setSelectedPinId(pin.id)}
        />
      ) : null}

      {selectedPin ? (
        <div className="card floor-plan-pin-sheet" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>{selectedPin.linkedRoom?.name || selectedPin.roomLabel}</h3>
          {selectedPin.linkedRoom && selectedPin.linkedRoom.name !== selectedPin.roomLabel ? (
            <p className="help-text" style={{ marginTop: 0 }}>
              Pin: {selectedPin.roomLabel}
            </p>
          ) : null}
          {sessionsForPin.length === 0 ? (
            <p className="help-text">No sessions in this room today.</p>
          ) : (
            <ul className="floor-plan-session-list">
              {sessionsForPin.map((s) => (
                <li key={s.id}>
                  <a href={`/session/${s.id}`}>{s.title}</a>
                  <span className="help-text">
                    {" "}
                    · {formatTime(s.startsAt, displayTimezone)}–{formatTime(s.endsAt, displayTimezone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="help-text" style={{ marginTop: 12 }}>
          Tap a pin to see the room and today’s sessions.
        </p>
      )}
    </div>
  );
}

/** Build roomId → { mapId, pinId } for View on map links. */
export function roomPinIndex(maps: VenueMapRow[]): Record<string, { mapId: string; pinId: string }> {
  const out: Record<string, { mapId: string; pinId: string }> = {};
  for (const m of maps) {
    for (const p of m.pins) {
      if (p.linkedRoomId && !out[p.linkedRoomId]) {
        out[p.linkedRoomId] = { mapId: m.id, pinId: p.id };
      }
    }
  }
  return out;
}
