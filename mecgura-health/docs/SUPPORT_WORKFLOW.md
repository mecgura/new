# Support workflow

## Channels and expectations (set by the business, defaults suggested)
| Priority | Example | Target first response |
|---|---|---|
| P1 | Clinic cannot work (login/OPD/billing down), suspected data exposure | 1 h, 24×7 owner on-call |
| P2 | A module broken for some users, payments/messages failing | 4 business hours |
| P3 | How-to, configuration, small defects | 1 business day |

## Handling a ticket
1. **Identify the clinic and the user** (never ask for a password; MFA reset requires verifying identity with the Clinic Admin, not the end user alone).
2. **Collect**: what, when, which screen, the **request id** from the error (shown on error pages and in API errors). Do not collect screenshots with patient details unless needed; redact before attaching.
3. **Look without touching**: `/platform/system`, Platform → Communications/Notifications monitors, Security events, clinic row in Platform → Clinics. These show counts and statuses, not patient records.
4. **Need to see the clinic's workspace?** Use **Support access**: written reason (≥ 10 chars), password re-entry, 60 minutes, banner shown, fully audited. Close it when done. Never ask a clinic for their password.
5. **Fix path**: configuration (feature switch, plan, domain) → Super Admin console; data correction → ask the Clinic Admin to do it with their permissions, or do it in support access with the reason recorded; defect → engineering with request id and steps.
6. **Close** with a short note to the clinic; if it was an incident, follow `docs/INCIDENT_RESPONSE.md`.

## Common requests
| Request | How |
|---|---|
| New clinic | Platform → Clinics → New (sets up clinic, branding, first Clinic Admin invitation, plan/trial) |
| Add custom domain | Clinic Admin enters the domain → Super Admin verifies DNS TXT → TLS on the host |
| Reset a staff member's access | Clinic Admin → Team (reset/deactivate); Super Admin → Users for Clinic Admins |
| Lost authenticator | Super Admin → Users → *Reset MFA* (audited, signs the user out) |
| Patient asks for data copy/erasure | Clinic: Settings → Privacy → data-rights requests (30-day due date; clinical records are retained or restricted per policy, never silently erased) |
| Change plan / extend trial / record offline payment | Platform → Subscriptions |
| Turn a module off for a clinic | Platform → Features (re-authentication) |

## What support must never do
Share credentials, copy patient data out of the system, disable audit, use a clinic's data for demos, promise legal compliance or clinical outcomes.
