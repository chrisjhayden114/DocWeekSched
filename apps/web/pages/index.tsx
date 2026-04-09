import { useEffect, useState } from "react";
import { apiFetch, AuthResponse } from "../lib/api";

export default function Home() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = window.localStorage.getItem("token");
    if (token) {
      window.location.href = "/dashboard";
    }
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const data = await apiFetch<AuthResponse>(`/auth/${mode === "login" ? "login" : "register"}`, {
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

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>Event Hub</h1>
          <p style={{ color: "var(--ink-700)" }}>
            Agenda, announcements, check-ins, surveys, and chat in one place.
          </p>
        </div>
        <span className="badge">Blue theme</span>
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
              <input className="input" name="name" placeholder="Full name" required />
              <select className="select" name="role" defaultValue="ATTENDEE">
                <option value="ATTENDEE">Attendee</option>
                <option value="SPEAKER">Speaker</option>
                <option value="ADMIN">Admin</option>
              </select>
            </>
          )}
          <input className="input" name="email" type="email" placeholder="Email" required />
          <input className="input" name="password" type="password" placeholder="Password (min 8)" required />
          {error && <div style={{ color: "crimson" }}>{error}</div>}
          <button className="button" disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
