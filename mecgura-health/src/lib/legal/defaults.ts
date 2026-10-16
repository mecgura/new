/**
 * Starting-point text ONLY. It is a draft outline, not legal advice and not a finished policy. While a page still shows this text it is
 * labelled "Draft — pending legal review" to every visitor. The Super Admin replaces it in Platform settings → Legal pages.
 */
export const LEGAL_KINDS = ["terms", "privacy"] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];
export const LEGAL_TITLES: Record<LegalKind, string> = { terms: "Terms of Service", privacy: "Privacy Policy" };
export const LEGAL_DEFAULTS: Record<LegalKind, string> = {
  terms: `## Who these terms are between
These terms apply to your use of MECGURA HEALTH, a clinic management service provided to clinics ("the Clinic") by [Company legal name]. Patients use the patient portal under the Clinic's own policies.

## Use of the service
- Accounts are personal. Do not share your password or authenticator codes.
- The service helps manage records, appointments, billing and communication. It does not give medical advice and does not make clinical decisions; clinical responsibility stays with the treating professional.
- You must not attempt to access another clinic's data, probe the service for weaknesses without written permission, or upload unlawful or harmful content.

## Clinic data
The Clinic is responsible for the accuracy and lawful collection of the patient information it enters. MECGURA HEALTH processes that information on the Clinic's behalf, for providing the service.

## Availability and changes
We aim for reliable service but do not promise uninterrupted availability. We may update the service and these terms; material changes will be notified in the service.

## Subscription and payment
Fees, billing periods and cancellation are set out in the Clinic's subscription plan.

## Liability
[Liability, warranty and governing-law clauses to be completed by your legal counsel.]

## Contact
[Company legal name, address, email]`,
  privacy: `## What this policy covers
How MECGURA HEALTH handles personal information of clinic staff and of patients whose records a Clinic keeps in the service.

## Information we handle
- Staff: name, email, phone, role, sign-in and security events.
- Patients (entered by the Clinic or by the patient in the portal): identity and contact details, appointments, visits, prescriptions, test reports, invoices and payments, messages sent, consent choices.
- Technical: request logs and audit records kept to secure the service. Logs do not contain clinical content.

## Why we use it
To provide the service to the Clinic, keep it secure, send messages the Clinic and the patient have chosen, and meet legal obligations.

## Who can see it
Only authorised staff of the Clinic that holds the record, and the patient for their own record. Other clinics cannot see it. Platform administrators do not browse clinic records; if support access is needed it needs a written reason, is time-limited and is logged.

## Sharing
We do not sell personal information. Messages and payments pass through the providers the platform has configured (for example e-mail, SMS, WhatsApp or payment providers) only when those are switched on.

## Your choices and rights
You can ask the Clinic for access, correction, restriction or erasure of your information, and manage consents and notification preferences in the portal. Medical records may have to be retained for the period required by law.

## Security
Access is controlled by role and permission, sign-in can require two-factor authentication, sensitive actions are logged and data is protected in transit.

## Retention
Records are kept as the Clinic's retention policy and applicable law require.

## Contact
[Data-protection contact name, email, address]`,
};
