import { brand } from "@event-app/config";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { apiFetch, AuthResponse, setCsrfToken } from "../../lib/api";

type Preview = { email: string; name: string; photoUrl?: string | null; researchInterests?: string | null };

export default function InviteSetupPage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : null;
  const eventRef = typeof router.query.event === "string" ? router.query.event : null;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [redirectingToLogin, setRedirectingToLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || router.isReady === false) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/auth/profile-setup/${encodeURIComponent(token)}`,
          { credentials: "include" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Invalid invite");
        }
        if (!cancelled) setPreview(data as Preview);
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : "Invalid or expired invite.";
          setLoadError(message);
          if (/invalid|expired/i.test(message)) {
            setRedirectingToLogin(true);
            window.setTimeout(() => {
              window.location.href = "/";
            }, 1800);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router.isReady]);

  useEffect(() => {
    if (!eventRef || router.isReady === false) return;
    window.localStorage.setItem("activeEventId", eventRef);
  }, [eventRef, router.isReady]);

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
      setCsrfToken(data.csrfToken);
      window.localStorage.removeItem("token");
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
        <p className="help-text">{brand.productName}</p>
        {loadError && (
          <>
            <p style={{ color: "#b42318" }}>{loadError}</p>
            <p className="help-text" style={{ marginTop: 0 }}>
              {redirectingToLogin
                ? "This invite link has already been used. Sending you to the login page…"
                : "If you've already set your password, please log in from the home page."}
            </p>
            {!redirectingToLogin && (
              <button type="button" className="button secondary" onClick={() => { window.location.href = "/"; }}>
                Go to login
              </button>
            )}
          </>
        )}
        {preview && !loadError && (
          <>
            <p className="help-text" style={{ marginTop: 0 }}>
              Hi <strong>{preview.name}</strong> ({preview.email}). An organizer started your profile. Set a password to sign in,
              then you can edit your photo and bio anytime under Profile.
            </p>
            {preview.photoUrl && (
              <img src={preview.photoUrl} alt="" style={{ width: 96, height: 96, borderRadius: 12, objectFit: "cover" }} />
            )}
            {preview.researchInterests && <p style={{ lineHeight: 1.45 }}>{preview.researchInterests}</p>}
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
