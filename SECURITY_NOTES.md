# Security notes

## Dependency audit triage — Chunk E7 (2026-08-02)

Baseline before triage: `npm audit` reported **9 vulnerabilities (1 low, 3 moderate, 4 high, 1 critical)**.
After triage: **1 high** remains, documented below.

### Fixed in this pass

| Package | Severity | Where it sat | Fix applied |
| --- | --- | --- | --- |
| tar 6.2.1 (critical, 12 advisories incl. GHSA-34x7-hfp2-rc4v) | Critical | apps/api runtime chain: bcrypt → @mapbox/node-pre-gyp → tar (only exercised at `npm install` time to unpack bcrypt's prebuilt binary) | No patched 6.x exists; root `overrides` pins tar to `^7.5.22` under `@mapbox/node-pre-gyp`. bcrypt verified working after the pin (hash + compare round-trip). |
| postcss 8.4.31 (high, GHSA-qx2v-qp2m-jg93 and 2 others) | High | apps/web build-time: next@14.2.35 pins postcss exactly at 8.4.31 | Root `overrides` lifts next's postcss to `^8.5.19` (installed 8.5.25). Minor-version bump, API-compatible; web build verified green. |
| brace-expansion 1.1.13 / 5.0.7 (high, DoS) | High | Dev/build tooling only (eslint, typescript-eslint, Sentry bundler plugins) plus the install-time node-pre-gyp chain | `npm audit fix` → 1.1.18 / 5.0.9 |
| body-parser 1.20.4 (moderate, GHSA-v422-hmwv-36x6) | Moderate | apps/api runtime: express | `npm audit fix` → express 4.22.2 / body-parser 1.20.6 |
| qs 6.14.2 (moderate, GHSA-q8mj-m7cp-5q26) | Moderate | apps/api runtime: express | `npm audit fix` → qs 6.15.3 |
| esbuild 0.27.7 (low, GHSA-g7r4-m6w7-qqqr — Windows-only dev-server file read) | Low | Dev-only: tsx dev runner + vitest in apps/api | `npm update tsx` → tsx 4.23.4, which carries esbuild 0.28.1 (patched) |

### Open: next@14.2.35 (high) — requires a major upgrade

- **What:** `npm audit` aggregates ~22 advisories against `next` with a combined vulnerable range of 9.5.0 – 15.5.20. The patched releases are next **15.5.21+** or **16.2.12+** — both are major bumps from our 14.2.35 (which is the final 14.x release; no backport is coming).
- **Why acceptable for now:**
  - apps/web is a **Pages Router** app with **no `middleware.ts`** and **no i18n config**. The majority of the advisories target the App Router, React Server Components, or Server Actions (DoS, cache poisoning, SSRF in Server Actions, CSP-nonce XSS) — those code paths are not present in this app.
  - Advisories that could apply to a Pages Router app (Image Optimization API DoS, image disk-cache growth, request smuggling in rewrites) are mitigated by our deployment shape: the site is deployed on **Netlify via @netlify/plugin-nextjs**, not a self-hosted `next start` server, and image optimization is handled by Netlify's image CDN rather than the vulnerable self-hosted optimizer.
  - Nothing in the remaining set is remote-code-execution or data-disclosure against our configuration.
- **Trigger for revisiting:** the planned Next 15/16 upgrade (flagged to the founder as a separate chunk — it is a breaking change touching the web build, Netlify runtime plugin, and React 18 → 19). Revisit immediately if we (a) add middleware or i18n routing, (b) move off Netlify to self-hosting, or (c) a new advisory lands against Pages Router on 14.x.

### Open: uuid@8.3.2 via exceljs (moderate) — vulnerable functions unreachable

Added 2026-08-06 with Chunk E21 (exceljs parses .xlsx uploads server-side).

- **What:** GHSA-w5hq-g745-h8pq — `uuid` < 11.1.1 misses a buffer bounds check in
  `v3`/`v5`/`v6` **when a caller passes the optional `buf` argument**. exceljs pins
  `uuid@^8.3.2`.
- **Why acceptable for now:** the vulnerable functions are not reachable. exceljs
  contains exactly one uuid call site (`lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`),
  which calls `v4()` with no arguments — a different function, and no `buf` is ever
  passed. Nothing else in the dependency tree depends on uuid (`npm ls uuid`).
- **Why not overridden:** an `overrides` pin to uuid ^11 requires regenerating
  `package-lock.json` from scratch (npm does not re-resolve an existing lockfile when
  overrides change — see "Notes on the mechanics" below). Full-tree version churn is a
  worse trade than a documented-unreachable moderate advisory.
- **Trigger for revisiting:** an exceljs release that lifts uuid past 11.1.1 (take it),
  any new advisory against uuid `v4`, or the next deliberate lockfile regeneration —
  add the override then.

### Notes on the mechanics

- Fixes were applied with `npm audit fix` (never `--force`), a semver-range `npm update tsx`, and two scoped entries in root `package.json` `overrides`.
- Applying the overrides required regenerating `package-lock.json` from scratch (`rm node_modules package-lock.json && npm install`) because npm does not re-resolve an existing valid lockfile when overrides change. All resulting version churn stays within the semver ranges declared by each workspace's `package.json`.
- `npm ls` prints tar@7.5.22 and postcss@8.5.25 as "invalid" against the parents' declared ranges — this is the expected cosmetic side-effect of npm overrides, not an install error.
