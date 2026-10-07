import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { billingStatusFor } from "@/lib/services/billing-invoices";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return billingStatusFor(ctx, s.get("kind") ?? "", s.get("id") ?? ""); });
