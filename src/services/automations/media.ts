import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { siteConfig } from "@/config/site";
import type { OrgAccess } from "@/lib/session";

/** Request bodies on the host are capped near 4.5 MB, so uploads stay under these. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png"];

const sniff = (b: Buffer) =>
  b.subarray(0, 4).toString("hex") === "25504446" ? "application/pdf" : b.subarray(0, 3).toString("hex") === "ffd8ff" ? "image/jpeg" : b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" ? "image/png" : "";

export const automationMediaUrl = (key: string) => `${siteConfig.url}/api/automation-media/${key}`;

/** Stores an image (JPG/PNG) or a brochure (PDF) for automation messages and returns its public link. */
export async function uploadAutomationMedia(access: OrgAccess, input: { filename: string; data: string }, req?: Request) {
  const bytes = Buffer.from(input.data.replace(/^data:[^;]+;base64,/, ""), "base64");
  const mime = sniff(bytes);
  if (!mime) throw new ApiError("VALIDATION_ERROR", "Upload a JPG or PNG image, or a PDF brochure.", { details: { data: ["Unsupported file"] } });
  const kind = IMAGE_TYPES.includes(mime) ? "image" : "document";
  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
  if (bytes.length > max) throw new ApiError("VALIDATION_ERROR", `Files up to ${Math.round(max / 1024 / 1024)} MB. Compress it (e.g. ilovepdf.com) and try again.`, { details: { data: ["Too large"] } });
  const filename = (input.filename.trim().replace(/[^\w .()-]/g, "").slice(0, 100) || (kind === "image" ? "image.jpg" : "Brochure.pdf")).replace(/\.pdf$/i, "") + (kind === "document" ? ".pdf" : "");
  const count = await db.automationMedia.count({ where: { organizationId: access.organizationId } });
  if (count >= 200) throw new ApiError("CONFLICT", "You have 200 files already. Remove unused automations' files first.");
  const row = await db.automationMedia.create({ data: { organizationId: access.organizationId, key: randomBytes(18).toString("base64url"), kind, mimeType: mime, filename, size: bytes.length, bytes } });
  await audit({ action: "automation.media_uploaded", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "automation_media", targetId: row.id, metadata: { kind, size: bytes.length }, req });
  return { kind: kind as "image" | "document", url: automationMediaUrl(row.key), filename: kind === "document" ? filename : "", size: bytes.length };
}

export async function automationMedia(key: string) {
  if (!/^[\w-]{20,40}$/.test(key)) return null;
  return db.automationMedia.findUnique({ where: { key }, select: { bytes: true, mimeType: true, filename: true, kind: true } });
}
