import sharp from "sharp";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { RATIOS, RATIO_KEYS, type Ratio } from "@/lib/onepost-media";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { BLOB_URL_RE, IMAGE_TYPES, MAX_BLOB_IMAGE_BYTES, blobConfigured, blobPrefix, deleteBlobs, fetchBlobBytes, headBlob, putBlob } from "@/services/onepost/storage";
import { canEditPost, getPost, resetApprovalFor } from "@/services/onepost/posts";

export const variantsSchema = z.object({ ratios: z.array(z.enum(RATIO_KEYS)).min(1).max(RATIO_KEYS.length), watermark: z.boolean().default(false) });
export const thumbnailSchema = z.object({ url: z.string().url().max(600) });

const baseName = (n: string) => n.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 60) || "photo";

async function originalBytes(m: { storage: string; blobUrl: string; bytes: Uint8Array | Buffer }) {
  return m.storage === "blob" && m.blobUrl ? fetchBlobBytes(m.blobUrl, MAX_BLOB_IMAGE_BYTES) : new Uint8Array(m.bytes);
}

/** Crops (never stretches) to the shape, keeping the interesting part, and puts the brand logo in the bottom-right corner when asked. */
export async function renderVariant(source: Uint8Array, ratio: Ratio, logo?: Uint8Array | null): Promise<{ bytes: Uint8Array<ArrayBuffer>; width: number; height: number }> {
  const { w, h } = RATIOS[ratio];
  let img = sharp(source, { failOn: "none" }).rotate().resize(w, h, { fit: "cover", position: "attention" });
  if (logo) {
    const lw = Math.round(w * 0.18);
    const l = await sharp(logo, { failOn: "none" }).resize({ width: lw, withoutEnlargement: false }).ensureAlpha().png().toBuffer({ resolveWithObject: true });
    const margin = Math.round(w * 0.03);
    img = sharp(await img.jpeg({ quality: 92 }).toBuffer()).composite([{ input: l.data, left: Math.max(0, w - l.info.width - margin), top: Math.max(0, h - l.info.height - margin) }]);
  }
  const bytes = await img.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return { bytes: Uint8Array.from(bytes), width: w, height: h };
}

/** Makes resized copies (1:1, 4:5, 9:16, 16:9) of one photo, optionally with the logo. A copy of the same shape and logo setting is replaced, not duplicated. */
export async function createVariants(a: OrgAccess, postId: string, mediaId: string, input: z.infer<typeof variantsSchema>, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const post = await db.onePost.findFirst({ where: { id: postId, organizationId: a.organizationId } });
  if (!post) throw new ApiError("NOT_FOUND", "Post not found.");
  if (!canEditPost(a, post)) throw new ApiError("FORBIDDEN", "You can't edit this post right now.");
  const m = await db.onePostMedia.findFirst({ where: { id: mediaId, postId, organizationId: a.organizationId } });
  if (!m || m.kind !== "image" || m.variantOf) throw new ApiError("NOT_FOUND", "Choose one of the post's original photos.");
  let logo: Uint8Array | null = null;
  if (input.watermark) {
    const b = await db.onePostBrand.findUnique({ where: { organizationId: a.organizationId }, select: { logo: true } });
    if (!b?.logo) throw new ApiError("VALIDATION_ERROR", "Upload your logo in the brand profile first, or turn the logo off.", { details: { watermark: ["No logo"] } });
    logo = new Uint8Array(b.logo);
  }
  let source: Uint8Array;
  try {
    source = await originalBytes(m);
  } catch (e) {
    throw new ApiError("SERVICE_UNAVAILABLE", e instanceof Error ? e.message : "The photo could not be read.");
  }
  const made: string[] = [];
  const dropped: string[] = [];
  const position = (await db.onePostMedia.count({ where: { postId, organizationId: a.organizationId } })) + 1;
  let n = 0;
  for (const ratio of new Set(input.ratios)) {
    let out;
    try {
      out = await renderVariant(source, ratio, logo);
    } catch {
      throw new ApiError("VALIDATION_ERROR", "That image can't be resized. Try a JPG or PNG.");
    }
    const old = await db.onePostMedia.findMany({ where: { postId, organizationId: a.organizationId, variantOf: m.id, ratio, watermarked: input.watermark } });
    const name = `${baseName(m.name)}-${ratio.replace(":", "x")}${input.watermark ? "-logo" : ""}.jpg`;
    const row: { storage: string; blobUrl: string; blobPath: string; bytes: Uint8Array<ArrayBuffer> } = blobConfigured()
      ? await putBlob(a.organizationId, postId, name, out.bytes, "image/jpeg").then((b) => ({ storage: "blob", blobUrl: b.url, blobPath: b.pathname, bytes: new Uint8Array(0) }))
      : { storage: "db", blobUrl: "", blobPath: "", bytes: out.bytes };
    await db.onePostMedia.create({ data: { organizationId: a.organizationId, postId, name, mimeType: "image/jpeg", sizeBytes: out.bytes.length, kind: "image", variantOf: m.id, ratio, watermarked: input.watermark, position: position + n++, ...row } });
    if (old.length) {
      await db.onePostMedia.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      dropped.push(...old.filter((o) => o.storage === "blob").map((o) => o.blobUrl));
    }
    made.push(ratio);
  }
  await deleteBlobs(dropped);
  await resetApprovalFor(a, post);
  await audit({ action: "onepost.updated", actorUserId: a.user.id, organizationId: a.organizationId, targetType: "onepost", targetId: postId, metadata: { media: "variants", ratios: made, watermark: input.watermark }, req });
  return getPost(a, postId);
}

/** Saves the cover frame a person picked for a video (the browser grabbed it and uploaded it to Blob). */
export async function setVideoThumbnail(a: OrgAccess, postId: string, mediaId: string, url: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const post = await db.onePost.findFirst({ where: { id: postId, organizationId: a.organizationId } });
  if (!post) throw new ApiError("NOT_FOUND", "Post not found.");
  if (!canEditPost(a, post)) throw new ApiError("FORBIDDEN", "You can't edit this post right now.");
  const m = await db.onePostMedia.findFirst({ where: { id: mediaId, postId, organizationId: a.organizationId } });
  if (!m || m.kind !== "video") throw new ApiError("NOT_FOUND", "Choose one of the post's videos.");
  if (!BLOB_URL_RE.test(url)) throw new ApiError("VALIDATION_ERROR", "That isn't an uploaded image.");
  const h = await headBlob(url);
  if (!h.pathname.startsWith(blobPrefix(a.organizationId, postId))) throw new ApiError("FORBIDDEN", "That file belongs to a different post.");
  if (!IMAGE_TYPES.includes(h.contentType.toLowerCase()) || h.size > MAX_BLOB_IMAGE_BYTES) {
    await deleteBlobs([h.url]);
    throw new ApiError("VALIDATION_ERROR", "The cover must be a JPG, PNG or WebP image up to 8 MB.");
  }
  const old = m.thumbUrl;
  await db.onePostMedia.update({ where: { id: m.id }, data: { thumbUrl: h.url } });
  if (old && old !== h.url) await deleteBlobs([old]);
  await resetApprovalFor(a, post);
  await audit({ action: "onepost.updated", actorUserId: a.user.id, organizationId: a.organizationId, targetType: "onepost", targetId: postId, metadata: { media: "thumbnail" }, req });
  return getPost(a, postId);
}
