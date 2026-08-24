import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps jsx: "preserve" for the Next compiler; vitest transpiles the
  // component tests itself and needs a real JSX transform.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    // Component tests (*.test.tsx) opt into jsdom with a @vitest-environment docblock.
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    // The rendered-page test boots a programmatic Next dev server.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
