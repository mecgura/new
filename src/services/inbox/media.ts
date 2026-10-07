import type { MediaKind } from "@/services/inbox/messaging";

/** WhatsApp-supported types with MECGURA's per-type size caps (bytes). */
export const ALLOWED_MEDIA: Record<MediaKind, { types: string[]; max: number }> = {
  image: { types: ["image/jpeg", "image/png"], max: 5 * 1024 * 1024 },
  video: { types: ["video/mp4", "video/3gpp"], max: 16 * 1024 * 1024 },
  audio: { types: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"], max: 16 * 1024 * 1024 },
  document: {
    types: [
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    max: 16 * 1024 * 1024,
  },
};

export function kindFor(mime: string): MediaKind | null {
  return (Object.keys(ALLOWED_MEDIA) as MediaKind[]).find((k) => ALLOWED_MEDIA[k].types.includes(mime)) ?? null;
}

