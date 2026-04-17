import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { apiFetch, AuthResponse } from "../../lib/api";

type Preview = { email: string; name: string; photoUrl?: string | null; researchInterests?: string | null };

export default function InviteSetupPage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : null;
  const eventSlug = typeof router.query.event === "string" ? router.query.event : null;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || router.isReady === false) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/auth/profile-setup/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Invalid invite");
        }
        if (!cancelled) setPreview(data as Preview);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Invalid or expired invite.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router.isReady]);

  useEffect(() => {
    if (!eventSlug || router.isReady === false) return;
    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/event/slug/${encodeURIComponent(eventSlug)}`,
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.id) {
          window.localStorage.setItem("activeEventId", data.id as string);
        }
      } catch {
        /* optional */
      }
    })();
  }, [eventSlug, router.isReady]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || password.length < 8) {
      setSubmitError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const data = await apiFetch<AuthResponse>("/auth/profile-setup", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      window.localStorage.setItem("token", data.token);
      window.localStorage.setItem("user", JSON.stringify(data.user));
      window.location.href = "/dashboard";
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not complete setup.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) return null;

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520 }}>
        <h1 style={{ marginTop: 0 }}>Welcome — confirm your profile</h1>
        {loadError && <p style={{ color: "#b42318" }}>{loadError}</p>}
        {preview && !loadError && (
          <>
            <p className="help-text" style={{ marginTop: 0 }}>
              Hi <strong>{preview.name}</strong> ({preview.email}). An organizer started your profile. Set a password to sign in,
              then you can edit your photo and bio anytime under Profile.
            </p>
            {preview.photoUrl && (
              <img src={preview.photoUrl} alt="" style={{ width: 96, height: 96, borderRadius: 12, objectFit: "cover" }} />
            )}
            {preview.researchInterests && (
              <p style={{ lineHeight: 1.45 }}>{preview.researchInterests}</p>
            )}
            <form className="grid" style={{ gap: 12, marginTop: 16 }} onSubmit={handleSubmit}>
              <label className="help-text" style={{ margin: 0, display: "grid", gap: 6 }}>
                Choose password (min 8 characters)
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  required
                  minLength={8}
                />
              </label>
              {submitError && <p style={{ color: "#b42318", margin: 0 }}>{submitError}</p>}
              <button className="button" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save password & continue"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
