import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FoodOrder, FoodSettings } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { publish } from "@/lib/realtime/broker";
import type { OrgAccess } from "@/lib/session";
import { siteConfig } from "@/config/site";
import { assertServiceEnabled, isServiceEnabled } from "@/services/whatsapp/guards";
import { sendSystemText, SystemSendError } from "@/services/inbox/messaging";

/**
 * Food ordering (service FOOD_ORDERING).
 *
 * Guest scans the room/table QR → mobile menu page → builds the order → taps "Order on WhatsApp", which opens WhatsApp with
 * a 6-character order code. Sending it confirms the order (so every order is tied to a real WhatsApp number) and opens
 * the 24-hour window, so every update after that is a free service message. The kitchen screen moves the order along
 * (accepted → preparing → ready → delivered) and each step tells the guest. Payment: pay now through the CLIENT's own
 * Razorpay payment link (money goes to the client), room bill, or pay at the counter.
 */
export const PAYMENT_MODES = ["pay_now", "room_bill", "counter"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const PAYMENT_LABEL: Record<PaymentMode, string> = { pay_now: "Pay now (UPI / card)", room_bill: "Add to room bill", counter: "Pay at the counter" };
export const STATUS_FLOW = ["placed", "accepted", "preparing", "ready", "delivered"] as const;
const NEXT: Record<string, string[]> = { placed: ["accepted", "cancelled"], accepted: ["preparing", "ready", "cancelled"], preparing: ["ready", "cancelled"], ready: ["delivered"], delivered: [], cancelled: [], draft: [] };
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const CODE_RE = /\b([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6})\b/;
const DRAFT_TTL_MS = 6 * 3_600_000;
const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const settingsSchema = z
  .object({
    whatsappAccountId: z.string().max(40).nullable(),
    venueName: z.string().trim().max(80),
    paymentModes: z.array(z.enum(PAYMENT_MODES)).min(1, "Choose at least one way to pay"),
    taxPercent: z.number().min(0).max(28),
    welcomeNote: z.string().trim().max(300),
    acceptingOrders: z.boolean(),
    razorpayKeyId: z.string().trim().max(60).regex(/^$|^rzp_(live|test)_[A-Za-z0-9]+$/, "Starts with rzp_live_ or rzp_test_"),
    razorpayKeySecret: z.string().trim().max(100), // write-only: empty = keep
    webhookSecret: z.string().trim().max(100), // write-only: empty = keep
  })
  .partial()
  .strict();

async function settingsRow(organizationId: string) {
  return (await db.foodSettings.findUnique({ where: { organizationId } })) ?? db.foodSettings.create({ data: { organizationId } });
}
const modesOf = (s: FoodSettings) => {
  try {
    const m = (JSON.parse(s.paymentModes) as string[]).filter((x): x is PaymentMode => (PAYMENT_MODES as readonly string[]).includes(x));
    return m.length ? m : (["counter"] as PaymentMode[]);
  } catch {
    return ["counter"] as PaymentMode[];
  }
};
const payNowReady = (s: FoodSettings) => Boolean(s.razorpayKeyId && s.encryptedKeySecret);

function settingsDto(s: FoodSettings) {
  return {
    whatsappAccountId: s.whatsappAccountId,
    venueName: s.venueName,
    paymentModes: modesOf(s),
    taxPercent: s.taxPercent,
    welcomeNote: s.welcomeNote,
    acceptingOrders: s.acceptingOrders,
    razorpayKeyId: s.razorpayKeyId,
    hasKeySecret: Boolean(s.encryptedKeySecret),
    hasWebhookSecret: Boolean(s.encryptedWebhookSecret),
    webhookUrl: `${siteConfig.url}/api/webhooks/food/${s.organizationId}`,
  };
}

export async function getSettings(organizationId: string) {
  await assertServiceEnabled(organizationId, "FOOD_ORDERING");
  const s = await settingsRow(organizationId);
  const numbers = await db.whatsAppAccount.findMany({ where: { organizationId, status: { in: ["connected", "demo"] } }, select: { id: true, displayName: true, phoneNumber: true, isDemo: true } });
  return { settings: settingsDto(s), numbers };
}

export async function saveSettings(access: OrgAccess, input: z.infer<typeof settingsSchema>, req?: Request) {
  const organizationId = access.organizationId;
  await assertServiceEnabled(organizationId, "FOOD_ORDERING");
  const cur = await settingsRow(organizationId);
  const data: Record<string, unknown> = {};
  if (input.whatsappAccountId !== undefined) {
    if (input.whatsappAccountId && !(await db.whatsAppAccount.findFirst({ where: { id: input.whatsappAccountId, organizationId, status: { in: ["connected", "demo"] } } }))) {
      throw new ApiError("VALIDATION_ERROR", "Choose a connected WhatsApp number.", { details: { whatsappAccountId: ["Not a connected number"] } });
    }
    data.whatsappAccountId = input.whatsappAccountId;
  }
  for (const k of ["venueName", "taxPercent", "welcomeNote", "acceptingOrders", "razorpayKeyId"] as const) if (input[k] !== undefined) data[k] = input[k];
  if (input.paymentModes) data.paymentModes = JSON.stringify([...new Set(input.paymentModes)]);
  if (input.razorpayKeySecret) data.encryptedKeySecret = encryptSecret(input.razorpayKeySecret);
  if (input.webhookSecret) data.encryptedWebhookSecret = encryptSecret(input.webhookSecret);
  const next = { ...cur, ...data } as FoodSettings;
  if (modesOf(next).includes("pay_now") && !payNowReady(next)) throw new ApiError("VALIDATION_ERROR", "“Pay now” needs your Razorpay key id and key secret.", { details: { razorpayKeyId: ["Required for pay now"] } });
  const s = await db.foodSettings.update({ where: { organizationId }, data });
  await audit({ action: "food.settings_updated", actorUserId: access.user.id, organizationId, targetType: "food_settings", targetId: s.id, metadata: { paymentModes: modesOf(s), razorpay: Boolean(s.razorpayKeyId) }, req });
  return settingsDto(s);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export const menuItemSchema = z
  .object({
    category: z.string().trim().min(1).max(40).default("Menu"),
    name: z.string().trim().min(1, "Name the dish").max(80),
    description: z.string().trim().max(200).default(""),
    priceRupees: z.number().min(0).max(100_000),
    imageUrl: z.string().trim().max(500).refine((v) => !v || /^https:\/\/\S+$/.test(v), "Use an https:// image link").default(""),
    veg: z.boolean().default(true),
    available: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();

const itemDto = (i: { id: string; category: string; name: string; description: string; pricePaise: number; imageUrl: string; veg: boolean; available: boolean; sortOrder: number }) => ({ id: i.id, category: i.category, name: i.name, description: i.description, pricePaise: i.pricePaise, imageUrl: i.imageUrl, veg: i.veg, available: i.available, sortOrder: i.sortOrder });

export async function listMenu(organizationId: string) {
  await assertServiceEnabled(organizationId, "FOOD_ORDERING");
  return (await db.menuItem.findMany({ where: { organizationId }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }] })).map(itemDto);
}

export async function saveMenuItem(access: OrgAccess, id: string | null, input: z.infer<typeof menuItemSchema>) {
  await assertServiceEnabled(access.organizationId, "FOOD_ORDERING");
  const { priceRupees, ...rest } = input;
  const data = { ...rest, pricePaise: Math.round(priceRupees * 100) };
  if (!id) {
    if ((await db.menuItem.count({ where: { organizationId: access.organizationId } })) >= 500) throw new ApiError("CONFLICT", "Up to 500 menu items.");
    return itemDto(await db.menuItem.create({ data: { ...data, organizationId: access.organizationId } }));
  }
  const r = await db.menuItem.updateMany({ where: { id, organizationId: access.organizationId }, data });
  if (!r.count) throw new ApiError("NOT_FOUND", "Menu item not found.");
  return itemDto(await db.menuItem.findUniqueOrThrow({ where: { id } }));
}

export async function deleteMenuItem(access: OrgAccess, id: string) {
  const r = await db.menuItem.deleteMany({ where: { id, organizationId: access.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Menu item not found.");
}

// ---------------------------------------------------------------------------
// Rooms / tables
// ---------------------------------------------------------------------------

export const spotsSchema = z
  .object({
    kind: z.enum(["room", "table", "other"]),
    prefix: z.string().trim().min(1).max(30), // "Room", "Table", "Pool side"
    from: z.number().int().min(0).max(99_999).optional(),
    to: z.number().int().min(0).max(99_999).optional(),
  })
  .strict()
  .refine((v) => (v.from === undefined) === (v.to === undefined) && (v.from === undefined || (v.to! >= v.from! && v.to! - v.from! < 300)), "Give a range of up to 300 numbers (or none for a single spot)");

const spotUrl = (orgSlug: string, code: string) => `${siteConfig.url}/menu/${orgSlug}/${code}`;

export async function listSpots(organizationId: string) {
  await assertServiceEnabled(organizationId, "FOOD_ORDERING");
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
  const rows = await db.diningSpot.findMany({ where: { organizationId }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] });
  return rows.map((s) => ({ id: s.id, label: s.label, code: s.code, kind: s.kind, active: s.active, url: spotUrl(org.slug, s.code) }));
}

export async function addSpots(access: OrgAccess, input: z.infer<typeof spotsSchema>) {
  const organizationId = access.organizationId;
  await assertServiceEnabled(organizationId, "FOOD_ORDERING");
  const labels = input.from === undefined ? [input.prefix] : Array.from({ length: input.to! - input.from + 1 }, (_, i) => `${input.prefix} ${input.from! + i}`);
  if ((await db.diningSpot.count({ where: { organizationId } })) + labels.length > 1000) throw new ApiError("CONFLICT", "Up to 1000 rooms/tables.");
  let made = 0;
  for (const label of labels) {
    const base = (label.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "spot").slice(0, 24);
    for (let i = 0; i < 5; i++) {
      const code = i === 0 ? base : `${base}-${randomInt(100, 999)}`;
      const ok = await db.diningSpot.create({ data: { organizationId, label, code, kind: input.kind } }).catch(() => null);
      if (ok) {
        made++;
        break;
      }
    }
  }
  return { added: made, spots: await listSpots(organizationId) };
}

export async function updateSpot(access: OrgAccess, id: string, input: { active?: boolean; label?: string }) {
  const r = await db.diningSpot.updateMany({ where: { id, organizationId: access.organizationId }, data: { ...(input.active !== undefined ? { active: input.active } : {}), ...(input.label ? { label: input.label.slice(0, 60) } : {}) } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Room/table not found.");
}

export async function deleteSpot(access: OrgAccess, id: string) {
  const r = await db.diningSpot.deleteMany({ where: { id, organizationId: access.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Room/table not found.");
}

// ---------------------------------------------------------------------------
// Public menu page + draft orders
// ---------------------------------------------------------------------------

async function venueFor(orgSlug: string) {
  const org = await db.organization.findUnique({ where: { slug: orgSlug }, select: { id: true, name: true, slug: true, status: true } });
  if (!org || org.status !== "active" || !(await isServiceEnabled(org.id, "FOOD_ORDERING"))) return null;
  const s = await settingsRow(org.id);
  const acct = s.whatsappAccountId ? await db.whatsAppAccount.findFirst({ where: { id: s.whatsappAccountId, organizationId: org.id, status: { in: ["connected", "demo"] } }, select: { phoneNumber: true } }) : null;
  return { org, s, phone: acct?.phoneNumber ?? "" };
}

/** Everything the guest's menu page needs. Null when the venue doesn't take orders this way. */
export async function publicMenu(orgSlug: string, spotCode: string) {
  const v = await venueFor(orgSlug);
  if (!v) return null;
  const spot = await db.diningSpot.findFirst({ where: { organizationId: v.org.id, code: spotCode, active: true } });
  if (!spot) return null;
  const items = await db.menuItem.findMany({ where: { organizationId: v.org.id, available: true }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }] });
  return {
    venue: v.s.venueName || v.org.name,
    spot: { label: spot.label, code: spot.code },
    open: v.s.acceptingOrders && Boolean(v.phone),
    welcomeNote: v.s.welcomeNote,
    taxPercent: v.s.taxPercent,
    paymentModes: modesOf(v.s).filter((m) => m !== "pay_now" || payNowReady(v.s)).filter((m) => m !== "room_bill" || spot.kind === "room"),
    items: items.map(itemDto),
  };
}

export const draftSchema = z
  .object({
    items: z.array(z.object({ itemId: z.string().max(40), qty: z.number().int().min(1).max(20) }).strict()).min(1, "Add something to your order").max(30),
    note: z.string().trim().max(300).default(""),
    paymentMode: z.enum(PAYMENT_MODES),
    guestName: z.string().trim().max(60).default(""),
  })
  .strict();

function newCode() {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

/** The guest built an order on the menu page: saved as a draft until it's confirmed from their WhatsApp. */
export async function createDraft(orgSlug: string, spotCode: string, input: z.infer<typeof draftSchema>) {
  const menu = await publicMenu(orgSlug, spotCode);
  if (!menu) throw new ApiError("NOT_FOUND", "This menu isn't available.");
  if (!menu.open) throw new ApiError("CONFLICT", "The kitchen isn't taking orders right now.");
  if (!menu.paymentModes.includes(input.paymentMode)) throw new ApiError("VALIDATION_ERROR", "Choose one of the payment options shown.");
  const v = (await venueFor(orgSlug))!;
  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const lines: { itemId: string; name: string; qty: number; pricePaise: number }[] = [];
  for (const l of input.items) {
    const it = byId.get(l.itemId);
    if (!it) throw new ApiError("CONFLICT", "An item in your order is no longer available. Please refresh the menu.");
    const same = lines.find((x) => x.itemId === it.id);
    if (same) same.qty = Math.min(20, same.qty + l.qty);
    else lines.push({ itemId: it.id, name: it.name, qty: l.qty, pricePaise: it.pricePaise });
  }
  const subtotal = lines.reduce((a, l) => a + l.qty * l.pricePaise, 0);
  const tax = Math.round((subtotal * menu.taxPercent) / 100);
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await db.foodOrder.findFirst({ where: { organizationId: v.org.id }, orderBy: { number: "desc" }, select: { number: true } });
    const order = await db.foodOrder
      .create({ data: { organizationId: v.org.id, number: (last?.number ?? 0) + 1, code: newCode(), spotLabel: menu.spot.label, guestName: input.guestName, items: JSON.stringify(lines), note: input.note, subtotalPaise: subtotal, taxPaise: tax, totalPaise: subtotal + tax, paymentMode: input.paymentMode } })
      .catch(() => null);
    if (order) {
      const text = `Confirm my order ${order.code} (${menu.spot.label})`;
      return { code: order.code, number: order.number, totalPaise: order.totalPaise, whatsappUrl: `https://wa.me/${v.phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}` };
    }
  }
  throw new ApiError("SERVICE_UNAVAILABLE", "Couldn't save your order. Please try again.");
}

// ---------------------------------------------------------------------------
// WhatsApp: confirming the order, and updates to the guest
// ---------------------------------------------------------------------------

type Line = { itemId: string; name: string; qty: number; pricePaise: number };
const linesOf = (o: FoodOrder) => JSON.parse(o.items || "[]") as Line[];
function summary(o: FoodOrder) {
  const lines = linesOf(o).map((l) => `• ${l.qty} × ${l.name} — ${rupees(l.qty * l.pricePaise)}`);
  return [...lines, o.taxPaise ? `Tax: ${rupees(o.taxPaise)}` : "", `*Total: ${rupees(o.totalPaise)}*`, o.note ? `Note: ${o.note}` : ""].filter(Boolean).join("\n");
}
const GUEST_TEXT: Record<string, (o: FoodOrder) => string> = {
  accepted: (o) => `👨‍🍳 Order #${o.number} accepted — the kitchen has started on it.`,
  preparing: (o) => `🍳 Order #${o.number} is being prepared.`,
  ready: (o) => `🍽️ Order #${o.number} is ready${o.spotLabel ? ` and on its way to ${o.spotLabel}` : ""}!`,
  delivered: (o) => `✅ Order #${o.number} delivered. Enjoy your meal! Reply here if you need anything.`,
  cancelled: (o) => `❌ Sorry, order #${o.number} was cancelled${o.cancelReason ? `: ${o.cancelReason}` : ""}. Reply here and we'll help.`,
};

async function tellGuest(o: FoodOrder, text: string) {
  if (!o.conversationId) return "no_conversation";
  try {
    await sendSystemText(o.organizationId, o.conversationId, text, { foodOrderId: o.id });
    return "sent";
  } catch (e) {
    return e instanceof SystemSendError ? `not_sent: ${e.message}` : "not_sent";
  }
}

/** Razorpay payment link on the CLIENT's own account; reference_id is our order id (used by the webhook). */
async function createPaymentLink(s: FoodSettings, o: FoodOrder, phone: string) {
  const secret = decryptSecret(s.encryptedKeySecret);
  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${s.razorpayKeyId}:${secret}`).toString("base64")}`, "content-type": "application/json" },
    body: JSON.stringify({ amount: o.totalPaise, currency: "INR", description: `Order #${o.number}${o.spotLabel ? ` · ${o.spotLabel}` : ""}`.slice(0, 2048), reference_id: o.id, customer: { contact: phone }, notify: { sms: false, email: false }, reminder_enable: false }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; short_url?: string; error?: { description?: string } };
  if (!res.ok || !body.id || !body.short_url) throw new Error(body.error?.description || `Razorpay ${res.status}`);
  return { id: body.id, url: body.short_url };
}

/**
 * Inbound WhatsApp text: if it carries a draft order's code, the order is confirmed from this number. Returns true when
 * the message was an order confirmation (so automations / the AI agent stay quiet for it).
 */
export async function handleFoodInbound(organizationId: string, input: { contactId: string; conversationId: string; text: string; profileName: string }) {
  const m = CODE_RE.exec(input.text.toUpperCase());
  if (!m || !(await isServiceEnabled(organizationId, "FOOD_ORDERING"))) return false;
  const draft = await db.foodOrder.findFirst({ where: { organizationId, code: m[1], status: "draft", createdAt: { gte: new Date(Date.now() - DRAFT_TTL_MS) } } });
  if (!draft) {
    const done = await db.foodOrder.findFirst({ where: { organizationId, code: m[1], status: { not: "draft" } } });
    if (done) {
      await sendSystemText(organizationId, input.conversationId, `Order #${done.number} is already confirmed (${done.status}). We'll keep you posted here.`, { foodOrderId: done.id }).catch(() => null);
      return true;
    }
    return false;
  }
  const now = new Date();
  const claimed = await db.foodOrder.updateMany({ where: { id: draft.id, status: "draft" }, data: { status: "placed", placedAt: now, contactId: input.contactId, conversationId: input.conversationId, guestName: draft.guestName || input.profileName.slice(0, 60), paymentStatus: draft.paymentMode === "pay_now" ? "pending" : "unpaid" } });
  if (!claimed.count) return true;
  let o = await db.foodOrder.findUniqueOrThrow({ where: { id: draft.id } });
  const s = await settingsRow(organizationId);
  const contact = await db.contact.findUnique({ where: { id: input.contactId }, select: { phone: true } });
  let payLine = draft.paymentMode === "room_bill" ? "It will be added to your room bill." : draft.paymentMode === "counter" ? "Please pay at the counter." : "";
  if (draft.paymentMode === "pay_now") {
    try {
      const link = await createPaymentLink(s, o, contact?.phone ?? "");
      o = await db.foodOrder.update({ where: { id: o.id }, data: { paymentLinkId: link.id, paymentLinkUrl: link.url } });
      payLine = `Pay here (UPI / card): ${link.url}`;
    } catch (e) {
      console.error("[food] payment link failed:", e);
      payLine = "We couldn't create a payment link right now — you can pay at the counter.";
      o = await db.foodOrder.update({ where: { id: o.id }, data: { paymentMode: "counter", paymentStatus: "unpaid" } });
    }
  }
  await tellGuest(o, `Thank you! ✅ Order #${o.number}${o.spotLabel ? ` for ${o.spotLabel}` : ""} is received.\n\n${summary(o)}\n\n${payLine}\nWe'll message you here as it's prepared.`);
  publish(organizationId, { type: "food.order", orderId: o.id, status: o.status });
  await audit({ action: "food.order_placed", organizationId, targetType: "food_order", targetId: o.id, metadata: { number: o.number, total: o.totalPaise, payment: o.paymentMode } });
  return true;
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

export function orderDto(o: FoodOrder) {
  return {
    id: o.id,
    number: o.number,
    code: o.code,
    spotLabel: o.spotLabel,
    guestName: o.guestName,
    items: linesOf(o),
    note: o.note,
    totalPaise: o.totalPaise,
    taxPaise: o.taxPaise,
    status: o.status,
    paymentMode: o.paymentMode,
    paymentStatus: o.paymentStatus,
    paymentLinkUrl: o.paymentLinkUrl,
    placedAt: o.placedAt,
    acceptedAt: o.acceptedAt,
    readyAt: o.readyAt,
    deliveredAt: o.deliveredAt,
    cancelReason: o.cancelReason,
    conversationId: o.conversationId,
    next: NEXT[o.status] ?? [],
  };
}

export async function kitchenOrders(organizationId: string, view: "active" | "today" = "active") {
  await assertServiceEnabled(organizationId, "FOOD_ORDERING");
  const start = new Date(Date.now() - 24 * 3_600_000);
  const rows = await db.foodOrder.findMany({
    where: { organizationId, status: view === "active" ? { in: ["placed", "accepted", "preparing", "ready"] } : { not: "draft" }, ...(view === "today" ? { placedAt: { gte: start } } : {}) },
    orderBy: { placedAt: view === "active" ? "asc" : "desc" },
    take: 200,
  });
  return rows.map(orderDto);
}

export async function advanceOrder(access: OrgAccess, id: string, to: string, reason = "", req?: Request) {
  const organizationId = access.organizationId;
  await assertServiceEnabled(organizationId, "FOOD_ORDERING");
  const o = await db.foodOrder.findFirst({ where: { id, organizationId } });
  if (!o) throw new ApiError("NOT_FOUND", "Order not found.");
  if (!(NEXT[o.status] ?? []).includes(to)) throw new ApiError("CONFLICT", `Order #${o.number} is ${o.status}; it can't go to ${to}.`);
  const now = new Date();
  const stamp = to === "accepted" ? { acceptedAt: now } : to === "ready" ? { readyAt: now, acceptedAt: o.acceptedAt ?? now } : to === "delivered" ? { deliveredAt: now } : to === "cancelled" ? { cancelledAt: now, cancelReason: reason.slice(0, 200) } : {};
  const moved = await db.foodOrder.updateMany({ where: { id, status: o.status }, data: { status: to, ...stamp } });
  if (!moved.count) throw new ApiError("CONFLICT", "Someone else just updated this order. Refresh.");
  const fresh = await db.foodOrder.findUniqueOrThrow({ where: { id } });
  const delivery = GUEST_TEXT[to] ? await tellGuest(fresh, GUEST_TEXT[to](fresh)) : "none";
  publish(organizationId, { type: "food.order", orderId: id, status: to });
  await audit({ action: "food.order_status", actorUserId: access.user.id, organizationId, targetType: "food_order", targetId: id, metadata: { number: fresh.number, to, guestUpdate: delivery }, req });
  return { order: orderDto(fresh), guestUpdate: delivery };
}

/** Counter / room-bill / cash payments the staff received in person. */
export async function markPaid(access: OrgAccess, id: string, req?: Request) {
  const o = await db.foodOrder.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!o) throw new ApiError("NOT_FOUND", "Order not found.");
  if (o.paymentStatus === "paid") return orderDto(o);
  const fresh = await db.foodOrder.update({ where: { id }, data: { paymentStatus: "paid", paidAt: new Date() } });
  await audit({ action: "food.order_paid", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "food_order", targetId: id, metadata: { number: o.number, via: "staff" }, req });
  publish(access.organizationId, { type: "food.order", orderId: id, status: fresh.status });
  return orderDto(fresh);
}

// ---------------------------------------------------------------------------
// Razorpay webhook (client's own account)
// ---------------------------------------------------------------------------

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function handlePaymentWebhook(organizationId: string, raw: string, headers: Headers) {
  const s = await db.foodSettings.findUnique({ where: { organizationId } });
  if (!s?.encryptedWebhookSecret) throw new ApiError("NOT_FOUND", "Not configured.");
  const sig = headers.get("x-razorpay-signature") ?? "";
  if (!sig || !safeEqual(createHmac("sha256", decryptSecret(s.encryptedWebhookSecret)).update(raw).digest("hex"), sig)) throw new ApiError("UNAUTHENTICATED", "Invalid signature.");
  const eventId = headers.get("x-razorpay-event-id") ?? "";
  if (eventId && !(await db.paymentEvent.create({ data: { gateway: `food:${organizationId}`, eventId, type: "food" } }).catch(() => null))) return "duplicate";
  let body: { event?: string; payload?: { payment_link?: { entity?: { id?: string; reference_id?: string; amount_paid?: number; status?: string } } } };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Invalid payload.");
  }
  if (body.event !== "payment_link.paid") return "ignored";
  const pl = body.payload?.payment_link?.entity;
  const o = pl?.reference_id ? await db.foodOrder.findFirst({ where: { id: pl.reference_id, organizationId } }) : null;
  if (!o || (pl?.id && o.paymentLinkId && pl.id !== o.paymentLinkId)) return "unknown_order";
  if (o.paymentStatus === "paid") return "already_paid";
  if (typeof pl?.amount_paid === "number" && pl.amount_paid < o.totalPaise) return "amount_mismatch";
  const fresh = await db.foodOrder.update({ where: { id: o.id }, data: { paymentStatus: "paid", paidAt: new Date() } });
  await tellGuest(fresh, `💳 Payment of ${rupees(o.totalPaise)} received for order #${o.number}. Thank you!`);
  publish(organizationId, { type: "food.order", orderId: o.id, status: fresh.status });
  await audit({ action: "food.order_paid", organizationId, targetType: "food_order", targetId: o.id, metadata: { number: o.number, via: "razorpay" } });
  return "paid";
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export async function foodReport(organizationId: string, days = 7) {
  await assertServiceEnabled(organizationId, "FOOD_ORDERING");
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.foodOrder.findMany({ where: { organizationId, status: { notIn: ["draft"] }, placedAt: { gte: since } }, take: 10_000 });
  const done = rows.filter((r) => r.status !== "cancelled");
  const items = new Map<string, { name: string; qty: number; revenuePaise: number }>();
  for (const r of done) for (const l of linesOf(r)) {
    const e = items.get(l.itemId) ?? { name: l.name, qty: 0, revenuePaise: 0 };
    e.qty += l.qty;
    e.revenuePaise += l.qty * l.pricePaise;
    items.set(l.itemId, e);
  }
  const prep = done.filter((r) => r.placedAt && r.readyAt).map((r) => (r.readyAt!.getTime() - r.placedAt!.getTime()) / 60_000);
  const bySpot = new Map<string, number>();
  for (const r of done) bySpot.set(r.spotLabel, (bySpot.get(r.spotLabel) ?? 0) + r.totalPaise);
  return {
    days,
    orders: rows.length,
    cancelled: rows.length - done.length,
    revenuePaise: done.reduce((a, r) => a + r.totalPaise, 0),
    paidPaise: done.filter((r) => r.paymentStatus === "paid").reduce((a, r) => a + r.totalPaise, 0),
    unpaidPaise: done.filter((r) => r.paymentStatus !== "paid").reduce((a, r) => a + r.totalPaise, 0),
    avgPrepMinutes: prep.length ? Math.round(prep.reduce((a, b) => a + b, 0) / prep.length) : null,
    topItems: [...items.values()].sort((a, b) => b.qty - a.qty).slice(0, 8),
    bySpot: [...bySpot.entries()].map(([spot, revenuePaise]) => ({ spot, revenuePaise })).sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, 8),
    byPayment: PAYMENT_MODES.map((m) => ({ mode: m, orders: done.filter((r) => r.paymentMode === m).length })),
  };
}
