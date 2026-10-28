import { postMedia } from "@/services/social/posts";

export const dynamic = "force-dynamic";

/** Post image for Meta to fetch while publishing, and for the calendar preview. The key is random per post. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const m = await postMedia((await params).key);
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(m.bytes), { headers: { "Content-Type": m.type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
