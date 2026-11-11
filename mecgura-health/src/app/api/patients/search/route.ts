import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { searchPatients } from "@/lib/services/patients";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => searchPatients(ctx, { q: new URL(req.url).searchParams.get("q") ?? "" }));
