/**
 * Phase 7 Chunk B — destructive-operation guard (unit).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertDestructiveAllowed,
  DestructiveGuardError,
  looksLikeLocalOrTestDb,
} from "../lib/destructiveGuard";

const NEON_URL = "postgresql://user:pass@ep-cool-name-123456.us-west-2.aws.neon.tech/neondb";
const LOCAL_URL = "postgresql://postgres:postgres@localhost:5432/event_app";

describe("looksLikeLocalOrTestDb", () => {
  it("accepts localhost and loopback hosts", () => {
    expect(looksLikeLocalOrTestDb(LOCAL_URL)).toBe(true);
    expect(looksLikeLocalOrTestDb("postgresql://u:p@127.0.0.1:5432/app")).toBe(true);
  });

  it("accepts test-named databases and hosts", () => {
    expect(looksLikeLocalOrTestDb("postgresql://u:p@db.example.com:5432/event_app_test")).toBe(true);
    expect(looksLikeLocalOrTestDb("postgresql://u:p@test-db.internal:5432/app")).toBe(true);
  });

  it("rejects hosted production-looking URLs", () => {
    expect(looksLikeLocalOrTestDb(NEON_URL)).toBe(false);
  });

  it("rejects unparseable URLs (cannot prove safety)", () => {
    expect(looksLikeLocalOrTestDb("not a url")).toBe(false);
  });
});

describe("assertDestructiveAllowed", () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["DATABASE_URL", "NODE_ENV", "ALLOW_DESTRUCTIVE_DB"] as const;

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("blocks db-tests against a hosted URL without override", () => {
    process.env.DATABASE_URL = NEON_URL;
    process.env.NODE_ENV = "test";
    delete process.env.ALLOW_DESTRUCTIVE_DB;
    expect(() => assertDestructiveAllowed("db-tests")).toThrow(DestructiveGuardError);
  });

  it("blocks db-tests against a hosted URL even in NODE_ENV=production", () => {
    process.env.DATABASE_URL = NEON_URL;
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_DESTRUCTIVE_DB;
    expect(() => assertDestructiveAllowed("db-tests")).toThrow(DestructiveGuardError);
  });

  it("blocks demo-reset and account-hard-delete in dev against a hosted URL", () => {
    process.env.DATABASE_URL = NEON_URL;
    process.env.NODE_ENV = "development";
    delete process.env.ALLOW_DESTRUCTIVE_DB;
    expect(() => assertDestructiveAllowed("demo-reset")).toThrow(DestructiveGuardError);
    expect(() => assertDestructiveAllowed("account-hard-delete")).toThrow(DestructiveGuardError);
    expect(() => assertDestructiveAllowed("seed-script")).toThrow(DestructiveGuardError);
  });

  it("allows normal production operation for non-test scopes", () => {
    process.env.DATABASE_URL = NEON_URL;
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_DESTRUCTIVE_DB;
    expect(() => assertDestructiveAllowed("demo-reset")).not.toThrow();
    expect(() => assertDestructiveAllowed("account-hard-delete")).not.toThrow();
    expect(() => assertDestructiveAllowed("seed-script")).not.toThrow();
  });

  it("allows local/test databases in dev without override", () => {
    process.env.DATABASE_URL = LOCAL_URL;
    process.env.NODE_ENV = "development";
    delete process.env.ALLOW_DESTRUCTIVE_DB;
    expect(() => assertDestructiveAllowed("db-tests")).not.toThrow();
    expect(() => assertDestructiveAllowed("demo-reset")).not.toThrow();
  });

  it("ALLOW_DESTRUCTIVE_DB=1 overrides everything", () => {
    process.env.DATABASE_URL = NEON_URL;
    process.env.NODE_ENV = "test";
    process.env.ALLOW_DESTRUCTIVE_DB = "1";
    expect(() => assertDestructiveAllowed("db-tests")).not.toThrow();
    expect(() => assertDestructiveAllowed("demo-reset")).not.toThrow();
  });

  it("allows when DATABASE_URL is unset (nothing to destroy)", () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "test";
    delete process.env.ALLOW_DESTRUCTIVE_DB;
    expect(() => assertDestructiveAllowed("db-tests")).not.toThrow();
  });
});
