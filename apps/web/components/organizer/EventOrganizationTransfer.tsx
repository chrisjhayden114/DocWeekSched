import { EVENT_TRANSFER_UI, eventTransferConfirmBody } from "@event-app/shared";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { Select } from "../Select";
import {
  getEventTransferState,
  transferEventOrganization,
  type EventTransferState,
} from "../../lib/organizerApi";

type Props = {
  open: boolean;
  eventId: string;
  eventName: string;
  /** Only a DRAFT is ever offered this; anything else renders nothing. */
  status: string;
  onMoved: (message: string) => Promise<void> | void;
};

/**
 * ORG-2 — the draft-only event move, in Event settings.
 *
 * W-6 still refuses organizationId on a settings save, and J-A still refuses a
 * general transfer: seventeen models denormalize organizationId, so moving a
 * live event would rewrite billing, metering and audit history. A draft with no
 * payments, certificates, AI usage or series has none of that history, which is
 * the only case narrow enough to move safely — so it is the only case offered.
 *
 * The section appears for drafts only, and the server is asked whether this
 * particular draft qualifies before any control is drawn. A draft that doesn't
 * qualify gets the reasons and the way that does work, rather than a button
 * that would fail.
 */
export function EventOrganizationTransfer({ open, eventId, eventName, status, onMoved }: Props) {
  const isDraft = status === "DRAFT";
  const [state, setState] = useState<EventTransferState | null>(null);
  const [targetOrgId, setTargetOrgId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await getEventTransferState(eventId);
    setState(next);
    setTargetOrgId("");
  }, [eventId]);

  useEffect(() => {
    if (!open || !isDraft) return;
    setError(null);
    void load().catch((err: Error) => setError(err.message));
  }, [open, isDraft, load]);

  if (!isDraft || !state) return null;

  const target = state.targets.find((t) => t.id === targetOrgId) ?? null;

  // Eligible but with nowhere to go: an organizer who runs one organization
  // does not need to be told about a door to a room that doesn't exist.
  if (state.canTransfer && state.targets.length === 0) return null;

  async function run() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await transferEventOrganization(eventId, target.id);
      setConfirming(false);
      await onMoved(res.message);
    } catch (err) {
      const failure = err as Error & {
        body?: { error?: string; reasons?: string[]; recommendation?: string };
      };
      const parts = [
        failure.body?.error || failure.message,
        ...(failure.body?.reasons ?? []),
        failure.body?.recommendation ?? "",
      ].filter(Boolean);
      setError(parts.join(" "));
      setConfirming(false);
      void load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-event-section="transfer-organization"
      style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--gray-200)", display: "grid", gap: 10 }}
    >
      <h3 className="text-body-lg" style={{ margin: 0, fontWeight: 600 }}>
        {EVENT_TRANSFER_UI.heading}
      </h3>

      {state.canTransfer ? (
        <>
          <p className="help-text" style={{ margin: 0 }}>
            {EVENT_TRANSFER_UI.intro}
          </p>
          <label>
            {EVENT_TRANSFER_UI.pickerLabel}
            <Select
              value={targetOrgId}
              onChange={setTargetOrgId}
              options={[
                { value: "", label: EVENT_TRANSFER_UI.choosePlaceholder },
                ...state.targets.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </label>
          <div>
            <button
              type="button"
              className="button secondary"
              disabled={busy || !target}
              onClick={() => setConfirming(true)}
            >
              {busy ? EVENT_TRANSFER_UI.working : EVENT_TRANSFER_UI.action}
            </button>
          </div>
        </>
      ) : (
        <div data-event-transfer-blockers>
          <p className="text-body-md" style={{ margin: "0 0 6px", fontWeight: 600 }}>
            {EVENT_TRANSFER_UI.blockedHeading}
          </p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 20, display: "grid", gap: 6 }}>
            {state.reasons.map((reason) => (
              <li key={reason} className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
                {reason}
              </li>
            ))}
          </ul>
          {state.recommendation ? (
            <p className="help-text" style={{ margin: 0 }}>
              {state.recommendation}
            </p>
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" style={{ margin: 0, color: "var(--danger)", font: "var(--text-body)" }}>
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={EVENT_TRANSFER_UI.confirmTitle}
        body={eventTransferConfirmBody(eventName, target?.name ?? "")}
        confirmLabel={EVENT_TRANSFER_UI.confirmLabel}
        cancelLabel={EVENT_TRANSFER_UI.cancelLabel}
        busy={busy}
        onConfirm={() => void run()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
