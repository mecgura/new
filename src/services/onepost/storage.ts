import { del, head, put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api";

/**
 * OnePost's own file storage (Vercel Blob, public URLs with unguessable names, because Instagram, Facebook, LinkedIn and Google
 * fetch images from a link). The older Social Media module keeps its own database storage and is not touched.
 * BLOB_READ_WRITE_TOKEN comes from the Vercel Blob store connected to the project; it is never sent to the browser.
 */
export const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const MAX_BLOB_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_BLOB_VIDEO_BYTES = 300 * 1024 * 1024;

/** Only links to this project's Blob stores are ever fetched or stored. */
export const BLOB_URL_RE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[^\s]+$/i;
export const blobPrefix = (organizationId: string, postId: string) => `onepost/${organizationId}/${postId}/`;

export function requireBlob() {
  if (!blobConfigured()) throw new ApiError("SERVICE_UNAVAILABLE", "File storage isn't set up on this server yet (Vercel Blob). Ask MECGURA to connect it.");
}

const safeName = (n: string) => n.replace(/[^\w.-]+/g, "_").slice(-80) || "file";

export async function putBlob(organizationId: string, postId: string, name: string, bytes: Uint8Array, contentType: string) {
  requireBlob();
  const r = await put(`${blobPrefix(organizationId, postId)}${randomBytes(6).toString("hex")}-${safeName(name)}`, Buffer.from(bytes), { access: "public", contentType, addRandomSuffix: true });
  return { url: r.url, pathname: r.pathname };
}

export async function deleteBlobs(urls: string[]) {
  const ok = urls.filter((u) => BLOB_URL_RE.test(u));
  if (!ok.length || !blobConfigured()) return;
  await del(ok).catch((e) => console.error("[onepost] blob delete failed:", e));
}

/** Size, type and path of a file a browser uploaded straight to Blob. */
export async function headBlob(url: string) {
  requireBlob();
  if (!BLOB_URL_RE.test(url)) throw new ApiError("VALIDATION_ERROR", "That isn't an uploaded file.");
  const h = await head(url).catch(() => null);
  if (!h) throw new ApiError("NOT_FOUND", "The uploaded file wasn't found.");
  return { size: h.size, contentType: h.contentType, pathname: h.pathname, url: h.url };
}

/** The bytes of a stored file, for platforms that need the file itself (LinkedIn, WordPress). */
export async function fetchBlobBytes(url: string, maxBytes = MAX_BLOB_IMAGE_BYTES): Promise<Uint8Array> {
  if (!BLOB_URL_RE.test(url)) throw new Error("Unexpected file location.");
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`The stored file could not be read (${res.status}).`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("The file is too large to send to this channel.");
  return buf;
}
