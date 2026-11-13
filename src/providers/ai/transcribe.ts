/**
 * Voice note → text. Uses Google Gemini when GEMINI_API_KEY is set, otherwise OpenAI. Returns "" when no key is set,
 * the audio is too large, or the provider fails: a voice note without text is still a normal message.
 */
const MAX_BYTES = 8 * 1024 * 1024;
const PROMPT =
  "Write down exactly what is said in this voice note. Keep the speaker's language (Hindi, Punjabi, English or a mix) and write Hindi or Punjabi words in Roman letters the way people type on WhatsApp. Reply with the words only, no notes. If nothing can be heard, reply with an empty line.";

export const transcriptionConfigured = () => Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());

export async function transcribeAudio(bytes: Buffer, mimeType: string, timeoutMs = 9000): Promise<string> {
  if (!bytes.length || bytes.length > MAX_BYTES) return "";
  const mime = mimeType.split(";")[0].trim() || "audio/ogg";
  try {
    const gemini = process.env.GEMINI_API_KEY?.trim();
    if (gemini) {
      const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": gemini },
        body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: bytes.toString("base64") } }] }], generationConfig: { temperature: 0 } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return "";
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return clean(data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "");
    }
    const openai = process.env.OPENAI_API_KEY?.trim();
    if (openai) {
      const form = new FormData();
      form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
      form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `voice.${mime.includes("mpeg") ? "mp3" : mime.includes("mp4") ? "m4a" : "ogg"}`);
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${openai}` }, body: form, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return "";
      return clean(((await res.json()) as { text?: string }).text ?? "");
    }
  } catch {
    /* fall through: no transcript */
  }
  return "";
}

const clean = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 2000);
