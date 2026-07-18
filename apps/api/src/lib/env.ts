import dotenv from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

/** Load nearest .env — apps/api/.env or monorepo root. */
function loadEnvFiles() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), "../../.env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) dotenv.config({ path: p });
  }
  dotenv.config();
}

loadEnvFiles();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required and must be set (no insecure defaults).`);
  }
  return value;
}

const jwtSecret = requireEnv("JWT_SECRET");
if (jwtSecret === "dev-secret" || jwtSecret.length < 16) {
  throw new Error("JWT_SECRET must be a strong secret (min 16 chars); refuse to boot with a weak/default value.");
}

const cookieSameSiteRaw = (process.env.COOKIE_SAMESITE || "lax").toLowerCase();
const cookieSameSite =
  cookieSameSiteRaw === "none" || cookieSameSiteRaw === "strict" || cookieSameSiteRaw === "lax"
    ? cookieSameSiteRaw
    : "lax";

const cookieDomain = process.env.COOKIE_DOMAIN?.trim() || "";
const nodeEnv = process.env.NODE_ENV || "development";
const isProd = nodeEnv === "production";

/** When SameSite=None (cross-site interim), cookies must be Secure. */
const cookieSecure =
  process.env.COOKIE_SECURE === "true" ||
  process.env.COOKIE_SECURE === "1" ||
  cookieSameSite === "none" ||
  isProd;

export const env = {
  databaseUrl: requireEnv("DATABASE_URL"),
  jwtSecret,
  adminInviteCode: process.env.ADMIN_INVITE_CODE || "",
  apiPort: Number(process.env.PORT || process.env.API_PORT || 4000),
  webBaseUrl: process.env.WEB_BASE_URL || "http://localhost:3000",
  nodeEnv,
  isProd,
  /** e.g. `.ukedl.com` once API is at api.ukedl.com; empty for localhost. */
  cookieDomain,
  cookieSameSite: cookieSameSite as "lax" | "strict" | "none",
  cookieSecure,
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "ep_session",
  csrfCookieName: process.env.CSRF_COOKIE_NAME || "ep_csrf",
  /** Account-setup invite token lifetime (days). */
  inviteTokenDays: Number(process.env.INVITE_TOKEN_DAYS || 7),
  /** Public API origin for ICS feed URLs (defaults to localhost API port). */
  apiPublicUrl: (process.env.API_PUBLIC_URL || "").trim() || `http://localhost:${Number(process.env.PORT || process.env.API_PORT || 4000)}`,
};

if (env.cookieSameSite === "none" && !env.cookieSecure) {
  throw new Error("COOKIE_SAMESITE=none requires Secure cookies (set COOKIE_SECURE=true).");
}
