import type { CookieOptions, Response } from "express";
import { env } from "./env";
import { generateOpaqueToken, signToken, type AuthToken } from "./auth";

/**
 * Cookie consent (Phase 6 / Chunk B):
 * We set ONLY essential auth cookies here (HttpOnly session JWT + readable CSRF token).
 * brand.cookieConsentRequired is false — no consent banner — because there are no non-essential
 * analytics/marketing cookies today. Revisit when S3 adds third-party analytics cookies.
 */
export function sessionCookieOptions(): CookieOptions {
  const opts: CookieOptions = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
  if (env.cookieDomain) {
    opts.domain = env.cookieDomain;
  }
  return opts;
}

export function csrfCookieOptions(): CookieOptions {
  const opts: CookieOptions = {
    httpOnly: false,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
  if (env.cookieDomain) {
    opts.domain = env.cookieDomain;
  }
  return opts;
}

export function setSessionCookies(res: Response, payload: AuthToken): { csrfToken: string } {
  const jwt = signToken(payload);
  const csrfToken = generateOpaqueToken(24);
  res.cookie(env.sessionCookieName, jwt, sessionCookieOptions());
  res.cookie(env.csrfCookieName, csrfToken, csrfCookieOptions());
  return { csrfToken };
}

export function clearSessionCookies(res: Response): void {
  const base: CookieOptions = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    maxAge: 0,
  };
  if (env.cookieDomain) base.domain = env.cookieDomain;
  res.cookie(env.sessionCookieName, "", { ...base, httpOnly: true });
  res.cookie(env.csrfCookieName, "", { ...base, httpOnly: false });
}
