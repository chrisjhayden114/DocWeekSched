import dotenv from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { log } from "./log";

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

// ---------------------------------------------------------------------------
// Production env preflight (Phase 7 Chunk F).
//
// Fatal: public URLs still pointing at localhost — every emailed link, ICS
// feed, CORS allowlist entry, and billing redirect would be wrong.
// Warnings: subsystems that boot but run degraded; one loud line each so a
// misconfigured deploy is visible in the first screen of logs.
// ---------------------------------------------------------------------------

function isLocalhostUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname;
    return (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.startsWith("127.") ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

export type PreflightResult = { fatal: string[]; warnings: string[] };

/** Pure — evaluates a vars snapshot so tests don't have to re-import the module. */
export function collectProductionPreflight(vars: NodeJS.ProcessEnv): PreflightResult {
  const fatal: string[] = [];
  const warnings: string[] = [];

  const webBaseUrl = vars.WEB_BASE_URL?.trim() || "";
  if (!webBaseUrl) {
    fatal.push("WEB_BASE_URL is not set — emailed links, CORS, and redirects would target localhost.");
  } else if (isLocalhostUrl(webBaseUrl)) {
    fatal.push(`WEB_BASE_URL=${webBaseUrl} is a localhost default — set the public web origin (e.g. https://ukedl.com).`);
  }

  const apiPublicUrl = vars.API_PUBLIC_URL?.trim() || "";
  if (!apiPublicUrl) {
    fatal.push("API_PUBLIC_URL is not set — ICS feed URLs would point at localhost.");
  } else if (isLocalhostUrl(apiPublicUrl)) {
    fatal.push(`API_PUBLIC_URL=${apiPublicUrl} is a localhost default — set the public API origin (e.g. https://api.ukedl.com).`);
  }

  if (!vars.RESEND_API_KEY?.trim() || (vars.EMAIL_PROVIDER || "").trim().toLowerCase() === "none") {
    warnings.push("email disabled: invites/password-reset/verification fall back to copy-link only (set RESEND_API_KEY).");
  }
  if (!vars.VAPID_PUBLIC_KEY?.trim() || !vars.VAPID_PRIVATE_KEY?.trim()) {
    warnings.push("web push disabled: no VAPID keypair (set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT).");
  }
  if (!vars.LEMONSQUEEZY_API_KEY?.trim()) {
    warnings.push("billing unconfigured: checkout/portal return 503 (set LEMONSQUEEZY_API_KEY + LEMONSQUEEZY_STORE_ID + LEMONSQUEEZY_WEBHOOK_SECRET + variants).");
  }
  const aiProvider = (vars.AI_PROVIDER || "mock").trim().toLowerCase();
  if (aiProvider !== "anthropic") {
    warnings.push("AI_PROVIDER=mock: agents (ingest/concierge/matchmaker/ops/recap) return deterministic mock output (set AI_PROVIDER=anthropic + ANTHROPIC_API_KEY).");
  } else if (!vars.ANTHROPIC_API_KEY?.trim()) {
    warnings.push("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is unset: AI calls will fail (set the key or fall back to AI_PROVIDER=mock).");
  }
  if (
    !vars.STORAGE_BUCKET?.trim() ||
    !vars.STORAGE_ACCESS_KEY_ID?.trim() ||
    !vars.STORAGE_SECRET_ACCESS_KEY?.trim()
  ) {
    warnings.push("object storage unset: uploads fall back to data-URLs stored in Postgres (set STORAGE_BUCKET + STORAGE_ACCESS_KEY_ID + STORAGE_SECRET_ACCESS_KEY).");
  }

  return { fatal, warnings };
}

if (isProd) {
  const { fatal, warnings } = collectProductionPreflight(process.env);
  for (const warning of warnings) {
    log("warn", `[preflight] ${warning}`);
  }
  if (fatal.length > 0) {
    throw new Error(
      `Production env preflight failed:\n- ${fatal.join("\n- ")}\n` +
        "Fix the variables above (see RUNBOOK.md §10) and redeploy.",
    );
  }
}
