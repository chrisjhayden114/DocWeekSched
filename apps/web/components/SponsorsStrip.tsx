/**
 * Phase 5 — Attendee sponsor strip (tier / sort order).
 */

import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type Sponsor = {
  id: string;
  name: string;
  logoUrl?: string | null;
  url?: string | null;
  tier: string;
  boothLabel?: string | null;
  description?: string | null;
};

export function SponsorsStrip({
  token,
  eventId,
  enabled,
}: {
  token: string;
  eventId: string;
  enabled: boolean;
}) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);

  useEffect(() => {
    if (!enabled || !token || !eventId) {
      setSponsors([]);
      return;
    }
    let cancelled = false;
    apiFetch<Sponsor[]>(
      "/sponsors",
      { headers: { "x-event-id": eventId } },
      token,
    )
      .then((rows) => {
        if (!cancelled) setSponsors(rows);
      })
      .catch(() => {
        if (!cancelled) setSponsors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, token, eventId]);

  if (!enabled || sponsors.length === 0) return null;

  const byTier = new Map<string, Sponsor[]>();
  for (const s of sponsors) {
    const list = byTier.get(s.tier) || [];
    list.push(s);
    byTier.set(s.tier, list);
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Sponsors</h3>
      {[...byTier.entries()].map(([tier, rows]) => (
        <div key={tier} style={{ marginBottom: 12 }}>
          <div className="help-text" style={{ marginBottom: 6 }}>
            {tier}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            {rows.map((s) => {
              const inner = s.logoUrl ? (
                <img src={s.logoUrl} alt={s.name} style={{ maxHeight: 48, maxWidth: 140, objectFit: "contain" }} />
              ) : (
                <strong>{s.name}</strong>
              );
              return s.url ? (
                <a key={s.id} href={s.url} target="_blank" rel="noreferrer" title={s.description || s.name}>
                  {inner}
                </a>
              ) : (
                <span key={s.id} title={s.description || undefined}>
                  {inner}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
