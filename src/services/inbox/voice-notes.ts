import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { downloadMedia } from "@/providers/meta/messages";
import { transcribeAudio, transcriptionConfigured } from "@/providers/ai/transcribe";

/** Turns a customer's WhatsApp voice note into text. "" when switched off, not set up, or anything fails. */
export async function transcribeVoiceNote(organizationId: string, whatsappAccountId: string, mediaId: string): Promise<string> {
  try {
    if (!mediaId || !transcriptionConfigured()) return "";
    const settings = await db.organizationSettings.findUnique({ where: { organizationId }, select: { voiceNotes: true } });
    if (settings && !settings.voiceNotes) return "";
    const acc = await db.whatsAppAccount.findFirst({ where: { id: whatsappAccountId, organizationId }, select: { connection: { select: { encryptedAccessToken: true } } } });
    if (!acc?.connection?.encryptedAccessToken) return "";
    const media = await downloadMedia(mediaId, decryptSecret(acc.connection.encryptedAccessToken));
    if (media.size > 8 * 1024 * 1024) return "";
    const bytes = Buffer.from(await new Response(media.body).arrayBuffer());
    return await transcribeAudio(bytes, media.mimeType);
  } catch (e) {
    console.error("[voice-notes] transcription failed:", e);
    return "";
  }
}
