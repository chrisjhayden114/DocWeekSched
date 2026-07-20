/**
 * Phase 5 — Staff QR check-in scanner with offline auto-sync.
 * QR payload = membership.checkInCode (never invent a separate code).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { OrganizerShell } from "../../../../components/OrganizerShell";
import { apiFetch } from "../../../../lib/api";

type RosterAttendee = {
  userId: string;
  name: string;
  email: string;
  checkInCode: string;
  checkedIn: boolean;
  checkedInAt: string | null;
};

type PendingScan = {
  clientMutationId: string;
  checkInCode: string;
  queuedAt: string;
};

const CACHE_KEY = (eventId: string) => `checkin-roster:${eventId}`;
const QUEUE_KEY = (eventId: string) => `checkin-queue:${eventId}`;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export default function CheckInScannerPage() {
  const router = useRouter();
  const eventId = String(router.query.eventId || "");
  const [token, setToken] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<RosterAttendee[]>([]);
  const [queue, setQueue] = useState<PendingScan[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const headers = useCallback(
    (extra?: RequestInit): RequestInit => ({
      ...extra,
      headers: {
        ...(extra?.headers || {}),
        "x-event-id": eventId,
        "Content-Type": "application/json",
      },
    }),
    [eventId],
  );

  useEffect(() => {
    try {
      setToken(window.localStorage.getItem("token"));
    } catch {
      setToken(null);
    }
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const refreshRoster = useCallback(async () => {
    if (!token || !eventId) return;
    try {
      const data = await apiFetch<{ attendees: RosterAttendee[] }>(
        "/checkins/roster",
        headers(),
        token,
      );
      setAttendees(data.attendees);
      saveJson(CACHE_KEY(eventId), data.attendees);
      setError(null);
    } catch (e) {
      const cached = loadJson<RosterAttendee[]>(CACHE_KEY(eventId), []);
      if (cached.length) {
        setAttendees(cached);
        setMessage("Showing cached roster (offline or unreachable).");
      } else {
        setError(e instanceof Error ? e.message : "Could not load roster");
      }
    }
  }, [token, eventId, headers]);

  useEffect(() => {
    if (!eventId || !token) return;
    setQueue(loadJson<PendingScan[]>(QUEUE_KEY(eventId), []));
    const cached = loadJson<RosterAttendee[]>(CACHE_KEY(eventId), []);
    if (cached.length) setAttendees(cached);
    void refreshRoster();
  }, [eventId, token, refreshRoster]);

  const flushQueue = useCallback(async () => {
    if (!token || !eventId || !online) return;
    const pending = loadJson<PendingScan[]>(QUEUE_KEY(eventId), []);
    if (!pending.length) return;
    setSyncing(true);
    const remaining: PendingScan[] = [];
    for (const item of pending) {
      try {
        await apiFetch(
          "/checkins/scan",
          headers({
            method: "POST",
            body: JSON.stringify({
              checkInCode: item.checkInCode,
              clientMutationId: item.clientMutationId,
              method: "QR_SCAN",
            }),
          }),
          token,
        );
      } catch {
        remaining.push(item);
      }
    }
    setQueue(remaining);
    saveJson(QUEUE_KEY(eventId), remaining);
    await refreshRoster();
    setSyncing(false);
    if (!remaining.length) setMessage("Offline queue synced.");
  }, [token, eventId, online, headers, refreshRoster]);

  useEffect(() => {
    if (online) void flushQueue();
  }, [online, flushQueue]);

  async function recordScan(checkInCode: string) {
    const code = checkInCode.trim();
    if (!code || !eventId) return;
    const clientMutationId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const local = attendees.find((a) => a.checkInCode === code);
    if (!local && !online) {
      setError("Code not in cached roster — connect once to refresh the list.");
      return;
    }

    if (!online || !token) {
      const next = [...queue, { clientMutationId, checkInCode: code, queuedAt: new Date().toISOString() }];
      setQueue(next);
      saveJson(QUEUE_KEY(eventId), next);
      setAttendees((prev) =>
        prev.map((a) => (a.checkInCode === code ? { ...a, checkedIn: true, checkedInAt: new Date().toISOString() } : a)),
      );
      setMessage(`Queued offline check-in for ${local?.name || code}`);
      setError(null);
      return;
    }

    try {
      await apiFetch(
        "/checkins/scan",
        headers({
          method: "POST",
          body: JSON.stringify({ checkInCode: code, clientMutationId, method: "QR_SCAN" }),
        }),
        token,
      );
      setMessage(`Checked in ${local?.name || code}`);
      setError(null);
      await refreshRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        // BarcodeDetector when available
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => {
          detect: (s: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
        } }).BarcodeDetector;
        if (BD && videoRef.current) {
          const detector = new BD({ formats: ["qr_code"] });
          const tick = async () => {
            if (cancelled || !videoRef.current) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes[0]?.rawValue) {
                await recordScan(codes[0].rawValue);
              }
            } catch {
              /* ignore frame errors */
            }
            if (!cancelled) requestAnimationFrame(() => void tick());
          };
          requestAnimationFrame(() => void tick());
        }
      } catch {
        setMessage("Camera unavailable — enter the check-in code manually (same as QR payload).");
      }
    }
    void startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const checkedInCount = attendees.filter((a) => a.checkedIn).length;

  if (!eventId) {
    return <main style={{ padding: 24 }}>Missing event id.</main>;
  }

  return (
    <OrganizerShell active="scanner" eventId={eventId}>
      <div style={{ maxWidth: 560 }}>
      <h1 style={{ marginTop: 0, font: "var(--text-h1)" }}>
        Check-in scanner
      </h1>
      <p className="help-text">
        Status: {online ? "Online" : "Offline"} · Roster {attendees.length} · Checked in {checkedInCount}
        {queue.length ? ` · Pending sync ${queue.length}` : ""}
        {syncing ? " · Syncing…" : ""}
      </p>
      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p role="alert" style={{ color: "var(--danger-700, #C22F2F)" }}>
          {error}
        </p>
      ) : null}

      <video
        ref={videoRef}
        playsInline
        muted
        style={{ width: "100%", maxHeight: 280, background: "#111", borderRadius: 8 }}
      />

      <form
        style={{ display: "flex", gap: 8, marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          void recordScan(manualCode);
          setManualCode("");
        }}
      >
        <input
          className="input"
          style={{ flex: 1 }}
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          placeholder="Paste or type check-in code (QR payload)"
          aria-label="Check-in code"
        />
        <button type="submit" className="button">
          Check in
        </button>
      </form>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button type="button" className="button secondary" onClick={() => void refreshRoster()}>
          Refresh roster
        </button>
        <button type="button" className="button secondary" disabled={!online || !queue.length} onClick={() => void flushQueue()}>
          Sync queue
        </button>
      </div>

      <ul style={{ listStyle: "none", padding: 0, marginTop: 16 }}>
        {attendees.slice(0, 40).map((a) => (
          <li
            key={a.userId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              padding: "8px 0",
              borderBottom: "1px solid var(--gray-200)",
            }}
          >
            <span>
              {a.name}
              <span className="help-text"> · {a.checkInCode.slice(0, 8)}…</span>
            </span>
            <span className="help-text">{a.checkedIn ? "✓ In" : "—"}</span>
          </li>
        ))}
      </ul>
      </div>
    </OrganizerShell>
  );
}
