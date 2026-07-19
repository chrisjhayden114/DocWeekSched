import { brand } from "@event-app/config";
import { useRouter } from "next/router";
import { useState } from "react";
import { apiFetch } from "../../lib/api";

export default function ResetPasswordPage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch<{ ok: true }>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setSuccess("Password updated. Redirecting to login…");
      window.setTimeout(() => {
        window.location.href = "/login";
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520 }}>
        <h1 style={{ marginTop: 0 }}>Reset password</h1>
        <p className="help-text" style={{ marginTop: 0 }}>
          Enter a new password for your {brand.productName} account.
        </p>
        <form className="grid" style={{ gap: 10 }} onSubmit={handleSubmit}>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="New password (min 8)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          {error && <p style={{ color: "#b42318", margin: 0 }}>{error}</p>}
          {success && <p style={{ color: "#0f7b3d", margin: 0 }}>{success}</p>}
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Set new password"}
          </button>
        </form>
      </div>
    </div>
  );
}
