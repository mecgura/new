# Phase 2 — Public doctor/clinic website + CMS

## How a request becomes a website
```
visitor → clinic host (clinic-a.<TENANT_ROOT_DOMAIN> | verified custom domain)
        → src/proxy.ts   : host is a tenant host AND path is on the public allow-list (lib/website/paths.ts)
                           → rewrite to /site/<path> + marker header x-mh-site
        → app/site/[[...path]]  : tenant = findTenantByHost(Host)   (never from URL/body)
        → loadSite(tenantId, "public")  : PUBLISHED snapshot + PUBLISHED items only, every query `where tenantId`
        → template (MODERN_MEDICAL) renders the page
```
* Unknown host → 404. Suspended/inactive clinic → 404. Site not published → "coming soon" (noindex).
* Staff app routes (`/dashboard`, `/team`, `/website`, `/api/*`…) are NOT on the allow-list, so a clinic host never serves them as site pages.
* Draft **preview** lives at `/preview/[[...path]]` (staff only, tenant from the session, noindex). Same renderer, `mode="preview"`.

## Public routes
`/` `/about` `/services` `/services/[slug]` `/doctors` `/doctors/[slug]` `/clinic` `/testimonials` `/faq` `/articles` (`?page=`) `/articles/[slug]` `/contact` `/book-appointment` `/privacy` `/terms` `/sitemap.xml` `/robots.txt`.
A page exists only when it is switched on **and** has real content (`lib/website/pages.ts › availablePages`).
`/book-appointment` is an honest set-up page (no form, no slots, no confirmation) — the booking engine is Phase 3.

## Content model & draft/publish
| Data | Where | Draft/publish |
|---|---|---|
| Site-wide content: hero, about, clinic info, **hours**, WhatsApp, social, contact, legal, footer, page switches, **navigation**, SEO | `Website.draftContent` / `publishedContent` (validated JSON, `lib/website/content.ts`) | Save draft → Preview → **Publish** (copies draft → published snapshot). Unpublish = site offline |
| Services, doctors' public profiles, testimonials, FAQ, articles | own tables (`WebsiteService`, `DoctorPublicProfile`, `Testimonial`, `FaqItem`, `Article`) | per-record `DRAFT / PUBLISHED / ARCHIVED`. Created as DRAFT. Public site shows PUBLISHED only |
| Contact enquiries | `ContactEnquiry` | never public |

* Editing a **published** item without `website.publish` (e.g. a doctor editing their live profile/article) sends it back to DRAFT. An admin editing a published item changes it immediately (the UI says so).
* Doctor clinical identity (qualification, specialization, experience, registration, fee) is *reused* from Phase 1 `DoctorProfile` — not duplicated.

## Roles
| Permission | CLINIC_ADMIN / SUPER_ADMIN (inside a clinic) | DOCTOR | RECEPTIONIST |
|---|---|---|---|
| `website.view` (CMS + preview) | ✔ | ✔ | – |
| `website.edit` (site content, services, FAQ, testimonials, doctors list, nav, SEO) | ✔ | – | – |
| `website.publish` (publish site/items) – never grantable | ✔ | – | – |
| `website.profile` (own public profile) | ✔ | ✔ | – |
| `website.articles` (own article drafts) | ✔ | ✔ | – |
| `enquiries.view/manage` | ✔ | – | ✔ |
| `clinic.settings` (request a domain) | ✔ | – | – |

## Rich text (safe by construction)
CMS text is **Markdown-lite** parsed to an AST and rendered as React elements (`lib/website/markdown.ts`, `components/website/markdown.tsx`).
Raw HTML is never interpreted (it shows as text); links must be `http(s)/mailto/tel/relative`; no `dangerouslySetInnerHTML` is used for content
(only for JSON-LD, with `<` escaped). Supported: `##`/`###`, paragraphs, `-` and `1.` lists, `>` quotes, `**bold**`, `*italic*`, `[text](url)`.

## Images
Upload → magic-byte validation (PNG/JPG/WebP, no SVG) → **re-encoded with sharp** (≤1600 px, WebP, EXIF/GPS stripped) → stored in `TenantAsset(kind=SITE_IMAGE)`
→ served at `/api/assets/<id>` (public, `nosniff`, sandbox CSP). Content may only reference images **uploaded by the same clinic** (checked on save).
Every image field has alt text (required when an image is set). Rendered with `loading="lazy" decoding="async"`.
Production should move storage to an object store/CDN (see limitations).

## Templates
`src/website/templates/types.ts` (`TemplateComponents`) → implement → register in `registry.ts`. The CMS, data loader, SEO and routing don't change.
Only `MODERN_MEDICAL` ships. `Website.template` stores the key (unknown keys fall back to the default).

## SEO
Title/description/canonical/Open Graph/Twitter per page, generated from real content with CMS overrides; clinic title (no app suffix);
`noindex` for previews, unpublished sites and clinics that turn indexing off; JSON-LD (`MedicalClinic`/`Physician`: name, address, phone, hours — **no ratings/reviews**);
tenant-aware `/sitemap.xml` (published only) and `/robots.txt` (blocks `/api/`, app and admin areas). The platform host's robots disallows everything.

## Domains
Subdomain `<label>.TENANT_ROOT_DOMAIN` resolves when the root domain is configured and DNS has a wildcard record + wildcard SSL.
Custom domains: a clinic admin can only **request** one (`Website.requestedDomain`); a Super Admin attaches and verifies it (Phase 1). It serves the site only when verified.
States shown: Not connected / Pending verification / Verified / Active (verified + published). *Error* is reserved — nothing checks DNS automatically yet.
Production needs: DNS (CNAME/A to the host), per-domain SSL (managed certs), forwarding of the original `Host` header, `APP_URL` set to the https base.

## Contact form
`POST /api/public/contact` — clinic from the **Host** header; honeypot, per-IP + per-clinic rate limits, validation + length caps, consent required,
IP stored only as a salted hash, same-origin check. Enquiries are visible to that clinic only (`/website/enquiries`). No email is sent (no provider configured).

## Security notes
* Public data module `lib/website/data.ts` is the single reader; public types contain no ids; tenant filter + `status=PUBLISHED` on every query.
* CMS goes through `tenantDb(ctx)`; another clinic's ids are 404; client-supplied tenant ids don't exist.
* CSP: nonce-based scripts; `upgrade-insecure-requests` only when `APP_URL` is https.

## Tests
`npm test` (unit + service-level isolation, draft/publish, permissions, slugs, images, enquiries) and the live suite `e2e/phase2-website.mjs`
(host isolation, drafts, sitemap/robots, SEO tags, a11y structure, keyboard, XSS, broken links, contact, preview, publish/unpublish, suspension).

## Known limitations
* Public pages are rendered per request (dynamic, because the CSP nonce and tenant host are per request). Add edge/CDN caching with short TTL in production.
* Site images are stored in the database (fine for a handful per clinic; use object storage at scale).
* Editing a *live* item as an admin is live immediately (no per-item draft copy). Site-wide content has true draft/publish.
* No redirects when a slug is changed. No automatic DNS/SSL check. No email notification for enquiries.
* Only one template. `next dev` on fake hosts (`*.mecgura.test`) doesn't hydrate (HMR host check) — test hosts against a production build.
