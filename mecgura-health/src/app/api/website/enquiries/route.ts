import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listEnquiries } from "@/lib/services/enquiries";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "enquiries.view" }, async ({ req, ctx }) => {
  const sp = new URL(req.url).searchParams;
  return listEnquiries(ctx, { status: sp.get("status") ?? undefined, q: sp.get("q") ?? undefined, page: Number(sp.get("page")) || 1 });
});
