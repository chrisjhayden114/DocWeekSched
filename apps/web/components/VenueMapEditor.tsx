import { FormEvent, useCallback, useEffect, useState } from "react";
import { FloorPlanCanvas, type FloorPlanPin } from "./FloorPlanCanvas";
import { UploadDropzone } from "./UploadDropzone";
import { organizerFetch } from "../lib/organizerApi";

type Room = { id: string; name: string };

type VenueMapRow = {
  id: string;
  name: string;
  imageUrl: string;
  sortOrder: number;
  pins: FloorPlanPin[];
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read file"));
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

type Props = {
  eventId: string;
  rooms: Room[];
};

/**
 * Organizer venue map editor — upload floor plans, drop/drag pins, link rooms.
 */
export function VenueMapEditor({ eventId, rooms }: Props) {
  const [maps, setMaps] = useState<VenueMapRow[]>([]);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [newMapName, setNewMapName] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [dropMode, setDropMode] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [pinLabel, setPinLabel] = useState("");
  const [pinRoomId, setPinRoomId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeMap = maps.find((m) => m.id === activeMapId) || null;
  const selectedPin = activeMap?.pins.find((p) => p.id === selectedPinId) || null;

  const refresh = useCallback(async () => {
    if (!eventId) return;
    const list = await organizerFetch<VenueMapRow[]>("/event/maps/", eventId);
    setMaps(list);
    setActiveMapId((cur) => cur || list[0]?.id || null);
  }, [eventId]);

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed to load maps"));
  }, [refresh]);

  useEffect(() => {
    if (selectedPin) {
      setPinLabel(selectedPin.roomLabel);
      setPinRoomId(selectedPin.linkedRoomId || "");
    }
  }, [selectedPin]);

  async function createMap(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !newMapName.trim() || !pendingImage) return;
    setBusy(true);
    setError(null);
    try {
      const created = await organizerFetch<VenueMapRow>("/event/maps/", eventId, {
        method: "POST",
        body: JSON.stringify({ name: newMapName.trim(), imageUrl: pendingImage }),
      });
      setNewMapName("");
      setPendingImage(null);
      await refresh();
      setActiveMapId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create map");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMap(mapId: string) {
    if (!eventId || !confirm("Delete this floor plan and all its pins?")) return;
    await organizerFetch(`/event/maps/${mapId}`, eventId, { method: "DELETE", body: "{}" });
    setActiveMapId(null);
    await refresh();
  }

  async function dropPin(x: number, y: number) {
    if (!eventId || !activeMapId) return;
    setBusy(true);
    try {
      const pin = await organizerFetch<FloorPlanPin>(`/event/maps/${activeMapId}/pins`, eventId, {
        method: "POST",
        body: JSON.stringify({ roomLabel: "New pin", x, y, linkedRoomId: null }),
      });
      setDropMode(false);
      setSelectedPinId(pin.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add pin");
    } finally {
      setBusy(false);
    }
  }

  async function movePin(pinId: string, x: number, y: number) {
    if (!eventId || !activeMapId) return;
    setMaps((prev) =>
      prev.map((m) =>
        m.id !== activeMapId
          ? m
          : { ...m, pins: m.pins.map((p) => (p.id === pinId ? { ...p, x, y } : p)) },
      ),
    );
    try {
      await organizerFetch(`/event/maps/${activeMapId}/pins/${pinId}`, eventId, {
        method: "PUT",
        body: JSON.stringify({ x, y }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move pin");
      await refresh();
    }
  }

  async function savePinMeta(e: FormEvent) {
    e.preventDefault();
    if (!eventId || !activeMapId || !selectedPinId || !pinLabel.trim()) return;
    setBusy(true);
    try {
      await organizerFetch(`/event/maps/${activeMapId}/pins/${selectedPinId}`, eventId, {
        method: "PUT",
        body: JSON.stringify({
          roomLabel: pinLabel.trim(),
          linkedRoomId: pinRoomId || null,
        }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update pin");
    } finally {
      setBusy(false);
    }
  }

  async function deletePin() {
    if (!eventId || !activeMapId || !selectedPinId) return;
    await organizerFetch(`/event/maps/${activeMapId}/pins/${selectedPinId}`, eventId, {
      method: "DELETE",
      body: "{}",
    });
    setSelectedPinId(null);
    await refresh();
  }

  return (
    <section style={{ display: "grid", gap: 20 }}>
      <div>
        <h2 style={{ marginTop: 0 }}>Venue maps</h2>
        <p className="help-text">
          Upload floor plans, click to drop pins, label them, and optionally link each pin to a Room. Attendees see
          maps when the Venue maps feature is on.
        </p>
      </div>

      {error ? <p style={{ color: "#b42318" }}>{error}</p> : null}

      <form onSubmit={createMap} style={{ display: "grid", gap: 12, maxWidth: 480 }}>
        <label>
          New map name
          <input
            className="input"
            value={newMapName}
            onChange={(e) => setNewMapName(e.target.value)}
            placeholder="e.g. Building A — Floor 1"
            required
          />
        </label>
        <UploadDropzone
          label="Floor plan image"
          accept="image/jpeg,image/png,image/webp,image/gif"
          maxBytes={8_000_000}
          onFile={async (file) => {
            setPendingImage(await fileToDataUrl(file));
          }}
        />
        {pendingImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pendingImage} alt="" style={{ maxWidth: 240, borderRadius: 8 }} />
        ) : null}
        <button className="button" type="submit" disabled={busy || !pendingImage || !newMapName.trim()}>
          Add map
        </button>
      </form>

      {maps.length > 0 ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
      ) : (
        <p className="help-text">No maps yet.</p>
      )}

      {activeMap ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <strong>{activeMap.name}</strong>
            <button
              type="button"
              className={dropMode ? "button" : "button secondary"}
              onClick={() => setDropMode((v) => !v)}
            >
              {dropMode ? "Click map to place pin…" : "Add pin"}
            </button>
            <button type="button" className="button secondary" onClick={() => void deleteMap(activeMap.id)}>
              Delete map
            </button>
          </div>

          <FloorPlanCanvas
            imageUrl={activeMap.imageUrl}
            pins={activeMap.pins}
            selectedPinId={selectedPinId}
            dropMode={dropMode}
            onDropPin={(x, y) => void dropPin(x, y)}
            onMovePin={(id, x, y) => void movePin(id, x, y)}
            onSelectPin={(pin) => setSelectedPinId(pin.id)}
          />

          {selectedPin ? (
            <form onSubmit={savePinMeta} className="card" style={{ display: "grid", gap: 10, maxWidth: 420 }}>
              <h3 style={{ margin: 0 }}>Edit pin</h3>
              <label>
                Label
                <input className="input" value={pinLabel} onChange={(e) => setPinLabel(e.target.value)} required />
              </label>
              <label>
                Linked room
                <select className="input" value={pinRoomId} onChange={(e) => setPinRoomId(e.target.value)}>
                  <option value="">None</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="button" type="submit" disabled={busy}>
                  Save pin
                </button>
                <button type="button" className="button secondary" onClick={() => void deletePin()}>
                  Delete pin
                </button>
              </div>
            </form>
          ) : (
            <p className="help-text">Select a pin to edit label and room link, or drag to reposition.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
