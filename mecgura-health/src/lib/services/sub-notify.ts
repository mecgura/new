import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { def, type NType } from "@/lib/notifications/catalog";
import { safeNotify } from "@/lib/notifications/engine";
import { email as emailProvider } from "@/lib/communications/providers/registry";
import { esc } from "@/lib/billing/billing-html";
import { getVendor } from "./sub-config";

export type SubNotifyType = Extract<NType, `SUBSCRIPTION_${string}`>;
/**
 * Tells the clinic about a billing event: an in-app notification for clinic admins (Phase 12) AND one email to the billing contact.
 * Both are idempotent per `eventKey`, and neither can ever break the billing transaction that raised them.
 */
export async function notifySubscription(tenantId: string, type: SubNotifyType, eventKey: string, vars: Record<string, string> = {}) {
  try { await safeNotify({ tenantId, type, eventKey: `sub:${eventKey}`, entityType: "subscription", entityId: tenantId, vars, actionUrl: "/subscription" }); } catch (e) { logger.error("subscription notification failed", { type, error: e }); }
  try { await emailBillingContact(tenantId, type, eventKey, vars); } catch (e) { logger.error("subscription email failed", { type, error: e }); }
}

async function emailBillingContact(tenantId: string, type: SubNotifyType, eventKey: string, vars: Record<string, string>) {
  const d = def(type); if (!d) return;
  const dedupe = `EMAIL:${eventKey}`;
  if (await db.subscriptionEvent.findFirst({ where: { tenantId, type: "NOTIFIED", note: dedupe }, select: { id: true } })) return;
  const [profile, tenant, vendor] = await Promise.all([db.subscriptionBillingProfile.findUnique({ where: { tenantId } }), db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, contactEmail: true } }), getVendor()]);
  const to = profile?.billingEmail || tenant?.contactEmail; const provider = emailProvider();
  if (!to || !provider) return; // no contact or no email provider configured: the in-app notification still exists
  const subject = `${vendor.brandName}: ${d.title(vars)}`; const body = d.message(vars);
  const sub = await db.subscription.findUnique({ where: { tenantId }, select: { id: true } }); if (!sub) return;
  // Record first (the unique intent), then send: a crash in between can at worst skip one email, never send twice.
  await db.subscriptionEvent.create({ data: { tenantId, subscriptionId: sub.id, type: "NOTIFIED", source: "SYSTEM", note: dedupe } });
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px"><h2>${esc(d.title(vars))}</h2><p>${esc(body)}</p><p>Open <b>Subscription</b> in your ${esc(vendor.brandName)} workspace for details.</p>${vendor.supportEmail ? `<p style="color:#555">Questions? ${esc(vendor.supportEmail)}</p>` : ""}</div>`;
  const r = await provider.sendEmail({ to, fromName: vendor.brandName, replyTo: vendor.supportEmail || null, subject, html, text: `${d.title(vars)}\n\n${body}` });
  if (!r.ok) logger.warn("subscription email not accepted", { code: r.code });
}
