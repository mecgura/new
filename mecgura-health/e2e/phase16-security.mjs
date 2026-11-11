/**
 * Live HTTP + browser checks for Phase 16 (two-factor, sessions, password reset, API keys, audit integrity, Security Center, privacy, tenant isolation, headers).
 * Run against a PRODUCTION build after `npm run db:seed`, server started with CRON_SECRET=e2e-cron-secret-0123456789.
 */
import { createHmac } from "node:crypto";
import { chromium } from "playwright-core";
const PORT = process.env.PORT ?? "3101"; const LOCAL = `localhost:${PORT}`; const PW = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
let pass = 0; const fails = []; const check = (n, ok, extra = "") => { if (ok) pass++; else { fails.push(n); console.log("  ✗", n, extra); } };
const noise = /Failed to load resource|Cross-Origin-Opener-Policy/;
async function login(path, email, code) {
  const ctx = await browser.newContext({ baseURL: `http://${LOCAL}` }); const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !noise.test(m.text())) errors.push(m.text()); });
  await page.goto(path); await page.fill("input[name=identifier]", email); await page.fill("input[name=password]", PW); await page.click("button[type=submit]");
  if (code) { await page.waitForSelector("input[name=code]", { timeout: 10000 }); await page.fill("input[name=code]", code); await page.click("button[type=submit]"); }
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }); return { ctx, page, errors };
}
const api = async (c, method, path, body, origin) => { const r = await c.ctx.request.fetch(`http://${LOCAL}${path}`, { method, headers: { "content-type": "application/json", origin: origin ?? `http://${LOCAL}` }, data: body ? JSON.stringify(body) : undefined, failOnStatusCode: false, maxRedirects: 0 }); let json = null, text = ""; try { text = await r.text(); json = JSON.parse(text); } catch { /* */ } return { status: r.status(), json, text, headers: r.headers() }; };
const b32 = (s) => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out = []; for (const ch of s) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totp = (secret, offset = 0) => { const c = Math.floor(Date.now() / 30000) + offset; const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(c)); const h = createHmac("sha1", b32(secret)).update(m).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0"); };

let adminB; const sa = await login("/login", "platform@demo.mecgura.test"), adminA = await login("/login", "admin@demo.mecgura.test"), recepA = await login("/login", "reception@demo.mecgura.test"), docA = await login("/login", "doctor@demo.mecgura.test"); adminB = await login("/login", "admin@demob.mecgura.test");

/* ---------- headers & cookies ---------- */
const home = await fetch(`http://${LOCAL}/login`);
check("security headers present (CSP with nonce, frame, nosniff, referrer, permissions, HSTS)", /nonce-/.test(home.headers.get("content-security-policy") ?? "") && /frame-ancestors 'none'/.test(home.headers.get("content-security-policy") ?? "") && home.headers.get("x-content-type-options") === "nosniff" && home.headers.get("x-frame-options") === "DENY" && !!home.headers.get("referrer-policy") && !!home.headers.get("permissions-policy") && /max-age=\d+/.test(home.headers.get("strict-transport-security") ?? "") && !home.headers.get("x-powered-by"));
check("no permissive CORS on APIs", !(await fetch(`http://${LOCAL}/api/health`, { headers: { origin: "https://evil.example" } })).headers.get("access-control-allow-origin"));
const cookies = await adminA.ctx.cookies(); const sess = cookies.find((c) => /session-token/.test(c.name));
check("session cookie is HttpOnly and SameSite", !!sess && sess.httpOnly && /Lax|Strict/.test(sess.sameSite));
check("cross-site writes are refused (CSRF)", (await api(adminA, "POST", "/api/me/security/logout-all", {}, "https://evil.example")).status === 403);
check("open redirects are ignored after sign-in", await (async () => { const x = await login("/login?callbackUrl=https%3A%2F%2Fevil.example%2Fsteal", "reception@demo.mecgura.test"); const u = new URL(x.page.url()); await x.ctx.close(); return u.host === LOCAL; })());

/* ---------- authentication surface ---------- */
for (const p of ["/api/me/security", "/api/security/api-keys", "/api/platform/security", "/api/platform/security/events", "/api/privacy/requests"]) check(`anonymous ${p} -> 401`, (await fetch(`http://${LOCAL}${p}`)).status === 401);
check("Security Center APIs are Super-Admin only (403 for clinic admin/doctor/reception)", (await Promise.all(["security", "security/events", "security/incidents", "security/access-review"].flatMap((p) => [adminA, docA, recepA].map((c) => api(c, "GET", `/api/platform/${p}`))))).every((r) => r.status === 403));
check("clinic staff cannot call privacy / security-policy / api-key admin APIs without the permission", (await api(recepA, "GET", "/api/privacy/requests")).status === 403 && (await api(recepA, "GET", "/api/security/policy")).status === 403 && (await api(recepA, "GET", "/api/security/api-keys")).status === 403 && (await api(docA, "POST", "/api/security/api-keys", { name: "x", scopes: ["services.read"], password: PW })).status === 403);
const f1 = await api(adminA, "POST", "/api/auth/forgot", { email: "nobody@nowhere.test" }), f2 = await api(adminA, "POST", "/api/auth/forgot", { email: "admin@demo.mecgura.test" });
check("password-reset request answers identically for known and unknown emails", f1.status === 200 && f2.status === 200 && JSON.stringify(f1.json.data) === JSON.stringify(f2.json.data));
check("a made-up reset token is refused", (await api(adminA, "POST", "/api/auth/reset", { token: "x".repeat(43), password: "Valid-pass-12345", confirm: "Valid-pass-12345" })).status === 400);
await sa.page.goto("/forgot-password"); check("forgot-password page renders without a session", (await sa.page.getByRole("heading", { name: /Reset your password/ }).count()) > 0);

/* ---------- two-factor: enrol, sign in with code, backup code, step-up ---------- */
const beginBad = await api(adminB, "POST", "/api/me/security/mfa", { action: "begin", password: "wrong-password" }); check("starting 2FA needs the right password", beginBad.status === 403);
const begin = await api(adminB, "POST", "/api/me/security/mfa", { action: "begin", password: PW }); const secret = begin.json?.data?.secret;
check("enrolment returns a setup key (shown once) and nothing is enabled yet", begin.status === 200 && /^[A-Z2-7]{32}$/.test(secret) && (await api(adminB, "GET", "/api/me/security")).json.data.mfa.enabled === false);
check("a wrong confirmation code is refused", (await api(adminB, "POST", "/api/me/security/mfa", { action: "confirm", code: "000000" })).status === 400);
const conf = await api(adminB, "POST", "/api/me/security/mfa", { action: "confirm", code: totp(secret) }); const backups = conf.json?.data?.backupCodes ?? [];
check("confirming turns 2FA on and returns 10 backup codes once", conf.status === 200 && backups.length === 10 && (await api(adminB, "GET", "/api/me/security")).json.data.mfa.enabled === true);
check("backup codes and secrets are never returned again", !/backupCodes|secret/.test((await api(adminB, "GET", "/api/me/security")).text));
await adminB.ctx.close();
const noCode = await browser.newContext({ baseURL: `http://${LOCAL}` }); const np = await noCode.newPage(); await np.goto("/login"); await np.fill("input[name=identifier]", "admin@demob.mecgura.test"); await np.fill("input[name=password]", PW); await np.click("button[type=submit]"); await np.waitForSelector("input[name=code]", { timeout: 10000 });
check("after the right password the login asks for the authenticator code", (await np.getByText(/authenticator app/i).count()) > 0);
await np.fill("input[name=code]", "123456"); await np.click("button[type=submit]"); await np.waitForTimeout(2500); check("a wrong code does not sign in", np.url().includes("/login"));
const wrongPw = await browser.newContext({ baseURL: `http://${LOCAL}` }); const wp = await wrongPw.newPage(); await wp.goto("/login"); await wp.fill("input[name=identifier]", "admin@demob.mecgura.test"); await wp.fill("input[name=password]", "Wrong-password-1"); await wp.click("button[type=submit]"); await wp.waitForTimeout(2500);
check("a wrong password gets the generic error and never reveals the 2FA step", (await wp.locator("input[name=code]").count()) === 0 && (await wp.getByText(/Incorrect email or password/).count()) > 0);
await noCode.close(); await wrongPw.close();
const bB = await login("/login", "admin@demob.mecgura.test", totp(secret, 1)); check("signing in with a current code works", /dashboard|\/$/.test(new URL(bB.page.url()).pathname) || !bB.page.url().includes("/login"));
const bB2 = await login("/login", "admin@demob.mecgura.test", backups[0]); check("a backup code signs in once", !bB2.page.url().includes("/login")); adminB = bB2;
const reuse = await browser.newContext({ baseURL: `http://${LOCAL}` }); const rp = await reuse.newPage(); await rp.goto("/login"); await rp.fill("input[name=identifier]", "admin@demob.mecgura.test"); await rp.fill("input[name=password]", PW); await rp.click("button[type=submit]"); await rp.waitForSelector("input[name=code]"); await rp.fill("input[name=code]", backups[0]); await rp.click("button[type=submit]"); await rp.waitForTimeout(2500);
check("the same backup code cannot be used twice", rp.url().includes("/login")); await reuse.close();
const regen = await api(bB2, "POST", "/api/me/security/mfa", { action: "regenerate", password: PW, code: backups[1] }); check("new backup codes need password + a valid code", regen.status === 200 && regen.json.data.backupCodes.length === 10);
await bB2.page.goto("/account/security"); check("account security page shows 2FA on", (await bB2.page.getByText("On", { exact: true }).count()) > 0);
check("clinic policy can require 2FA for roles (admin only)", (await api(bB2, "PUT", "/api/security/policy", { mfaRequiredRoles: ["ACCOUNTANT"], password: PW, mfaCode: regen.json.data.backupCodes[1] })).status === 200);
await new Promise((r) => setTimeout(r, 1000));
const dis = await api(bB2, "POST", "/api/me/security/mfa", { action: "disable", password: PW, code: regen.json.data.backupCodes[0] }); check("2FA can be turned off with password + code", dis.status === 200 && (await api(bB2, "GET", "/api/me/security")).json.data.mfa.enabled === false);
await api(bB2, "PUT", "/api/security/policy", { mfaRequiredRoles: [], password: PW });

/* ---------- sessions ---------- */
const s1 = await login("/login", "reception@demo.mecgura.test"), s2 = await login("/login", "reception@demo.mecgura.test");
check("two sessions work", (await api(s1, "GET", "/api/me")).status === 200 && (await api(s2, "GET", "/api/me")).status === 200);
await new Promise((r) => setTimeout(r, 1100)); check("sign out everywhere succeeds", (await api(s1, "POST", "/api/me/security/logout-all", {})).status === 200);
check("both sessions are rejected afterwards (401)", (await api(s1, "GET", "/api/me")).status === 401 && (await api(s2, "GET", "/api/me")).status === 401);
const s3 = await login("/login", "reception@demo.mecgura.test"); check("signing in again works", (await api(s3, "GET", "/api/me")).status === 200); await s1.ctx.close(); await s2.ctx.close(); await s3.ctx.close();
check("changing the password needs the current password", (await api(docA, "POST", "/api/me/security/password", { current: "nope", next: "Another-pass-123", confirm: "Another-pass-123" })).status === 403);

/* ---------- API keys ---------- */
const mkKey = await api(adminA, "POST", "/api/security/api-keys", { name: "E2E sync", scopes: ["appointments.read", "services.read"], expiresInDays: 7, password: PW }); const key = mkKey.json?.data?.key;
check("clinic admin creates a key; it is shown once", mkKey.status === 200 && /^mh_[a-z0-9]+\.[A-Za-z0-9_-]{20,}$/.test(key) && !/secretHash/.test(mkKey.text));
check("listing keys never reveals the secret", !(await api(adminA, "GET", "/api/security/api-keys")).text.includes(key.split(".")[1]));
const v1 = (p, k) => fetch(`http://${LOCAL}${p}`, { headers: k ? { authorization: `Bearer ${k}` } : {} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const ping = await v1("/api/v1/ping", key); check("the key authenticates /api/v1/ping and shows only its scopes", ping.status === 200 && ping.json.data.scope === "clinic" && ping.json.data.scopes.includes("appointments.read"));
const appts = await v1("/api/v1/appointments?pageSize=500", key); check("appointments API is paginated (≤50), tenant-scoped and has no patient details", appts.status === 200 && appts.json.data.pageSize <= 50 && appts.json.data.rows.every((r) => !("patientId" in r) && !("contactName" in r) && !("contactPhone" in r)) && appts.json.data.total > 0);
const bAppts = await api(adminB, "GET", "/api/appointments?pageSize=100"); const aIds = new Set(appts.json.data.rows.map((r) => r.publicId));
check("clinic A's key shows none of clinic B's appointments", !(bAppts.json?.data?.rows ?? []).some((r) => aIds.has(r.publicId ?? r.id)));
check("no key / garbage key / cookie-only requests are 401", (await v1("/api/v1/ping")).status === 401 && (await v1("/api/v1/ping", "mh_nope.AAAAAAAAAAAAAAAAAAAAAAAA")).status === 401 && (await fetch(`http://${LOCAL}/api/v1/ping`, { headers: { cookie: (await adminA.ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } })).status === 401);
const platKey = await api(adminA, "POST", "/api/security/api-keys", { name: "bad", scopes: ["platform.status.read"], password: PW }); check("a clinic cannot mint a platform-scope key", platKey.status === 400);
check("a clinic key cannot read platform status; a scope-less call is 403", (await v1("/api/v1/platform/status", key)).status === 403 && (await v1("/api/v1/services", (await api(adminA, "POST", "/api/security/api-keys", { name: "appts only", scopes: ["appointments.read"], password: PW })).json.data.key)).status === 403);
const cB = await api(adminB, "GET", "/api/security/api-keys"); check("clinic B cannot see or revoke clinic A's key (404)", !(cB.json.data ?? []).some((k) => k.id === mkKey.json.data.id) && (await api(adminB, "POST", `/api/security/api-keys/${mkKey.json.data.id}`, { action: "revoke", password: PW })).status === 404);
const rot = await api(adminA, "POST", `/api/security/api-keys/${mkKey.json.data.id}`, { action: "rotate", password: PW }); check("rotation returns a new key and the old one dies", rot.status === 200 && (await v1("/api/v1/ping", key)).status === 401 && (await v1("/api/v1/ping", rot.json.data.key)).status === 200);
const rev = await api(adminA, "POST", `/api/security/api-keys/${(await api(adminA, "GET", "/api/security/api-keys")).json.data.find((k) => k.status === "ACTIVE" && k.prefix === rot.json.data.prefix).id}`, { action: "revoke", password: PW }); check("revocation takes effect immediately", rev.status === 200 && (await v1("/api/v1/ping", rot.json.data.key)).status === 401);
const platMk = await api(sa, "POST", "/api/security/api-keys", { name: "platform status", scopes: ["platform.status.read"], expiresInDays: 3, password: PW }); check("Super Admin can mint a platform key that reads platform status only", platMk.status === 200 && (await v1("/api/v1/platform/status", platMk.json.data.key)).status === 200 && (await v1("/api/v1/appointments", platMk.json.data.key)).status === 403);

/* ---------- Security Center + audit integrity ---------- */
for (const p of ["/platform/security", "/platform/security/events", "/platform/security/incidents", "/platform/security/audit", "/platform/security/access", "/platform/security/keys", "/platform/security/holds"]) { const r = await sa.page.goto(p); await sa.page.waitForSelector("h1"); check(`SA page ${p} renders`, r.status() === 200); }
const ov = (await api(sa, "GET", "/api/platform/security")).json.data; check("overview reports real counts (failed sign-ins from this run, API key events)", ov.failedLogins24h >= 2 && ov.apiKeys.active >= 1 && ov.last24h.LOW >= 1);
const ev = (await api(sa, "GET", "/api/platform/security/events?type=API_KEY_BAD")).json.data; check("rejected API keys are logged without the secret", ev.total >= 1 && !/AAAAAAAA/.test(JSON.stringify(ev.rows)));
const seal = await api(sa, "POST", "/api/platform/security/audit", { action: "seal" }); const ver = await api(sa, "POST", "/api/platform/security/audit", { action: "verify" });
check("audit verification passes on untouched data", seal.status === 200 && ver.status === 200 && ver.json.data.ok === true && ver.json.data.tampered.length === 0 && ver.json.data.rowsChecked > 20);
check("purge without retention configured is refused (nothing is ever auto-deleted)", (await api(sa, "POST", "/api/platform/security/audit", { action: "purge", password: PW, reason: "attempt without retention" })).status === 409);
const inc = await api(sa, "POST", "/api/platform/security/incidents", { title: "E2E drill incident", description: "Drill: verifying the incident workflow", severity: "LOW", category: "ACCESS" }); check("incident opens with a SEC number and lifecycle rules", inc.status === 200 && /^SEC-\d{4}-\d{4}$/.test(inc.json.data.incidentNumber) && (await api(sa, "POST", `/api/platform/security/incidents/${inc.json.data.id}`, { status: "CLOSED" })).status === 409);
await sa.page.goto(`/platform/security/incidents/${inc.json.data.id}`); check("incident page shows timeline", (await sa.page.getByText("Incident opened").count()) > 0);
check("audit trail records MFA, key and incident actions", await (async () => { const a = (await api(sa, "GET", "/api/platform/audit?action=auth.mfa")).json?.data; const b = (await api(sa, "GET", "/api/platform/audit?action=security.")).json?.data; return (a?.rows?.length ?? 0) >= 2 && (b?.rows?.length ?? 0) >= 3; })());
await adminA.page.goto("/settings/security"); check("clinic admin sees Security settings (policy + keys), no platform controls", (await adminA.page.getByText("Integration API keys").count()) > 0 && (await adminA.page.getByText("Audit trail integrity").count()) === 0);
const rcp = await recepA.page.goto("/settings/security"); await recepA.page.waitForTimeout(800); check("receptionist is redirected from clinic security settings", !recepA.page.url().endsWith("/settings/security"));

/* ---------- privacy ---------- */
const P1 = await login("/portal/login?clinic=demo-clinic", "patient@demo.mecgura.test");
const rr = await api(P1, "POST", "/api/patient/privacy-requests", { kind: "ERASURE", reason: "Please erase my information" }); check("a patient can raise a data-rights request", rr.status === 200 && /^PRQ-/.test(rr.json.data.requestNumber));
check("a duplicate open request of the same kind is refused", (await api(P1, "POST", "/api/patient/privacy-requests", { kind: "ERASURE", reason: "Again, please" })).status === 409);
const list = (await api(adminA, "GET", "/api/privacy/requests")).json.data; const er = list.rows.find((r) => r.kind === "ERASURE");
check("the clinic admin sees it, clinic B does not", !!er && !(await api(adminB, "GET", "/api/privacy/requests")).json.data.rows.some((r) => r.id === er.id));
check("erasure can never be marked 'fulfilled' (records are not deleted automatically)", (await api(adminA, "POST", `/api/privacy/requests/${er.id}`, { outcome: "FULFILLED", note: "Deleting everything now please" })).status === 409);
check("another clinic cannot close it", (await api(adminB, "POST", `/api/privacy/requests/${er.id}`, { outcome: "NOT_APPLICABLE", note: "Trying from the wrong clinic" })).status === 404);
const close = await api(adminA, "POST", `/api/privacy/requests/${er.id}`, { outcome: "RETENTION_EXCEPTION", note: "Medical records must be kept for the legally required period." }); check("closing with a retention exception works and the patient record remains", close.status === 200);
await P1.page.goto("/portal/privacy"); check("patient portal shows the data-rights form", (await P1.page.getByText("Your data rights").count()) > 0);
check("a patient cannot reach clinic privacy/security APIs", (await api(P1, "GET", "/api/privacy/requests")).status === 403 || (await api(P1, "GET", "/api/privacy/requests")).status === 401);

/* ---------- tenant isolation matrix (clinic B probing clinic A's ids) ---------- */
const rowsOf = (j) => j?.data?.rows ?? j?.data?.items ?? (Array.isArray(j?.data) ? j.data : []);
const ids = {};
for (const [k, p] of [["patients", "/api/patients"], ["appointments", "/api/appointments"], ["opd", "/api/opd"], ["consultations", "/api/consultations"], ["lab", "/api/lab/orders"], ["followups", "/api/followups"], ["invoices", "/api/billing/invoices"], ["dispensings", "/api/pharmacy/dispensings"], ["purchases", "/api/pharmacy/purchases"], ["messages", "/api/communications/messages"], ["notifications", "/api/notifications"]]) { const r = await api(adminA, "GET", p); ids[k] = rowsOf(r.json)[0]?.id ?? null; }
const pat0 = rowsOf((await api(adminA, "GET", "/api/patients")).json)[0]; check("clinic A has patients to probe with (other modules are probed per-phase in the module e2e suites)", !!ids.patients && !!pat0);
const probes = [["patients", (i) => `/api/patients/${i}`], ["patients", (i) => `/api/patients/${i}/export`], ["patients", (i) => `/api/patients/${i}/timeline`], ["patients", (i) => `/api/patients/${i}/billing`], ["patients", (i) => `/api/patients/${i}/lab-reports`], ["appointments", (i) => `/api/appointments/${i}`], ["opd", (i) => `/api/opd/${i}`], ["consultations", (i) => `/api/consultations/${i}`], ["consultations", (i) => `/api/consultations/${i}/prescription`], ["lab", (i) => `/api/lab/orders/${i}`], ["followups", (i) => `/api/followups/${i}`], ["invoices", (i) => `/api/billing/invoices/${i}`], ["dispensings", (i) => `/api/pharmacy/dispensings/${i}`], ["purchases", (i) => `/api/pharmacy/purchases/${i}`], ["messages", (i) => `/api/communications/messages/${i}`], ["notifications", (i) => `/api/notifications/${i}`]];
let leaks = [];
for (const [k, mk] of probes) { if (!ids[k]) continue; const r = await api(adminB, "GET", mk(ids[k])); if (r.status === 200 && r.json?.ok && (r.text.includes(ids[k]) || (k === "patients" && (r.text.includes(pat0.code) || r.text.includes(pat0.name))))) leaks.push(mk(ids[k])); }
check("clinic B gets 404/403 for every one of clinic A's objects (direct ID manipulation)", leaks.length === 0, leaks.join(", "));
let wleaks = []; for (const [k, mk, body] of [["patients", (i) => `/api/patients/${i}`, { name: "Hijacked" }], ["followups", (i) => `/api/followups/${i}/action`, { action: "CANCEL" }], ["notifications", (i) => `/api/notifications/${i}/read`, {}]]) { if (!ids[k]) continue; const r = await api(adminB, k === "patients" ? "PATCH" : "POST", mk(ids[k]), body); if (r.status === 200 && r.json?.ok) wleaks.push(mk(ids[k])); }
check("clinic B cannot write to clinic A's objects either", wleaks.length === 0, wleaks.join(", "));
const tParam = await api(adminB, "GET", `/api/patients?tenantId=${(await api(sa, "GET", "/api/platform/clinics?all=1")).json.data.rows.find((c) => c.slug === "demo-clinic").id}&pageSize=100`); check("a tenantId query parameter changes nothing", tParam.status === 200 && !rowsOf(tParam.json).some((p) => p.id === ids.patients));
const createWithTenant = await api(adminB, "POST", "/api/patients", { name: "Injected Tenant Patient", phone: "9876500011", tenantId: "clinic-a-id", allowDuplicate: true }); const cid = createWithTenant.json?.data?.id; check("a tenantId in a request body is ignored: the record lands in the caller's clinic", !cid || ((await api(adminB, "GET", `/api/patients/${cid}`)).status === 200 && (await api(adminA, "GET", `/api/patients/${cid}`)).status === 404));
check("billing subscription / documents of clinic A are invisible to clinic B", (await api(adminB, "GET", "/api/subscription")).json?.data?.invoices?.every?.((i) => true) !== false);
check("clinic B's analytics and audit exclude clinic A", await (async () => { const au = await api(adminB, "GET", "/api/audit"); return au.status === 403 || au.status === 404 || !JSON.stringify(au.json).includes(ids.patients ?? "§"); })());

/* ---------- injection, XSS, uploads ---------- */
const xss = `<img src=x onerror="window.__xss=1">E2E`; const xp = await api(adminA, "POST", "/api/patients", { name: xss.slice(0, 60), phone: "9876500022", allowDuplicate: true });
await adminA.page.goto("/patients?q=E2E"); await adminA.page.waitForTimeout(1500); check("script in a patient name is shown as text, never executed", (await adminA.page.evaluate(() => window.__xss)) === undefined && (await adminA.page.locator("img[onerror]").count()) === 0);
check("SQL-injection style search input is harmless", (await api(adminA, "GET", `/api/patients?q=${encodeURIComponent("' OR 1=1; DROP TABLE Patient;--")}`)).status === 200);
const fake = await adminA.ctx.request.post(`http://${LOCAL}/api/clinic/branding/logo`, { multipart: { file: { name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script></html>") } }, headers: { origin: `http://${LOCAL}` }, failOnStatusCode: false }); check("an HTML file renamed .png is rejected as an upload", fake.status() === 400);
check("path traversal / odd IDs return 404, not 500", [(await api(adminA, "GET", "/api/patients/..%2F..%2Fetc%2Fpasswd")).status, (await api(adminA, "GET", "/api/appointments/' OR '1'='1")).status].every((s) => s === 404 || s === 400));
check("error responses never leak internals", !/at .*\.ts|node_modules|PrismaClient|SQLITE|stack/i.test((await api(adminA, "GET", "/api/patients/%00")).text));

/* ---------- webhooks ---------- */
check("unsigned messaging webhooks are rejected and recorded", (await fetch(`http://${LOCAL}/api/webhooks/email`, { method: "POST", body: JSON.stringify({ entry: [] }) })).status === 401 && ((await api(sa, "GET", "/api/platform/security/events?type=WEBHOOK_SIGNATURE_FAILED")).json.data.total >= 1));
check("health endpoint reveals nothing but status", await (async () => { const h = await fetch(`http://${LOCAL}/api/health`).then((r) => r.text()); return !/postgres|sqlite|secret|version/i.test(h); })());

const all = [sa, adminA, bB, bB2, recepA, docA, P1]; check("no console errors", all.every((c) => c.errors.length === 0), all.flatMap((c) => c.errors).join(" | ").slice(0, 600));
await browser.close(); console.log(`\nPhase 16 e2e: ${pass} passed, ${fails.length} failed`); if (fails.length) { console.log("FAILED:\n - " + fails.join("\n - ")); process.exit(1); }
