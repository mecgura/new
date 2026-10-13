// Database backup: consistent snapshot -> gzip -> AES-256-GCM (when BACKUP_ENCRYPTION_KEY is set) -> checksum + manifest -> register -> prune.
// Usage:  node scripts/backup.mjs [--out ./backups] [--allow-unencrypted]
//   env:  DATABASE_URL, BACKUP_ENCRYPTION_KEY (base64 32 bytes), BACKUP_RETENTION_DAYS (default 30), BACKUP_LOCATION_LABEL
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Database, KEY_TABLES, cuid, dbUrl, driverOf, env, isProd, key, packEncrypted, packPlain, pg, pgCounts, sha256File, sqliteCounts, sqlitePath } from "./lib/backup-lib.mjs";

const args = process.argv.slice(2); const out = path.resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : env("BACKUP_DIR", "backups")); mkdirSync(out, { recursive: true });
const driver = driverOf(); const k = key(); const started = new Date();
if (!k && isProd() && !args.includes("--allow-unencrypted")) { console.error("Refusing to write an UNENCRYPTED backup in production. Set BACKUP_ENCRYPTION_KEY (or pass --allow-unencrypted knowingly)."); process.exit(2); }
const stamp = started.toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z"); const base = path.join(out, `mecgura-${driver}-${stamp}`); const raw = `${base}.raw`; const final = `${base}.${driver === "postgres" ? "dump" : "db"}.gz${k ? ".enc" : ""}`;

function register(row) {
  const cols = { id: cuid(), kind: "DATABASE", startedAt: started.toISOString(), finishedAt: new Date().toISOString(), driver, location: env("BACKUP_LOCATION_LABEL", path.basename(out)), ...row };
  try {
    if (driver === "sqlite") { const D = Database(); const d = new D(sqlitePath()); const names = Object.keys(cols); d.prepare(`INSERT INTO "BackupRun" (${names.map((n) => `"${n}"`).join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...names.map((n) => (typeof cols[n] === "boolean" ? Number(cols[n]) : cols[n]))); d.close(); }
    else { const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : `'${String(v).replace(/'/g, "''")}'`); const names = Object.keys(cols); pg(["psql", dbUrl(), "-v", "ON_ERROR_STOP=1", "-c", `INSERT INTO "BackupRun" (${names.map((n) => `"${n}"`).join(",")}) VALUES (${names.map((n) => q(cols[n])).join(",")})`]); }
  } catch (e) { console.error("warning: could not write the backup register:", e.message); }
}
try {
  let counts;
  if (driver === "sqlite") { const D = Database(); const src = new D(sqlitePath(), { readonly: true, fileMustExist: true }); await src.backup(raw); src.close(); counts = sqliteCounts(raw); }
  else { pg(["pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--file", raw, dbUrl()]); counts = pgCounts(dbUrl()); }
  if (k) await packEncrypted(raw, final, k); else await packPlain(raw, final); rmSync(raw, { force: true });
  const checksum = await sha256File(final); const size = statSync(final).size;
  const migrations = driver === "sqlite" ? counts["_prisma_migrations"] ?? null : Number(pg(["psql", dbUrl(), "-At", "-c", 'SELECT COUNT(*) FROM "_prisma_migrations"']).trim());
  const manifest = { format: 1, createdAt: started.toISOString(), driver, file: path.basename(final), sizeBytes: size, sha256: checksum, encrypted: !!k, migrations, rowCounts: driver === "sqlite" ? counts : Object.fromEntries(KEY_TABLES.map((t) => [t, counts[t]])) };
  writeFileSync(`${final}.manifest.json`, JSON.stringify(manifest, null, 2));
  register({ status: "SUCCESS", sizeBytes: size, checksum, encrypted: !!k, rowCounts: JSON.stringify(Object.fromEntries(KEY_TABLES.map((t) => [t, counts[t] ?? null]))), note: k ? "encrypted" : "NOT encrypted" });
  // retention: keep at least the 3 newest, delete the rest older than BACKUP_RETENTION_DAYS
  const days = Number(env("BACKUP_RETENTION_DAYS", "30")); const files = readdirSync(out).filter((f) => /^mecgura-.*\.(db|dump)\.gz(\.enc)?$/.test(f)).map((f) => ({ f, t: statSync(path.join(out, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  let pruned = 0; for (const { f, t } of files.slice(3)) if (Date.now() - t > days * 86_400_000) { rmSync(path.join(out, f), { force: true }); rmSync(path.join(out, `${f}.manifest.json`), { force: true }); pruned++; }
  console.log(JSON.stringify({ ok: true, file: path.basename(final), sizeBytes: size, encrypted: !!k, sha256: checksum.slice(0, 16) + "…", tables: Object.keys(counts).length, pruned, ms: Date.now() - started.getTime() }));
} catch (e) {
  rmSync(raw, { force: true }); register({ status: "FAILED", note: String(e.message).slice(0, 300) }); console.error("BACKUP FAILED:", e.message); process.exit(1);
}
void createHash;
