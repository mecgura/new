/**
 * Live HTTP + browser checks for the public website & CMS (Phase 2).
 * Run against a PRODUCTION build (hydration/CSP behave like real hosting):
 *   NEXT_DIST_DIR=.next-prod npm run build && NEXT_DIST_DIR=.next-prod npx next start -p 3101
 *   node e2e/phase2-website.mjs        (needs `npm run db:seed`, TENANT_ROOT_DOMAIN="mecgura.test", playwright-core)
 * Clinic hosts (demo.mecgura.test / demo-b.mecgura.test) are mapped to 127.0.0.1 inside the browser, and sent as Host headers.
 */
import { chromium } from "playwright-core";

const PORT = process.env.PORT ?? "3101";
const HOST_A = `demo.mecgura.test:${PORT}`, HOST_B = `demo-b.mecgura.test:${PORT}`, LOCAL = `localhost:${PORT}`;
const PW = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--host-resolver-rules=MAP *.mecgura.test 127.0.0.1"] });
let pass = 0; const fails = [];
const check = (n, ok, extra = "") => { if (ok) pass++; else { fails.push(n); console.log("  ✗", n, extra); } };

// Plain HTTP with an explicit Host header (what a reverse proxy would send). node:http, because fetch() forbids overriding Host.
import http from "node:http";
function raw(method, host, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path, headers: { host, ...headers, ...(body ? { "content-length": Buffer.byteLength(body) } : {}) } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (c) => (text += c)); res.on("end", () => resolve({ status: res.statusCode, text, headers: { get: (k) => res.headers[k.toLowerCase()] ?? null } }));
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}
const get = (host, path, headers = {}) => raw("GET", host, path, { headers });
async function post(host, path, body) {
  const r = await raw("POST", host, path, { headers: { origin: `http://${host}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  let json = null; try { json = JSON.parse(r.text); } catch { /* */ }
  return { status: r.status, json };
}
async function login(identifier) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(`http://${LOCAL}/login`); await page.fill("input[name=identifier]", identifier); await page.fill("input[name=password]", PW); await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  return { ctx, page };
}
const api = async (c, method, path, body) => {
  const r = await c.ctx.request.fetch(`http://${LOCAL}${path}`, { method, headers: { "content-type": "application/json", origin: `http://${LOCAL}` }, data: body ? JSON.stringify(body) : undefined, failOnStatusCode: false, maxRedirects: 0 });
  let json = null; try { json = await r.json(); } catch { /* */ }
  return { status: r.status(), json };
};

/* ---------- Tenant resolution & isolation on public hosts ---------- */
const [a, b] = await Promise.all([get(HOST_A, "/"), get(HOST_B, "/")]);
check("clinic A host -> 200 with A content", a.status === 200 && a.text.includes("Demo Clinic (demo website)"));
check("clinic B host -> 200 with B content", b.status === 200 && b.text.includes("Demo Clinic B (demo website)"));
check("A shows nothing of B", !a.text.includes("Demo Clinic B") && !a.text.includes("Specialist Consultation") && !a.text.includes("demob.mecgura"));
check("B shows nothing of A", !b.text.includes("General Consultation") && !b.text.includes("contact@demo.mecgura") && !b.text.includes("911234567890"));
check("A's WhatsApp CTA from A's own number only", a.text.includes("wa.me/911234567890") && !b.text.includes("wa.me/"));
check("security headers on public pages", !!a.headers.get("content-security-policy") && a.headers.get("x-content-type-options") === "nosniff" && a.headers.get("x-frame-options") === "DENY");
check("page text has no internal tenant ids", !/cmux[a-z0-9]{15,}/.test(a.text.replace(/\/api\/assets\/cmux[a-z0-9]+/g, "")));
check("A serves its service", (await get(HOST_A, "/services/general-consultation-demo")).status === 200);
check("A cannot serve B's service slug", (await get(HOST_A, "/services/specialist-consultation-demo")).status === 404);
check("B cannot serve A's service slug", (await get(HOST_B, "/services/general-consultation-demo")).status === 404);
check("draft service slug -> 404 (A)", (await get(HOST_A, "/services/a-draft-service")).status === 404);
check("draft article -> 404", (await get(HOST_A, "/articles/a-draft-article")).status === 404);
check("B's article not on A", (await get(HOST_A, "/articles/b-demo-article")).status === 404);
check("A's doctor profile ok / B's slug 404 on A", (await get(HOST_A, "/doctors/demo-doctor-a")).status === 200 && (await get(HOST_A, "/doctors/demo-doctor-b")).status === 404);
check("unknown clinic host -> 404", (await get(`nobody.mecgura.test:${PORT}`, "/")).status === 404);
check("unknown page -> 404 not a soft-200", (await get(HOST_A, "/terms")).status === 404);
check("platform host doesn't serve a site (/services needs login)", (await get(LOCAL, "/services")).status === 307);
check("/site/... on the platform host is not reachable", (await get(LOCAL, "/site/services")).status === 307);
check("/site/... typed on a clinic host without the proxy marker -> 404", (await get(HOST_A, "/site/services")).status !== 200);
check("staff app routes are not served as site pages on a clinic host", (await get(HOST_A, "/dashboard")).status === 307);

/* ---------- SEO ---------- */
const smA = await get(HOST_A, "/sitemap.xml");
check("A sitemap: published pages/services/doctor/article", smA.status === 200 && smA.text.includes("/services/general-consultation-demo") && smA.text.includes("/doctors/demo-doctor-a") && smA.text.includes("/articles/a-demo-article"));
check("A sitemap: no drafts, no B, no booking page", !smA.text.includes("draft") && !smA.text.includes("specialist") && !smA.text.includes("b-demo") && !smA.text.includes("book-appointment"));
check("B (not indexable) sitemap 404 + robots disallow all", (await get(HOST_B, "/sitemap.xml")).status === 404 && (await get(HOST_B, "/robots.txt")).text.includes("Disallow: /\n"));
const rb = await get(HOST_A, "/robots.txt");
check("A robots: allows site, blocks app/admin/api, links sitemap", rb.text.includes("Allow: /") && rb.text.includes("Disallow: /api/") && rb.text.includes("Disallow: /website") && rb.text.includes("Sitemap: http://demo.mecgura.test"));
check("platform robots disallow everything", (await get(LOCAL, "/robots.txt")).text.includes("Disallow: /"));
const svc = await get(HOST_A, "/services/general-consultation-demo");
check("canonical + OG + twitter + title without app suffix", svc.text.includes('rel="canonical" href="http://demo.mecgura.test') && svc.text.includes('property="og:title"') && svc.text.includes('name="twitter:card"') && /<title>General Consultation \(demo\) \| Demo Clinic<\/title>/.test(svc.text));
check("home has JSON-LD without ratings/reviews", /application\/ld\+json/.test(a.text) && !/aggregateRating|"review"/i.test(a.text));
check("indexable A has index,follow; B has noindex", !/noindex/.test(a.text) && /noindex/.test(b.text));

/* ---------- Accessibility & structure (browser) ---------- */
{
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  for (const path of ["/", "/services", "/contact", "/faq", "/doctors", "/clinic", "/articles/a-demo-article"]) {
    await p.goto(`http://${HOST_A}${path}`);
    const s = await p.evaluate(() => ({
      h1: document.querySelectorAll("h1").length, lang: document.documentElement.lang, main: document.querySelectorAll("main").length,
      noAlt: [...document.images].filter((i) => !i.hasAttribute("alt")).length, skip: !!document.querySelector('a[href="#content"]'),
      unlabeled: [...document.querySelectorAll("input:not([type=hidden]):not([tabindex='-1']),textarea,select")].filter((el) => !el.labels?.length && !el.getAttribute("aria-label")).length,
      headingJump: (() => { const hs = [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => +h.tagName[1]); return hs.some((n, i) => i > 0 && n - hs[i - 1] > 1); })(),
    }));
    check(`a11y ${path}: one h1, lang, main, alt on all images, skip link, labelled inputs, no heading jumps`, s.h1 === 1 && s.lang === "en" && s.main === 1 && s.noAlt === 0 && s.skip && s.unlabeled === 0 && !s.headingJump, JSON.stringify(s));
  }
  // keyboard: mobile menu opens with Enter and closes with Escape
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`http://${HOST_A}/`); await p.waitForTimeout(1200);
  const btn = p.locator('button[aria-controls="site-mobile-nav"]'); await btn.focus(); await p.keyboard.press("Enter");
  check("mobile menu opens by keyboard (aria-expanded)", (await btn.getAttribute("aria-expanded")) === "true");
  await p.keyboard.press("Escape");
  check("Escape closes the menu", (await btn.getAttribute("aria-expanded")) === "false");
  // FAQ accordion is keyboard-operable <details>
  await p.goto(`http://${HOST_A}/faq`); await p.waitForTimeout(300);
  const sum = p.locator("summary").first(); await sum.focus(); await p.keyboard.press("Enter");
  check("FAQ accordion toggles with the keyboard", await p.locator("details").first().evaluate((d) => d.open));
  // broken-link crawl from home
  await p.setViewportSize({ width: 1280, height: 800 }); await p.goto(`http://${HOST_A}/`);
  const hrefs = await p.evaluate(() => [...new Set([...document.querySelectorAll("a[href]")].map((x) => x.getAttribute("href")).filter((h) => h && h.startsWith("/") && !h.startsWith("//")))]);
  const bad = []; for (const h of hrefs) { const r = await get(HOST_A, h.split("#")[0]); if (r.status >= 400) bad.push(`${h}:${r.status}`); }
  check(`no broken internal links (${hrefs.length} checked)`, bad.length === 0, bad.join(" "));
  await ctx.close();
}

/* ---------- Contact form ---------- */
const good = { name: "E2E Visitor", phone: "9876543210", message: "Hello, what are your timings please?", consent: true };
check("contact form on clinic A host -> stored", (await post(HOST_A, "/api/public/contact", good)).status === 200);
check("contact form without consent -> 400", (await post(HOST_A, "/api/public/contact", { ...good, consent: false })).status === 400);
check("honeypot filled -> pretends success", (await post(HOST_A, "/api/public/contact", { ...good, website_url: "x" })).status === 200);
check("contact API on platform host (no tenant) -> 404", (await post(LOCAL, "/api/public/contact", good)).status === 404);
check("body cannot choose the clinic (tenantId ignored)", (await post(HOST_A, "/api/public/contact", { ...good, name: "Cross attempt", tenantId: "x", tenant: "demo-clinic-b" })).status === 200);
const admA = await login("admin@demo.mecgura.test"), admB = await login("admin@demob.mecgura.test"), docA = await login("doctor@demo.mecgura.test"), recA = await login("reception@demo.mecgura.test");
const enqA = await api(admA, "GET", "/api/website/enquiries"), enqB = await api(admB, "GET", "/api/website/enquiries");
check("clinic A sees the enquiry; clinic B does not", enqA.json.data.rows.some((r) => r.name === "E2E Visitor") && !enqB.json.data.rows.some((r) => r.name === "E2E Visitor" || r.name === "Cross attempt"));
check("reception can read enquiries, doctor cannot", (await api(recA, "GET", "/api/website/enquiries")).status === 200 && (await api(docA, "GET", "/api/website/enquiries")).status === 403);
check("anonymous cannot read enquiries", (await get(HOST_A, "/api/website/enquiries")).status === 401);

/* ---------- CMS: permissions via real HTTP ---------- */
check("receptionist: CMS reads/writes -> 403", (await api(recA, "GET", "/api/website/services")).status === 403 && (await api(recA, "PATCH", "/api/website/content", { section: "hero", data: {} })).status === 403 && (await api(recA, "POST", "/api/website/publish", { action: "unpublish" })).status === 403);
check("doctor: cannot edit site content / publish / create services", (await api(docA, "PATCH", "/api/website/content", { section: "hero", data: {} })).status === 403 && (await api(docA, "POST", "/api/website/publish", { action: "publish" })).status === 403 && (await api(docA, "POST", "/api/website/services", { title: "x" })).status === 403);
const docs = await api(docA, "GET", "/api/website/doctors");
check("doctor sees only their own profile in the CMS", docs.status === 200 && docs.json.data.length === 1 && /Demo/.test(docs.json.data[0].name));
const bDocs = await api(admB, "GET", "/api/website/doctors"); const bDocId = bDocs.json.data[0].id;
check("clinic A admin cannot open/edit clinic B's doctor profile", (await api(admA, "GET", `/api/website/doctors/${bDocId}`)).status === 404 && (await api(admA, "PATCH", `/api/website/doctors/${bDocId}`, { shortBio: "x" })).status === 404);
const bSvc = (await api(admB, "GET", "/api/website/services")).json.data.rows[0];
check("clinic A admin cannot read/update/publish clinic B's service (404)", (await api(admA, "GET", `/api/website/services/${bSvc.id}`)).status === 404 && (await api(admA, "PATCH", `/api/website/services/${bSvc.id}`, { title: "hacked" })).status === 404 && (await api(admA, "POST", `/api/website/services/${bSvc.id}/status`, { status: "ARCHIVED" })).status === 404);
check("unknown resource -> 404", (await api(admA, "GET", "/api/website/secrets")).status === 404);

/* ---------- Content safety (XSS) ---------- */
const evil = await api(admA, "POST", "/api/website/faq", { question: "XSS test <img src=x onerror=alert(1)>", answer: "<script>alert('x')</script> [click](javascript:alert(1)) **bold**" });
check("create FAQ (draft)", evil.status === 200, JSON.stringify(evil.json));
const evilId = evil.json?.data?.id;
check("draft FAQ not visible publicly", !(await get(HOST_A, "/faq")).text.includes("XSS test"));
const prevBefore = await admA.page.goto(`http://${LOCAL}/preview/faq`).then((r) => r.status());
check("…but visible in the admin's preview", prevBefore === 200 && (await admA.page.content()).includes("XSS test"));
check("publish FAQ", (await api(admA, "POST", `/api/website/faq/${evilId}/status`, { status: "PUBLISHED" })).status === 200);
const faqPage = await get(HOST_A, "/faq");
check("script/HTML is escaped, javascript: link neutralised", faqPage.text.includes("XSS test &lt;img") && !faqPage.text.includes("<script>alert") && !/href="javascript:/i.test(faqPage.text) && !/<img src=x/i.test(faqPage.text));
await api(admA, "POST", `/api/website/faq/${evilId}/status`, { status: "ARCHIVED" });
check("archived FAQ disappears", !(await get(HOST_A, "/faq")).text.includes("XSS test"));

/* ---------- Draft / publish / unpublish ---------- */
check("anonymous /preview -> login", (await get(LOCAL, "/preview")).status === 307);
const prevA = await admA.page.goto(`http://${LOCAL}/preview`); const prevHtml = await admA.page.content();
check("admin preview shows banner + noindex", prevA.status() === 200 && prevHtml.includes("draft content, not public") && /noindex/.test(prevHtml));
await admA.page.goto(`http://${LOCAL}/preview/services`);
check("preview shows draft service for A only", (await admA.page.content()).includes("A Draft service (demo)") && !(await admA.page.content()).includes("Specialist Consultation"));
await admB.page.goto(`http://${LOCAL}/preview/services`);
check("clinic B's preview never shows A's drafts", !(await admB.page.content()).includes("A Draft service") && (await admB.page.content()).includes("B Draft service"));
check("admin saves a draft change", (await api(admA, "PATCH", "/api/website/content", { section: "hero", data: { headline: "Draft headline E2E", subheadline: "x", intro: "y", imageUrl: "", imageAlt: "", primaryCtaLabel: "" } })).status === 200);
check("…public site unchanged until publish", !(await get(HOST_A, "/")).text.includes("Draft headline E2E"));
check("publish", (await api(admA, "POST", "/api/website/publish", { action: "publish" })).status === 200);
check("…now live", (await get(HOST_A, "/")).text.includes("Draft headline E2E"));
check("unpublish -> 'coming soon' (noindex), other clinic unaffected", (await api(admA, "POST", "/api/website/publish", { action: "unpublish" })).status === 200 && (await get(HOST_A, "/")).text.includes("coming soon") && (await get(HOST_B, "/")).text.includes("Demo Clinic B (demo website)"));
await api(admA, "PATCH", "/api/website/content", { section: "hero", data: { headline: "Demo Clinic (demo website)", subheadline: "Sample content — not a real clinic", intro: "This is demo content created for development and testing. Replace it with your own information.", imageUrl: "", imageAlt: "", primaryCtaLabel: "Book appointment" } });
await api(admA, "POST", "/api/website/publish", { action: "publish" });
check("restored", (await get(HOST_A, "/")).text.includes("Demo Clinic (demo website)"));

/* ---------- Images ---------- */
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const up = await admA.ctx.request.post(`http://${LOCAL}/api/website/images`, { multipart: { file: { name: "x.png", mimeType: "image/png", buffer: png } }, headers: { origin: `http://${LOCAL}` }, failOnStatusCode: false });
const imgUrl = (await up.json().catch(() => ({})))?.data?.url;
check("image upload ok -> /api/assets url", up.status() === 200 && /^\/api\/assets\//.test(imgUrl ?? ""));
const served = await get(HOST_B, imgUrl);
check("site images are public and served as webp with nosniff", served.status === 200 && served.headers.get("content-type") === "image/webp" && served.headers.get("x-content-type-options") === "nosniff");
check("clinic B cannot reference A's image", (await api(admB, "POST", "/api/website/services", { title: "img steal", imageUrl: imgUrl, imageAlt: "x" })).status === 400);
const svg = await admA.ctx.request.post(`http://${LOCAL}/api/website/images`, { multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("<svg onload=alert(1)/>") } }, headers: { origin: `http://${LOCAL}` }, failOnStatusCode: false });
check("disguised SVG rejected", svg.status() === 400);
check("doctor/reception upload rules", (await recA.ctx.request.post(`http://${LOCAL}/api/website/images`, { multipart: { file: { name: "x.png", mimeType: "image/png", buffer: png } }, headers: { origin: `http://${LOCAL}` }, failOnStatusCode: false })).status() === 403);

/* ---------- Suspended clinic hides its website ---------- */
const sa = await login("platform@demo.mecgura.test");
const bId = (await (await sa.ctx.request.get(`http://${LOCAL}/api/platform/clinics?q=demo-clinic-b`)).json()).data.rows[0].id;
await api(sa, "POST", `/api/platform/clinics/${bId}/status`, { status: "SUSPENDED" });
check("suspended clinic's website -> 404", (await get(HOST_B, "/")).status === 404);
await api(sa, "POST", `/api/platform/clinics/${bId}/status`, { status: "ACTIVE" });
check("re-activated clinic's website is back", (await get(HOST_B, "/")).status === 200);

console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) console.log(fails.map((f) => " - " + f).join("\n"));
await browser.close();
process.exit(fails.length ? 1 : 0);
