import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: ["**/node_modules/**", "tests/e2e/**"],
    testTimeout: 15_000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
