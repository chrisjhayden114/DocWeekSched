const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const CSRF_STORAGE_KEY = "ep_csrf";

export type AuthResponse = {
  csrfToken?: string;
  token?: string; // legacy — unused once cookies are set
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    photoUrl?: string | null;
    researchInterests?: string | null;
    participantType?: "GRAD_STUDENT" | "EDD_STUDENT" | "PHD_STUDENT" | "EDL_ALUMNI" | "PROFESSOR" | null;
    engagementPoints?: number;
    emailVerifiedAt?: string | null;
    isEventAdmin?: boolean;
    orgRole?: string | null;
    eventRole?: string | null;
  };
};

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getCsrfToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(CSRF_STORAGE_KEY) || readCookie("ep_csrf");
}

export function setCsrfToken(token: string | undefined | null) {
  if (typeof window === "undefined" || !token) return;
  window.sessionStorage.setItem(CSRF_STORAGE_KEY, token);
}

export function clearAuthClientState() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(CSRF_STORAGE_KEY);
  window.localStorage.removeItem("token");
  window.localStorage.removeItem("user");
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, _token?: string) {
  const method = (options.method || "GET").toUpperCase();
  const csrf = getCsrfToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (method !== "GET" && method !== "HEAD" && csrf) {
    headers["X-CSRF-Token"] = csrf;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    method,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = data.error
      ? typeof data.error === "string"
        ? data.error
        : JSON.stringify(data.error)
      : "Request failed";
    const err = new Error(message) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = data;
    throw err;
  }

  const data = (await res.json()) as T & { csrfToken?: string };
  if (data && typeof data === "object" && "csrfToken" in data && data.csrfToken) {
    setCsrfToken(data.csrfToken);
  }
  return data as T;
}

export { API_URL };
