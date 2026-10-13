// Production environment gate.   npm run env:check   (reads process.env; pass --file .env.production to load a dotenv file first)
// Exit 1 when a REQUIRED item is wrong. Warnings are things that should be decided before launch. Never prints secret values.
import { readFileSync } from "node:fs";
const fi = process.argv.indexOf("--file"); if (fi > 0) for (const l of readFileSync(process.argv[fi + 1], "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim(); }
const e = (k) => (process.env[k] ?? "").trim(); const out = []; const add = (level, name, ok, hint) => out.push({ level, name, ok, hint });
const b64len = (v) => { try { return Buffer.from(v, "base64").length; } catch { return 0; } };
add("required", "APP_ENV is 'production'", e("APP_ENV") === "production" || e("NODE_ENV") === "production", "Set APP_ENV=production");
add("required", "DATABASE_URL is PostgreSQL (not the SQLite dev file)", /^postgres(ql)?:\/\//.test(e("DATABASE_URL")), "Use a managed PostgreSQL and PRISMA_SCHEMA=prisma/schema.postgres.prisma");
add("required", "DATABASE_URL requires TLS", /sslmode=(require|verify-full|verify-ca)/.test(e("DATABASE_URL")) || /ssl=true/.test(e("DATABASE_URL")), "Append ?sslmode=require (or verify-full)");
add("required", "PRISMA_SCHEMA points at the PostgreSQL schema", /schema\.postgres\.prisma$/.test(e("PRISMA_SCHEMA")), "PRISMA_SCHEMA=prisma/schema.postgres.prisma (must be set at install/build time too)");
add("required", "AUTH_SECRET is set (>= 32 chars)", e("AUTH_SECRET").length >= 32, "openssl rand -base64 32");
add("required", "APP_URL is an https URL", /^https:\/\//.test(e("APP_URL")), "e.g. https://app.yourdomain.com");
add("required", "SECURITY_KEYS key ring is set (each key 32 bytes, base64)", e("SECURITY_KEYS").split(",").filter(Boolean).length > 0 && e("SECURITY_KEYS").split(",").every((p) => b64len(p.split(":").slice(1).join(":")) === 32), "SECURITY_KEYS=\"k1:<base64-32-bytes>\"");
add("required", "CRON_SECRET is set (>= 16 chars) so reminders, delivery retries and billing run", e("CRON_SECRET").length >= 16, "Set it and schedule POST /api/internal/communications/run every 5 minutes");
add("required", "BACKUP_ENCRYPTION_KEY is set (32 bytes, base64)", b64len(e("BACKUP_ENCRYPTION_KEY")) === 32, "Store it outside the database and outside the backup location");
add("required", "No demo password / seed variables are present", !e("SEED_DEMO_PASSWORD"), "Remove SEED_DEMO_PASSWORD — demo seed must never run in production");
add("required", "Design preview is not exposed", e("ENABLE_DESIGN_PREVIEW") !== "true", "Remove ENABLE_DESIGN_PREVIEW or set it to false");
add("required", "Login throttles are at defaults", !e("LOGIN_RATE_LIMIT_IP") && !e("LOGIN_RATE_LIMIT_ACCT"), "Remove LOGIN_RATE_LIMIT_* (they exist only for automated tests)");
add("warning", "TENANT_ROOT_DOMAIN is set (clinic subdomains)", !!e("TENANT_ROOT_DOMAIN"), "Without it only the platform host resolves; clinics need custom domains");
add("warning", "LOG_LEVEL is info or higher", !e("LOG_LEVEL") || ["info", "warn", "error"].includes(e("LOG_LEVEL")), "debug logs are noisy in production");
add("warning", "A payment provider is configured if online subscription payments are wanted", !e("SUBSCRIPTION_PAYMENT_PROVIDER") || (!!e("RAZORPAY_KEY_ID") && !!e("RAZORPAY_KEY_SECRET") && !!e("RAZORPAY_WEBHOOK_SECRET")), "Provider chosen but keys/webhook secret missing — online payment stays unavailable");
add("warning", "Email provider fully configured if email is wanted", !e("EMAIL_PROVIDER") || (!!(e("RESEND_API_KEY") || e("EMAIL_API_KEY")) && !!e("EMAIL_FROM")), "Without it, email shows 'not configured' and nothing is sent");
add("warning", "SMS provider fully configured if SMS is wanted", !e("SMS_PROVIDER") || !!e("SMS_API_KEY"), "Without it, SMS shows 'not configured' and nothing is sent");
add("warning", "WhatsApp provider fully configured if WhatsApp is wanted", !e("WHATSAPP_PROVIDER") || (!!e("WHATSAPP_ACCESS_TOKEN") && !!e("WHATSAPP_PHONE_NUMBER_ID")), "Without it, WhatsApp shows 'not configured' and nothing is sent");
add("warning", "APP_VERSION / GIT_SHA set for /version", !!(e("APP_VERSION") || e("GIT_SHA") || e("VERCEL_GIT_COMMIT_SHA")), "Helps support identify the running build");
let bad = 0; for (const r of out) { if (!r.ok && r.level === "required") bad++; console.log(`${r.ok ? "PASS " : r.level === "required" ? "FAIL " : "WARN "} ${r.name}${r.ok ? "" : `  →  ${r.hint}`}`); }
console.log(`\n${bad === 0 ? "Environment gate passed" : `${bad} required item(s) failed`}${out.some((r) => !r.ok && r.level === "warning") ? " (with warnings)" : ""}.`); process.exit(bad ? 1 : 0);
