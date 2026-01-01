import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    alias: {
      "@": path.resolve(__dirname, "./"),
      // Mock server-only for tests
      "server-only": path.resolve(__dirname, "./tests/__mocks__/server-only.ts"),
    },
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
