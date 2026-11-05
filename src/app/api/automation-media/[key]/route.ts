import { automationMedia } from "@/services/automations/media";

export const dynamic = "force-dynamic";

/** Image / brochure that an automation message sends. WhatsApp fetches it by this link; the key is random per file. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const m = await automationMedia((await params).key);
  if (!m) return new Response("Not found", { status: 404 });
  const disposition = m.kind === "document" ? `inline; filename="${m.filename.replace(/"/g, "")}"` : "inline";
  return new Response(new Uint8Array(m.bytes), { headers: { "Content-Type": m.mimeType, "Content-Disposition": disposition, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
