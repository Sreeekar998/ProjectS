import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      ".next-build/**",
      ".next-e2e/**",
      "tests/e2e/**",
      "playwright-report/**",
      "test-results/**",
      "drizzle/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      // Client-side API responses are intentionally loosely typed at the
      // fetch boundary (src/lib/client/api.ts and the pages that consume
      // it) rather than duplicating every server DTO as a client type —
      // strict TypeScript compilation (tsc --noEmit) still catches real
      // type errors everywhere else. Downgraded to a warning, not disabled.
      "@typescript-eslint/no-explicit-any": "warn",
      // The `_name` prefix is this codebase's explicit "destructured to omit"
      // marker (e.g. dropping an internal field before returning a result).
      // Flagging it would push us toward `delete` or a cast, both worse.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
];
