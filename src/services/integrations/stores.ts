import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { siteConfig } from "@/config/site";
import type { OrgAccess } from "@/lib/session";
import { createContact, normalizePhone, setContactTags, updateContact, type Ctx } from "@/services/inbox/contacts";
import { getLoyaltySettings, recordPurchase } from "@/services/loyalty/loyalty";
import { isServiceEnabled } from "@/services/whatsapp/guards";

/**
 * Store integrations through the store's own signed webhooks — no app review needed:
 * - Shopify: Settings → Notifications → Webhooks (JSON), signed with the key Shopify shows there.
 * - WooCommerce: Settings → Advanced → Webhooks, signed with the secret MECGURA generates.
 * An order creates/updates the contact, records the purchase and tags them (tags can start
 * automations). A Shopify checkout without an order tags "Abandoned cart" with the cart link.
 * Customers are never marked as opted in to WhatsApp marketing by a store event.
 */
export const STORE_PROVIDERS = ["shopify", "woocommerce"] as const;
export type StoreProvider = (typeof STORE_PROVIDERS)[number];

export const storeSettingsSchema = z.object({
  customerTag: z.string().trim().min(1).max(40).default("Store customer"),
  cartTag: z.string().trim().min(1).max(40).default("Abandoned cart"),
  recordPurchases: z.boolean().default(true),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export const createConnectionSchema = z.object({
  provider: z.enum(STORE_PROVIDERS),
  name: z.string().trim().min(1, "Name the store").max(80),
  /** Shopify: the signing key shown under Settings → Notifications → Webhooks. WooCommerce: leave empty and we generate one. */
  secret: z.string().trim().max(200).default(""),
  settings: storeSettingsSchema.partial().default({}),
});

const parse = <T,>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
export const webhookUrl = (provider: string, id: string) => `${siteConfig.url}/api/integrations/${provider}/${id}`;

type Row = Prisma.IntegrationConnectionGetPayload<object>;
function toDto(c: Row) {
  return {
    id: c.id,
    provider: c.provider as StoreProvider,
    name: c.name,
    status: c.status,
    settings: storeSettingsSchema.parse(parse(c.settings, {})),
    webhookUrl: webhookUrl(c.provider, c.id),
    eventCount: c.eventCount,
    lastEventAt: c.lastEventAt,
    lastError: c.lastError,
    createdAt: c.createdAt,
  };
}

export async function listConnections(access: OrgAccess) {
  const rows = await db.integrationConnection.findMany({ where: { organizationId: access.organizationId }, orderBy: { createdAt: "asc" } });
  const recent = await db.integrationEvent.findMany({ where: { connectionId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "desc" }, take: 30, select: { connectionId: true, topic: true, externalId: true, status: true, detail: true, createdAt: true } });
  return rows.map((r) => ({ ...toDto(r), recent: recent.filter((e) => e.connectionId === r.id).slice(0, 10) }));
}

export async function createConnection(access: OrgAccess, input: z.infer<typeof createConnectionSchema>, req?: Request) {
  if ((await db.integrationConnection.count({ where: { organizationId: access.organizationId } })) >= 10) throw new ApiError("VALIDATION_ERROR", "Up to 10 store connections per workspace.");
  let secret = input.secret;
  let generated = false;
  if (input.provider === "shopify" && secret.length < 16) throw new ApiError("VALIDATION_ERROR", "Paste the webhook signing key from Shopify (Settings → Notifications → Webhooks).", { details: { secret: ["Required"] } });
  if (input.provider === "woocommerce" && !secret) {
    secret = randomBytes(24).toString("base64url");
    generated = true;
  }
  const defaults: StoreSettings = { customerTag: input.provider === "shopify" ? "Shopify customer" : "WooCommerce customer", cartTag: "Abandoned cart", recordPurchases: true };
  const c = await db.integrationConnection.create({
    data: { organizationId: access.organizationId, provider: input.provider, name: input.name, encryptedSecret: encryptSecret(secret), settings: JSON.stringify({ ...defaults, ...input.settings }), createdById: access.user.id },
  });
  await audit({ action: "integration.connected", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "integration", targetId: c.id, metadata: { provider: c.provider }, req });
  // The generated WooCommerce secret is shown once, to paste into WooCommerce.
  return { connection: toDto(c), secret: generated ? secret : undefined };
}

export async function updateConnection(access: OrgAccess, id: string, input: { name?: string; status?: "active" | "disabled"; settings?: Partial<StoreSettings> }) {
  const c = await db.integrationConnection.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!c) throw new ApiError("NOT_FOUND", "Connection not found.");
  const settings = input.settings ? JSON.stringify(storeSettingsSchema.parse({ ...parse(c.settings, {}), ...input.settings })) : undefined;
  const u = await db.integrationConnection.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.status ? { status: input.status } : {}), ...(settings ? { settings } : {}) } });
  return toDto(u);
}

export async function deleteConnection(access: OrgAccess, id: string, req?: Request) {
  const r = await db.integrationConnection.deleteMany({ where: { id, organizationId: access.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Connection not found.");
  await audit({ action: "integration.disconnected", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "integration", targetId: id, req });
}

// ---------------------------------------------------------------------------
// Incoming webhooks
// ---------------------------------------------------------------------------

function signatureOk(secret: string, raw: Buffer, given: string | null) {
  if (!given) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const got = Buffer.from(given, "base64");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

type Address = { phone?: string | null; first_name?: string | null; last_name?: string | null; name?: string | null };
type ShopifyOrder = { id: number | string; name?: string; email?: string | null; phone?: string | null; total_price?: string; currency?: string; customer?: (Address & { email?: string | null }) | null; billing_address?: Address | null; shipping_address?: Address | null; cancelled_at?: string | null };
type ShopifyCheckout = { token?: string; id?: number | string; email?: string | null; phone?: string | null; total_price?: string; currency?: string; abandoned_checkout_url?: string; completed_at?: string | null; customer?: (Address & { email?: string | null }) | null; billing_address?: Address | null; shipping_address?: Address | null };
type WooOrder = { id: number; number?: string; status?: string; total?: string; currency?: string; billing?: { first_name?: string; last_name?: string; email?: string; phone?: string }; shipping?: { phone?: string } };

type Normalized = { kind: "order" | "cart"; externalId: string; phone: string; name: string; email: string; totalRupees: number; currency: string; label: string; cartUrl?: string };

const fullName = (a?: Address | null) => (a ? (a.name ?? [a.first_name, a.last_name].filter(Boolean).join(" ")).trim() : "");

function normalize(provider: StoreProvider, topic: string, body: unknown): Normalized | { skip: string } {
  if (provider === "shopify") {
    if (topic === "orders/create" || topic === "orders/paid") {
      const o = body as ShopifyOrder;
      if (o.cancelled_at) return { skip: "Cancelled order" };
      return { kind: "order", externalId: String(o.id), phone: o.phone || o.customer?.phone || o.billing_address?.phone || o.shipping_address?.phone || "", name: fullName(o.customer) || fullName(o.billing_address) || fullName(o.shipping_address), email: o.email || o.customer?.email || "", totalRupees: Number(o.total_price ?? 0), currency: o.currency ?? "INR", label: o.name ?? `#${o.id}` };
    }
    if (topic === "checkouts/create" || topic === "checkouts/update") {
      const c = body as ShopifyCheckout;
      if (c.completed_at) return { skip: "Checkout already completed" };
      return { kind: "cart", externalId: String(c.token ?? c.id), phone: c.phone || c.customer?.phone || c.shipping_address?.phone || c.billing_address?.phone || "", name: fullName(c.customer) || fullName(c.shipping_address) || fullName(c.billing_address), email: c.email || c.customer?.email || "", totalRupees: Number(c.total_price ?? 0), currency: c.currency ?? "INR", label: "Checkout", cartUrl: c.abandoned_checkout_url ?? "" };
    }
    return { skip: `Topic ${topic} isn't used` };
  }
  if (topic === "order.created" || topic === "order.updated") {
    const o = body as WooOrder;
    if (!["processing", "completed", "on-hold"].includes(o.status ?? "")) return { skip: `Order status “${o.status ?? "unknown"}” — waiting for payment` };
    return { kind: "order", externalId: String(o.id), phone: o.billing?.phone || o.shipping?.phone || "", name: [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(" ").trim(), email: o.billing?.email ?? "", totalRupees: Number(o.total ?? 0), currency: o.currency ?? "INR", label: `#${o.number ?? o.id}` };
  }
  return { skip: `Topic ${topic} isn't used` };
}

/** Verifies and processes one store webhook. Unknown connection and bad signature look the same. */
export async function handleStoreWebhook(provider: string, id: string, raw: Buffer, headers: Headers): Promise<{ status: string; detail?: string }> {
  if (!(STORE_PROVIDERS as readonly string[]).includes(provider)) throw new ApiError("NOT_FOUND", "Not found.");
  const c = await db.integrationConnection.findFirst({ where: { id, provider } });
  // WooCommerce pings a new webhook with "webhook_id=…" before it is saved; answer it so saving succeeds.
  if (provider === "woocommerce" && c && raw.toString("utf8").startsWith("webhook_id=")) return { status: "ping" };
  const sigHeader = provider === "shopify" ? headers.get("x-shopify-hmac-sha256") : headers.get("x-wc-webhook-signature");
  if (!c || !signatureOk(decryptSecret(c.encryptedSecret), raw, sigHeader)) throw new ApiError("UNAUTHENTICATED", "Invalid webhook signature.");
  if (c.status !== "active") return { status: "disabled" };
  const topic = (provider === "shopify" ? headers.get("x-shopify-topic") : headers.get("x-wc-webhook-topic")) ?? "";
  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Body must be JSON.");
  }
  const n = normalize(provider as StoreProvider, topic, body);
  const touch = (error = "") => db.integrationConnection.update({ where: { id: c.id }, data: { eventCount: { increment: 1 }, lastEventAt: new Date(), ...(error ? { lastError: error.slice(0, 300) } : {}) } });
  if ("skip" in n) {
    await touch();
    return { status: "skipped", detail: n.skip };
  }
  // One record per order/cart: retries and repeated topics (orders/create + orders/paid) are processed once.
  const key = n.kind === "order" ? "order" : "cart";
  try {
    await db.integrationEvent.create({ data: { connectionId: c.id, topic: key, externalId: n.externalId, status: "processing" } });
  } catch (e) {
    // Already handled (store retry, orders/paid after orders/create, later cart updates).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: "duplicate" };
    throw e;
  }
  const finishEvent = (status: string, detail = "") => db.integrationEvent.updateMany({ where: { connectionId: c.id, topic: key, externalId: n.externalId }, data: { status, detail: detail.slice(0, 300) } });
  const phone = normalizePhone(n.phone);
  if (!phone) {
    await finishEvent("skipped", "No valid phone number on the order");
    await touch();
    return { status: "skipped", detail: "No valid phone number" };
  }
  try {
    const detail = await applyEvent(c.organizationId, provider as StoreProvider, storeSettingsSchema.parse(parse(c.settings, {})), { ...n, phone });
    await finishEvent("processed", detail);
    await touch();
    return { status: "processed", detail };
  } catch (e) {
    // Forget the attempt so the store's automatic retry can process it again.
    const msg = e instanceof Error ? e.message : "Failed";
    await db.integrationEvent.deleteMany({ where: { connectionId: c.id, topic: key, externalId: n.externalId } });
    await touch(msg);
    throw e;
  }
}

async function applyEvent(organizationId: string, provider: StoreProvider, s: StoreSettings, n: Normalized & { phone: string }): Promise<string> {
  const ctx: Ctx = { organizationId, actorUserId: null };
  const store = provider === "shopify" ? "Shopify" : "WooCommerce";
  let contact = await db.contact.findUnique({ where: { organizationId_phone: { organizationId, phone: n.phone } }, include: { tags: { include: { tag: true } } } });
  const custom: Record<string, string> = n.kind === "order" ? { last_order: n.label, last_order_total: `${n.currency} ${n.totalRupees}` } : { cart_url: n.cartUrl ?? "", cart_total: `${n.currency} ${n.totalRupees}` };
  if (!contact) {
    await createContact(ctx, { phone: n.phone, name: n.name.slice(0, 120), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n.email) ? n.email.toLowerCase().slice(0, 255) : "", source: "api", lifecycle: n.kind === "order" ? "customer" : "lead", customFields: custom });
    contact = await db.contact.findUniqueOrThrow({ where: { organizationId_phone: { organizationId, phone: n.phone } }, include: { tags: { include: { tag: true } } } });
  } else {
    const existing = parse<Record<string, string>>(contact.customFields, {});
    await updateContact(ctx, contact.id, {
      ...(contact.name ? {} : n.name ? { name: n.name.slice(0, 120) } : {}),
      ...(contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n.email) ? {} : { email: n.email.toLowerCase().slice(0, 255) }),
      ...(n.kind === "order" ? { lifecycle: "customer" as const } : {}),
      customFields: { ...existing, ...custom },
    });
  }
  const tags = new Set(contact.tags.map((t) => t.tag.name));
  if (n.kind === "order") {
    tags.delete(s.cartTag); // they bought — no cart reminder
    tags.add(s.customerTag);
  } else tags.add(s.cartTag);
  await setContactTags(ctx, contact.id, [...tags], { silent: true });

  if (n.kind === "order" && s.recordPurchases && n.totalRupees > 0) {
    const note = `${store} order ${n.label}${n.currency !== "INR" ? ` (${n.currency})` : ""}`.slice(0, 200);
    const loyaltyOn = (await isServiceEnabled(organizationId, "LOYALTY")) && (await getLoyaltySettings(organizationId)).enabled;
    if (loyaltyOn) await recordPurchase(ctx, { contactId: contact.id, amountRupees: n.totalRupees, note });
    else await db.purchase.create({ data: { organizationId, contactId: contact.id, amountPaise: Math.round(n.totalRupees * 100), note } });
    return `Order ${n.label} · ₹${n.totalRupees} · tagged “${s.customerTag}”${loyaltyOn ? " · loyalty points added" : ""}`;
  }
  return n.kind === "order" ? `Order ${n.label} · tagged “${s.customerTag}”` : `Cart ₹${n.totalRupees} · tagged “${s.cartTag}”`;
}
