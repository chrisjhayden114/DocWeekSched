import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    // The rendered-page test boots a programmatic Next dev server.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
