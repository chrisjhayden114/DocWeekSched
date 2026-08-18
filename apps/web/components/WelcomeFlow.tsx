import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Portal } from "./kit/Portal";
import { initialsFor } from "./kit/kitHelpers";
import { apiFetch } from "../lib/api";
import { fileToDataUrl } from "../lib/photoDataUrl";

export type WelcomeFlowProps = {
  open: boolean;
  token: string;
  activeEventId: string;
  withEventHeaders: (extra?: RequestInit) => RequestInit;
  user: { name: string; photoUrl?: string | null; researchInterests?: string | null };
  onDone: () => void;
};

/**
 * ONB-A — calm, skippable, ask-once attendee welcome. Skip stamps seen and
 * never re-prompts. Finish saves are best-effort; welcome-seen always fires.
 */
export function WelcomeFlow({
  open,
  token,
  activeEventId,
  withEventHeaders,
  user,
  onDone,
}: WelcomeFlowProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const settledRef = useRef(false);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(user.photoUrl || null);
  const [photoChosen, setPhotoChosen] = useState(false);
  const [researchInterests, setResearchInterests] = useState(user.researchInterests || "");
  const [directoryOptIn, setDirectoryOptIn] = useState(false);
  const [messageEmail, setMessageEmail] = useState(true);

  const eventHeaders = useCallback(
    (extra: RequestInit = {}) => {
      const base = withEventHeaders(extra);
      const h = (base.headers as Record<string, string> | undefined) || {};
      return { ...base, headers: { ...h, "x-event-id": h["x-event-id"] || activeEventId } };
    },
    [activeEventId, withEventHeaders],
  );

  const finish = useCallback(async () => {
    if (settledRef.current) return;
    settledRef.current = true;
    setBusy(true);
    const profileBody: { researchInterests: string; photoUrl?: string } = { researchInterests };
    if (photoChosen && photoPreview) profileBody.photoUrl = photoPreview;
    await apiFetch("/auth/me/profile", { method: "PUT", body: JSON.stringify(profileBody) }, token).catch(
      () => undefined,
    );
    if (directoryOptIn) {
      await apiFetch(
        "/attendees/me/directory",
        eventHeaders({ method: "PUT", body: JSON.stringify({ directoryOptIn: true }) }),
        token,
      ).catch(() => undefined);
    }
    if (!messageEmail) {
      await apiFetch(
        "/notifications/preferences",
        eventHeaders({ method: "PUT", body: JSON.stringify({ messageEmail: false }) }),
        token,
      ).catch(() => undefined);
    }
    await apiFetch("/attendees/me/welcome-seen", eventHeaders({ method: "POST" }), token).catch(() => undefined);
    onDone();
  }, [directoryOptIn, eventHeaders, messageEmail, onDone, photoChosen, photoPreview, researchInterests, token]);

  const skip = useCallback(async () => {
    if (settledRef.current) return;
    settledRef.current = true;
    setBusy(true);
    await apiFetch("/attendees/me/welcome-seen", eventHeaders({ method: "POST" }), token).catch(() => undefined);
    onDone();
  }, [eventHeaders, onDone, token]);

  // Ref so the open effect doesn't re-run (and steal focus back to the dialog)
  // whenever `skip` gets a fresh identity — it chains through eventHeaders to
  // the `withEventHeaders` prop, which callers rebuild every render. Same fix,
  // same reason as SessionPeekSheet and the SlideOver focus-steal bug.
  const skipRef = useRef(skip);
  useEffect(() => {
    skipRef.current = skip;
  });

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void skipRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file, { maxWidth: 800, quality: 0.82 });
      setPhotoPreview(dataUrl);
      setPhotoChosen(true);
    } catch {
      /* leave existing preview */
    }
  };

  return (
    <Portal>
      <div className="modal-backdrop" role="presentation">
        <div
          ref={dialogRef}
          className="modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="welcome-flow-head">
            <h2 id={titleId} className="text-display-sm" style={{ margin: 0 }}>
              Set yourself up
            </h2>
            <button type="button" className="button ghost welcome-flow-skip" disabled={busy} onClick={() => void skip()}>
              Skip for now
            </button>
          </div>
          <div className="welcome-flow-dots" aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map((n) => (
              <span key={n} className={`welcome-flow-dot${n === step ? " is-active" : ""}`} aria-hidden />
            ))}
          </div>

          {step === 1 ? (
            <div className="welcome-flow-body">
              <h3 style={{ margin: "0 0 var(--space-3)" }}>Add a face and your interests</h3>
              <div className="welcome-flow-photo">
                {photoPreview ? (
                  <img src={photoPreview} alt="" className="avatar avatar-large" />
                ) : (
                  <div className="attendee-avatar attendee-avatar-placeholder welcome-flow-initials" aria-hidden>
                    {initialsFor(user.name) || "?"}
                  </div>
                )}
                <label className="help-text" style={{ margin: 0, display: "grid", gap: 6, flex: 1 }}>
                  Photo (optional)
                  <input
                    className="input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    aria-label="Profile photo"
                    onChange={(e) => void handleFileChange(e)}
                  />
                </label>
              </div>
              <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
                Interests (optional)
                <textarea
                  className="textarea"
                  rows={4}
                  value={researchInterests}
                  onChange={(e) => setResearchInterests(e.target.value)}
                  placeholder="Research interests, projects, and topics you care about"
                />
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="welcome-flow-body">
              <h3 style={{ margin: "0 0 var(--space-3)" }}>Want to be findable?</h3>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={directoryOptIn}
                  onChange={(e) => setDirectoryOptIn(e.target.checked)}
                />
                <span>Show me in this event&apos;s attendee directory</span>
              </label>
              <p className="help-text" style={{ margin: "8px 0 0" }}>
                Opting in lets other attendees find you, message you, and (if you like) get introduction
                suggestions. You can change this anytime in Profile. Off = invisible.
              </p>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="welcome-flow-body">
              <h3 style={{ margin: "0 0 var(--space-3)" }}>Email</h3>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={messageEmail}
                  onChange={(e) => setMessageEmail(e.target.checked)}
                />
                <span>Email me about unread messages (max one per day)</span>
              </label>
              <p className="help-text" style={{ margin: "8px 0 0" }}>
                No other email. Event notifications stay in the app.
              </p>
            </div>
          ) : null}

          <div className="form-actions">
            {step > 1 ? (
              <button type="button" className="button secondary" disabled={busy} onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            ) : null}
            {step < 3 ? (
              <button type="button" className="button" disabled={busy} onClick={() => setStep((s) => s + 1)}>
                Next
              </button>
            ) : (
              <button type="button" className="button" disabled={busy} onClick={() => void finish()}>
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
