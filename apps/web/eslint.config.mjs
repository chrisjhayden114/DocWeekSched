/**
 * CI-1 — web lint. The bug class this exists for is the unstable-dependency
 * effect (an effect whose deps include a callback recreated on every parent
 * render, so it tears down and re-runs constantly and steals focus —
 * live-observed in SlideOver and WelcomeFlow). `react-hooks/exhaustive-deps`
 * is the rule that catches it, so it runs as an error, not a warning.
 *
 * ESLint 9 here while apps/api is on 10: eslint-plugin-react, -import and
 * -jsx-a11y (all pulled in by next/core-web-vitals) still cap their peer range
 * at ESLint 9 and, under 10, die on context APIs that 10 removed. Revisit when
 * the Next preset ships an ESLint 10-compatible dependency set.
 */
import coreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * eslint-plugin-react-hooks v7 also ships the React Compiler rules (purity,
 * immutability, no setState in effects, …). This app is React 18 / Next 14 with
 * no compiler in the pipeline, and these report ~80 findings that each need a
 * real refactor. Turning them on is its own piece of work, not a side effect of
 * adding CI lint.
 */
const reactCompilerRules = [
  "react-hooks/config",
  "react-hooks/error-boundaries",
  "react-hooks/gating",
  "react-hooks/globals",
  "react-hooks/immutability",
  "react-hooks/incompatible-library",
  "react-hooks/preserve-manual-memoization",
  "react-hooks/purity",
  "react-hooks/refs",
  "react-hooks/set-state-in-effect",
  "react-hooks/set-state-in-render",
  "react-hooks/static-components",
  "react-hooks/unsupported-syntax",
  "react-hooks/use-memo",
];

const config = [
  {
    ignores: ["**/node_modules/**", ".next/**", ".netlify/**", "out/**", "public/**", "next-env.d.ts"],
  },
  ...coreWebVitals,
  {
    linterOptions: {
      // The repo carries eslint-disable comments for rules this config does not
      // enable (react/no-danger, @typescript-eslint/no-var-requires). They
      // document intent for readers; reporting them as unused would only push
      // us to delete that intent to keep CI green.
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      ...Object.fromEntries(reactCompilerRules.map((rule) => [rule, "off"])),
      "react-hooks/exhaustive-deps": "error",
      // Avatars and uploaded images are data URLs or arbitrary remote hosts and
      // next/image has no loader configured for Netlify, so plain <img> is the
      // deliberate choice here.
      "@next/next/no-img-element": "off",
      // Hard navigation via window.location is deliberate on auth boundaries
      // (login, invite accept, event switch): the full document load is what
      // clears in-memory auth state and re-reads cookies.
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
];

export default config;
