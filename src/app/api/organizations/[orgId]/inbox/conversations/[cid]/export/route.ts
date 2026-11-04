import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { orgRoute } from "@/lib/route-helpers";
import { getVisibleConversation } from "@/services/inbox/conversations";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

/** Plain-text transcript of a conversation (internal notes marked), for records or a customer request. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "contacts:export");
  const conv = await getVisibleConversation(access, ids.cid);
  const msgs = await db.message.findMany({ where: { conversationId: conv.id, organizationId: access.organizationId }, orderBy: { createdAt: "asc" }, take: 5000, select: { direction: true, type: true, body: true, createdAt: true, sender: { select: { name: true, email: true } } } });
  const who = conv.contact.name || conv.contact.phone;
  const lines = [
    `Conversation with ${who} (${conv.contact.phone}) · ${conv.channel}`,
    `Exported ${fmt.format(new Date())} by ${access.user.name || access.user.email}`,
    "",
    ...msgs.map((m) => {
      const from = m.type === "note" ? `[internal note] ${m.sender?.name || m.sender?.email || "Team"}` : m.direction === "inbound" ? who : m.sender?.name || m.sender?.email || "Business";
      return `[${fmt.format(m.createdAt)}] ${from}: ${m.body || `(${m.type})`}`;
    }),
  ];
  await audit({ action: "inbox.exported", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "conversation", targetId: conv.id, metadata: { messages: msgs.length }, req });
  return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="chat-${conv.contact.phone.replace(/\D/g, "") || conv.id}.txt"`, "cache-control": "no-store" } });
});
