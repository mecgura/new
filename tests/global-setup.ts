import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Fresh, isolated SQLite database for every test run (never touches dev.db).
export default function setup() {
  const file = path.resolve(__dirname, "../test.db");
  for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: "file:./test.db", PRISMA_SCHEMA: "prisma/schema.prisma" },
    stdio: "pipe",
  });
}
