// Restore test: proves a backup can really be restored. Never touches the live database.
// Usage:  node scripts/restore-verify.mjs <backup-file> [--record]
//   SQLite: decrypt+unpack to a temp file, PRAGMA integrity_check / foreign_key_check, compare every table's row count with the manifest.
//   PostgreSQL: create a scratch database, pg_restore into it, compare key-table counts, drop it.   (--record writes the result to BackupRun)
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database, KEY_TABLES, dbUrl, driverOf, key, pg, pgCounts, sha256File, sqliteCounts, unpack } from "./lib/backup-lib.mjs";

const file = process.argv[2]; if (!file) { console.error("Usage: node scripts/restore-verify.mjs <backup-file> [--record]"); process.exit(2); }
const t0 = Date.now(); const problems = []; const manifest = JSON.parse(readFileSync(`${file}.manifest.json`, "utf8")); const tmp = mkdtempSync(path.join(os.tmpdir(), "mh-restore-")); const out = path.join(tmp, "restored");
let scratch = null;
try {
  if ((await sha256File(file)) !== manifest.sha256) problems.push("checksum does not match the manifest (file damaged or altered)");
  const k = manifest.encrypted ? key() : null; if (manifest.encrypted && !k) throw new Error("This backup is encrypted: set BACKUP_ENCRYPTION_KEY.");
  await unpack(file, out, k, manifest.encrypted);
  if (manifest.driver === "sqlite") {
    const D = Database(); const d = new D(out, { readonly: true }); const ic = d.pragma("integrity_check", { simple: true }); if (ic !== "ok") problems.push(`integrity_check: ${ic}`);
    const fk = d.pragma("foreign_key_check"); if (fk.length) problems.push(`${fk.length} foreign key violation(s)`); d.close();
    const counts = sqliteCounts(out); for (const [t, n] of Object.entries(manifest.rowCounts)) if (counts[t] !== n) problems.push(`table ${t}: manifest ${n}, restored ${counts[t]}`);
  } else {
    const admin = new URL(dbUrl()); scratch = `restore_test_${Date.now()}`; admin.pathname = "/postgres"; const target = new URL(dbUrl()); target.pathname = `/${scratch}`;
    pg(["psql", admin.toString(), "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${scratch}`]); pg(["pg_restore", "--no-owner", "--no-privileges", "--exit-on-error", "-d", target.toString(), out]);
    const counts = pgCounts(target.toString()); for (const t of KEY_TABLES) if (counts[t] !== manifest.rowCounts[t]) problems.push(`table ${t}: manifest ${manifest.rowCounts[t]}, restored ${counts[t]}`);
  }
} catch (e) { problems.push(String(e.message).slice(0, 200)); }
finally {
  if (scratch) { try { const admin = new URL(dbUrl()); admin.pathname = "/postgres"; pg(["psql", admin.toString(), "-c", `DROP DATABASE IF EXISTS ${scratch}`]); } catch { /* best effort */ } }
  rmSync(tmp, { recursive: true, force: true });
}
const ms = Date.now() - t0; const ok = problems.length === 0;
if (process.argv.includes("--record")) {
  try {
    const sql = (driverOf() === "sqlite");
    if (sql) { const D = Database(); const d = new D(dbUrl().replace(/^file:/, "")); d.prepare(`UPDATE "BackupRun" SET "restoreTestedAt"=?, "restoreOk"=?, "restoreDurationMs"=?, "verifiedAt"=? WHERE "checksum"=?`).run(new Date().toISOString(), ok ? 1 : 0, ms, ok ? new Date().toISOString() : null, manifest.sha256); d.close(); }
    else pg(["psql", dbUrl(), "-v", "ON_ERROR_STOP=1", "-c", `UPDATE "BackupRun" SET "restoreTestedAt"=now(), "restoreOk"=${ok ? "TRUE" : "FALSE"}, "restoreDurationMs"=${ms}, "verifiedAt"=${ok ? "now()" : "NULL"} WHERE "checksum"='${manifest.sha256}'`]);
  } catch (e) { console.error("warning: could not record the restore test:", e.message); }
}
console.log(JSON.stringify({ ok, driver: manifest.driver, restoreMs: ms, backupCreatedAt: manifest.createdAt, encrypted: manifest.encrypted, problems }));
process.exit(ok ? 0 : 1);
