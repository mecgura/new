import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listDoctors } from "@/lib/services/website-doctors";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "website.view" }, async ({ ctx }) => listDoctors(ctx));
