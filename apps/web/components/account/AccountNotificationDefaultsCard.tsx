import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { NOTIFICATION_DEFAULTS_COPY } from "../../lib/accountSettings";

type AccountPrefs = {
  digestEmail: boolean;
  messageEmail: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

const FALLBACK: AccountPrefs = {
  digestEmail: false,
  messageEmail: true,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
};

export function AccountNotificationDefaultsCard({ ready }: { ready: boolean }) {
  const [prefs, setPrefs] = useState<AccountPrefs>(FALLBACK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const row = await apiFetch<AccountPrefs>("/notifications/preferences/account");
      setPrefs({
        digestEmail: row.digestEmail === true,
        messageEmail: row.messageEmail !== false,
        quietHoursStart: row.quietHoursStart || FALLBACK.quietHoursStart,
        quietHoursEnd: row.quietHoursEnd || FALLBACK.quietHoursEnd,
      });
    } catch {
      setPrefs(FALLBACK);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [ready, load]);

  function toHm(value: string) {
    const match = value.match(/^(\d{1,2}:\d{2})/);
    return match?.[1] ?? value;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await apiFetch<AccountPrefs>("/notifications/preferences/account", {
        method: "PUT",
        body: JSON.stringify({
          ...prefs,
          quietHoursStart: toHm(prefs.quietHoursStart),
          quietHoursEnd: toHm(prefs.quietHoursEnd),
        }),
      });
      setPrefs({
        digestEmail: saved.digestEmail === true,
        messageEmail: saved.messageEmail !== false,
        quietHoursStart: saved.quietHoursStart || prefs.quietHoursStart,
        quietHoursEnd: saved.quietHoursEnd || prefs.quietHoursEnd,
      });
      setSuccess("Notification defaults saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save notification defaults.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 24, padding: 20 }}>
      <h2 className="text-display-sm" style={{ marginTop: 0 }}>
        Notification defaults
      </h2>
      <p className="text-body-md" style={{ color: "var(--ink-secondary)" }}>
        {NOTIFICATION_DEFAULTS_COPY}
      </p>
      <form className="grid" style={{ gap: 12 }} onSubmit={(e) => void onSubmit(e)}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={prefs.digestEmail}
            onChange={(e) => setPrefs((p) => ({ ...p, digestEmail: e.target.checked }))}
          />
          Daily digest email
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={prefs.messageEmail}
            onChange={(e) => setPrefs((p) => ({ ...p, messageEmail: e.target.checked }))}
          />
          Email me about unread messages (max one per day)
        </label>
        <div className="grid" style={{ gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <label className="text-meta">
            Quiet hours start
            <input
              className="input"
              type="time"
              value={prefs.quietHoursStart}
              onChange={(e) => setPrefs((p) => ({ ...p, quietHoursStart: e.target.value }))}
            />
          </label>
          <label className="text-meta">
            Quiet hours end
            <input
              className="input"
              type="time"
              value={prefs.quietHoursEnd}
              onChange={(e) => setPrefs((p) => ({ ...p, quietHoursEnd: e.target.value }))}
            />
          </label>
        </div>
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
        <button type="submit" className="button" disabled={saving || !ready} style={{ justifySelf: "start" }}>
          {saving ? "Saving…" : "Save notification defaults"}
        </button>
      </form>
    </section>
  );
}
