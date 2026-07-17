import type { CookieOptions, Response } from "express";
import { env } from "./env";
import { generateOpaqueToken, signToken, type AuthToken } from "./auth";

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
