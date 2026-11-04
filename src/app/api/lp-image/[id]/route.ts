import { imageBytes } from "@/services/landing/pages";

type Ctx = { params: Promise<{ id: string }> };

/** Public: a landing page photo. Images never change, so browsers and CDNs may keep them for a year. */
export async function GET(_req: Request, { params }: Ctx) {
  const img = await imageBytes((await params).id);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.data), { headers: { "content-type": img.mimeType, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}
