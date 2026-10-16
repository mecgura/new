import { defineConfig } from "vitest/config";
import path from "node:path";

/** Performance benchmark (not part of the normal test run): `npm run perf`. Builds a large synthetic dataset in a throw-away SQLite file and times real service calls. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts") } },
  test: {
    environment: "node", include: ["perf/**/*.perf.ts"], fileParallelism: false, testTimeout: 600_000, hookTimeout: 600_000, globalSetup: ["./src/test/global-setup.ts"],
    env: { DATABASE_URL: `file:${path.resolve(__dirname, ".test-db/test.db")}`, AUTH_SECRET: "test-secret-test-secret-test-secret-123456", COMMUNICATIONS_INLINE_WORKER: "false" },
  },
});
