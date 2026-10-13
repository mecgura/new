// Build step used by vercel.json. Checks the settings that most often break a first deploy, says exactly what is missing,
import { spawnSync } from "node:child_process";
const env = process.env; const prod = env.VERCEL_ENV === "production"; const problems = [];
/**
 * One-time recovery for a half-initialised EMPTY database (Prisma error P3005: tables exist but there is no migration history).
 * Only runs when RESET_EMPTY_DATABASE=yes is set, and only if (a) migration history is missing/empty AND (b) the key data tables hold no rows.
 * A database that is already migrated, or holds any clinic data, is never touched and the flag is simply ignored.
 */
async function resetEmptyDatabase(url) {
  if (env.DATABASE_SCHEMA) { console.log("[vercel-build] RESET_EMPTY_DATABASE ignored: DATABASE_SCHEMA is set (a dedicated schema is never reset automatically)"); return; }
  const { default: pg } = await import("pg"); const c = new pg.Client({ connectionString: url, ssl: /sslmode=disable/.test(url) || /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } }); await c.connect();
  try {
    const t = (await c.query("select table_name from information_schema.tables where table_schema='public'")).rows.map((r) => r.table_name);
    if (t.length === 0) { console.log("[vercel-build] database is empty: nothing to reset"); return; }
    if (t.includes("_prisma_migrations")) { const n = Number((await c.query('select count(*) n from "_prisma_migrations" where finished_at is not null')).rows[0].n); if (n > 0) { console.log(`[vercel-build] migration history exists (${n} applied): RESET_EMPTY_DATABASE ignored`); return; } }
    for (const name of ["Tenant", "User", "Patient", "Appointment", "Invoice", "AuditLog"]) if (t.includes(name)) { const n = Number((await c.query(`select count(*) n from "${name}"`)).rows[0].n); if (n > 0) { console.error(`[vercel-build] REFUSING to reset: table ${name} holds ${n} row(s)`); process.exit(1); } }
    console.log(`[vercel-build] resetting half-initialised empty database (${t.length} stray tables, no data rows)`);
    await c.query("DROP SCHEMA public CASCADE"); await c.query("CREATE SCHEMA public");
  } finally { await c.end(); }
}
/** When DATABASE_SCHEMA is set (database shared with another app), create that schema if needed. Never touches other schemas. */
async function ensureSchema(url, schema) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema) || schema === "public") { console.error(`[vercel-build] DATABASE_SCHEMA must be a lowercase name other than "public" (got "${schema}")`); process.exit(1); }
  const { default: pg } = await import("pg"); const c = new pg.Client({ connectionString: url }); await c.connect();
  try { await c.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`); console.log(`[vercel-build] using PostgreSQL schema "${schema}"`); } finally { await c.end(); }
}
const present = (k) => (env[k] ? "set" : "MISSING");
console.log(`[vercel-build] VERCEL_ENV=${env.VERCEL_ENV ?? "?"} PRISMA_SCHEMA=${present("PRISMA_SCHEMA")} DATABASE_URL=${present("DATABASE_URL")} DATABASE_URL_UNPOOLED=${present("DATABASE_URL_UNPOOLED")} AUTH_SECRET=${present("AUTH_SECRET")} SECURITY_KEYS=${present("SECURITY_KEYS")} CRON_SECRET=${present("CRON_SECRET")} APP_URL=${present("APP_URL")}`);
if (!/schema\.postgres\.prisma$/.test(env.PRISMA_SCHEMA ?? "")) problems.push("PRISMA_SCHEMA must be set to prisma/schema.postgres.prisma (Vercel → Settings → Environment Variables, ALL environments), then Redeploy WITHOUT build cache.");
if (prod && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? "")) problems.push("DATABASE_URL (a PostgreSQL URL) is missing for the Production environment.");
if (problems.length) { console.error("\nDeployment settings missing:\n - " + problems.join("\n - ") + "\n"); process.exit(1); }
const run = (cmd, args, e = env) => { const r = spawnSync(cmd, args, { stdio: "inherit", env: e }); if (r.status !== 0) { console.error(`\n[vercel-build] FAILED: ${cmd} ${args.join(" ")} (exit ${r.status})\n`); process.exit(r.status ?? 1); } };
if (prod) {
  // Migrations need a direct connection: pooled (pgbouncer) URLs cannot hold the advisory lock Prisma Migrate uses.
  const direct = env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING;
  if (env.DATABASE_SCHEMA) await ensureSchema(direct || env.DATABASE_URL, env.DATABASE_SCHEMA);
  if (env.RESET_EMPTY_DATABASE === "yes") await resetEmptyDatabase(direct || env.DATABASE_URL);
  console.log(`[vercel-build] running migrations over the ${direct ? "direct (unpooled)" : "DATABASE_URL"} connection`);
  // Advisory locking is switched off: on serverless Postgres (Neon) the lock can time out (P1002). Only one deploy migrates at a time here.
  run("npx", ["prisma", "migrate", "deploy"], { ...env, ...(direct ? { DATABASE_URL: direct } : {}), PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1" });
} else console.log("[vercel-build] preview/dev deploy: skipping database migrations");
run("npx", ["next", "build"]);
