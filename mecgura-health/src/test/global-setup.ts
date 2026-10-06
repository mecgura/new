import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

// Fresh SQLite database (all committed migrations applied) for integration tests.
const dir = path.resolve(process.cwd(), ".test-db");

export default function setup() {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execSync("npx prisma migrate deploy", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: `file:${path.join(dir, "test.db")}`, PRISMA_SCHEMA: "prisma/schema.prisma" },
  });
  return () => rmSync(dir, { recursive: true, force: true });
}
