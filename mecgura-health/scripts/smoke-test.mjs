// Production smoke test: read-only, safe against a live deployment.   BASE_URL=https://app.example.com npm run smoke
// Optional: SMOKE_CLINIC_HOST=clinic.example.com checks a clinic's public site;  SMOKE_API_KEY=… checks the API-key route.
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, ""); if (!BASE) { console.error("Set BASE_URL, e.g. BASE_URL=https://app.example.com"); process.exit(2); }
const res = []; const t = async (name, fn) => { const s = Date.now(); try { const r = await fn(); res.push({ name, ok: r === true || r?.ok === true, ms: Date.now() - s, detail: r?.detail ?? "" }); } catch (e) { res.push({ name, ok: false, ms: Date.now() - s, detail: String(e?.message ?? e).slice(0, 120) }); } };
const get = (p, init = {}) => fetch(BASE + p, { redirect: "manual", ...init });
await t("GET /health → 200 {status:ok}", async () => { const r = await get("/health"); return r.status === 200 && (await r.json()).status === "ok"; });
await t("GET /ready → 200 and database ok", async () => { const r = await get("/ready"); const j = await r.json().catch(() => ({})); return { ok: r.status === 200 && (j.checks ? j.checks.some((c) => c.name === "database" && c.status === "ok") : j.status !== "not_ready"), detail: `${j.status}; ${(j.checks ?? []).filter((c) => c.status !== "ok").map((c) => `${c.name}:${c.status}`).join(" ")}` }; });
await t("GET /version has a version, no secrets", async () => { const j = await (await get("/version")).json(); return !!j.version && !/secret|password|key/i.test(JSON.stringify(j)); });
await t("GET /login renders", async () => (await get("/login")).status === 200);
await t("anonymous /dashboard redirects to login", async () => { const r = await get("/dashboard"); return [307, 308].includes(r.status) && /\/login/.test(r.headers.get("location") ?? ""); });
await t("anonymous /platform redirects to login", async () => { const r = await get("/platform"); return [307, 308].includes(r.status) && /\/login/.test(r.headers.get("location") ?? ""); });
await t("anonymous API returns 401, not data", async () => (await get("/api/patients")).status === 401);
await t("cross-site write is refused", async () => { const r = await get("/api/me/security/logout-all", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }); return [401, 403].includes(r.status); });
await t("security headers present", async () => { const r = await get("/login"); const h = r.headers; return !!h.get("content-security-policy") && h.get("x-content-type-options") === "nosniff" && !!h.get("x-frame-options") && /max-age/.test(h.get("strict-transport-security") ?? "") ? true : { ok: false, detail: "missing header" }; });
await t("no technology/version leak headers", async () => !(await get("/login")).headers.get("x-powered-by"));
await t("scheduler endpoint refuses without its secret", async () => [401, 403, 404].includes((await get("/api/internal/communications/run", { method: "POST" })).status));
await t("webhook endpoints refuse unsigned requests", async () => [400, 401, 403, 404, 503].includes((await get("/api/webhooks/subscriptions/razorpay", { method: "POST", body: "{}" })).status));
if (process.env.SMOKE_CLINIC_HOST) await t(`clinic site ${process.env.SMOKE_CLINIC_HOST} serves`, async () => { const r = await fetch(`https://${process.env.SMOKE_CLINIC_HOST}/`, { redirect: "manual" }); return r.status === 200; });
if (process.env.SMOKE_API_KEY) await t("API key route /api/v1/ping", async () => (await get("/api/v1/ping", { headers: { authorization: `Bearer ${process.env.SMOKE_API_KEY}` } })).status === 200);
for (const r of res) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.ms} ms)${r.detail ? "  " + r.detail : ""}`);
const bad = res.filter((r) => !r.ok).length; console.log(`\n${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
