const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type AuthResponse = {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    photoUrl?: string | null;
    researchInterests?: string | null;
    engagementPoints?: number;
  };
};

export async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ? JSON.stringify(data.error) : "Request failed");
  }

  return (await res.json()) as T;
}
