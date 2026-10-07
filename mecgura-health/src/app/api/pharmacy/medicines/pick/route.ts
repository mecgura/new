import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { pickMedicines } from "@/lib/services/pharmacy-master";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => pickMedicines(ctx, new URL(req.url).searchParams.get("q") ?? ""));
