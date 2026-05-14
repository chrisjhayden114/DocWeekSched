import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { EventPilotLogo } from "../components/EventPilotLogo";
import { apiFetch, AuthResponse } from "../lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [registerType, setRegisterType] = useState<"participant" | "admin">("participant");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

  useEffect(() => {
    const token = window.localStorage.getItem("token");
    if (token) {
      window.location.href = "/dashboard";
    }
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const slug = typeof router.query.event === "string" ? router.query.event.trim().toLowerCase() : "";
    if (!slug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/event/slug/${encodeURIComponent(slug)}`);
        const data = (await res.json().catch(() => ({}))) as { id?: string };
        if (!res.ok || cancelled || !data.id) return;
        window.localStorage.setItem("activeEventId", data.id);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router.isReady, router.query.event]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const endpoint = mode === "login" ? "/auth/login" : registerType === "admin" ? "/auth/register-admin" : "/auth/register";
      const data = await apiFetch<AuthResponse>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      window.localStorage.setItem("token", data.token);
      window.localStorage.setItem("user", JSON.stringify(data.user));
      window.location.href = "/dashboard";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function sendForgotPassword() {
    if (!forgotEmail || forgotSending) return;
    setForgotSending(true);
    setForgotError(null);
    setForgotMessage(null);
    try {
      const eventSlug = typeof router.query.event === "string" ? router.query.event.trim().toLowerCase() : undefined;
      await apiFetch<{ ok: true }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: forgotEmail, ...(eventSlug ? { eventSlug } : {}) }),
      });
      setForgotMessage("If that email is in our system, a reset link has been sent.");
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setForgotSending(false);
    }
  }

  return (
    <>
      <Head>
        <title>EventPilot — Sign in</title>
      </Head>
      <div className="container">
        <div className="header header--login">
          <div className="login-brand">
            <EventPilotLogo size={56} className="login-brand-logo" />
            <div className="login-brand-text">
              <h1>EventPilot</h1>
              <p style={{ color: "var(--ink-700)", margin: 0 }}>
                A professional event workspace for schedules, networking, and collaboration.
              </p>
              <p className="help-text" style={{ margin: "10px 0 0", lineHeight: 1.45 }}>
                Joining a specific conference? Use your organizer&apos;s event link (it looks like{" "}
                <strong>/e/…</strong> with a stable ID, or a short slug), or add{" "}
                <strong>?event=</strong> followed by that same token to this page&apos;s URL before you sign in so the
                correct schedule loads.
              </p>
            </div>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 520 }}>
          <div className="nav" style={{ marginBottom: 16 }}>
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
              Login
            </button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="grid" style={{ gap: 12 }}>
            {mode === "register" && (
              <>
                <div className="nav">
                  <button
                    type="button"
                    className={registerType === "participant" ? "active" : ""}
                    onClick={() => setRegisterType("participant")}
                  >
                    Participant Join Link
                  </button>
                  <button
                    type="button"
                    className={registerType === "admin" ? "active" : ""}
                    onClick={() => setRegisterType("admin")}
                  >
                    Admin Join Link
                  </button>
                </div>
                <input className="input" name="name" placeholder="Full name" required />
                {registerType === "participant" && (
                  <select className="select" name="role" defaultValue="ATTENDEE">
                    <option value="ATTENDEE">Attendee</option>
                    <option value="SPEAKER">Speaker</option>
                  </select>
                )}
                <textarea
                  className="textarea"
                  name="researchInterests"
                  placeholder="Research interests (optional)"
                  rows={3}
                />
                {registerType === "admin" && (
                  <input className="input" name="inviteCode" placeholder="Admin invite code" required />
                )}
              </>
            )}
            <input className="input" name="email" type="email" placeholder="Email" required />
            <input className="input" name="password" type="password" placeholder="Password (min 8)" required />
            {mode === "login" && (
              <div style={{ display: "grid", gap: 8 }}>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setForgotOpen((v) => !v);
                    setForgotError(null);
                    setForgotMessage(null);
                  }}
                >
                  {forgotOpen ? "Hide forgot password" : "Forgot password?"}
                </button>
                {forgotOpen && (
                  <div className="grid" style={{ gap: 8 }}>
                    <input
                      className="input"
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="Enter your email for password reset"
                      required
                    />
                    {forgotError && <div style={{ color: "crimson" }}>{forgotError}</div>}
                    {forgotMessage && <div style={{ color: "var(--ink-700)" }}>{forgotMessage}</div>}
                    <button className="button secondary" type="button" disabled={forgotSending} onClick={sendForgotPassword}>
                      {forgotSending ? "Sending…" : "Send reset link"}
                    </button>
                  </div>
                )}
              </div>
            )}
            {error && <div style={{ color: "crimson" }}>{error}</div>}
            <button className="button" disabled={loading}>
              {loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
