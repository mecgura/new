import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { notify } from "@/lib/notifications";
import { publish } from "@/lib/realtime/broker";
import type { OrgAccess } from "@/lib/session";
import type { NormalizedEvent } from "@/providers/meta/webhook";
import { MetaApiError } from "@/providers/meta/graph";
import { answerCall, rejectCall, sendCallPermissionRequest, setCallingSettings, startCall, terminateCall } from "@/providers/meta/calling";
import { hasFeature } from "@/services/billing/entitlements";
import { upsertInboundContact } from "@/services/inbox/contacts";
import { can, getVisibleConversation } from "@/services/inbox/conversations";

/**
 * WhatsApp voice calls through the Business Calling API. MECGURA relays the WebRTC offer/answer between the agent's
 * browser and Meta and keeps a call log; it never touches the audio. Calling needs the plan's "calling" feature and
 * calling switched on for the number.
 */
type CallEvent = Extract<NormalizedEvent, { kind: "call" }>;
type CallRow = Awaited<ReturnType<typeof db.waCall.findFirstOrThrow>>;

const RING_WINDOW_MS = 90_000;
const LIVE = ["ringing", "connecting", "active"];

const metaMessage = (e: unknown, fallback: string) => (e instanceof MetaApiError ? `Meta: ${e.message}` : e instanceof Error ? e.message : fallback);

export function toCallDto(c: CallRow) {
  return {
    id: c.id,
    direction: c.direction,
    status: c.status,
    peerPhone: c.peerPhone,
    peerName: c.peerName,
    contactId: c.contactId,
    offerSdp: c.direction === "inbound" && c.status === "ringing" ? c.offerSdp : "",
    answerSdp: c.direction === "outbound" ? c.answerSdp : "",
    startedAt: c.startedAt.toISOString(),
    answeredAt: c.answeredAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    durationSec: c.durationSec,
    error: c.error,
  };
}

async function accountWithToken(organizationId: string, where: { id?: string; phoneNumberId?: string }) {
  const a = await db.whatsAppAccount.findFirst({ where: { organizationId, status: "connected", ...where }, include: { connection: { select: { encryptedAccessToken: true } } } });
  if (!a) return null;
  const token = a.connection?.encryptedAccessToken ? decryptSecret(a.connection.encryptedAccessToken) : "";
  return { account: a, token };
}

/** A short line in the chat timeline (team only), when the customer already has a chat on that number. */
async function logInChat(organizationId: string, whatsappAccountId: string, contactId: string | null, body: string) {
  if (!contactId) return;
  const conv = await db.conversation.findFirst({ where: { organizationId, whatsappAccountId, contactId }, select: { id: true, assignedToUserId: true } });
  if (!conv) return;
  const m = await db.message.create({ data: { organizationId, conversationId: conv.id, direction: "internal", type: "system", body, status: "received" } });
  publish(organizationId, { type: "message.created", conversationId: conv.id, messageId: m.id, assignedToUserId: conv.assignedToUserId });
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

async function finish(c: CallRow, status: "ended" | "missed" | "rejected" | "failed", opts: { durationSec?: number; error?: string } = {}) {
  if (!LIVE.includes(c.status)) return c;
  const endedAt = new Date();
  const durationSec = opts.durationSec || (c.answeredAt ? Math.max(0, Math.round((endedAt.getTime() - c.answeredAt.getTime()) / 1000)) : 0);
  const done = await db.waCall.update({ where: { id: c.id }, data: { status, endedAt, durationSec, ...(opts.error ? { error: opts.error.slice(0, 300) } : {}) } });
  const who = c.peerName || c.peerPhone;
  const line =
    status === "ended"
      ? `📞 WhatsApp call ${c.direction === "inbound" ? "from" : "to"} ${who} · ${mmss(durationSec)}`
      : status === "missed"
        ? `📞 Missed WhatsApp call from ${who}`
        : status === "rejected"
          ? `📞 WhatsApp call ${c.direction === "inbound" ? "declined" : "not answered"} (${who})`
          : `📞 WhatsApp call failed (${who})`;
  await logInChat(c.organizationId, c.whatsappAccountId, c.contactId, line);
  if (status === "missed") {
    const members = await db.organizationMember.findMany({ where: { organizationId: c.organizationId }, select: { userId: true } });
    await Promise.all(members.map((m) => notify({ userId: m.userId, organizationId: c.organizationId, type: "warning", title: "Missed WhatsApp call", body: who, link: c.contactId ? `/contacts/${c.contactId}` : "/inbox" })));
  }
  return done;
}

/** Webhook: a customer calls, a call we placed rings / is answered / ends. */
export async function handleCallEvent(organizationId: string, ev: CallEvent): Promise<"processed" | "ignored"> {
  if (!ev.callId) return "ignored";
  const existing = await db.waCall.findUnique({ where: { metaCallId: ev.callId } });
  if (existing && existing.organizationId !== organizationId) return "ignored";

  if (ev.event === "connect" && ev.sdpType === "offer" && !existing) {
    const a = await db.whatsAppAccount.findFirst({ where: { organizationId, phoneNumberId: ev.phoneNumberId, status: "connected" }, select: { id: true } });
    if (!a || !ev.from) return "ignored";
    const phone = `+${ev.from.replace(/\D/g, "")}`;
    const contact = await upsertInboundContact(organizationId, phone, ev.profileName);
    await db.waCall.create({
      data: { organizationId, whatsappAccountId: a.id, contactId: contact.id, metaCallId: ev.callId, direction: "inbound", status: "ringing", peerPhone: phone, peerName: contact.name || ev.profileName, offerSdp: ev.sdp },
    });
    return "processed";
  }
  if (!existing) return "ignored";

  if (ev.event === "connect" && ev.sdpType === "answer" && existing.direction === "outbound") {
    await db.waCall.update({ where: { id: existing.id }, data: { answerSdp: ev.sdp, status: "active", answeredAt: existing.answeredAt ?? new Date() } });
    return "processed";
  }
  if (ev.event === "status") {
    if (ev.status === "RINGING" && existing.status === "connecting") await db.waCall.update({ where: { id: existing.id }, data: { status: "ringing" } });
    else if (ev.status === "ACCEPTED" && existing.status !== "active") await db.waCall.update({ where: { id: existing.id }, data: { status: "active", answeredAt: existing.answeredAt ?? new Date() } });
    else if (ev.status === "REJECTED") await finish(existing, "rejected");
    return "processed";
  }
  if (ev.event === "terminate") {
    const neverAnswered = !existing.answeredAt;
    const status = ev.status === "FAILED" ? "failed" : neverAnswered ? (existing.direction === "inbound" ? "missed" : "rejected") : "ended";
    await finish(existing, status, { durationSec: ev.durationSec });
    return "processed";
  }
  return "ignored";
}

async function assertCalling(access: OrgAccess) {
  if (!can(access, "inbox:reply")) throw new ApiError("FORBIDDEN");
  if (!(await hasFeature(access.organizationId, "calling"))) throw new ApiError("FORBIDDEN", "Calling isn't included in this workspace's plan.");
}

/** Calls the browser should show now: customers ringing (recent) and calls in progress. */
export async function liveCalls(access: OrgAccess) {
  if (!can(access, "inbox:reply")) return [];
  const rows = await db.waCall.findMany({ where: { organizationId: access.organizationId, status: { in: LIVE } }, orderBy: { startedAt: "desc" }, take: 10 });
  const now = Date.now();
  const out = [];
  for (const c of rows) {
    // A ring nobody answered (webhook lost, browser closed) is cleaned up here.
    if (c.status === "ringing" && c.direction === "inbound" && now - c.startedAt.getTime() > RING_WINDOW_MS) {
      await finish(c, "missed");
      continue;
    }
    out.push(toCallDto(c));
  }
  return out;
}

export async function getCall(access: OrgAccess, id: string) {
  const c = await db.waCall.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!c) throw new ApiError("NOT_FOUND", "Call not found.");
  return toCallDto(c);
}

export async function answer(access: OrgAccess, id: string, sdp: string) {
  await assertCalling(access);
  const c = await db.waCall.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!c || c.direction !== "inbound") throw new ApiError("NOT_FOUND", "Call not found.");
  if (c.status !== "ringing") throw new ApiError("CONFLICT", c.answeredByUserId ? "Someone else already answered this call." : "This call has ended.");
  // Claim it first so two agents can't both answer.
  const claimed = await db.waCall.updateMany({ where: { id, status: "ringing" }, data: { status: "connecting", answeredByUserId: access.user.id } });
  if (!claimed.count) throw new ApiError("CONFLICT", "Someone else already answered this call.");
  const t = await accountWithToken(access.organizationId, { id: c.whatsappAccountId });
  if (!t?.token) {
    await finish({ ...c, status: "connecting" }, "failed", { error: "No active credentials for this number." });
    throw new ApiError("CONFLICT", "This number has no active Meta connection.");
  }
  try {
    await answerCall(t.account.phoneNumberId, t.token, c.metaCallId, sdp);
  } catch (e) {
    const msg = metaMessage(e, "Meta did not accept the answer.");
    await finish({ ...c, status: "connecting" }, "failed", { error: msg });
    throw new ApiError("CONFLICT", msg);
  }
  const done = await db.waCall.update({ where: { id }, data: { status: "active", answeredAt: new Date() } });
  await audit({ action: "whatsapp.call", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "wa_call", targetId: id, metadata: { call: "answered" } });
  return toCallDto(done);
}

export async function hangUp(access: OrgAccess, id: string) {
  if (!can(access, "inbox:reply")) throw new ApiError("FORBIDDEN");
  const c = await db.waCall.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!c) throw new ApiError("NOT_FOUND", "Call not found.");
  if (!LIVE.includes(c.status)) return toCallDto(c);
  const t = await accountWithToken(access.organizationId, { id: c.whatsappAccountId });
  const declining = c.direction === "inbound" && c.status === "ringing";
  if (t?.token) {
    try {
      if (declining) await rejectCall(t.account.phoneNumberId, t.token, c.metaCallId);
      else await terminateCall(t.account.phoneNumberId, t.token, c.metaCallId);
    } catch (e) {
      console.error("[calls] hang up on Meta failed:", metaMessage(e, "unknown"));
    }
  }
  return toCallDto(await finish(c, declining ? "rejected" : "ended"));
}

/** Places a call to the customer of a WhatsApp chat with the browser's SDP offer. */
export async function startOutbound(access: OrgAccess, conversationId: string, sdp: string) {
  await assertCalling(access);
  const conv = await getVisibleConversation(access, conversationId);
  if (!conv.whatsappAccountId) throw new ApiError("CONFLICT", "Calls work on WhatsApp chats only.");
  const t = await accountWithToken(access.organizationId, { id: conv.whatsappAccountId });
  if (!t?.token) throw new ApiError("CONFLICT", "This number has no active Meta connection.");
  if (!t.account.callingEnabled) throw new ApiError("CONFLICT", "WhatsApp calling is off for this number. Turn it on in WhatsApp → number settings.");
  const contact = await db.contact.findUniqueOrThrow({ where: { id: conv.contactId } });
  if (contact.suppressed || contact.optInStatus === "opted_out") throw new ApiError("CONFLICT", "This contact opted out. Calls are blocked.");
  const busy = await db.waCall.count({ where: { organizationId: access.organizationId, startedByUserId: access.user.id, status: { in: LIVE } } });
  if (busy) throw new ApiError("CONFLICT", "You are already on a call.");
  let metaCallId: string;
  try {
    metaCallId = await startCall(t.account.phoneNumberId, t.token, contact.phone, sdp);
  } catch (e) {
    const msg = metaMessage(e, "Meta could not place the call.");
    throw new ApiError("CONFLICT", /permission/i.test(msg) ? `${msg} Ask the customer for permission to call first.` : msg);
  }
  const c = await db.waCall.create({
    data: { organizationId: access.organizationId, whatsappAccountId: t.account.id, contactId: contact.id, metaCallId, direction: "outbound", status: "connecting", peerPhone: contact.phone, peerName: contact.name, offerSdp: sdp, startedByUserId: access.user.id },
  });
  return toCallDto(c);
}

/** Sends the customer WhatsApp's "allow calls" request (needed before we can call them). */
export async function requestPermission(access: OrgAccess, conversationId: string) {
  await assertCalling(access);
  const conv = await getVisibleConversation(access, conversationId);
  if (!conv.whatsappAccountId) throw new ApiError("CONFLICT", "Calls work on WhatsApp chats only.");
  if (!conv.lastInboundAt || Date.now() - conv.lastInboundAt.getTime() >= 24 * 60 * 60 * 1000) {
    throw new ApiError("CONFLICT", "The 24-hour window is closed. Ask for call permission after the customer writes to you.");
  }
  const t = await accountWithToken(access.organizationId, { id: conv.whatsappAccountId });
  if (!t?.token) throw new ApiError("CONFLICT", "This number has no active Meta connection.");
  const contact = await db.contact.findUniqueOrThrow({ where: { id: conv.contactId } });
  const text = "We'd like to call you on WhatsApp to help you faster. Is that okay?";
  let externalId = "";
  try {
    externalId = await sendCallPermissionRequest(t.account.phoneNumberId, t.token, contact.phone, text);
  } catch (e) {
    throw new ApiError("CONFLICT", metaMessage(e, "Meta could not send the request."));
  }
  const m = await db.message.create({
    data: { organizationId: access.organizationId, conversationId: conv.id, direction: "outbound", type: "interactive", body: `📞 ${text}`, payload: JSON.stringify({ callPermissionRequest: true }), status: "sent", externalId: externalId || null, sentAt: new Date(), senderUserId: access.user.id },
  });
  publish(access.organizationId, { type: "message.created", conversationId: conv.id, messageId: m.id, assignedToUserId: conv.assignedToUserId });
  return { sent: true };
}

/** Turns WhatsApp calling on/off for one number (owner). */
export async function setNumberCalling(access: OrgAccess, accountId: string, enabled: boolean) {
  if (!can(access, "whatsapp:manage")) throw new ApiError("FORBIDDEN");
  if (enabled && !(await hasFeature(access.organizationId, "calling"))) throw new ApiError("FORBIDDEN", "Calling isn't included in this workspace's plan.");
  const t = await accountWithToken(access.organizationId, { id: accountId });
  if (!t) throw new ApiError("NOT_FOUND", "Connected number not found.");
  if (!t.token || t.account.isDemo) throw new ApiError("CONFLICT", "Calling needs a live connected number.");
  try {
    await setCallingSettings(t.account.phoneNumberId, t.token, enabled);
  } catch (e) {
    throw new ApiError("CONFLICT", metaMessage(e, "Meta did not accept the calling setting."));
  }
  await db.whatsAppAccount.update({ where: { id: accountId }, data: { callingEnabled: enabled } });
  await audit({ action: "whatsapp.account_event", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "whatsapp_account", targetId: accountId, metadata: { calling: enabled } });
  return { callingEnabled: enabled };
}
