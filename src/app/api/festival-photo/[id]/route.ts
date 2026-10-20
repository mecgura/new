import { festivalPhoto } from "@/services/site/festivals";

export const dynamic = "force-dynamic";

/** Public festival banner image (shown on the home page and in client greetings). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const photo = await festivalPhoto((await params).id);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.bytes), { headers: { "Content-Type": photo.type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
