import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { OnboardingChecklistItem } from "@event-app/shared";
import { apiFetch } from "../lib/api";

type OnboardingState = {
  isOrganizer: boolean;
  dismissed: boolean;
  sampleEventOffered: boolean;
  showSamplePrompt: boolean;
  showChecklist: boolean;
  organizationId: string | null;
  seriesId: string | null;
  eventId: string | null;
  checklist: OnboardingChecklistItem[];
};

type Props = {
  /** Soft refresh after sample create so dashboard can switch events. */
  onSampleCreated?: (eventId: string) => void;
};

/**
 * First-run organizer onboarding: optional sample event + compact checklist
 * with thin progress bar (D3 — not a hero block).
 */
export function OnboardingPanel({ onSampleCreated }: Props) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeHint, setUpgradeHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<OnboardingState>("/account/onboarding");
      setState(data);
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!state?.isOrganizer) return null;
  if (!state.showChecklist && !state.showSamplePrompt) return null;

  const doneCount = state.checklist.filter((c) => c.done).length;
  const total = state.checklist.length || 1;
  const progressPct = Math.round((doneCount / total) * 100);

  async function dismiss() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/account/onboarding/dismiss", { method: "POST", body: "{}" });
      setState((s) => (s ? { ...s, dismissed: true, showChecklist: false, showSamplePrompt: false } : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dismiss");
    } finally {
      setBusy(false);
    }
  }

  async function declineSample() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/account/onboarding/decline-sample", { method: "POST", body: "{}" });
      setState((s) =>
        s ? { ...s, sampleEventOffered: true, showSamplePrompt: false } : s,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update preference");
    } finally {
      setBusy(false);
    }
  }

  async function createSample() {
    if (!state?.organizationId) return;
    setBusy(true);
    setError(null);
    setUpgradeHint(null);
    try {
      const res = await apiFetch<{ eventId: string; slug: string }>("/account/onboarding/sample-event", {
        method: "POST",
        body: JSON.stringify({ organizationId: state.organizationId }),
      });
      await load();
      onSampleCreated?.(res.eventId);
    } catch (e) {
      const err = e as Error & { status?: number; body?: { upgrade?: { message?: string }; error?: string } };
      if (err.status === 402 || err.body?.upgrade) {
        setUpgradeHint(
          err.body?.upgrade?.message ||
            err.body?.error ||
            "Your plan’s event limit is reached. Upgrade to create another event.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Could not create sample event");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="onboarding-panel" aria-label="Getting started">
      <div className="onboarding-panel-head">
        <div>
          <h2>Getting started</h2>
          <p className="text-meta" style={{ margin: "4px 0 0" }}>
            {doneCount}/{state.checklist.length} steps · Setup Copilot is the fastest path
          </p>
        </div>
        <button type="button" className="button secondary" disabled={busy} onClick={() => void dismiss()}>
          Dismiss
        </button>
      </div>

      <div className="onboarding-progress" aria-hidden>
        <span style={{ width: `${progressPct}%` }} />
      </div>

      {state.showSamplePrompt ? (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--gray-200)" }}>
          <p className="text-body" style={{ margin: "0 0 10px" }}>
            Create a sample draft with sessions, papers, speakers, and sponsors?
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="button" disabled={busy} onClick={() => void createSample()}>
              Create sample event
            </button>
            <button type="button" className="button secondary" disabled={busy} onClick={() => void declineSample()}>
              No thanks
            </button>
          </div>
          {upgradeHint ? (
            <p style={{ color: "var(--danger)", marginBottom: 0 }}>
              {upgradeHint}{" "}
              <Link href="/pricing">View pricing</Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <ul className="onboarding-steps">
        {state.checklist.map((step) => (
          <li key={step.key} className={step.done ? "is-done" : undefined}>
            {step.label}
            {!step.done && (step.key === "create_event" || step.key === "add_sessions") ? (
              <>
                {" · "}
                <Link href={`/organizer/events/new?mode=ai${state.organizationId ? `&org=${state.organizationId}` : ""}`}>
                  Setup Copilot
                </Link>
              </>
            ) : null}
            {!step.done && step.key === "invite_attendees" && state.eventId ? (
              <>
                {" · "}
                <span className="text-meta">Use Invite on the dashboard</span>
              </>
            ) : null}
            {!step.done && step.key === "publish" && state.eventId ? (
              <>
                {" · "}
                <Link href={`/organizer/events/${state.eventId}`}>Publish</Link>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p style={{ color: "var(--danger)", marginBottom: 0 }}>{error}</p> : null}
    </section>
  );
}
