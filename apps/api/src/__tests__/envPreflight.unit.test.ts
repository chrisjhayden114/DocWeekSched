/**
 * Phase 7 Chunk F — production env preflight: localhost public URLs are fatal
 * in production mode, degraded subsystems warn loudly, dev boot is unaffected.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectProductionPreflight } from "../lib/env";

/** Snapshot with everything a fully configured production deploy would set. */
function fullProdVars(): NodeJS.ProcessEnv {
  return {
    WEB_BASE_URL: "https://ukedl.com",
    API_PUBLIC_URL: "https://api.ukedl.com",
    RESEND_API_KEY: "re_x",
    VAPID_PUBLIC_KEY: "pub",
    VAPID_PRIVATE_KEY: "priv",
    LEMONSQUEEZY_API_KEY: "ls_x",
    AI_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "sk-ant-x",
    STORAGE_BUCKET: "bucket",
    STORAGE_ACCESS_KEY_ID: "ak",
    STORAGE_SECRET_ACCESS_KEY: "sk",
  };
}

describe("collectProductionPreflight — fatal checks", () => {
  it("passes with a fully configured production env", () => {
    const result = collectProductionPreflight(fullProdVars());
    expect(result.fatal).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("fails on localhost WEB_BASE_URL", () => {
    const vars = { ...fullProdVars(), WEB_BASE_URL: "http://localhost:3000" };
    const result = collectProductionPreflight(vars);
    expect(result.fatal.some((m) => m.includes("WEB_BASE_URL"))).toBe(true);
  });

  it("fails on unset WEB_BASE_URL and API_PUBLIC_URL", () => {
    const vars = fullProdVars();
    delete vars.WEB_BASE_URL;
    delete vars.API_PUBLIC_URL;
    const result = collectProductionPreflight(vars);
    expect(result.fatal).toHaveLength(2);
  });

  it("fails on localhost-flavored API_PUBLIC_URL variants", () => {
    for (const url of ["http://localhost:4000", "http://127.0.0.1:4000", "http://api.local"]) {
      const result = collectProductionPreflight({ ...fullProdVars(), API_PUBLIC_URL: url });
      expect(result.fatal.some((m) => m.includes("API_PUBLIC_URL")), url).toBe(true);
    }
  });
});

describe("collectProductionPreflight — degraded-subsystem warnings", () => {
  it("warns per missing subsystem with the fallback behavior named", () => {
    const vars = fullProdVars();
    delete vars.RESEND_API_KEY;
    delete vars.VAPID_PUBLIC_KEY;
    delete vars.LEMONSQUEEZY_API_KEY;
    delete vars.STORAGE_BUCKET;
    vars.AI_PROVIDER = "mock";
    const { fatal, warnings } = collectProductionPreflight(vars);
    expect(fatal).toEqual([]);
    expect(warnings.some((w) => w.includes("copy-link"))).toBe(true);
    expect(warnings.some((w) => w.includes("web push disabled"))).toBe(true);
    expect(warnings.some((w) => w.includes("503"))).toBe(true);
    expect(warnings.some((w) => w.includes("mock output"))).toBe(true);
    expect(warnings.some((w) => w.includes("data-URLs"))).toBe(true);
    expect(warnings).toHaveLength(5);
  });

  it("warns when anthropic is selected without a key", () => {
    const vars = fullProdVars();
    delete vars.ANTHROPIC_API_KEY;
    const { warnings } = collectProductionPreflight(vars);
    expect(warnings.some((w) => w.includes("ANTHROPIC_API_KEY"))).toBe(true);
  });

  it("treats EMAIL_PROVIDER=none as email disabled even with a key", () => {
    const vars = { ...fullProdVars(), EMAIL_PROVIDER: "none" };
    const { warnings } = collectProductionPreflight(vars);
    expect(warnings.some((w) => w.includes("email disabled"))).toBe(true);
  });
});

describe("module boot behavior", () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["NODE_ENV", "DATABASE_URL", "JWT_SECRET", "WEB_BASE_URL", "API_PUBLIC_URL"];

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.DATABASE_URL = "postgresql://user:pass@db.example.com:5432/app";
    process.env.JWT_SECRET = "a-sufficiently-long-test-secret";
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("production boot throws on localhost public URLs", async () => {
    process.env.NODE_ENV = "production";
    process.env.WEB_BASE_URL = "http://localhost:3000";
    process.env.API_PUBLIC_URL = "http://localhost:4000";
    await expect(import("../lib/env")).rejects.toThrow(/preflight failed/i);
  });

  it("production boot succeeds with public URLs set (warnings only)", async () => {
    process.env.NODE_ENV = "production";
    process.env.WEB_BASE_URL = "https://ukedl.com";
    process.env.API_PUBLIC_URL = "https://api.ukedl.com";
    const mod = await import("../lib/env");
    expect(mod.env.isProd).toBe(true);
    expect(mod.env.webBaseUrl).toBe("https://ukedl.com");
  });

  it("development boot is unaffected by localhost defaults", async () => {
    process.env.NODE_ENV = "development";
    process.env.WEB_BASE_URL = "http://localhost:3000";
    delete process.env.API_PUBLIC_URL;
    const mod = await import("../lib/env");
    expect(mod.env.isProd).toBe(false);
    expect(mod.env.apiPublicUrl).toContain("localhost");
  });
});
