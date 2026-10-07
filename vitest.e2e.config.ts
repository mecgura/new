import path from "node:path";
import { defineConfig } from "vitest/config";

// HTTP end-to-end smoke tests against a RUNNING server:
//   E2E_BASE_URL=http://localhost:3000 DATABASE_URL=file:./dev.db npm run test:e2e
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", include: ["tests/e2e/**/*.e2e.ts"], fileParallelism: false, testTimeout: 60_000, hookTimeout: 60_000 },
});
