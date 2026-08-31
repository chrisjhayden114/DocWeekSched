import { orgSettingsCopy } from "@event-app/config";
import {
  ORG_TRANSFER_TARGET_ROLE,
  canCloseOrg,
  canTransferOrgOwnership,
  isEligibleTransferTarget,
  orgCloseConfirmBody,
  orgCloseConfirmationLabel,
  orgTransferConfirmBody,
} from "@event-app/shared";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { Select } from "../Select";
import {
  closeOrg,
  getOrgCloseState,
  listOrgMembers,
  transferOrgOwnership,
  type OrgCloseState,
  type OrgMember,
} from "../../lib/organizerApi";

type Props = {
  orgId: string;
  orgName: string;
  /** The caller's membership role. Anything but OWNER renders nothing. */
  role: string | null | undefined;
  /** Ownership changed — the settings page reloads so the role gate follows. */
  onOwnershipTransferred: (message: string) => void;
  onClosed: (message: string) => void;
};

function memberLabel(member: OrgMember): string {
  return member.name ? `${member.name} · ${member.email}` : member.email;
}

/**
 * ORG-2 — the organization's danger zone: hand it over, or close it.
 *
 * These two acts are the exit ORG-1 left missing. A solo OWNER could not delete
 * their account, because the deletion guard demanded they "transfer or close"
 * organizations the product gave them no way to transfer or close. So this
 * section is deliberately quiet but never hidden: it is the door out.
 *
 * Owner-only, matching the server. An admin sees nothing here — not a disabled
 * button, which would only invite a support ticket.
 */
export function OrgDangerZone({
  orgId,
  orgName,
  role,
  onOwnershipTransferred,
  onClosed,
}: Props) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [closeState, setCloseState] = useState<OrgCloseState | null>(null);
  const [newOwnerUserId, setNewOwnerUserId] = useState("");
  const [confirming, setConfirming] = useState<"transfer" | "close" | null>(null);
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = canTransferOrgOwnership(role);

  const load = useCallback(async () => {
    if (!isOwner) return;
    setError(null);
    const [memberList, close] = await Promise.all([listOrgMembers(orgId), getOrgCloseState(orgId)]);
    setMembers(memberList.members);
    setCloseState(close);
    setNewOwnerUserId("");
  }, [orgId, isOwner]);

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
  }, [load]);

  if (!isOwner) return null;

  const admins = members.filter((m) => !m.isSelf && isEligibleTransferTarget(m.role));
  const chosen = admins.find((m) => m.userId === newOwnerUserId) ?? null;

  async function runTransfer() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const res = await transferOrgOwnership(orgId, chosen.userId);
      setConfirming(null);
      onOwnershipTransferred(res.message);
    } catch (err) {
      const failure = err as Error & { body?: { error?: string } };
      setError(failure.body?.error || failure.message);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  async function runClose() {
    setBusy(true);
    setError(null);
    try {
      const res = await closeOrg(orgId, typedName);
      setConfirming(null);
      onClosed(res.message);
    } catch (err) {
      // A close refused between load and submit comes back with its reasons —
      // show those rather than a stale "ready to close".
      const failure = err as Error & { body?: { error?: string; reasons?: string[] } };
      const reasons = failure.body?.reasons;
      setError(
        reasons?.length
          ? `${failure.body?.error ?? failure.message} ${reasons.join(" ")}`
          : failure.body?.error || failure.message,
      );
      setConfirming(null);
      void load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const copy = orgSettingsCopy.danger;

  return (
    <section
      className="card danger-zone"
      data-org-section="danger-zone"
      style={{ marginTop: 24, padding: 20, display: "grid", gap: 24 }}
    >
      <p className="danger-zone-label" style={{ margin: 0 }}>
        {copy.label}
      </p>

      <div style={{ display: "grid", gap: 10 }}>
        <h2 className="text-display-sm" style={{ margin: 0 }}>
          {copy.transfer.heading}
        </h2>
        <p className="text-body-md" style={{ margin: 0, color: "var(--ink-secondary)" }}>
          {copy.transfer.intro}
        </p>
        {admins.length === 0 ? (
          <p className="help-text" style={{ margin: 0 }}>
            {copy.transfer.noAdmins}
          </p>
        ) : (
          <>
            <label>
              {copy.transfer.pickerLabel}
              <Select
                value={newOwnerUserId}
                onChange={setNewOwnerUserId}
                options={[
                  { value: "", label: `Choose an ${ORG_TRANSFER_TARGET_ROLE.toLowerCase()}…` },
                  ...admins.map((m) => ({ value: m.userId, label: memberLabel(m) })),
                ]}
              />
              <span className="help-text">{copy.transfer.adminsOnly}</span>
            </label>
            <div>
              <button
                type="button"
                className="button button-danger"
                disabled={busy || !chosen}
                onClick={() => setConfirming("transfer")}
              >
                {busy && confirming === "transfer" ? copy.transfer.working : copy.transfer.action}
              </button>
            </div>
          </>
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <h2 className="text-display-sm" style={{ margin: 0 }}>
          {copy.close.heading}
        </h2>
        <p className="text-body-md" style={{ margin: 0, color: "var(--ink-secondary)" }}>
          {copy.close.intro}
        </p>
        <p className="help-text" style={{ margin: 0 }}>
          {copy.close.notDeleted}
        </p>

        {closeState && !closeState.canClose ? (
          <div data-org-close-blockers>
            <p className="text-body-md" style={{ margin: "0 0 6px", fontWeight: 600 }}>
              {copy.close.blockedHeading}
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
              {closeState.reasons.map((reason) => (
                <li key={reason} className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <button
            type="button"
            className="button button-danger"
            disabled={busy || !closeState?.canClose}
            onClick={() => {
              setTypedName("");
              setConfirming("close");
            }}
          >
            {busy && confirming === "close" ? copy.close.working : copy.close.action}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" style={{ margin: 0, color: "var(--danger-700)" }}>
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming === "transfer"}
        tone="danger"
        title={copy.transfer.confirmTitle}
        body={orgTransferConfirmBody(orgName, chosen ? memberLabel(chosen) : "")}
        confirmLabel={copy.transfer.confirmLabel}
        cancelLabel={copy.transfer.cancelLabel}
        busy={busy}
        onConfirm={() => void runTransfer()}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        open={confirming === "close"}
        tone="danger"
        title={copy.close.confirmTitle}
        body={orgCloseConfirmBody(orgName, closeState?.otherMemberCount ?? 0)}
        confirmLabel={copy.close.confirmLabel}
        cancelLabel={copy.close.cancelLabel}
        busy={busy}
        typedConfirmExpected={orgName}
        typedConfirmLabel={orgCloseConfirmationLabel(orgName)}
        typedConfirmValue={typedName}
        onTypedConfirmChange={setTypedName}
        onConfirm={() => void runClose()}
        onCancel={() => {
          setConfirming(null);
          setTypedName("");
        }}
      />
    </section>
  );
}

/** Exported for the settings page's owner-only gate, so both agree. */
export const canSeeOrgDangerZone = (role: string | null | undefined): boolean =>
  canTransferOrgOwnership(role) && canCloseOrg(role);
