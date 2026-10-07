import { buildRobots } from "@/lib/website/seo";
import { getOrigin, getPublicSite } from "@/lib/website/request";

export const dynamic = "force-dynamic";

export async function GET() {
  const loaded = await getPublicSite();
  if (!loaded) return new Response("Not found", { status: 404 });
  const indexable = loaded.load.kind === "ok" && loaded.load.site.content.seo.indexable;
  return new Response(buildRobots(await getOrigin(), { indexable }), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
