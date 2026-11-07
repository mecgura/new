import { adImage } from "@/services/sponsored/sponsored";

export const dynamic = "force-dynamic";

/** The picture on a Sponsored card. The key is random per ad. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const m = await adImage((await params).key);
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(m.bytes), { headers: { "Content-Type": m.mime, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
