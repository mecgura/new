# Super Admin (platform owner) — quick guide

Runs the platform: creates and manages clinics, plans/subscriptions, domains, features, users and platform security. Has **no** routine access to patient records.

## What you do here
1. Sign in on the platform host. Two-factor is required — enrol in **Account security** at first sign-in and store the recovery codes safely.
2. **Clinics**: create, activate, suspend, archive (reason + password + authenticator code needed).
3. **Domains**: review custom-domain requests; check DNS; mark verified only after DNS and TLS are in place.
4. **Subscriptions**: plans, trials, offline payments, invoices; online payments only when the payment provider is configured.
5. **Features**: switch modules per clinic (the clinic loses the matching permissions immediately).
6. **System**: `/platform/system` — database, scheduler, queue, jobs, errors, backups. Act on any warning.
7. **Security**: events, incidents, audit verification, API keys, legal holds.
8. **Support access** to a clinic workspace: reason + password; 60 minutes; always audited.

## Good to know
- Never share your login or recovery codes.
- Do not use support access to browse patient data without a ticket.
- Keep at least two Super Admins so one lost device does not lock you out.

Need help? Ask your Clinic Admin; they can contact MECGURA support with the request id shown on any error.
