import { db } from "@/lib/db";
import { deleteBlobs } from "@/services/onepost/storage";

/** Deletes stored files only when no photo, video or cover in this workspace still points at them (event posts share files). */
export async function deleteUnreferencedBlobs(organizationId: string, urls: string[]) {
  const unique = [...new Set(urls.filter(Boolean))];
  if (!unique.length) return;
  const still = await db.onePostMedia.findMany({ where: { organizationId, OR: [{ blobUrl: { in: unique } }, { thumbUrl: { in: unique } }] }, select: { blobUrl: true, thumbUrl: true } });
  const used = new Set(still.flatMap((m) => [m.blobUrl, m.thumbUrl]));
  await deleteBlobs(unique.filter((u) => !used.has(u)));
}
