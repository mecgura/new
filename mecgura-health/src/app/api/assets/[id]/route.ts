import { db } from "@/lib/db";
import { getContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

/**
 * Serves stored images. LOGO and FAVICON are public branding (needed on the login page).
 * AVATAR images require a signed-in user of the SAME clinic (or a Super Admin). Anything else is a 404,
 * so the existence of another clinic's asset is never revealed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await db.tenantAsset.findUnique({ where: { id } });
  const notFound = new Response("Not found", { status: 404 });
  if (!asset) return notFound;
  if (asset.kind === "AVATAR") {
    const ctx = await getContext();
    const allowed = !!ctx && (ctx.permissions.has("platform.manage") || ctx.user.tenantId === asset.tenantId);
    if (!allowed) return notFound;
  }
  return new Response(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.mimeType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": asset.kind === "AVATAR" ? "private, max-age=300" : "public, max-age=300",
    },
  });
}
