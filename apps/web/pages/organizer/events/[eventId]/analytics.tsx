/**
 * Phase 5 — Organizer analytics dashboard (ingests engagement points).
 */

import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
import { brand } from "@event-app/config";
import { OrganizerShell } from "../../../../components/OrganizerShell";
import { apiFetch } from "../../../../lib/api";

type Analytics = {
  eventId: string;
  eventName: string;
  headline: {
    adoptionRate: number;
    adoptionCount: number;
    registrants: number;
    checkInRate: number;
    checkIns: number;
    directoryOptInRate: number;
    directoryOptIns: number;
    totalEngagementPoints: number;
  };
  registrationsOverTime: { day: string; count: number }[];
  sessionPopularity: {
    sessionId: string;
    title: string;
    joins: number;
    likes: number;
    qaThreads: number;
    polls: number;
    feedbackCount: number;
    avgFeedback: number | null;
  }[];
  volume: { messages: number; meetings: number; pollVotes: number; qaUpvotes: number };
};

type SeriesYoY = {
  seriesId: string;
  seriesName: string;
  editions: {
    eventId: string;
    name: string;
    startDate: string;
    registrants: number;
    checkIns: number;
    checkInRate: number;
    totalEngagementPoints: number;
  }[];
};

function pct(n: number) {
  return `${Math.round(n * 1000) / 10}%`;
}

export default function EventAnalyticsPage() {
  const router = useRouter();
  const eventId = String(router.query.eventId || "");
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Analytics | null>(null);
  const [series, setSeries] = useState<SeriesYoY | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setToken(window.localStorage.getItem("token") || "session");
    } catch {
      setToken("session");
    }
  }, []);

  const load = useCallback(async () => {
    if (!token || !eventId) return;
    setError(null);
    try {
      const dash = await apiFetch<Analytics>(`/analytics/event/${eventId}`, {}, token);
      setData(dash);
      try {
        const event = await apiFetch<{ seriesId?: string | null }>("/event", { headers: { "x-event-id": eventId } }, token);
        if (event.seriesId) {
          const yoy = await apiFetch<SeriesYoY>(`/analytics/series/${event.seriesId}`, {}, token);
          setSeries(yoy);
        }
      } catch {
        setSeries(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load analytics");
      setData(null);
    }
  }, [token, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!eventId) return <main style={{ padding: 24 }}>Missing event id.</main>;

  return (
    <>
      <Head>
        <title>{`Analytics — ${data?.eventName || "Event"} — ${brand.productName}`}</title>
      </Head>
      <OrganizerShell active="analytics" eventId={eventId} eventName={data?.eventName}>
        <h1 style={{ margin: "0 0 4px", font: "var(--text-h1)" }}>Analytics</h1>
        <p className="help-text" style={{ marginTop: 0 }}>
          Engagement points feed these numbers — no public leaderboard unless you enable it.
        </p>
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        {!data && !error ? <p className="help-text">Loading…</p> : null}

        {data ? (
          <>
            <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", margin: "20px 0" }}>
              <div>
                <div className="help-text">Adoption rate</div>
                <strong style={{ fontSize: 28 }}>{pct(data.headline.adoptionRate)}</strong>
                <div className="help-text">
                  {data.headline.adoptionCount}/{data.headline.registrants} activated
                </div>
              </div>
              <div>
                <div className="help-text">Check-in rate</div>
                <strong style={{ fontSize: 28 }}>{pct(data.headline.checkInRate)}</strong>
                <div className="help-text">
                  {data.headline.checkIns}/{data.headline.registrants}
                </div>
              </div>
              <div>
                <div className="help-text">Directory opt-in</div>
                <strong style={{ fontSize: 28 }}>{pct(data.headline.directoryOptInRate)}</strong>
              </div>
              <div>
                <div className="help-text">Engagement points</div>
                <strong style={{ fontSize: 28 }}>{data.headline.totalEngagementPoints}</strong>
              </div>
            </section>

            <p className="help-text">
              Volume: {data.volume.messages} messages · {data.volume.meetings} meetings · {data.volume.pollVotes} poll
              votes · {data.volume.qaUpvotes} Q&amp;A upvotes
            </p>

            <p>
              <a
                className="button secondary"
                href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/analytics/event/${eventId}?format=csv`}
                onClick={(e) => {
                  e.preventDefault();
                  void (async () => {
                    const res = await fetch(
                      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/analytics/event/${eventId}?format=csv`,
                      { credentials: "include", headers: { Authorization: token && token !== "session" ? `Bearer ${token}` : "" } },
                    );
                    const blob = await res.blob();
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `analytics-${eventId}.csv`;
                    a.click();
                  })();
                }}
              >
                Download session CSV
              </a>
            </p>

            <h2>Registrations over time</h2>
            {data.registrationsOverTime.length === 0 ? (
              <p className="help-text">No registrations yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0 }}>
                {data.registrationsOverTime.map((r) => (
                  <li key={r.day} style={{ display: "flex", gap: 12, padding: "4px 0" }}>
                    <span style={{ width: 110 }}>{r.day}</span>
                    <span
                      style={{
                        display: "inline-block",
                        height: 12,
                        width: Math.max(8, r.count * 12),
                        background: "var(--accent, #2F6FED)",
                        borderRadius: 2,
                        alignSelf: "center",
                      }}
                    />
                    <span className="help-text">{r.count}</span>
                  </li>
                ))}
              </ul>
            )}

            <h2>Session popularity</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: 8 }}>Session</th>
                    <th style={{ padding: 8 }}>Joins</th>
                    <th style={{ padding: 8 }}>Likes</th>
                    <th style={{ padding: 8 }}>Q&amp;A</th>
                    <th style={{ padding: 8 }}>Polls</th>
                    <th style={{ padding: 8 }}>Feedback</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessionPopularity.map((s) => (
                    <tr key={s.sessionId} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: 8 }}>{s.title}</td>
                      <td style={{ padding: 8 }}>{s.joins}</td>
                      <td style={{ padding: 8 }}>{s.likes}</td>
                      <td style={{ padding: 8 }}>{s.qaThreads}</td>
                      <td style={{ padding: 8 }}>{s.polls}</td>
                      <td style={{ padding: 8 }}>
                        {s.feedbackCount}
                        {s.avgFeedback != null ? ` (avg ${s.avgFeedback.toFixed(1)})` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {series && series.editions.length > 1 ? (
              <>
                <h2>Year-over-year · {series.seriesName}</h2>
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {series.editions.map((ed) => (
                    <li key={ed.eventId} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                      <strong>{ed.name}</strong>
                      <span className="help-text">
                        {" "}
                        · {new Date(ed.startDate).getFullYear()} · {ed.registrants} registered · check-in{" "}
                        {pct(ed.checkInRate)} · {ed.totalEngagementPoints} pts
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : null}
      </OrganizerShell>
    </>
  );
}
