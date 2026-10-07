import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["./src/test/global-setup.ts"],
    env: { COMMUNICATIONS_INLINE_WORKER: "false", DATABASE_URL: `file:${path.resolve(__dirname, ".test-db/test.db")}`, AUTH_SECRET: "test-secret-test-secret-test-secret-123456" },
  },
});
