import { brand } from "@event-app/config";
import { useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { EMAIL_CHANGE_COPY, validatePasswordChange } from "../../lib/accountSettings";

const EMAIL_COPY_PARTS = EMAIL_CHANGE_COPY.split("support");

export function AccountEmailPasswordCard({ email }: { email: string | null }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const invalid = validatePasswordChange({ currentPassword, password, confirmPassword });
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    try {
      await apiFetch<{ ok: boolean }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, password }),
      });
      setCurrentPassword("");
      setPassword("");
      setConfirmPassword("");
      setSuccess("Password updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 24, padding: 20 }}>
      <h2 className="text-display-sm" style={{ marginTop: 0 }}>
        Email &amp; password
      </h2>
      <label className="text-meta" style={{ display: "grid", gap: 6 }}>
        Email
        <input className="input" type="email" value={email ?? ""} readOnly disabled />
      </label>
      <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
        {EMAIL_COPY_PARTS[0]}
        <a href={`mailto:${brand.supportEmail}`}>support</a>
        {EMAIL_COPY_PARTS[1]}
      </p>
      <form className="grid" style={{ gap: 10 }} onSubmit={(e) => void onSubmit(e)}>
        <label className="text-meta">
          Current password
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label className="text-meta">
          New password
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <label className="text-meta">
          Confirm new password
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error ? (
          <p role="alert" style={{ color: "var(--danger-700)", margin: 0 }}>
            {error}
          </p>
        ) : null}
        {success ? (
          <p role="status" className="help-text" style={{ color: "#0f7b3d", margin: 0 }}>
            {success}
          </p>
        ) : null}
        <button type="submit" className="button" disabled={saving || !email} style={{ justifySelf: "start" }}>
          {saving ? "Updating…" : "Update password"}
        </button>
      </form>
    </section>
  );
}
