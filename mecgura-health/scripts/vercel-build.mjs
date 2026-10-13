// Build step used by vercel.json. Checks the settings that most often break a first deploy, says exactly what is missing,
// runs migrations for PRODUCTION deploys only, then builds.
import { spawnSync } from "node:child_process";
const env = process.env; const prod = env.VERCEL_ENV === "production"; const problems = [];
if (!/schema\.postgres\.prisma$/.test(env.PRISMA_SCHEMA ?? "")) problems.push("PRISMA_SCHEMA must be set to prisma/schema.postgres.prisma (Vercel → Settings → Environment Variables, ALL environments), then Redeploy WITHOUT build cache.");
if (prod && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? "")) problems.push("DATABASE_URL (a PostgreSQL URL) is missing for the Production environment.");
if (problems.length) { console.error("\nDeployment settings missing:\n - " + problems.join("\n - ") + "\n"); process.exit(1); }
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: "inherit", env }); if (r.status !== 0) process.exit(r.status ?? 1); };
if (prod) run("npx", ["prisma", "migrate", "deploy"]); else console.log("Preview/dev deploy: skipping database migrations.");
run("npx", ["next", "build"]);
