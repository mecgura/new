import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { searchMedicines } from "@/lib/services/medicines";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => searchMedicines(ctx, new URL(req.url).searchParams.get("q") ?? ""));
