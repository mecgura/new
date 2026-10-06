/**
 * Server-side image validation for logos/favicons/avatars. Never trusts the client's MIME type or
 * file name: the file's magic bytes decide. SVG is rejected on purpose (script/XSS risk).
 */
export const IMAGE_LIMITS = {
  LOGO: 512 * 1024,
  FAVICON: 128 * 1024,
  AVATAR: 512 * 1024,
} as const;
export type ImageKind = keyof typeof IMAGE_LIMITS;

export function sniffImage(buf: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | "image/x-icon" | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && String.fromCharCode(...buf.slice(0, 4)) === "RIFF" && String.fromCharCode(...buf.slice(8, 12)) === "WEBP") return "image/webp";
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return "image/x-icon";
  return null;
}

export function validateImage(kind: ImageKind, buf: Uint8Array): { ok: true; mime: string } | { ok: false; message: string } {
  if (buf.length === 0) return { ok: false, message: "The file is empty." };
  if (buf.length > IMAGE_LIMITS[kind]) return { ok: false, message: `Image must be ${Math.round(IMAGE_LIMITS[kind] / 1024)} KB or smaller.` };
  const mime = sniffImage(buf);
  if (!mime) return { ok: false, message: "Use a PNG, JPG or WebP image." };
  if (mime === "image/x-icon" && kind !== "FAVICON") return { ok: false, message: "Use a PNG, JPG or WebP image." };
  return { ok: true, mime };
}
