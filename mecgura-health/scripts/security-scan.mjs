// Lightweight secret + configuration scan (no network). Run: npm run security:scan   — exits 1 on findings.
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean).filter((f) => !/^(package-lock\.json|.*\.(png|jpg|ico|woff2?|svg))$/.test(f) && !f.startsWith("security-review/") && !f.startsWith("docs/"));
const RULES = [
  ["private key block", /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["live payment key", /\b(rzp_live_[A-Za-z0-9]{10,}|sk_live_[A-Za-z0-9]{10,})\b/],
  ["webhook secret literal", /\bwhsec_[A-Za-z0-9+/=]{24,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["hard-coded database URL with password", /postgres(ql)?:\/\/[^\s:@/]+:[^\s@/]{4,}@(?!localhost|127\.0\.0\.1|HOST|host)/],
];
const ALLOW = /(\.test\.|\/test\/|^e2e\/|\.env\.example$|^prisma\/seed\.ts$|^scripts\/security-scan\.mjs$)/;
const findings = [];
for (const f of files) {
  if (!existsSync(f)) continue; let text; try { text = readFileSync(f, "utf8"); } catch { continue; } if (text.includes("\u0000")) continue;
  for (const [name, re] of RULES) { const m = re.exec(text); if (m && !ALLOW.test(f)) findings.push(`${f}: ${name}`); }
}
const tracked = new Set(files);
for (const f of [".env", ".env.local", ".env.production"]) if (tracked.has(f)) findings.push(`${f} is committed to git`);
if (existsSync(".env.example")) { const ex = readFileSync(".env.example", "utf8"); for (const l of ex.split("\n")) { const m = /^([A-Z0-9_]*(SECRET|KEY|PASSWORD|TOKEN)[A-Z0-9_]*)=("?)([^"#\s]+)\3/.exec(l); if (m && !/^(change|your|<|xxx|example|replace)/i.test(m[4])) findings.push(`.env.example sets a real-looking value for ${m[1]}`); } }
const cfg = readFileSync("next.config.ts", "utf8");
for (const h of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security"]) if (!cfg.includes(h)) findings.push(`next.config.ts is missing the ${h} header`);
if (!/frame-ancestors 'none'/.test(readFileSync("src/lib/security/csp.ts", "utf8"))) findings.push("CSP lacks frame-ancestors 'none'");
if (findings.length) { console.error("Security scan FAILED:\n - " + findings.join("\n - ")); process.exit(1); }
console.log(`Security scan passed (${files.length} files).`);
