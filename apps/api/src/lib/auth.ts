import { createHash, randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "./env";

export const hashPassword = async (password: string) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

export const verifyPassword = async (password: string, hash: string) => {
  return bcrypt.compare(password, hash);
};

/** SHA-256 hex digest for opaque tokens stored at rest. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type AuthToken = {
  userId: string;
  role: "ADMIN" | "ATTENDEE" | "SPEAKER";
};

export const signToken = (payload: AuthToken) => {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "7d" });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, env.jwtSecret) as AuthToken;
};

const COMMON_BREACHED = new Set(
  [
    "password",
    "password1",
    "password123",
    "12345678",
    "123456789",
    "qwerty123",
    "letmein1",
    "welcome1",
    "admin123",
    "iloveyou",
    "monkey12",
    "football",
    "baseball",
    "dragon12",
    "master12",
    "login123",
    "abc12345",
    "passw0rd",
    "changeme",
    "trustno1",
  ].map((s) => s.toLowerCase()),
);

/**
 * Password policy: min 8 chars; reject common breached passwords.
 * Optionally checks Have I Been Pwned k-anonymity range API when network is available.
 */
export async function assertPasswordAllowed(password: string): Promise<void> {
  if (password.length < 8) {
    throw new Error("PASSWORD_TOO_SHORT");
  }
  if (COMMON_BREACHED.has(password.toLowerCase())) {
    throw new Error("PASSWORD_BREACHED");
  }

  try {
    const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "event-app-password-check" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return;
    const text = await res.text();
    const hit = text.split("\n").some((line) => {
      const [hashSuffix] = line.trim().split(":");
      return hashSuffix?.toUpperCase() === suffix;
    });
    if (hit) throw new Error("PASSWORD_BREACHED");
  } catch (err) {
    if (err instanceof Error && (err.message === "PASSWORD_BREACHED" || err.message === "PASSWORD_TOO_SHORT")) {
      throw err;
    }
    // Network failures: local list already applied; do not block registration.
  }
}
