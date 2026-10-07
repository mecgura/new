import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { createItem, listItems } from "@/lib/services/website-items";

export const dynamic = "force-dynamic";

// resource ∈ services | testimonials | faq | articles (anything else is a 404 from the service)
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "website.view" }, async ({ req, ctx, params }) => {
  const sp = new URL(req.url).searchParams;
  return listItems(ctx, params.resource, { status: sp.get("status") ?? undefined, q: sp.get("q") ?? undefined, page: Number(sp.get("page")) || 1 });
});
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => createItem(ctx, params.resource, await readJson(req)));
