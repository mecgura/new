// Shared helpers for scripts/backup.mjs and scripts/restore-verify.mjs. No secrets are ever printed.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export const env = (k, d) => process.env[k] ?? d;
export const dbUrl = () => env("DATABASE_URL", "file:./dev.db");
export const driverOf = (url = dbUrl()) => (url.startsWith("postgres") ? "postgres" : "sqlite");
export const sqlitePath = (url = dbUrl()) => url.replace(/^file:/, "");
export const isProd = () => env("NODE_ENV") === "production" || env("APP_ENV") === "production";
export const cuid = () => "c" + randomBytes(12).toString("hex");
export const Database = () => require("better-sqlite3");
export function key() {
  const b64 = env("BACKUP_ENCRYPTION_KEY"); if (!b64) return null; const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 32 random bytes, base64 encoded (node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\").");
  return k;
}
export const sha256File = (f) => new Promise((res, rej) => { const h = createHash("sha256"); createReadStream(f).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej); });

/** file -> gzip -> AES-256-GCM -> out.  Layout: "MHBK1" | iv(12) | ciphertext | tag(16) */
export async function packEncrypted(src, dest, k) {
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", k, iv); const out = createWriteStream(dest); out.write(Buffer.concat([Buffer.from("MHBK1"), iv]));
  await pipeline(createReadStream(src), createGzip({ level: 6 }), c, out, { end: false }); out.end(c.getAuthTag()); await new Promise((r) => out.on("finish", r));
}
export async function packPlain(src, dest) { await pipeline(createReadStream(src), createGzip({ level: 6 }), createWriteStream(dest)); }
export async function unpack(src, dest, k, encrypted) {
  if (!encrypted) return pipeline(createReadStream(src), createGunzip(), createWriteStream(dest));
  const size = statSync(src).size; const fd = readFileSync(src).subarray(0, 17); if (fd.subarray(0, 5).toString() !== "MHBK1") throw new Error("Not a MECGURA backup file.");
  const tagBuf = readFileSync(src).subarray(size - 16); const d = createDecipheriv("aes-256-gcm", k, fd.subarray(5, 17)); d.setAuthTag(tagBuf);
  await pipeline(createReadStream(src, { start: 17, end: size - 17 }), d, createGunzip(), createWriteStream(dest));
}
export function pg(args, input) { const r = spawnSync(args[0], args.slice(1), { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 }); if (r.status !== 0) throw new Error(`${args[0]} failed: ${(r.stderr || "").split("\n")[0].replace(/postgres(ql)?:\/\/[^\s]+/g, "<url>")}`); return r.stdout; }
export const KEY_TABLES = ["Tenant", "User", "Patient", "Appointment", "OpdVisit", "Invoice", "AuditLog", "SaasInvoice", "Notification"];
export function sqliteCounts(file) {
  const D = Database(); const d = new D(file, { readonly: true, fileMustExist: true }); const t = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  const counts = {}; for (const n of t) counts[n] = d.prepare(`SELECT COUNT(*) AS c FROM "${n}"`).get().c; d.close(); return counts;
}
export function pgCounts(url) { const c = {}; for (const t of KEY_TABLES) c[t] = Number(pg(["psql", url, "-At", "-c", `SELECT COUNT(*) FROM "${t}"`]).trim()); return c; }
export { existsSync, statSync, readFileSync };
