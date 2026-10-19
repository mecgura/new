import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

/** The seed runs on every deploy. It must create the admin once and never overwrite a password later. */
const root = path.resolve(__dirname, "../..");
const file = path.join(root, "seed-test.db");
const url = "file:./seed-test.db";

const run = (env: Record<string, string>) =>
  execSync("npx tsx prisma/seed.ts", { cwd: root, env: { ...process.env, DATABASE_URL: url, PRISMA_SCHEMA: "prisma/schema.prisma", ...env }, stdio: "pipe" }).toString();

describe("seed: admin password", () => {
  it("creates once, survives redeploys, and only an explicit reset changes it", async () => {
    for (const f of [file, `${file}-journal`]) if (fs.existsSync(f)) fs.rmSync(f);
    execSync("npx prisma migrate deploy", { cwd: root, env: { ...process.env, DATABASE_URL: url, PRISMA_SCHEMA: "prisma/schema.prisma" }, stdio: "pipe" });
    const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
    try {
      const email = "seed-admin@test.local";
      run({ SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: "First-Password-111" });
      const first = await db.user.findUniqueOrThrow({ where: { email } });
      expect(first.role).toBe("SUPER_ADMIN");
      expect(await bcrypt.compare("First-Password-111", first.passwordHash)).toBe(true);

      // The admin changes the password in the app, then a redeploy runs the seed with the old env value.
      const changed = await bcrypt.hash("Changed-In-App-222", 4);
      await db.user.update({ where: { email }, data: { passwordHash: changed } });
      run({ SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: "First-Password-111" });
      const afterRedeploy = await db.user.findUniqueOrThrow({ where: { email } });
      expect(afterRedeploy.passwordHash).toBe(changed);
      run({ SEED_ADMIN_EMAIL: email });
      expect((await db.user.findUniqueOrThrow({ where: { email } })).passwordHash).toBe(changed);

      // An explicit reset still works and signs existing sessions out.
      run({ SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: "Reset-Password-333", SEED_ADMIN_RESET: "true" });
      const reset = await db.user.findUniqueOrThrow({ where: { email } });
      expect(await bcrypt.compare("Reset-Password-333", reset.passwordHash)).toBe(true);
      expect(reset.sessionVersion).toBe(first.sessionVersion + 1);
    } finally {
      await db.$disconnect();
      for (const f of [file, `${file}-journal`]) if (fs.existsSync(f)) fs.rmSync(f);
    }
  }, 120_000);
});
