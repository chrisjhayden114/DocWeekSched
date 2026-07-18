import { brand } from "@event-app/config";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { EventPilotLogo } from "../components/EventPilotLogo";
import { apiFetch, AuthResponse, API_URL, setCsrfToken, clearAuthClientState } from "../lib/api";

const LINKED_EVENT_STORAGE_KEY = "eventPilotLinkedContext";

type LinkedEventPayload = { id: string; name: string };

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
  const [linkedEventName, setLinkedEventName] = useState<string | null>(null);
  const [registerMessage, setRegisterMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiFetch<AuthResponse["user"]>("/auth/me");
        if (!cancelled && me?.id) {
          window.localStorage.setItem("user", JSON.stringify(me));
          window.location.href = "/dashboard";
        }
      } catch {
        clearAuthClientState();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const token = typeof router.query.event === "string" ? router.query.event.trim() : "";
    if (!token) {
      try {
        const raw = window.sessionStorage.getItem(LINKED_EVENT_STORAGE_KEY);
        const activeId = window.localStorage.getItem("activeEventId");
        if (raw && activeId) {
          const parsed = JSON.parse(raw) as LinkedEventPayload;
          if (parsed.id === activeId && typeof parsed.name === "string" && parsed.name.trim()) {
            setLinkedEventName(parsed.name.trim());
            return;
          }
        }
      } catch {
        /* ignore */
      }
      setLinkedEventName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let res = await fetch(`${API_URL}/event/slug/${encodeURIComponent(token)}`, { credentials: "include" });
        if (!res.ok) {
          res = await fetch(`${API_URL}/event/join/${encodeURIComponent(token)}`, { credentials: "include" });
        }
        const data = (await res.json().catch(() => ({}))) as { id?: string; name?: string };
        if (!res.ok || cancelled || !data.id) {
          if (!cancelled) setLinkedEventName(null);
          return;
        }
        window.localStorage.setItem("activeEventId", data.id);
        const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : null;
        if (name) {
          try {
            window.sessionStorage.setItem(
              LINKED_EVENT_STORAGE_KEY,
              JSON.stringify({ id: data.id, name } satisfies LinkedEventPayload),
            );
          } catch {
            /* ignore */
          }
          if (!cancelled) setLinkedEventName(name);
        } else if (!cancelled) {
          setLinkedEventName(null);
        }
      } catch {
        if (!cancelled) setLinkedEventName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router.isReady, router.query.event]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setRegisterMessage(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const endpoint = mode === "login" ? "/auth/login" : registerType === "admin" ? "/auth/register-admin" : "/auth/register";
      const headers: Record<string, string> = {};
      const activeEventId = window.localStorage.getItem("activeEventId");
      if (activeEventId && mode === "register") {
        headers["x-event-id"] = activeEventId;
      }

      if (mode === "register" && registerType === "participant") {
        const data = await apiFetch<{ ok: true; requiresEmailVerification?: boolean; message?: string }>(
          endpoint,
          { method: "POST", body: JSON.stringify(payload), headers },
        );
        setRegisterMessage(data.message || `Check your email to verify your ${brand.productName} account.`);
        setMode("login");
        return;
      }

      const data = await apiFetch<AuthResponse>(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
        headers,
      });
      setCsrfToken(data.csrfToken);
      window.localStorage.setItem("user", JSON.stringify(data.user));
      window.localStorage.removeItem("token");
      try {
        window.sessionStorage.removeItem(LINKED_EVENT_STORAGE_KEY);
      } catch {
        /* ignore */
      }
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
      let eventRef = typeof router.query.event === "string" ? router.query.event.trim() : undefined;
      if (!eventRef && typeof window !== "undefined") {
        eventRef = window.localStorage.getItem("activeEventId")?.trim() || undefined;
      }
      await apiFetch<{ ok: true; message?: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: forgotEmail, ...(eventRef ? { eventSlug: eventRef } : {}) }),
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
        <title>{linkedEventName ? `${linkedEventName} — ${brand.productName}` : `${brand.productName} — Sign in`}</title>
      </Head>
      <div className="container">
        <div className="card login-card">
          <div className="login-brand login-brand--card">
            <EventPilotLogo size={56} className="login-brand-logo" />
            <div className="login-brand-text">
              <h1 className="text-display-md" style={{ margin: 0 }}>
                {brand.productName}
              </h1>
              {linkedEventName ? (
                <p className="login-guest-event-name text-body-md" style={{ margin: "6px 0 0" }}>
                  {linkedEventName}
                </p>
              ) : (
                <p className="text-body-md" style={{ margin: "6px 0 0", color: "var(--ink-secondary)" }}>
                  Sign in to your event
                </p>
              )}
            </div>
          </div>

          <p className="text-body-md" style={{ color: "var(--ink-secondary)", margin: "0 0 var(--space-4)" }}>
            Have an event link from your organizer? Open it and we&apos;ll bring you to the right place.
          </p>

          {mode === "register" ? (
            <>
              <div style={{ marginBottom: "var(--space-3)" }}>
                <label className="text-meta" htmlFor="register-type">
                  Account type
                </label>
                <select
                  id="register-type"
                  className="select"
                  value={registerType}
                  onChange={(e) => setRegisterType(e.target.value as "participant" | "admin")}
                >
                  <option value="participant">Participant</option>
                  <option value="admin">Organizer (invite code)</option>
                </select>
              </div>
              <form onSubmit={handleSubmit}>
                <label htmlFor="reg-email">Email</label>
                <input id="reg-email" className="input" name="email" type="email" required autoComplete="email" />
                <label htmlFor="reg-name">Name</label>
                <input id="reg-name" className="input" name="name" type="text" required autoComplete="name" />
                <label htmlFor="reg-password">Password</label>
                <input
                  id="reg-password"
                  className="input"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                {registerType === "admin" && (
                  <>
                    <label htmlFor="reg-invite">Admin invite code</label>
                    <input id="reg-invite" className="input" name="inviteCode" type="password" required />
                  </>
                )}
                {error && <p style={{ color: "var(--danger-700)" }}>{error}</p>}
                {registerMessage && <p style={{ color: "var(--success-700)" }}>{registerMessage}</p>}
                <button className="button" type="submit" disabled={loading} style={{ marginTop: 12, width: "100%", minHeight: 44 }}>
                  {loading ? "Please wait…" : "Create account"}
                </button>
              </form>
              <p className="text-body-md" style={{ marginTop: "var(--space-4)", textAlign: "center" }}>
                Already have an account?{" "}
                <button type="button" className="linkish" onClick={() => setMode("login")}>
                  Sign in
                </button>
              </p>
            </>
          ) : (
            <>
              <form onSubmit={handleSubmit}>
                <label htmlFor="login-email">Email</label>
                <input id="login-email" className="input" name="email" type="email" required autoComplete="email" />
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  className="input"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="current-password"
                />
                {/* Name required by some register payloads; omit from login DOM */}
                {error && <p style={{ color: "var(--danger-700)" }}>{error}</p>}
                {registerMessage && <p style={{ color: "var(--success-700)" }}>{registerMessage}</p>}
                <button className="button" type="submit" disabled={loading} style={{ marginTop: 12, width: "100%", minHeight: 44 }}>
                  {loading ? "Please wait…" : "Continue"}
                </button>
              </form>

              <p style={{ marginTop: "var(--space-3)", textAlign: "center" }}>
                <button
                  type="button"
                  className="linkish"
                  style={{ minHeight: 44 }}
                  onClick={() => setForgotOpen((v) => !v)}
                >
                  Forgot password?
                </button>
              </p>

              {forgotOpen && (
                <div style={{ marginTop: "var(--space-2)" }}>
                  <label htmlFor="forgot-email" className="text-meta">
                    Email for reset link
                  </label>
                  <input
                    id="forgot-email"
                    className="input"
                    type="email"
                    placeholder="Email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                  />
                  <button
                    type="button"
                    className="button secondary"
                    disabled={forgotSending}
                    style={{ width: "100%", minHeight: 44, marginTop: 8 }}
                    onClick={() => void sendForgotPassword()}
                  >
                    {forgotSending ? "Sending…" : "Send reset link"}
                  </button>
                  {forgotMessage && <p className="text-meta">{forgotMessage}</p>}
                  {forgotError && <p style={{ color: "var(--danger-700)" }}>{forgotError}</p>}
                </div>
              )}

              <p className="text-body-md" style={{ marginTop: "var(--space-4)", textAlign: "center" }}>
                New here?{" "}
                <button type="button" className="linkish" onClick={() => setMode("register")}>
                  Create an account
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
