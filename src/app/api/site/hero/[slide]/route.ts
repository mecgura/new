import { heroPhoto } from "@/services/site/hero";

export const dynamic = "force-dynamic";

/** Public home page hero photo. The URL carries ?v=<photo id>, so a new photo gets a new URL and this can cache long. */
export async function GET(_req: Request, { params }: { params: Promise<{ slide: string }> }) {
  const photo = await heroPhoto((await params).slide);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: { "Content-Type": photo.mimeType, "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff" },
  });
}
