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

/** Publishes to a Facebook Page: a photo post when there is an image URL, otherwise a text post. Returns the post id. */
export async function publishFacebookPost(token: string, pageId: string, caption: string, imageUrl?: string) {
  if (imageUrl) {
    const r = await graph<{ id?: string; post_id?: string }>(`${pageId}/photos`, { token, method: "POST", body: { url: imageUrl, caption } });
    return r.post_id ?? r.id ?? "";
  }
  const r = await graph<{ id?: string }>(`${pageId}/feed`, { token, method: "POST", body: { message: caption } });
  return r.id ?? "";
}

/** Publishes an image post to an Instagram business account (create the container, then publish it). Returns the media id. */
export async function publishInstagramPost(token: string, igUserId: string, caption: string, imageUrl: string) {
  const c = await graph<{ id?: string }>(`${igUserId}/media`, { token, method: "POST", body: { image_url: imageUrl, caption } });
  if (!c.id) throw new Error("Instagram did not accept the image.");
  const r = await graph<{ id?: string }>(`${igUserId}/media_publish`, { token, method: "POST", body: { creation_id: c.id }, timeoutMs: 30_000 });
  return r.id ?? "";
}
