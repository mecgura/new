import { graph } from "@/providers/meta/graph";

/** Checks that a Page (Messenger) or Instagram professional account id matches the token, and returns its display name. */
export async function verifySocialAccount(kind: "messenger" | "instagram", id: string, token: string) {
  const r = await graph<{ id: string; name?: string; username?: string }>(id, { token, query: { fields: kind === "instagram" ? "id,username" : "id,name" } });
  if (r.id !== id) throw new Error("Token belongs to a different account");
  return r.username ?? r.name ?? id;
}

/** Sends a plain-text reply inside the 24-hour standard messaging window (Messenger and Instagram DM). */
export async function sendSocialMessage(token: string, recipientId: string, text: string) {
  const r = await graph<{ message_id?: string }>("me/messages", {
    token,
    method: "POST",
    body: { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: text.slice(0, 1000) } },
  });
  return r.message_id ?? "";
}
