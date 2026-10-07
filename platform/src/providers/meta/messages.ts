import { getMetaConfig } from "@/providers/meta/config";
import { graph, MetaApiError } from "@/providers/meta/graph";

/** WhatsApp Cloud API message payload (the part after messaging_product/to). */
export type OutboundPayload =
  | { type: "text"; text: { body: string; preview_url?: boolean } }
  | { type: "image" | "video" | "audio" | "document"; image?: MediaRef; video?: MediaRef; audio?: MediaRef; document?: MediaRef & { filename?: string } }
  | { type: "template"; template: { name: string; language: { code: string }; components?: unknown[] } }
  | { type: "interactive"; interactive: { type: "button"; body: { text: string }; action: { buttons: { type: "reply"; reply: { id: string; title: string } }[] } } }
  | {
      type: "interactive";
      interactive: {
        type: "flow";
        body: { text: string };
        action: {
          name: "flow";
          parameters: { flow_message_version: "3"; flow_token: string; flow_id: string; flow_cta: string; flow_action: "navigate"; flow_action_payload: { screen: string } };
        };
      };
    };

type MediaRef = { id?: string; link?: string; caption?: string };

export async function sendMessage(phoneNumberId: string, token: string, to: string, payload: OutboundPayload, replyToExternalId?: string): Promise<{ externalId: string }> {
  const r = await graph<{ messages?: { id: string }[] }>(`${phoneNumberId}/messages`, {
    token,
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/^\+/, ""),
      ...(replyToExternalId ? { context: { message_id: replyToExternalId } } : {}),
      ...payload,
    },
  });
  const id = r.messages?.[0]?.id;
  if (!id) throw new MetaApiError("Meta didn't return a message id.", 502);
  return { externalId: id };
}

/** Uploads bytes to Meta's media store (multipart) and returns the media id. Nothing is stored by MECGURA. */
export async function uploadMedia(phoneNumberId: string, token: string, file: Blob, filename: string, mimeType: string): Promise<string> {
  const { graphVersion } = getMetaConfig();
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", mimeType);
  form.set("file", file, filename);
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new MetaApiError("Couldn't reach Meta to upload the file.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) throw new MetaApiError(data.error?.message ?? "Meta rejected the upload.", res.status);
  return data.id;
}

/** Resolves a media id to a short-lived download URL and downloads it with the token. */
export async function downloadMedia(mediaId: string, token: string): Promise<{ body: ReadableStream<Uint8Array>; mimeType: string; size: number }> {
  const meta = await graph<{ url?: string; mime_type?: string; file_size?: number }>(mediaId, { token });
  if (!meta.url) throw new MetaApiError("Media is no longer available from Meta.", 404);
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok || !res.body) throw new MetaApiError("Couldn't download media from Meta.", res.status);
  return { body: res.body, mimeType: meta.mime_type ?? "application/octet-stream", size: meta.file_size ?? 0 };
}
