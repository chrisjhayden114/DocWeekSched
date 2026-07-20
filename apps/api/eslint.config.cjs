/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  {
    files: ["src/**/*.{ts,tsx,js}"],
    ignores: ["src/lib/ai/**"],
    languageOptions: {
      parser: require("@typescript-eslint/parser"),
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: {
      "@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@anthropic-ai/sdk",
              message: "Import Anthropic only via lib/ai (gateway). Direct provider SDK imports are forbidden.",
            },
          ],
          patterns: [
            {
              group: ["@anthropic-ai/*"],
              message: "Import Anthropic only via lib/ai (gateway). Direct provider SDK imports are forbidden.",
            },
          ],
        },
      ],
    },
  },
  {
    // Gateway / providers may import the SDK.
    files: ["src/lib/ai/**/*.{ts,tsx,js}"],
    languageOptions: {
      parser: require("@typescript-eslint/parser"),
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    rules: {},
  },
];
