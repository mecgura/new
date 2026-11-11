# Phase 14 — Super Admin & Platform Management

The platform-owner layer: a Super Admin console to run clinics, people, features, domains, branding, monitoring, audit and platform settings — without ever becoming a hidden bypass of tenant isolation.

> Routing: the console lives under the **existing** `/platform` area (no duplicate `/admin` tree). Sidebar: Platform · Clinics · Users · Roles & permissions · Domains · Features · Communications · Platform alerts · Analytics · Audit logs · System health · Platform settings.

## Security model
* **Who:** every platform service calls `guard()` — role `SUPER_ADMIN` **and** `platform.manage`, both read from the server-side context. `platform.manage` is not grantable; `SUPER_ADMIN`/`PATIENT` are not assignable roles.
* **Re-authentication:** suspend / deactivate / archive / restore, switching a feature off, changing a clinic admin, deactivating a user, changing a role, resetting access, maintenance, disabling or manually confirming a domain, and starting support access all require the Super Admin's **own password** (`stepUp`). 5 wrong tries pause confirmations for 15 minutes; each failure is audited (`platform.reauth_failed`).
* **Reasons:** closing actions need a written reason (stored in the status history, not in audit metadata). The UI uses one confirmation pattern: **Action · Target · Impact · Reason · password · Confirm/Cancel**.
* **Session:** platform admin sessions end 4 h after sign-in (clinic staff keep 8 h). Maintenance never blocks Super Admins.
* **Support access** (`SupportAccess` table): a reason (≥10 chars) + password; 60 minutes; one open visit per admin; the workspace cookie is honoured **only while an open, unexpired row exists** (a replayed cookie is ignored); a banner “SUPER ADMIN SUPPORT ACCESS” shows the clinic, reason and time left on every screen; start and end are audited. There is **no user impersonation** and no way to sign in as another user.
* **No fake data / no secrets:** every figure is a count or timestamp from the database; providers show “Configured ✓” never credentials; where nothing is recorded (error store, backups, provider health probes) the UI says *unknown/unavailable*.

## Clinic lifecycle
`PENDING → ACTIVE ⇄ SUSPENDED / INACTIVE → ARCHIVED → (restore) INACTIVE → ACTIVE` (`TRIAL` still works as before). Defined in `src/lib/platform/lifecycle.ts`; invalid moves are refused. Activation from PENDING needs the required setup items (basic info, an *active* admin, timezone, branding, domain). Nothing is deleted: patients, users, audit and history stay. Every change writes a `TenantStatusEvent` (who, why, when, category) and a `clinic.status_changed` audit entry; the subscription status is kept in step as before.
Blocking is automatic because every access path already requires an ACTIVE/TRIAL clinic: staff sign-in and every request, the patient portal, public website routing, and the communications worker (queued messages are cancelled for inactive clinics).

## Feature switches (`TenantFeature`)
13 switches: appointments, liveOPD, patientCRM, consultation, lab, followUp, billing, pharmacy, patientPortal, whatsapp, sms, email, analytics. **Enforced server-side in one place** — `getAccess()` removes the permissions of a disabled feature's modules from the request context (`applyFeatureGates`), so every page, API and service guard denies them; the menu hides the entries; the patient portal and the clinic's message channels are checked where they run. Disabling never deletes data; enabling restores access immediately. New-clinic defaults live in platform settings.

## Domains
`Tenant.customDomainStatus` = PENDING / VERIFYING / VERIFIED / FAILED / DISABLED. The clinic proves ownership with a **DNS TXT record** `_mecgura-verify.<domain>` = `mecgura-verify=<token>`; “Check DNS now” performs a real lookup (`dns.resolveTxt`, 5 s timeout) and records the honest result. A host resolves to a clinic **only** when `customDomainVerifiedAt` is set (a VERIFIED, enabled domain); one domain belongs to one clinic (unique), platform/loopback/IP hosts can't be claimed, changing the domain resets verification, disabling stops routing immediately. Manual confirmation exists but needs a reason + password and is audited as manual. SSL and DNS pointing at the server are done outside the app.

## Users
Cross-clinic search (name, email, phone, role, clinic, status incl. Locked), server-paged. Actions: activate / suspend / deactivate, change role (never to SUPER_ADMIN/PATIENT; grants for the old role are removed), reset access (unlock; re-issue a single-use invitation for INVITED users), invite into a clinic. Protections: platform admins and patient portal accounts can't be touched; an active clinic can't lose its last active Clinic Admin; no cross-clinic move (a user belongs to one clinic). Invitations are single-use, 7-day, stored hashed, the token is shown once.
Clinic admin hand-off: choose an active non-doctor staff member → becomes Clinic Admin; previous admins can be moved to another role; previous admin ids are recorded.

## Roles & permissions
A read-only view generated from the real definitions (counts per area, every permission, grantable vs role-only). Roles are code-defined on purpose; there is no run-time role editor.

## Branding & white-label
Edit colours with a live preview of staff dashboard, login, public website/portal, email and notification surfaces (nothing saved until Save; the server re-validates contrast; audit holds before/after). A *white-label health check* reports real state: logo, favicon, readable colours, website, portal, domain, email sender name, notification branding. Logo/favicon are uploaded by the clinic in its own Settings (or by the admin during a support visit).

## Monitoring (`platform-monitor.ts`)
Dashboard (clinics by status, staff, doctors, patients, today's appointments in each clinic's own timezone, providers configured, unread critical alerts, recent clinics and admin activity), system health (application, database latency, queue age, **scheduler heartbeat** written by the cron endpoint, webhooks, storage; error monitoring and backups honestly *unknown*), provider monitor (state, last success/failure, 7-day failures, webhook readiness, “Health status unavailable” when there is no traffic), webhook monitor, notification monitor, usage per clinic. Per-clinic *Overview / Users / Branding / Domains / Features / Settings / Communications / Notifications / Analytics / Audit / Activity* tabs reuse these services; Phase 13 analytics logic is reused (`platformAnalytics`), not copied.

## Platform settings
Defaults (timezone, locale, currency, date format, reminder offsets, feature defaults) — applied *where a clinic has no value* (new-clinic features; default currency until billing settings are saved; reminder offsets until communication settings exist). Hierarchy: platform default → clinic setting → user preference. Global and per-clinic **maintenance mode** (blocks clinic users and patients with a notice; Super Admins never blocked). **Announcements** (all staff / clinic admins / selected clinics, optional end time) shown as a banner. Per-clinic **limits and retention** are validated configuration only — **nothing is enforced and nothing is deleted** (plans are Phase 15, compliance Phase 16).

## Audit center
Filters: clinic, actor, category, severity, action prefix, entity, date; 30 per page; per-entry detail with actor, role, entity, IP/device when recorded, and before/after for configuration changes. Append-only: no route or service updates or deletes audit rows (a test scans the source). Indexes added: `AuditLog(createdAt)`, `(action, createdAt)`, `(entityType, entityId)`; `Tenant(createdAt)`; `User(status, createdAt)`, `User(lastLoginAt)`.

## APIs (`/api/platform/…`, all `platform.manage`, same-origin checked)
`dashboard` · `system` · `providers` · `monitor` · `usage` · `roles` · `search` · `audit`, `audit/[id]` · `settings` · `maintenance` · `announcements` · `support` · `workspace` (POST = start support access, DELETE = end) · `users`, `users/[id]` (action: status/role/reset) · `features` · `domains` · `clinics` (+ `all=1`, sort) · `clinics/[id]/{lifecycle,history,overview,branding,features,config,users,admin}` · `clinics/[id]/domain` (PATCH subdomain; POST manual confirm) · `…/domain/custom` (GET/PUT/DELETE) · `…/domain/verify`.

## Not built / limits
* **No MFA** (no authenticator infrastructure exists); sessions are capped and sensitive actions re-authenticate instead. **No platform API keys or clinic API access** exist, so there is nothing to manage; **no webhook secrets are exposed**.
* **No user impersonation**; support access is workspace entry only.
* Users can't be moved between clinics (data scope). Roles can't be edited at run time.
* Limits and retention are configuration only. Storage metrics cover database-stored branding files; disk/object-storage capacity and backups are not monitored (Phase 17). There is no error store, so “critical errors” can't be listed.
* Step-up failure counting and the in-process setting cache are per server instance.
* Phase 15 (plans/billing), Phase 16 (advanced security/compliance) and Phase 17 (backup/DR) are untouched.
