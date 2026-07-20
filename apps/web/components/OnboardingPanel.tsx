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
 * First-run organizer onboarding: optional sample event + 4-step checklist.
 * Dismiss persists server-side (User.onboardingDismissedAt).
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
    <section
      className="card"
      style={{ marginBottom: 20, padding: 20 }}
      aria-label="Getting started"
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h2 className="text-display-sm" style={{ margin: 0 }}>
            Getting started
          </h2>
          <p className="text-body-md" style={{ color: "var(--ink-secondary)", margin: "6px 0 0" }}>
            {doneCount}/{state.checklist.length} steps complete. Setup Copilot is the fastest path for
            creating an event and adding sessions.
          </p>
        </div>
        <button type="button" className="button secondary" disabled={busy} onClick={() => void dismiss()}>
          Dismiss
        </button>
      </div>

      {state.showSamplePrompt ? (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <p className="text-body-md" style={{ marginTop: 0 }}>
            Create a sample draft event with sessions, papers, speakers, and sponsors? It uses your plan’s
            event allowance (you’ll see an upgrade prompt if you’re at the limit).
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
            <p style={{ color: "var(--danger-700)" }}>
              {upgradeHint}{" "}
              <Link href="/pricing">View pricing</Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <ol style={{ margin: "16px 0 0", paddingLeft: 20 }}>
        {state.checklist.map((step) => (
          <li key={step.key} style={{ marginBottom: 8 }}>
            <span style={{ textDecoration: step.done ? "line-through" : undefined, opacity: step.done ? 0.7 : 1 }}>
              {step.label}
            </span>
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
      </ol>
      {error ? <p style={{ color: "var(--danger-700)" }}>{error}</p> : null}
    </section>
  );
}
