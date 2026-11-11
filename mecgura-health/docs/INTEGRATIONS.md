# Integrations — what exists and what is configured

Rule: **an integration is "active" only when its variables are set and the provider accepted the call.** Nothing is simulated. `/ready`, Settings → Integrations and Platform → Communications show the real state.

| Integration | Code | Needs | Default state |
|---|---|---|---|
| Email — Resend | `communications/providers/resend-email.ts` | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_WEBHOOK_SECRET` (Svix signatures) | **Not configured** |
| SMS — Twilio | `providers/twilio-sms.ts` | `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_ACCOUNT_SID`, `SMS_SENDER_ID` (+ DLT/sender approvals where required by law) | **Not configured** |
| WhatsApp — Meta Cloud API | `providers/meta-whatsapp.ts` | `WHATSAPP_PROVIDER`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`; approved message templates | **Not configured** |
| Subscription payments — Razorpay | `subscriptions/providers/razorpay.ts` | `SUBSCRIPTION_PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | **Not configured** (offline payments recordable) |
| In-app notifications | `notifications/` | none | Active |
| Malware scanner | `security/malware.ts` interface | a registered scanner | None (images only) |
| Rate-limit store | `security/rate-limit.ts` `setRateLimitStore` | e.g. Redis | In-memory |
| External error tracker / APM | — | — | **Not connected** (own `ErrorEvent` store) |
| External API for partners | `/api/v1/*` with API keys | key created by Clinic Admin | Read-only: ping, appointments, services, platform status |

## Enabling a provider safely
1. Add the variables in the secret store (never in the repo). Redeploy.
2. `/ready` shows the channel as `ok`; Platform → Communications shows "Configured ✓" (credentials are never displayed).
3. Register the webhook URL at the provider (`<APP_URL>/api/webhooks/{email|sms|whatsapp}`, `<APP_URL>/api/webhooks/subscriptions/razorpay`).
4. Send one test message/payment in the provider's **sandbox**, confirm delivery status arrives via webhook, then switch to live keys.
5. Per clinic: Settings → Communications / switch on the feature for the plan. Per patient: consent and preferences are respected; opt-outs stop sends.

## What is *not* integrated
Insurance/TPA, government health IDs, lab analyser interfaces, accounting software exports, telemedicine, e-prescribing networks, Google/Meta ad conversions. None are implied anywhere in the UI.
