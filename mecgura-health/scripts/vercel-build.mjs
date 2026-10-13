// Build step used by vercel.json. Checks the settings that most often break a first deploy, says exactly what is missing,
import { spawnSync } from "node:child_process";
const env = process.env; const prod = env.VERCEL_ENV === "production"; const problems = [];
const present = (k) => (env[k] ? "set" : "MISSING");
console.log(`[vercel-build] VERCEL_ENV=${env.VERCEL_ENV ?? "?"} PRISMA_SCHEMA=${present("PRISMA_SCHEMA")} DATABASE_URL=${present("DATABASE_URL")} DATABASE_URL_UNPOOLED=${present("DATABASE_URL_UNPOOLED")} AUTH_SECRET=${present("AUTH_SECRET")} SECURITY_KEYS=${present("SECURITY_KEYS")} CRON_SECRET=${present("CRON_SECRET")} APP_URL=${present("APP_URL")}`);
if (!/schema\.postgres\.prisma$/.test(env.PRISMA_SCHEMA ?? "")) problems.push("PRISMA_SCHEMA must be set to prisma/schema.postgres.prisma (Vercel → Settings → Environment Variables, ALL environments), then Redeploy WITHOUT build cache.");
if (prod && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? "")) problems.push("DATABASE_URL (a PostgreSQL URL) is missing for the Production environment.");
if (problems.length) { console.error("\nDeployment settings missing:\n - " + problems.join("\n - ") + "\n"); process.exit(1); }
const run = (cmd, args, e = env) => { const r = spawnSync(cmd, args, { stdio: "inherit", env: e }); if (r.status !== 0) { console.error(`\n[vercel-build] FAILED: ${cmd} ${args.join(" ")} (exit ${r.status})\n`); process.exit(r.status ?? 1); } };
if (prod) {
  // Migrations need a direct connection: pooled (pgbouncer) URLs cannot hold the advisory lock Prisma Migrate uses.
  const direct = env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING;
  console.log(`[vercel-build] running migrations over the ${direct ? "direct (unpooled)" : "DATABASE_URL"} connection`);
  run("npx", ["prisma", "migrate", "deploy"], direct ? { ...env, DATABASE_URL: direct } : env);
} else console.log("[vercel-build] preview/dev deploy: skipping database migrations");
run("npx", ["next", "build"]);
