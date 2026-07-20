import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type Suggestion = {
  id: string;
  suggestedUserId: string;
  rank: number;
  whyLine: string;
  draftIntro: string;
  proposedSlots: Array<{ startsAt: string; endsAt: string }> | null;
  batchKey: string;
  aiGenerated: boolean;
  user: {
    id: string;
    name: string | null;
    title: string | null;
    affiliation: string | null;
    researchInterests: string | null;
    photoUrl: string | null;
  };
};

type Meta = {
  enabled: boolean;
  directoryOptIn: boolean;
  matchMeEnabled: boolean;
  aiGeneratedLabel: string;
};

type Props = {
  eventId: string;
  token: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  onViewProfile?: (userId: string) => void;
  onDraftIntro: (payload: {
    conversationId: string;
    prefillBody: string;
    toUserName: string | null;
  }) => void;
};

export function MatchmakerPanel({
  eventId,
  token,
  withEventHeaders,
  onViewProfile,
  onDraftIntro,
}: Props) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [label, setLabel] = useState("AI-generated — review before publishing");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !eventId) return;
    try {
      const [m, s] = await Promise.all([
        apiFetch<Meta>("/ai/matchmaker/meta", withEventHeaders(), token),
        apiFetch<{ suggestions: Suggestion[]; aiGeneratedLabel?: string }>(
          "/ai/matchmaker/suggestions",
          withEventHeaders(),
          token,
        ).catch((): { suggestions: Suggestion[]; aiGeneratedLabel?: string } => ({ suggestions: [] })),
      ]);
      setMeta(m);
      setSuggestions(s.suggestions || []);
      if (s.aiGeneratedLabel) setLabel(s.aiGeneratedLabel);
      else if (m.aiGeneratedLabel) setLabel(m.aiGeneratedLabel);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load matchmaker");
    }
  }, [token, eventId, withEventHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleMatchMe(next: boolean) {
    setBusy(true);
    try {
      await apiFetch("/ai/matchmaker/me", withEventHeaders({
        method: "PUT",
        body: JSON.stringify({ matchMeEnabled: next }),
      }), token);
      setMeta((m) => (m ? { ...m, matchMeEnabled: next } : m));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update preference");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/ai/matchmaker/refresh", withEventHeaders({
        method: "POST",
        body: JSON.stringify({ batchKey: "week" }),
      }), token);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  async function draftIntro(suggestionId: string) {
    setDraftingId(suggestionId);
    setError(null);
    try {
      const res = await apiFetch<{
        conversationId: string;
        prefillBody: string;
        toUserName: string | null;
        autoSent: boolean;
      }>("/ai/matchmaker/draft-intro", withEventHeaders({
        method: "POST",
        body: JSON.stringify({ suggestionId }),
      }), token);
      if (res.autoSent) {
        setError("Unexpected auto-send — nothing should send without you pressing Send.");
        return;
      }
      onDraftIntro({
        conversationId: res.conversationId,
        prefillBody: res.prefillBody,
        toUserName: res.toUserName,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open draft");
    } finally {
      setDraftingId(null);
    }
  }

  if (meta && !meta.enabled) {
    return (
      <div className="card matchmaker-panel">
        <h2 className="text-display-sm" style={{ marginTop: 0 }}>
          People you should meet
        </h2>
        <p className="help-text">Matchmaker isn’t available for this event on your plan.</p>
      </div>
    );
  }

  return (
    <div className="card matchmaker-panel">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 className="text-display-sm" style={{ marginTop: 0, marginBottom: 6 }}>
            People you should meet
          </h2>
          <p className="help-text" style={{ marginTop: 0 }}>
            Interest-based suggestions. Drafts are labeled and never sent until you press Send.
          </p>
        </div>
        <label className="help-text" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={meta?.matchMeEnabled ?? true}
            disabled={busy || !meta?.directoryOptIn}
            onChange={(e) => void toggleMatchMe(e.target.checked)}
          />
          Match me
        </label>
      </div>

      {!meta?.directoryOptIn ? (
        <p className="help-text">
          Opt into the attendee directory in Profile to participate in matching (both directions).
        </p>
      ) : null}

      {meta && !meta.matchMeEnabled ? (
        <p className="help-text">Matching is muted. Turn “Match me” back on to receive new suggestions.</p>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" className="button" disabled={busy || !meta?.matchMeEnabled} onClick={() => void refresh()}>
          {busy ? "Working…" : "Refresh suggestions"}
        </button>
        <span className="help-text" style={{ alignSelf: "center" }}>
          {label}
        </span>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--danger-700, #C22F2F)" }}>
          {error}
        </p>
      ) : null}

      {!suggestions.length ? (
        <p className="help-text">No suggestions yet. Opt in, keep Match me on, and refresh during the event window.</p>
      ) : (
        <ul className="matchmaker-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {suggestions.map((s) => (
            <li key={s.id} className="matchmaker-item" style={{ borderTop: "1px solid var(--border, #D9E1EE)", paddingTop: 12 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                {s.user.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.user.photoUrl}
                    alt=""
                    width={48}
                    height={48}
                    style={{ borderRadius: 8, objectFit: "cover" }}
                  />
                ) : (
                  <div
                    aria-hidden
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 8,
                      background: "var(--primary-100, #E5EBF7)",
                    }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <strong>{s.user.name || "Attendee"}</strong>
                  {s.user.affiliation ? (
                    <span className="help-text"> · {s.user.affiliation}</span>
                  ) : null}
                  <p style={{ margin: "6px 0" }}>{s.whyLine}</p>
                  {s.aiGenerated ? (
                    <span className="help-text" style={{ display: "block", marginBottom: 8 }}>
                      {label}
                    </span>
                  ) : null}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="button"
                      onClick={() => onViewProfile?.(s.suggestedUserId)}
                    >
                      View profile
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={draftingId === s.id}
                      onClick={() => void draftIntro(s.id)}
                    >
                      {draftingId === s.id ? "Opening…" : "Draft intro"}
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
