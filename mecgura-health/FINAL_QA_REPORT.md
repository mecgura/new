# Final QA report (Phase 18)

Statuses: **PASS** verified by an automated run recorded here · **WARNING** works but with a stated gap · **FAIL** broken · **BLOCKED** cannot be tested here · **NOT_CONFIGURED** needs an external account/credential (nothing is simulated).

Environment: production build (`next build`), SQLite, clean database per suite (`migrate deploy` + `db:seed`), Chromium (Playwright). Date: 2026-10-13.

## Automated results
| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | PASS, 0 errors |
| ESLint | PASS, 0 errors (12 pre-existing unused-variable warnings in tests/e2e) |
| Unit + integration (Vitest) | PASS — 742 tests, 36 files (SQLite) |
| Production build | PASS |
| `security:scan` (secrets/config) | PASS |
| `db:check-schema` (PG schema in sync) | PASS |
| Route guards (every one of 339 route files authenticated or on reviewed public list) | PASS |
| E2E Phases 1–17, clean DB each | PASS — 71, 76, 133, 130, 110, 97, 62, 111, 139, 135, 56, 56, 83, 151, 73, 86, 14 checks, 0 failures |
| Phase 18 QA sweep | PASS — 73/73 |
| Data integrity (`qa:integrity`) after billing/pharmacy/lab runs | PASS — 77 checks, 0 violations |
| Backup + restore verify | PASS SQLite (seeded data); PASS PostgreSQL 16 (schema only, empty tables) |

## Feature / journey audit
| Area | Status | Evidence / gap |
|---|---|---|
| Platform: create clinic → admin → branding → domain → plan | PASS | e2e phase 14, 15 |
| Clinic staff journey: register patient → appointment → OPD token → consultation → prescription → lab → invoice/payment → pharmacy dispensing | PASS | e2e phases 3–9, each module + cross-module |
| Patient journey: portal sign-up/activation → book → records → privacy request | PASS | e2e phase 10, 16 |
| Public website: publish/unpublish, drafts never public, suspended → 404, XSS neutralised | PASS | e2e phase 2 |
| Subscription journey incl. webhooks (signature checks) | PASS (offline payments); NOT_CONFIGURED (live online payment) | phase 15 |
| Communication (email/SMS/WhatsApp) | PASS for queue, templates, retry, webhooks with test secrets; **NOT_CONFIGURED** for real delivery | phase 11 |
| Notifications centre | PASS | phase 12 |
| Analytics/reports/exports | PASS | phase 13 |
| Security: MFA, sessions, API keys, audit chain, privacy | PASS | phase 16 |
| Operations: health/ready/version, jobs, errors, backups | PASS | phase 17 |

## Roles (12)
| Role | Status | How |
|---|---|---|
| SUPER_ADMIN, CLINIC_ADMIN, DOCTOR, RECEPTIONIST, ACCOUNTANT, PHARMACY_STAFF, PHARMACY_MANAGER, LAB_STAFF | PASS | 92-page sweep each: no 5xx, no browser errors; clinic roles reach 0 `/platform` pages; non-admin roles blocked from Team/security settings; 14–66 pages open per role per its permissions |
| PATIENT | PASS | cannot open `/dashboard` or `/platform`; portal pages checked at 375/768 px |
| COMPOUNDER, NURSE, STAFF | **WARNING** | no seeded users, so not in the live sweep; covered by permission-matrix and service integration tests only |

## Cross-tenant
PASS — two-clinic scenarios in every module e2e (foreign IDs → 404/403, client `tenantId` ignored), registry test, route-guard test, cross-tenant FK integrity check (69 relations, 0 violations).

## Financial / stock / clinical data
- Money: PASS — invoice total = sum of lines, collected = gross successful payments, refunded = sum of payment refunds, no negatives, unique numbers; real data incl. a partial refund. (A first draft of one check mis-modelled refunded payments; the check, not the app, was corrected.)
- Stock: PASS — no negative/over-reserved batches, ledger balance never negative, FEFO/partial dispensing in e2e phase 9.
- Clinical: PASS — versioned consultations/prescriptions/lab reports (finalised content not silently editable), allergy/medication records, tenant-scoped (phases 5, 6).

## Accessibility, responsive, browsers, errors
- Accessibility: **PASS (automated)** — axe-core WCAG 2.0/2.1 A+AA on 18 pages (admin, platform, public, portal): 0 violations. Found and fixed during QA: account-menu label mismatch (all pages), low-contrast text on dashboard checklist, unlabeled search inputs (16 filter forms, fixed generically in `Field`), links distinguished by colour only. **WARNING**: no manual screen-reader or keyboard-only audit.
- Responsive: PASS — no horizontal overflow at 375 / 768 / 1280 px on 9 clinic + 4 platform pages, 5 public pages, 3 portal pages.
- Browsers: **WARNING** — Chromium only. Firefox/Safari/real mobile devices not tested.
- Error states: PASS — forbidden/unavailable pages, 401/403/404/429 envelopes, request ids; 503 on `/ready` when DB down (unit-tested path).

## Other
- Demo-data separation: PASS — demo seed refuses in production; `db:seed:production` creates only permissions, roles, optional first Super Admin (verified on an empty database: 0 tenants/plans/patients).
- Code quality: PASS with warnings (above). No secret in repo.
- Performance: PASS on synthetic SQLite data (`perf/RESULTS.md`, all screens < 210 ms); **WARNING** not measured on PostgreSQL or real volumes.

## Defects found and fixed in Phase 17/18
1. Tenant-cache invalidation did not reach page bundles (separate module copies per route) → public site changes could stay stale 30 s. Fixed with a `globalThis` registry; e2e phase 2 now passes.
2. Accessibility items listed above.
3. Phase 14 e2e asserted "backups unknown"; updated to the real records.
4. No production bootstrap existed (demo seed refuses in production) → added `db:seed:production`.

## Not tested / limits
Vitest suite on PostgreSQL; PostgreSQL production seed; any live provider (email/SMS/WhatsApp/Razorpay); load/concurrency testing; penetration test; Firefox/Safari; manual accessibility; multi-instance behaviour (rate limiter is per instance).
